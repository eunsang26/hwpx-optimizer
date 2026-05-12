import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const releaseDir = resolve("release");

await rm(releaseDir, { recursive: true, force: true });
console.log(`Removed ${releaseDir}`);
