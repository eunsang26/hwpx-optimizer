import { lstat, open, unlink } from "node:fs/promises";
import { dirname, join, basename, extname } from "node:path";

export type ClaimedPath = { path: string; dev: string; ino: string; birthtimeNs: string; ctimeNs: string };

async function createClaim(preferredPath: string): Promise<ClaimedPath> {
  const dir = dirname(preferredPath);
  const ext = extname(preferredPath);
  const stem = basename(preferredPath, ext);
  for (let i = 0; ; i += 1) {
    const candidate = i === 0 ? preferredPath : join(dir, `${stem} (${i})${ext}`);
    try {
      const handle = await open(candidate, "wx");
      try {
        const identity = await handle.stat({ bigint: true });
        return { path: candidate, dev: String(identity.dev), ino: String(identity.ino),
          birthtimeNs: String(identity.birthtimeNs), ctimeNs: String(identity.ctimeNs) };
      } finally { await handle.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }
}

export async function claimPath(preferredPath: string): Promise<string> {
  return (await createClaim(preferredPath)).path;
}

export async function releaseOwnedClaim(claim: ClaimedPath): Promise<void> {
  try {
    const current = await lstat(claim.path, { bigint: true });
    if (current.isFile() && current.size === 0n && String(current.dev) === claim.dev && String(current.ino) === claim.ino &&
      String(current.birthtimeNs) === claim.birthtimeNs && String(current.ctimeNs) === claim.ctimeNs) {
      await unlink(claim.path);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export class PathClaimRegistry {
  private readonly claimed = new Map<string, ClaimedPath>();
  constructor(private readonly onClaim?: (claim: ClaimedPath) => Promise<void>) {}
  async claim(preferredPath: string): Promise<string> {
    const claim = await createClaim(preferredPath);
    this.claimed.set(claim.path, claim);
    try {
      await this.onClaim?.(claim);
      return claim.path;
    } catch (error) {
      await this.release(claim.path);
      throw error;
    }
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
