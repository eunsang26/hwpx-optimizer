import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { releaseOwnedClaim } from "./pathClaims.js";
import type { ClaimedPath } from "./pathClaims.js";

const LOCK_NAME = ".hwpx-optimizer-batch.lock";
const TOOL_ID = "hwpx-optimizer-batch";
type OwnerRecord = { version: 1; tool: typeof TOOL_ID; pid: number; token: string; claims: ClaimedPath[] };

/** A private workspace and an exclusive lock for one output directory. */
export class BatchWorkspace {
  private recordQueue: Promise<void> = Promise.resolve();
  private constructor(
    readonly directory: string,
    private readonly outputDirectory: string,
    private readonly owner: OwnerRecord
  ) {}

  static async open(outputDirectory: string): Promise<BatchWorkspace> {
    const canonicalOutput = await realpath(outputDirectory);
    const directory = join(canonicalOutput, LOCK_NAME);
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = await readOwner(directory, canonicalOutput);
      if (isProcessAlive(owner.pid)) throw new Error("Another batch is using this output directory.");
      // Serialize recovery too: two restarts must not remove each other's new
      // workspace after observing the same stale record.
      const recoveryDirectory = `${directory}.recovery`;
      try { await mkdir(recoveryDirectory, { mode: 0o700 }); }
      catch { throw new Error("Batch workspace recovery is already in progress; existing files were preserved."); }
      try {
        const latest = await readOwner(directory, canonicalOutput);
        if (isProcessAlive(latest.pid)) throw new Error("Another batch is using this output directory.");
        await cleanOwnedWorkspace(directory, latest);
        try { await mkdir(directory, { mode: 0o700 }); }
        catch { throw new Error("Another batch claimed the output directory during recovery."); }
      } finally { await rmdir(recoveryDirectory); }
    }
    const owner: OwnerRecord = { version: 1, tool: TOOL_ID, pid: process.pid, token: randomUUID(), claims: [] };
    const workspace = new BatchWorkspace(directory, canonicalOutput, owner);
    try {
      await writeFile(join(directory, "owner.json"), JSON.stringify(owner), { flag: "wx" });
    } catch (error) {
      // An unrecorded lock is deliberately left alone on failure: later runs
      // cannot prove ownership and must never infer it from the folder name.
      throw new Error("Could not initialize the batch workspace ownership record.", { cause: error });
    }
    return workspace;
  }

  stagePath(name: string): string {
    if (!isStageName(name)) throw new Error("Invalid batch staging name.");
    return join(this.directory, name);
  }

  recordClaim(claim: ClaimedPath): Promise<void> {
    const task = this.recordQueue.then(async () => {
      if (await realpath(dirname(claim.path)) !== this.outputDirectory) throw new Error("Claim is outside the batch output directory.");
      this.owner.claims.push({ ...claim, path: join(this.outputDirectory, basename(claim.path)) });
      const next = join(this.directory, "owner.json.next");
      await writeFile(next, JSON.stringify(this.owner));
      await rename(next, join(this.directory, "owner.json"));
    });
    this.recordQueue = task.catch(() => {});
    return task;
  }

  async close(): Promise<void> {
    await this.recordQueue;
    const current = await readOwner(this.directory, this.outputDirectory);
    if (current.token !== this.owner.token) throw new Error("Batch workspace ownership changed.");
    await cleanOwnedWorkspace(this.directory, current);
  }
}

function isStageName(name: string): boolean {
  return /^(?:job-\d+\.(?:hwpx|report\.json)|batch-report\.json)\.tmp$/.test(name);
}

async function readOwner(directory: string, outputDirectory: string): Promise<OwnerRecord> {
  try {
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error("Not a private directory.");
    const recordStat = await lstat(join(directory, "owner.json"));
    if (!recordStat.isFile() || recordStat.isSymbolicLink()) throw new Error("Not a regular ownership record.");
    const owner = JSON.parse(await readFile(join(directory, "owner.json"), "utf8")) as OwnerRecord;
    if (owner.version !== 1 || owner.tool !== TOOL_ID || !Number.isInteger(owner.pid) || owner.pid <= 0 ||
      typeof owner.token !== "string" || !/^[a-f0-9-]{36}$/.test(owner.token) || !Array.isArray(owner.claims)) {
      throw new Error("Invalid ownership record.");
    }
    for (const claim of owner.claims) {
      if (typeof claim.path !== "string" || dirname(claim.path) !== outputDirectory ||
        !/^\d+$/.test(claim.dev) || !/^\d+$/.test(claim.ino) || !/^\d+$/.test(claim.birthtimeNs) ||
        !/^\d+$/.test(claim.ctimeNs)) throw new Error("Invalid claim identity.");
    }
    return owner;
  } catch (error) {
    throw new Error(`Unrecognized batch lock workspace; its files were preserved: ${directory}`, { cause: error });
  }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

async function cleanOwnedWorkspace(directory: string, owner: OwnerRecord): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some(entry => !entry.isFile() ||
    (entry.name !== "owner.json" && entry.name !== "owner.json.next" && !isStageName(entry.name)))) {
    throw new Error(`Unexpected batch workspace files were preserved: ${directory}`);
  }
  await Promise.all(owner.claims.map(releaseOwnedClaim));
  await rm(directory, { recursive: true });
}
