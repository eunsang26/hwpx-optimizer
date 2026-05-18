import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const buildArtifacts = [
  "packages/core/dist",
  "packages/core/tsconfig.tsbuildinfo",
  "packages/cli/dist",
  "packages/cli/tsconfig.tsbuildinfo",
  "apps/desktop/dist",
  "apps/desktop/tsconfig.tsbuildinfo",
  "apps/tauri-desktop/dist",
  "apps/tauri-desktop/tsconfig.tsbuildinfo"
];

for (const artifact of buildArtifacts) {
  await rm(resolve(artifact), { recursive: true, force: true });
}
