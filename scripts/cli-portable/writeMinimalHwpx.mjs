import { writeMinimalHwpxFile } from "./createMinimalHwpx.mjs";

const out = process.argv[2];
if (!out) {
  console.error("Usage: node scripts/cli-portable/writeMinimalHwpx.mjs <out.hwpx>");
  process.exit(1);
}
await writeMinimalHwpxFile(out);
console.log(`Wrote ${out}`);
