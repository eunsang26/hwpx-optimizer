import { open, unlink } from "node:fs/promises";
import { dirname, join, basename, extname } from "node:path";

export async function claimPath(preferredPath: string): Promise<string> {
  const dir = dirname(preferredPath);
  const ext = extname(preferredPath);
  const stem = basename(preferredPath, ext);
  for (let i = 0; ; i += 1) {
    const candidate = i === 0 ? preferredPath : join(dir, `${stem} (${i})${ext}`);
    try {
      const handle = await open(candidate, "wx");
      await handle.close();
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }
}

export class PathClaimRegistry {
  private readonly claimed = new Set<string>();
  async claim(preferredPath: string): Promise<string> {
    const path = await claimPath(preferredPath);
    this.claimed.add(path);
    return path;
  }
  async release(path: string): Promise<void> {
    this.claimed.delete(path);
    await unlink(path).catch(() => {});
  }
  async releaseAll(): Promise<void> {
    await Promise.all([...this.claimed].map((p) => unlink(p).catch(() => {})));
    this.claimed.clear();
  }
}
