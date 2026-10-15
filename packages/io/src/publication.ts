import { constants, createReadStream } from "node:fs";
import { link, lstat, mkdir, open, rmdir, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { BigIntStats } from "node:fs";

export type ClaimedPath = {
  path: string; dev: string; ino: string; birthtimeNs: string; ctimeNs: string;
  /** Absent only in legacy batch journals that reserved empty files. */
  kind?: "directory";
};
export type OwnedArtifact = {
  path: string; dev: string; ino: string; birthtimeNs: string; mtimeNs: string; size: string;
};
function sameIdentity(stat: BigIntStats, identity: { dev: string; ino: string; birthtimeNs: string }): boolean {
  return String(stat.dev) === identity.dev && String(stat.ino) === identity.ino &&
    String(stat.birthtimeNs) === identity.birthtimeNs;
}
function artifactIdentity(path: string, stat: BigIntStats): OwnedArtifact {
  return { path, dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs),
    mtimeNs: String(stat.mtimeNs), size: String(stat.size) };
}

/** Only removes the file this operation created, with unchanged bytes and identity. */
export async function removeOwnedArtifact(artifact: OwnedArtifact): Promise<void> {
  try {
    const current = await lstat(artifact.path, { bigint: true });
    if (current.isFile() && sameIdentity(current, artifact) && String(current.mtimeNs) === artifact.mtimeNs &&
        String(current.size) === artifact.size) await unlink(artifact.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function writeStagedFile(path: string, data: Buffer | string): Promise<OwnedArtifact> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(data);
    return artifactIdentity(path, await handle.stat({ bigint: true }));
  } catch (error) {
    const partial = artifactIdentity(path, await handle.stat({ bigint: true }));
    await handle.close();
    await removeOwnedArtifact(partial);
    throw error;
  } finally { await handle.close(); }
}

/** Creates a new final entry; never replaces a file that appears during publication. */
export async function publishExclusiveFile(
  stage: string, target: string, operations: { link: typeof link } = { link }
): Promise<OwnedArtifact> {
  const source = await lstat(stage, { bigint: true });
  if (!source.isFile()) throw new Error(`Staged artifact is not a regular file: ${stage}`);
  let expected = artifactIdentity(target, source);
  try {
    await operations.link(stage, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!["EXDEV", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EPERM"].includes(code ?? "")) throw error;
    // FAT and some mounts cannot link. Stream into a newly opened inode while
    // retaining the exclusive-name guarantee. Never use overwrite-capable rename.
    const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      for await (const chunk of createReadStream(stage)) await handle.writeFile(chunk);
      expected = artifactIdentity(target, await handle.stat({ bigint: true }));
    } catch (copyError) {
      const partial = artifactIdentity(target, await handle.stat({ bigint: true }));
      await handle.close();
      await removeOwnedArtifact(partial);
      throw copyError;
    } finally { await handle.close(); }
  }
  const current = await lstat(target, { bigint: true });
  if (!current.isFile() || !sameIdentity(current, expected)) {
    throw new Error(`Artifact path changed during publication; replacement preserved: ${target}`);
  }
  return artifactIdentity(target, current);
}

async function createClaim(path: string): Promise<ClaimedPath> {
  // rmdir cannot remove a regular file if somebody replaces this reservation.
  await mkdir(path, { mode: 0o700 });
  const identity = await lstat(path, { bigint: true });
  if (!identity.isDirectory()) throw new Error(`Artifact reservation changed: ${path}`);
  return { path, dev: String(identity.dev), ino: String(identity.ino), birthtimeNs: String(identity.birthtimeNs),
    ctimeNs: String(identity.ctimeNs), kind: "directory" };
}

export async function releaseOwnedClaim(claim: ClaimedPath): Promise<void> {
  try {
    const current = await lstat(claim.path, { bigint: true });
    if (!sameIdentity(current, claim) || String(current.ctimeNs) !== claim.ctimeNs) return;
    if (claim.kind === "directory") {
      if (current.isDirectory()) await rmdir(claim.path);
    } else if (current.isFile() && current.size === 0n) await unlink(claim.path);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "ENOTDIR", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
  }
}

export class PathClaimRegistry {
  private readonly claimed = new Map<string, ClaimedPath>();
  constructor(private readonly onClaim?: (claim: ClaimedPath) => Promise<void>) {}
  async claim(preferred: string, style: "parentheses" | "dash" = "parentheses"): Promise<string> {
    const extension = extname(preferred);
    const stem = basename(preferred, extension);
    for (let index = 0; index < 10_000; index += 1) {
      const candidate = index === 0 ? preferred : join(dirname(preferred),
        `${stem}${style === "dash" ? `-${index + 1}` : ` (${index})`}${extension}`);
      let claim: ClaimedPath;
      try { claim = await createClaim(candidate); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw error;
      }
      return this.registerClaim(claim);
    }
    throw new Error(`No available artifact name: ${preferred}`);
  }
  async claimExact(path: string): Promise<string> {
    const claim = await createClaim(path);
    return this.registerClaim(claim);
  }
  private async registerClaim(claim: ClaimedPath): Promise<string> {
    this.claimed.set(claim.path, claim);
    try { await this.onClaim?.(claim); return claim.path; }
    catch (error) { await this.release(claim.path); throw error; }
  }
  async publish(stage: string, path: string): Promise<OwnedArtifact> {
    const claim = this.claimed.get(path);
    if (!claim) throw new Error(`Artifact path was not reserved: ${path}`);
    const current = await lstat(path, { bigint: true });
    if (!current.isDirectory() || !sameIdentity(current, claim) || String(current.ctimeNs) !== claim.ctimeNs) {
      throw new Error(`Artifact reservation changed; replacement preserved: ${path}`);
    }
    await rmdir(path);
    const artifact = await publishExclusiveFile(stage, path);
    this.claimed.delete(path);
    return artifact;
  }
  async release(path: string): Promise<void> {
    const claim = this.claimed.get(path);
    this.claimed.delete(path);
    if (claim) await releaseOwnedClaim(claim);
  }
  async releaseAll(): Promise<void> {
    await Promise.all([...this.claimed.values()].map(releaseOwnedClaim));
    this.claimed.clear();
  }
}

export async function claimPath(path: string): Promise<string> {
  return new PathClaimRegistry().claim(path);
}
