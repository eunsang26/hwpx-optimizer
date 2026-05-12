import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const localArtifactDirs = [".tmp"];

for (const directory of localArtifactDirs) {
  const target = resolve(directory);
  await rm(target, { recursive: true, force: true });
  console.log(`Removed ${target}`);
}
