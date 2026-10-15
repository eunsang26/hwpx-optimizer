import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, readlink, realpath, rename, rmdir, stat, symlink, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { BigIntStats } from "node:fs";
import { PathClaimRegistry, publishExclusiveFile, removeOwnedArtifact, writeStagedFile } from "./publication.js";
import type { OwnedArtifact } from "./publication.js";

type StagedArtifact = { stage: string; target: string };
type Backup = { directory: string; entry?: OwnedArtifact; symbolicLink?: boolean };
type ArtifactState = StagedArtifact & { previous?: BigIntStats; backup?: Backup; published?: OwnedArtifact };
export type ArtifactOperations = {
  move?: typeof rename;
  write?: typeof writeStagedFile;
  publish?: (stage: string, target: string, claims: PathClaimRegistry) => Promise<OwnedArtifact>;
};
type SaveOptions = { overwrite?: boolean; claims?: PathClaimRegistry; operations?: ArtifactOperations };

export class ArtifactSaveError extends Error {
  constructor(readonly failedTarget: string, cause: unknown, readonly recoveryPaths: string[], rollbackErrors: string[]) {
    super(`Could not save artifact ${failedTarget}: ${message(cause)}. ${rollbackErrors.length
      ? `Rollback incomplete; preserved recovery files: ${recoveryPaths.join(", ")}. ${rollbackErrors.join("; ")}`
      : "The artifact set was rolled back; existing files were preserved."}`, { cause });
    this.name = "ArtifactSaveError";
  }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function snapshot(path: string, stat: BigIntStats): OwnedArtifact {
  return { path, dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs),
    mtimeNs: String(stat.mtimeNs), size: String(stat.size) };
}
function unchanged(stat: BigIntStats, entry: OwnedArtifact): boolean {
  return String(stat.dev) === entry.dev && String(stat.ino) === entry.ino &&
    String(stat.birthtimeNs) === entry.birthtimeNs && String(stat.mtimeNs) === entry.mtimeNs && String(stat.size) === entry.size;
}
async function inspect(path: string): Promise<BigIntStats | undefined> {
  try { return await lstat(path, { bigint: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
}
async function canonical(path: string, depth = 0): Promise<string> {
  if (depth > 40) throw new Error(`Too many symbolic links: ${path}`);
  const absolute = resolve(path);
  try { return await realpath(absolute); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const entry = await inspect(absolute);
  if (entry?.isSymbolicLink()) return canonical(resolve(dirname(absolute), await readlink(absolute)), depth + 1);
  const parent = dirname(absolute);
  return parent === absolute ? absolute : join(await canonical(parent, depth + 1), basename(absolute));
}

/** Covers lexical, directory-symlink, file-symlink and hardlink aliases, including missing final names. */
export async function assertArtifactPathsDistinct(paths: string[]): Promise<void> {
  const entries = await Promise.all(paths.map(async (path) => {
    const resolved = await canonical(path);
    return { path, canonical: process.platform === "win32" ? resolved.toLowerCase() : resolved, stat: await inspect(resolved) };
  }));
  for (let index = 0; index < entries.length; index += 1) {
    for (const other of entries.slice(index + 1)) {
      const entry = entries[index]!;
      if (entry.canonical === other.canonical || (entry.stat && other.stat &&
          entry.stat.dev === other.stat.dev && entry.stat.ino === other.stat.ino)) {
        throw new Error(`Artifact destinations must be distinct (same path or file alias): ${entry.path}, ${other.path}`);
      }
    }
  }
}

async function discardBackup(backup: Backup): Promise<string[]> {
  const warnings: string[] = [];
  try {
    if (backup.entry) {
      const current = await inspect(backup.entry.path);
      if (current) {
        if (!unchanged(current, backup.entry)) throw new Error("Backup changed; preserved");
        await unlink(backup.entry.path);
      }
    }
    await rmdir(backup.directory);
  } catch (error) { warnings.push(`Recovery directory retained at ${backup.directory}: ${message(error)}`); }
  return warnings;
}

/** A caught save failure rolls the whole set back. Forced termination recovery is a separate concern. */
export async function publishArtifactSet(artifacts: StagedArtifact[], options: SaveOptions = {}): Promise<string[]> {
  await assertArtifactPathsDistinct(artifacts.flatMap(({ stage, target }) => [stage, target]));
  if (options.overwrite && options.claims) throw new Error("Overwrite cannot use pre-existing non-overwrite reservations.");
  const claims = options.claims ?? new PathClaimRegistry();
  const states: ArtifactState[] = artifacts.map((artifact) => ({ ...artifact }));
  let failedTarget = states[0]?.target ?? "";
  try {
    // Validate every destination and stage before moving any existing file.
    for (const state of states) {
      failedTarget = state.target;
      if (!(await inspect(state.stage))?.isFile()) throw new Error(`Invalid staged artifact: ${state.stage}`);
      if (options.overwrite) {
        state.previous = await inspect(state.target);
        if (state.previous && !state.previous.isFile() && !state.previous.isSymbolicLink()) {
          throw new Error(`Refusing to write artifact over directory or special file: ${state.target}`);
        }
        if (state.previous?.isSymbolicLink()) {
          try {
            if ((await stat(state.target)).isDirectory()) throw new Error(`Refusing to write artifact over directory: ${state.target}`);
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        }
      }
    }
    if (options.overwrite) {
      for (const state of states) {
        failedTarget = state.target;
        if (state.previous) {
          const directory = await mkdtemp(join(dirname(state.target), ".hwpx-save-"));
          state.backup = { directory };
          const path = join(directory, "previous");
          await (options.operations?.move ?? rename)(state.target, path);
          const moved = (await inspect(path))!;
          state.backup.entry = snapshot(path, moved);
          state.backup.symbolicLink = moved.isSymbolicLink();
          if (!unchanged(moved, snapshot(state.target, state.previous))) throw new Error("Destination changed during backup");
        }
        await claims.claimExact(state.target);
      }
    } else if (!options.claims) {
      for (const state of states) { failedTarget = state.target; await claims.claimExact(state.target); }
    }
    for (const state of states) {
      failedTarget = state.target;
      state.published = await (options.operations?.publish ?? ((stage, target, registry) => registry.publish(stage, target)))
        (state.stage, state.target, claims);
    }
  } catch (error) {
    const rollbackErrors: string[] = [];
    const recoveryPaths = new Set<string>();
    for (const state of [...states].reverse()) {
      try {
        await claims.release(state.target);
        if (state.published) {
          await removeOwnedArtifact(state.published);
          if (await inspect(state.target)) throw new Error(`Published file changed or could not be removed: ${state.target}`);
        }
        const backup = state.backup;
        if (backup?.entry) {
          const current = await inspect(backup.entry.path);
          if (!current || !unchanged(current, backup.entry)) throw new Error(`Backup changed: ${backup.entry.path}`);
          if (backup.symbolicLink) await symlink(await readlink(backup.entry.path), state.target, "file");
          else await publishExclusiveFile(backup.entry.path, state.target);
        }
        if (backup) {
          const warnings = await discardBackup(backup);
          if (warnings.length) { recoveryPaths.add(backup.directory); rollbackErrors.push(...warnings); }
        }
      } catch (rollbackError) {
        recoveryPaths.add(state.backup?.directory ?? state.target);
        rollbackErrors.push(message(rollbackError));
      }
    }
    throw new ArtifactSaveError(failedTarget, error, [...recoveryPaths], rollbackErrors);
  }
  const warnings: string[] = [];
  for (const state of states) if (state.backup) warnings.push(...await discardBackup(state.backup));
  return warnings;
}

export async function writeArtifactSet(
  artifacts: Array<{ target: string; data: Buffer | string }>, options: SaveOptions = {}
): Promise<string[]> {
  await assertArtifactPathsDistinct(artifacts.map(({ target }) => target));
  const claims = options.claims ?? (options.overwrite ? undefined : new PathClaimRegistry());
  const stages: OwnedArtifact[] = [];
  const warnings: string[] = [];
  let failure: unknown;
  let failed = false;
  try {
    if (claims && !options.claims) for (const { target } of artifacts) await claims.claimExact(target);
    for (const { target, data } of artifacts) {
      stages.push(await (options.operations?.write ?? writeStagedFile)(`${target}.tmp-${randomUUID()}`, data));
    }
    warnings.push(...await publishArtifactSet(artifacts.map(({ target }, index) => ({ target, stage: stages[index]!.path })),
      { ...options, claims }));
  } catch (error) {
    failure = error;
    failed = true;
  } finally {
    for (const stage of stages) {
      try { await removeOwnedArtifact(stage); }
      catch (error) { warnings.push(`Staging file retained at ${stage.path}: ${message(error)}`); }
    }
    if (!options.claims) {
      try { await claims?.releaseAll(); }
      catch (error) { warnings.push(`Reservation cleanup incomplete: ${message(error)}`); }
    }
  }
  if (failed) {
    if (warnings.length) throw new Error(`${message(failure)}. ${warnings.join("; ")}`, { cause: failure });
    throw failure;
  }
  return warnings;
}
