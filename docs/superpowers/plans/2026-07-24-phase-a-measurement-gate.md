# Phase A: Measurement / Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a dev-only `scripts/bench/` harness that produces a reproducible jpegli capacity GO/NO-GO (Axis A iso-quality, package-byte median) and Hangul WebP/AVIF compatibility spike artifacts — without changing production optimizer policy or release dependencies.

**Architecture:** tsx scripts under `scripts/bench/` import `@hwpx-optimizer/core` public APIs and root `sharp`. jpegli + SSIMULACRA2 are **external CLIs** (`cjpegli`, `ssimulacra2`) resolved via PATH or env vars — no new production npm deps, no `packages/bench` workspace. Shared decode→resize→raw front-end feeds mozjpeg (sharp) and jpegli; RD curves match iso-quality; packages are rebuilt with product `writeHwpxPackage`.

**Tech Stack:** Node 20+, tsx, vitest, sharp (workspace), `@hwpx-optimizer/core`, external `cjpegli` + `ssimulacra2` CLIs.

**Spec:** [docs/superpowers/specs/2026-07-24-phase-a-measurement-gate-design.md](../specs/2026-07-24-phase-a-measurement-gate-design.md)

## Global Constraints

- Production `packages/core` optimizer/verifier policy **unchanged** (no JPEG→WebP/AVIF emit).
- **Zero impact** on Electron / CLI portable release graphs: no jpegli/ssimulacra2 npm deps in root or workspaces.
- Never overwrite original HWPX inputs; never commit real sample documents.
- Axis A GO uses **resized raw** + SSIMULACRA2 only; Axis B (`computeVisualMetrics`) is secondary; mozjpeg-vs-candidate similarity is diagnostic only.
- GO statistic = **median per-document package-byte savings %** (balanced profile primary); synthetic-only runs are **GO-invalid**.
- CI runs fixture/invariant tests only — **CI green ≠ investment GO**.
- Prefer Node 20: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20` when needed.
- Conventional Commits; one intent per commit.

## File Structure

| Path | Responsibility |
| --- | --- |
| `scripts/bench/README.md` | Install CLIs, `HWPX_BENCH_DIR`, how to read GO |
| `scripts/bench/corpus.manifest.json` | Hashed corpus listing (no file bytes); may start empty `files: []` |
| `scripts/bench/fixtures/*.hwpx` | Synthetic packages for tests/smoke |
| `scripts/bench/src/types.ts` | Shared report / candidate / axis types |
| `scripts/bench/src/resizeRaw.ts` | Decode + identical lanczos3 budget → `{ raw, width, height, channels }` |
| `scripts/bench/src/candidates.ts` | `encodeMozjpeg` / `encodeJpegli` / `encodePng` / `encodeWebp` |
| `scripts/bench/src/ssimulacra2.ts` | Spawn SSIMULACRA2 CLI; score raw vs encoded (via temp PNG/JPEG) |
| `scripts/bench/src/rdCurve.ts` | Q-grid sweep + iso-quality interpolation |
| `scripts/bench/src/corpus.ts` | List docs from env + fixtures; manifest verify |
| `scripts/bench/src/packageBytes.ts` | Substitute BinData → `writeHwpxPackage`; optional byte-identical collapse |
| `scripts/bench/src/report.ts` | Aggregate medians, soft flags, GO boolean |
| `scripts/bench/src/spikeHangul.ts` | Emit spike HWPX + CHECKLIST.md |
| `scripts/bench/src/runBench.ts` | CLI entry (`rd` / `spike` / `manifest`) |
| `scripts/bench/test/*.test.ts` | Reader fixture + apple-to-apple resize invariant |
| `scripts/bench/out/` | gitignored JSON / spike outputs |
| `vitest.config.ts` | Include `scripts/bench/**/*.test.ts` |
| `package.json` | `bench`, `bench:spike` script entries |
| `.gitignore` | `scripts/bench/out/`, `scripts/bench/RESULT.md` |

### Locked constants (implement exactly)

```ts
export const GO_METRIC_ID = "ssimulacra2" as const;
export const SSIMULACRA2_MATCH_TOLERANCE = 0.5; // absolute score units
export const Q_GRID = [60, 65, 70, 75, 80, 85, 88, 90, 95] as const;
export const PRIMARY_PROFILE = "balanced" as const; // Q88, displayScale 2
export const PACKAGE_SAVINGS_GO_PERCENT = 15;
export const MAX_JPEG_EXCLUSION_RATIO = 0.2; // >20% JPEG no-data → GO invalid
export const ENCODE_CPU_SOFT_FLAG_RATIO = 2;
export const JPEGLI_ENV = "HWPX_BENCH_JPEGLI";
export const SSIMULACRA2_ENV = "HWPX_BENCH_SSIMULACRA2";
export const CORPUS_DIR_ENV = "HWPX_BENCH_DIR";
```

### External tools

| Tool | Resolve order | Notes |
| --- | --- | --- |
| jpegli | `process.env.HWPX_BENCH_JPEGLI` → `cjpegli` on PATH | stdin/out or temp PPM/PNG → JPEG; document flags in README |
| SSIMULACRA2 | `process.env.HWPX_BENCH_SSIMULACRA2` → `ssimulacra2` on PATH | Compare two image files; parse float score from stdout |

If SSIMULACRA2 missing → bench exits non-zero (`goValid: false`, reason `metric-tool-missing`).  
If jpegli missing → jpegli row disabled; capacity GO invalid (`jpegli-unavailable`).

---

### Task 1: Scaffold + vitest include + gitignore

**Files:**
- Create: `scripts/bench/README.md` (stub)
- Create: `scripts/bench/src/types.ts`
- Create: `scripts/bench/corpus.manifest.json`
- Modify: `vitest.config.ts`
- Modify: `.gitignore`
- Modify: `package.json` (scripts only)

**Interfaces:**
- Produces: types + empty manifest shape used by later tasks

- [ ] **Step 1: Add ignore + vitest include**

`.gitignore` append:

```
scripts/bench/out/
scripts/bench/RESULT.md
```

`vitest.config.ts` `include` becomes:

```ts
include: [
  "packages/**/*.test.ts",
  "apps/**/*.test.ts",
  "scripts/cli-portable/**/*.test.ts",
  "scripts/bench/**/*.test.ts"
]
```

- [ ] **Step 2: Write `types.ts` + empty manifest**

```ts
// scripts/bench/src/types.ts
export const GO_METRIC_ID = "ssimulacra2" as const;
export const SSIMULACRA2_MATCH_TOLERANCE = 0.5;
export const Q_GRID = [60, 65, 70, 75, 80, 85, 88, 90, 95] as const;
export const PRIMARY_PROFILE = "balanced" as const;
export const PACKAGE_SAVINGS_GO_PERCENT = 15;
export const MAX_JPEG_EXCLUSION_RATIO = 0.2;
export const ENCODE_CPU_SOFT_FLAG_RATIO = 2;
export const JPEGLI_ENV = "HWPX_BENCH_JPEGLI";
export const SSIMULACRA2_ENV = "HWPX_BENCH_SSIMULACRA2";
export const CORPUS_DIR_ENV = "HWPX_BENCH_DIR";

export type BenchProfileName = "balanced" | "aggressive";
export type RawImage = { data: Buffer; width: number; height: number; channels: 3 };
export type EncodeResult = { bytes: Buffer; encodeMs: number; quality: number; candidate: string };
export type ImageStatus = "ok" | "error" | "no-data";
```

```json
{
  "version": 1,
  "files": []
}
```

- [ ] **Step 3: Root scripts**

In root `package.json` `scripts`:

```json
"bench": "tsx --conditions=development scripts/bench/src/runBench.ts",
"bench:spike": "tsx --conditions=development scripts/bench/src/runBench.ts spike",
"bench:manifest": "tsx --conditions=development scripts/bench/src/runBench.ts manifest"
```

Stub `runBench.ts` that prints usage and `process.exit(1)` until Task 8.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts .gitignore package.json scripts/bench
git commit -m "$(cat <<'EOF'
chore(bench): scaffold Phase A measurement harness layout

EOF
)"
```

---

### Task 2: Synthetic fixture + reader smoke test

**Files:**
- Create: `scripts/bench/src/buildFixture.ts`
- Create: `scripts/bench/fixtures/.gitkeep` (fixture bytes generated in test or committed small hwpx)
- Create: `scripts/bench/test/fixtureReader.test.ts`
- Create: `scripts/bench/src/runBench.ts` (keep stub if not ready)

**Interfaces:**
- Produces: `buildSyntheticPhotoHwpx(): Promise<Buffer>` — one JPEG photo + minimal `content.hpf` / `section0.xml` with display size so budgets exist

- [ ] **Step 1: Write failing test**

```ts
// scripts/bench/test/fixtureReader.test.ts
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readHwpxPackage } from "@hwpx-optimizer/core";
import { buildSyntheticPhotoHwpx } from "../src/buildFixture.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/photo.hwpx");

describe("bench fixtures", () => {
  it("buildSyntheticPhotoHwpx is readable by core reader with an image entry", async () => {
    const buf = await buildSyntheticPhotoHwpx();
    await mkdir(dirname(fixturePath), { recursive: true });
    await writeFile(fixturePath, buf);
    const pkg = await readHwpxPackage(buf);
    const images = pkg.entries.filter((e) => e.kind === "image");
    expect(images.length).toBeGreaterThanOrEqual(1);
    expect(images.some((e) => /\.jpe?g$/i.test(e.path))).toBe(true);
  });
});
```

Run: `npm test -- scripts/bench/test/fixtureReader.test.ts`  
Expected: FAIL (`buildFixture` missing).

- [ ] **Step 2: Implement `buildFixture.ts`**

Reuse the pattern from `packages/core/test/fixtures.ts`: sharp-create JPEG → `writeHwpxPackage` with `mimetype`, `Contents/content.hpf` (item + media-type), `Contents/section0.xml` (`hp:sz` + `binaryItemIDRef`), `BinData/photo.jpg`. Use a large enough display size (e.g. width/height HWP units that yield budgets under balanced scale 2).

```ts
import sharp from "sharp";
import { writeHwpxPackage } from "@hwpx-optimizer/core";

export async function buildSyntheticPhotoHwpx(): Promise<Buffer> {
  const jpeg = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: 40, g: 90, b: 160 } }
  })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  const entries = [
    { path: "mimetype", data: Buffer.from("application/hwp+zip"), size: 17, kind: "other" as const },
    {
      path: "Contents/content.hpf",
      data: Buffer.from(
        `<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:manifest>` +
          `<opf:item id="photo" href="BinData/photo.jpg" media-type="image/jpeg" isEmbeded="1"/>` +
          `</opf:manifest></opf:package>`
      ),
      size: 0,
      kind: "xml" as const
    },
    {
      path: "Contents/section0.xml",
      data: Buffer.from(
        `<root><hp:pic><hp:sz width="7200" height="4800"/><hc:img binaryItemIDRef="photo"/></hp:pic></root>`
      ),
      size: 0,
      kind: "xml" as const
    },
    { path: "BinData/photo.jpg", data: jpeg, size: jpeg.byteLength, kind: "image" as const }
  ].map((e) => ({ ...e, size: e.data.byteLength }));

  return writeHwpxPackage({ entries });
}
```

- [ ] **Step 3: Re-run test**

Run: `npm test -- scripts/bench/test/fixtureReader.test.ts`  
Expected: PASS. Commit generated `fixtures/photo.hwpx` **or** regenerate in `beforeAll` and keep only builder (prefer commit small fixture so smoke needs no sharp create). Prefer: test writes fixture; also add `npm run bench -- build-fixtures` later — for now committing `photo.hwpx` from the test output is fine if size is small.

- [ ] **Step 4: Commit**

```bash
git add scripts/bench
git commit -m "$(cat <<'EOF'
test(bench): add synthetic HWPX fixture readable by core reader

EOF
)"
```

---

### Task 3: Shared resize→raw + apple-to-apple invariant test

**Files:**
- Create: `scripts/bench/src/resizeRaw.ts`
- Create: `scripts/bench/test/appleToApple.test.ts`

**Interfaces:**
- Consumes: `readHwpxPackage`, `getRecommendedImagePixelBudgets`, `balancedImageProfile` / `aggressiveImageProfile` from core; `decodeBmp` if needed
- Produces:

```ts
export async function decodeResizeToRaw(
  imageBytes: Buffer,
  budget: { width: number; height: number } | undefined,
  profile: { maxEdge: number }
): Promise<RawImage>;

export function budgetsForPackage(
  pkg: Awaited<ReturnType<typeof readHwpxPackage>>,
  profileName: BenchProfileName
): Map<string, { width: number; height: number }>;
```

Resize must match production intent: `fit: "inside"`, `withoutEnlargement: true`, `kernel: "lanczos3"`, then `.raw()` with 3 channels (`removeAlpha()`). Budget = `min(profile.maxEdge, recommended)` when recommendation exists; else `{ maxEdge, maxEdge }`.

- [ ] **Step 1: Failing test — same budget fingerprint for two candidate paths**

```ts
import { describe, expect, it } from "vitest";
import { readHwpxPackage, balancedImageProfile } from "@hwpx-optimizer/core";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { budgetsForPackage, decodeResizeToRaw } from "../src/resizeRaw.js";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/photo.hwpx");

describe("apple-to-apple resize", () => {
  it("produces identical raw pixels for repeated decodeResizeToRaw calls", async () => {
    const pkg = await readHwpxPackage(await readFile(fixture));
    const budgets = budgetsForPackage(pkg, "balanced");
    const image = pkg.entries.find((e) => e.kind === "image")!;
    const budget = budgets.get(image.path);
    const a = await decodeResizeToRaw(image.data, budget, balancedImageProfile);
    const b = await decodeResizeToRaw(image.data, budget, balancedImageProfile);
    expect(a.width).toBe(b.width);
    expect(a.height).toBe(b.height);
    expect(createHash("sha256").update(a.data).digest("hex")).toBe(
      createHash("sha256").update(b.data).digest("hex")
    );
  });
});
```

Run: `npm test -- scripts/bench/test/appleToApple.test.ts`  
Expected: FAIL until `resizeRaw.ts` exists.

- [ ] **Step 2: Implement `resizeRaw.ts`**

Use `sharp(data, { failOn: "none" }).rotate().removeAlpha().resize({...}).raw().toBuffer({ resolveWithObject: true })`. Handle BMP via `decodeBmp` from core when needed (same as opportunities).

`budgetsForPackage`:

```ts
import {
  getRecommendedImagePixelBudgets,
  balancedImageProfile,
  aggressiveImageProfile
} from "@hwpx-optimizer/core";

export function budgetsForPackage(pkg, profileName) {
  const profile = profileName === "aggressive" ? aggressiveImageProfile : balancedImageProfile;
  const recommended = getRecommendedImagePixelBudgets(pkg, profile.displayScale);
  const out = new Map();
  for (const entry of pkg.entries) {
    if (entry.kind !== "image") continue;
    const rec = recommended.get(entry.path);
    out.set(entry.path, {
      width: Math.min(profile.maxEdge, rec?.width ?? profile.maxEdge),
      height: Math.min(profile.maxEdge, rec?.height ?? profile.maxEdge)
    });
  }
  return out;
}
```

- [ ] **Step 3: Pass test + commit**

```bash
npm test -- scripts/bench/test/appleToApple.test.ts
git add scripts/bench
git commit -m "$(cat <<'EOF'
feat(bench): shared decode-resize-raw front-end for encoder bake-off

EOF
)"
```

---

### Task 4: Encoder candidates (mozjpeg / jpegli CLI / png / webp)

**Files:**
- Create: `scripts/bench/src/candidates.ts`
- Create: `scripts/bench/src/jpegliCli.ts`
- Create: `scripts/bench/test/candidates.test.ts`

**Interfaces:**
- Produces:

```ts
export function resolveJpegliBin(): string | null;
export async function encodeMozjpeg(raw: RawImage, quality: number): Promise<EncodeResult>;
export async function encodeJpegli(raw: RawImage, quality: number): Promise<EncodeResult>; // throws if bin missing
export async function encodePng(raw: RawImage, profile: ImageOptimizationProfile): Promise<EncodeResult>;
export async function encodeWebp(raw: RawImage, quality: number): Promise<EncodeResult>;
```

mozjpeg must mirror production: `sharp(raw.data, { raw: { width, height, channels: 3 } }).jpeg({ quality, mozjpeg: true, progressive: true })`.

jpegli: write temp PPM or PNG from raw → `spawn(bin, [..., '-q', String(quality), in, out])` → read JPEG. Pin exact argv in `jpegliCli.ts` after checking `cjpegli --help` on the implementer machine; document in README. Time only the spawn/encode section for `encodeMs`.

- [ ] **Step 1: Test mozjpeg deterministic size class**

```ts
it("encodeMozjpeg shrinks vs uncompressed raw byte length", async () => {
  const raw = { data: Buffer.alloc(64 * 64 * 3, 120), width: 64, height: 64, channels: 3 as const };
  const enc = await encodeMozjpeg(raw, 88);
  expect(enc.bytes.byteLength).toBeGreaterThan(100);
  expect(enc.bytes.byteLength).toBeLessThan(raw.data.byteLength);
  expect(enc.candidate).toBe("mozjpeg");
});
```

jpegli test: `it.skipIf(!resolveJpegliBin())("encodeJpegli returns jpeg")`.

- [ ] **Step 2: Implement candidates + CLI resolver**

```ts
export function resolveJpegliBin(): string | null {
  // 1) process.env[JPEGLI_ENV]
  // 2) which/where cjpegli via `import { sync as which } from "node:child_process"` — use `execFileSync("which", ["cjpegli"])` try/catch
  // return null if missing
}
```

Do **not** add npm jpegli packages.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(bench): mozjpeg/jpegli/png/webp encode candidates

EOF
)"
```

---

### Task 5: SSIMULACRA2 wrapper + RD iso-quality matching

**Files:**
- Create: `scripts/bench/src/ssimulacra2.ts`
- Create: `scripts/bench/src/rdCurve.ts`
- Create: `scripts/bench/test/rdCurve.test.ts`

**Interfaces:**
- Produces:

```ts
export function resolveSsimulacra2Bin(): string | null;
export async function scoreSsimulacra2(referencePng: Buffer, distortedJpeg: Buffer): Promise<number>;

export type RdPoint = { quality: number; bytes: number; score: number; encodeMs: number };
export async function sweepMozjpeg(raw: RawImage, qualities: readonly number[]): Promise<RdPoint[]>;
export async function sweepJpegli(raw: RawImage, qualities: readonly number[]): Promise<RdPoint[]>;

/** Match jpegli bytes to mozjpeg score at anchorQ within SSIMULACRA2_MATCH_TOLERANCE (interpolate Q). */
export function isoQualityJpegliBytes(
  mozPoints: RdPoint[],
  jpegliPoints: RdPoint[],
  anchorQ: number
): { status: "ok"; quality: number; bytes: number; encodeMs: number; targetScore: number; score: number }
  | { status: "no-data"; reason: string };
```

Procedure for `isoQualityJpegliBytes`:
1. Find moz point at exact `anchorQ` (must exist on grid — 80 and 88 do). `targetScore = moz.score`.
2. Among jpegli points, find bracket where scores straddle `targetScore` (SSIMULACRA2: higher=better; jpegli score decreases as Q drops).
3. Linear-interpolate Q and bytes (and encodeMs) between bracket ends.
4. If interpolated score still outside `targetScore ± SSIMULACRA2_MATCH_TOLERANCE` after picking nearest grid point refinement — still accept interpolated point if within tolerance of target; else `no-data`.
5. If all jpegli scores are on one side of target → `no-data` (`curve-miss`).

For scoring: write reference as PNG from raw (`sharp(raw).png()`), distorted as the JPEG bytes, run:

```bash
ssimulacra2 <ref.png> <dist.jpg>
```

Parse the first float on stdout. If tool missing, throw a typed error `MetricToolMissingError` — callers must not fall back to PSNR for Axis A.

- [ ] **Step 1: Unit-test interpolation without CLI**

Export pure `interpolateIsoQuality(mozPoints, jpegliPoints, anchorQ, tolerance)` and test:

```ts
it("interpolates jpegli bytes at matching score", () => {
  const moz = [{ quality: 88, bytes: 1000, score: 80, encodeMs: 10 }];
  const jl = [
    { quality: 80, bytes: 700, score: 78, encodeMs: 12 },
    { quality: 90, bytes: 900, score: 82, encodeMs: 14 }
  ];
  const hit = interpolateIsoQuality(moz, jl, 88, 0.5);
  expect(hit.status).toBe("ok");
  if (hit.status === "ok") {
    expect(hit.bytes).toBeGreaterThan(700);
    expect(hit.bytes).toBeLessThan(900);
  }
});
```

- [ ] **Step 2: Implement sweep + score wiring**

Warmup: first mozjpeg + first jpegli encode discarded per process (module-level flag).

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(bench): SSIMULACRA2 RD curves and iso-quality matching

EOF
)"
```

---

### Task 6: Corpus listing + hashed manifest

**Files:**
- Create: `scripts/bench/src/corpus.ts`
- Create: `scripts/bench/test/corpus.test.ts`
- Modify: `scripts/bench/src/runBench.ts` — `manifest` subcommand

**Interfaces:**
- Produces:

```ts
export type CorpusFile = { relativePath: string; size: number; sha256: string };
export type CorpusManifest = { version: 1; files: CorpusFile[] };

export async function listHwpxFiles(dir: string): Promise<string[]>; // sorted *.hwpx
export async function hashFile(absPath: string): Promise<CorpusFile>;
export async function buildManifest(dir: string): Promise<CorpusManifest>;
export async function verifyManifest(dir: string, manifest: CorpusManifest): Promise<
  { ok: true } | { ok: false; reason: string }
>;
export async function loadCorpus(options: {
  benchDir: string | undefined;
  fixturesDir: string;
  manifestPath: string;
}): Promise<{
  docs: Array<{ absPath: string; relativePath: string; source: "real" | "fixture" }>;
  goEligible: boolean;
  invalidReason?: string;
  manifestId: string; // sha256 of canonical JSON
}>;
```

Rules:
- If `HWPX_BENCH_DIR` unset/empty → docs = fixtures only, `goEligible: false`, `invalidReason: "synthetic-only"`.
- If set → verify manifest; on mismatch `goEligible: false`, `invalidReason: "manifest-mismatch"`. Still may run smoke on fixtures.
- `manifest` CLI: write/update `corpus.manifest.json` from `$HWPX_BENCH_DIR` (hashes only).

- [ ] **Step 1: Test verifyManifest mismatch**

Use temp dir with two tiny fake `.hwpx` buffers; build manifest; change one byte; expect `ok: false`.

- [ ] **Step 2: Implement + wire `bench:manifest`**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(bench): hashed corpus manifest and GO eligibility rules

EOF
)"
```

---

### Task 7: Package-byte repack (product writer)

**Files:**
- Create: `scripts/bench/src/packageBytes.ts`
- Create: `scripts/bench/test/packageBytes.test.ts`

**Interfaces:**
- Produces:

```ts
export async function repackWithImageBytes(
  original: Buffer,
  replacements: Map<string, Buffer>, // path → new image bytes (same path for jpegli)
  options?: { collapseByteIdentical?: boolean }
): Promise<Buffer>;
```

Implementation:
1. `readHwpxPackage(original)`.
2. Replace `entry.data` / `size` for paths in `replacements` (kind stays `image`).
3. If `collapseByteIdentical: true`, group image entries by sha256; for duplicates after the first, remove entry and rewrite `content.hpf` hrefs that pointed at removed paths to the kept path (string replace on href values). Do **not** attempt near-dup / visual consolidation (not exported from core).
4. `return writeHwpxPackage(pkg)` — product DEFLATE.

GO path uses `collapseByteIdentical: true`. Also compute `false` for diagnostics when cheap.

- [ ] **Step 1: Test** — fixture with two identical PNGs; after collapse, package smaller and still `readHwpxPackage` OK.

- [ ] **Step 2: Implement + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(bench): repack substituted BinData via product writeHwpxPackage

EOF
)"
```

---

### Task 8: Report aggregation + `runBench` RD command

**Files:**
- Create: `scripts/bench/src/report.ts`
- Create: `scripts/bench/src/axisB.ts`
- Modify: `scripts/bench/src/runBench.ts`
- Create: `scripts/bench/test/report.test.ts`

**Interfaces:**
- Produces JSON written to `scripts/bench/out/rd-report.json`:

```ts
export type BenchReport = {
  metricId: typeof GO_METRIC_ID;
  metricTolerance: number;
  axes: { primary: "A-resized-raw-ssimulacra2"; secondary: "B-original-bindata-verifier-metrics"; diagnostic: "C-mozjpeg-similarity" };
  corpus: { manifestId: string; goEligible: boolean; invalidReason?: string; documentCount: number };
  profile: BenchProfileName;
  jpegli: {
    perDocumentPackageSavingsPercent: number[]; // only docs with ≥1 ok JPEG iso match
    medianPackageSavingsPercent: number | null;
    jpegExclusionRatio: number;
    growCount: number;
    encodeCpuRatioMedian: number | null;
    wallClockDeltaPercentMedian: number | null;
    axisBPassRate: number | null;
  };
  pngRows: { /* control + optional webp if enabled */ };
  softFlags: string[];
  go: boolean;
  goReason: string;
};
```

GO logic (balanced primary run):

```
go = goEligible
  && jpegExclusionRatio <= MAX_JPEG_EXCLUSION_RATIO
  && medianPackageSavingsPercent !== null
  && medianPackageSavingsPercent >= PACKAGE_SAVINGS_GO_PERCENT
```

Soft flags: `encode-cpu>${ENCODE_CPU_SOFT_FLAG_RATIO}x`, `axis-B-failures`, `recompress-grow-heavy` (growCount > 25% of ok images).

Per document:
1. Wall-clock start.
2. For each JPEG image: raw → moz sweep + jpegli sweep → iso match at profile anchor (88 or 80).
3. Build replacement maps for moz@anchor and jpegli@isoQ; `repackWithImageBytes` both; savings % = `(mozPkg - jlPkg) / mozPkg * 100`.
4. Axis B: `computeVisualMetrics(originalBin, jlBytes)` vs mode thresholds (balanced 18/0.72, aggressive 14/0.55) — record pass/fail, do not flip GO.
5. PNG row: encodePng control sizes only unless `--webp` and compat file says PASS (default off in automation).

CLI:

```bash
npm run bench -- rd --profile balanced
npm run bench -- rd --profile aggressive
```

Exit code: `0` always if report written; print `GO` / `NO-GO` / `INVALID` on stderr. (Do not fail CI on NO-GO — eligibility invalid is expected without corpus.)

- [ ] **Step 1: Pure tests for median + GO boolean**

```ts
expect(median([10, 20, 30])).toBe(20);
expect(decideJpegliGo({ goEligible: true, exclusion: 0.1, median: 16 })).toBe(true);
expect(decideJpegliGo({ goEligible: false, exclusion: 0, median: 50 }).go).toBe(false);
```

- [ ] **Step 2: Implement report + runBench loop**

Skip full corpus in unit tests; integration is local with `HWPX_BENCH_DIR`.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(bench): RD runner with package-byte GO report

EOF
)"
```

---

### Task 9: Hangul compatibility spike

**Files:**
- Create: `scripts/bench/src/spikeHangul.ts`
- Create: `scripts/bench/out/spike/CHECKLIST.md` (generated, committed template under `scripts/bench/spike-template/CHECKLIST.md`)
- Create: `scripts/bench/spike-template/RESULT.md`
- Create: `scripts/bench/spike-template/POLICY_CHECKBOX.md`
- Modify: `runBench.ts` — `spike` subcommand

**Interfaces:**
- `npm run bench:spike` writes to `scripts/bench/out/spike/`:
  - `jpeg-control.hwpx`
  - `webp-test.hwpx`
  - `avif-test.hwpx`
  - `jpeg-webp-mixed.hwpx`
  - copies CHECKLIST + empty RESULT + POLICY_CHECKBOX

Each package: minimal valid HWPX; BinData encoded with sharp `.webp()` / `.avif()` / `.jpeg()`; `content.hpf` `media-type` matches (`image/webp`, `image/avif`, `image/jpeg`); section references id.

CHECKLIST matrix columns: Hangul version A / B (blank); rows: open, save-as, reopen, mixed, print-or-pdf for webp and avif; jpeg-control sanity.

POLICY_CHECKBOX.md:

```markdown
- [ ] If compat PASS: accept follow-on project to change product policy + `isAllowedAdvancedFormat` + manifest media-type/extension rewrite.
```

- [ ] **Step 1: Implement spike generator; run once; ensure outputs are valid `readHwpxPackage`**

Add `scripts/bench/test/spike.test.ts` that builds spikes in tmp and reads them (AVIF may need sharp support — skip AVIF assert if encode throws, still emit webp+jpeg).

- [ ] **Step 2: Commit templates + generator (not RESULT fills)**

```bash
git commit -m "$(cat <<'EOF'
feat(bench): Hangul WebP/AVIF compatibility spike artifacts

EOF
)"
```

---

### Task 10: README completion + smoke path without real corpus

**Files:**
- Modify: `scripts/bench/README.md`
- Modify: `docs/KNOWN_LIMITATIONS.md` (one short bullet pointing at Phase A bench / verifier 256px follow-up — optional, only if file already discusses image quality)

**README must document:**

1. Install `cjpegli` (libjxl/jpegli tools) and `ssimulacra2`; set `HWPX_BENCH_JPEGLI` / `HWPX_BENCH_SSIMULACRA2` if not on PATH.
2. Place real `.hwpx` under a local dir → `HWPX_BENCH_DIR=... npm run bench:manifest` → commit updated `corpus.manifest.json` hashes only.
3. `HWPX_BENCH_DIR=... npm run bench -- rd --profile balanced` → read `out/rd-report.json` `go` / `goReason`.
4. `npm run bench:spike` → open `out/spike/*.hwpx` in ≥2 Hangul versions; fill RESULT.md locally (gitignored).
5. Explicit: **synthetic-only = INVALID for GO**; **CI ≠ GO**; WebP capacity only after human compat PASS; jpegli capacity-GO ≠ integration/Windows cost approval.

- [ ] **Step 1: Write README**

- [ ] **Step 2: Run automated gates**

```bash
npm test -- scripts/bench
npm run bench:spike
# without HWPX_BENCH_DIR:
npm run bench -- rd --profile balanced
# expect go=false, invalidReason synthetic-only, report written
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs(bench): Phase A operator guide and smoke verification

EOF
)"
```

---

## Spec coverage checklist (self-review)

| Spec item | Task |
| --- | --- |
| `scripts/bench/` not workspace package | Task 1 |
| External jpegli/ssimulacra2 (no release dep) | Tasks 4–5 |
| Axis A resized-raw SSIMULACRA2 GO | Tasks 3, 5, 8 |
| Axis B verifier metrics secondary | Task 8 `axisB.ts` |
| Iso-quality Q sweep + interpolate | Task 5 |
| PNG row independent | Task 8 |
| Package bytes via `writeHwpxPackage` | Task 7 |
| Document median ≥15%, exclusion >20% invalid | Task 8 |
| Synthetic-only NO-GO / manifest | Task 6 |
| Encode CPU soft flag ~2× | Task 8 |
| Hangul matrix spike + policy checkbox | Task 9 |
| decode-once / perceptual-Q out of scope | — (not scheduled) |
| Two tests: reader + apple-to-apple | Tasks 2–3 |
| Verifier 256px fix out of scope | README note only |

## Placeholder scan

No TBD steps; jpegli argv pinned at implement time after `cjpegli --help` (document actual flags in README in Task 4/10 — allowed calibration, not open product scope).

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-24-phase-a-measurement-gate.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with checkpoints  

Which approach?
