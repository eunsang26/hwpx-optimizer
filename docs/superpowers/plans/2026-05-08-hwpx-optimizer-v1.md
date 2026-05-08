# HWPX Optimizer v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first local CLI version of a conservative HWPX size optimizer.

**Architecture:** A TypeScript monorepo with a core package and CLI package. The core package reads HWPX ZIP packages, analyzes resources, builds a conservative reference graph, plans safe actions, writes a repacked package, verifies it, and produces a JSON report. The CLI is a thin wrapper over the core.

**Tech Stack:** Node.js, TypeScript, Vitest, JSZip for ZIP handling, fast-xml-parser for XML parsing/serialization, sharp for image metadata and lossless metadata stripping.

---

## File Structure

- Create: `package.json` - workspace scripts and dev dependencies.
- Create: `tsconfig.base.json` - shared TypeScript settings.
- Create: `vitest.config.ts` - test configuration.
- Create: `packages/core/package.json` - core package metadata.
- Create: `packages/core/src/index.ts` - public core exports.
- Create: `packages/core/src/types.ts` - shared data types.
- Create: `packages/core/src/reader.ts` - reads HWPX ZIP entries.
- Create: `packages/core/src/analyzer.ts` - classifies package entries and image metadata.
- Create: `packages/core/src/referenceGraph.ts` - finds conservative internal references.
- Create: `packages/core/src/planner.ts` - creates safe optimization plans.
- Create: `packages/core/src/optimizer.ts` - applies safe actions.
- Create: `packages/core/src/writer.ts` - repacks HWPX output.
- Create: `packages/core/src/verifier.ts` - verifies output package integrity.
- Create: `packages/core/src/report.ts` - builds JSON report objects.
- Create: `packages/core/src/optimize.ts` - orchestrates analyze and optimize flows.
- Create: `packages/core/test/fixtures.ts` - synthetic HWPX fixture builder.
- Create: `packages/core/test/*.test.ts` - core tests.
- Create: `packages/cli/package.json` - CLI package metadata.
- Create: `packages/cli/src/index.ts` - CLI command parser and command execution.
- Create: `packages/cli/test/cli.test.ts` - CLI tests.

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `packages/core/package.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/cli/package.json`
- Create: `packages/cli/src/index.ts`

- [ ] **Step 1: Create workspace package metadata**

Write `package.json`:

```json
{
  "name": "hwpx-optimizer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/core",
    "packages/cli"
  ],
  "scripts": {
    "build": "tsc -b packages/core packages/cli",
    "test": "vitest run",
    "typecheck": "tsc -b packages/core packages/cli --pretty false",
    "cli": "tsx packages/cli/src/index.ts"
  },
  "dependencies": {
    "fast-xml-parser": "^4.5.0",
    "jszip": "^3.10.1",
    "sharp": "^0.33.5"
  },
  "devDependencies": {
    "@types/node": "^20.12.12",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Add shared TypeScript and test config**

Write `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "outDir": "dist"
  }
}
```

Write `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts"],
    environment: "node"
  }
});
```

- [ ] **Step 3: Add package shells**

Write `packages/core/package.json`:

```json
{
  "name": "@hwpx-optimizer/core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js"
  }
}
```

Write `packages/core/src/index.ts`:

```ts
export const version = "0.1.0";
```

Write `packages/cli/package.json`:

```json
{
  "name": "@hwpx-optimizer/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "hwpx-opt": "dist/index.js"
  },
  "dependencies": {
    "@hwpx-optimizer/core": "0.1.0"
  }
}
```

Write `packages/cli/src/index.ts`:

```ts
#!/usr/bin/env node

console.log("hwpx-opt 0.1.0");
```

- [ ] **Step 4: Install dependencies and verify scaffold**

Run: `npm install`

Run: `npm run typecheck`

Expected: TypeScript completes without errors.

## Task 2: Reader and Fixture Builder

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/reader.ts`
- Create: `packages/core/test/fixtures.ts`
- Create: `packages/core/test/reader.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing reader tests**

Create `packages/core/test/reader.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

describe("readHwpxPackage", () => {
  it("reads entries from a valid HWPX zip buffer", async () => {
    const fixture = await createHwpxFixture({
      entries: {
        "mimetype": "application/hwp+zip",
        "Contents/content.hpf": "<opf:package xmlns:opf=\"http://www.idpf.org/2007/opf\" />",
        "Contents/section0.xml": "<root />"
      }
    });

    const result = await readHwpxPackage(fixture);

    expect(result.entries.map((entry) => entry.path).sort()).toEqual([
      "Contents/content.hpf",
      "Contents/section0.xml",
      "mimetype"
    ]);
  });

  it("fails clearly for an invalid zip buffer", async () => {
    await expect(readHwpxPackage(Buffer.from("not a zip"))).rejects.toThrow(
      /Invalid HWPX package/
    );
  });
});
```

- [ ] **Step 2: Run reader tests and verify failure**

Run: `npm test -- packages/core/test/reader.test.ts`

Expected: FAIL because `reader.ts` and fixtures do not exist.

- [ ] **Step 3: Implement shared types, fixture builder, and reader**

Create `packages/core/src/types.ts`:

```ts
export type HwpxEntryKind = "xml" | "image" | "font" | "ole" | "bindata" | "other";

export type HwpxEntry = {
  path: string;
  data: Buffer;
  size: number;
  kind: HwpxEntryKind;
};

export type HwpxPackage = {
  entries: HwpxEntry[];
};
```

Create `packages/core/test/fixtures.ts`:

```ts
import JSZip from "jszip";

export async function createHwpxFixture(input: {
  entries: Record<string, string | Buffer>;
}): Promise<Buffer> {
  const zip = new JSZip();
  for (const [path, value] of Object.entries(input.entries)) {
    zip.file(path, value);
  }
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}
```

Create `packages/core/src/reader.ts`:

```ts
import JSZip from "jszip";
import type { HwpxEntry, HwpxEntryKind, HwpxPackage } from "./types.js";

export async function readHwpxPackage(input: Buffer): Promise<HwpxPackage> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch (error) {
    throw new Error("Invalid HWPX package: input is not a readable ZIP archive", {
      cause: error
    });
  }

  const entries: HwpxEntry[] = [];
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const data = Buffer.from(await file.async("nodebuffer"));
    entries.push({
      path,
      data,
      size: data.byteLength,
      kind: classifyEntry(path)
    });
  }

  return { entries };
}

export function classifyEntry(path: string): HwpxEntryKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".xml") || lower.endsWith(".hpf") || lower.endsWith(".opf")) return "xml";
  if (lower.includes("bindata/")) {
    if (/\.(png|jpg|jpeg|bmp|gif|tif|tiff|webp)$/i.test(lower)) return "image";
    return "bindata";
  }
  if (/\.(png|jpg|jpeg|bmp|gif|tif|tiff|webp)$/i.test(lower)) return "image";
  if (/\.(ttf|otf|woff|woff2)$/i.test(lower)) return "font";
  if (/\.(ole|bin)$/i.test(lower)) return "ole";
  return "other";
}
```

Modify `packages/core/src/index.ts`:

```ts
export * from "./reader.js";
export * from "./types.js";
export const version = "0.1.0";
```

- [ ] **Step 4: Run reader tests**

Run: `npm test -- packages/core/test/reader.test.ts`

Expected: PASS.

## Task 3: Analyzer

**Files:**
- Create: `packages/core/src/analyzer.ts`
- Create: `packages/core/test/analyzer.test.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing analyzer tests**

Create `packages/core/test/analyzer.test.ts`:

```ts
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { analyzeHwpxPackage } from "../src/analyzer.js";
import { readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

describe("analyzeHwpxPackage", () => {
  it("reports image dimensions and BMP candidates", async () => {
    const png = await sharp({
      create: {
        width: 12,
        height: 8,
        channels: 3,
        background: "#ffffff"
      }
    }).png().toBuffer();
    const bmpLike = Buffer.from("BMfake");
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": "<root />",
        "BinData/image1.png": png,
        "BinData/image2.bmp": bmpLike
      }
    });

    const pkg = await readHwpxPackage(fixture);
    const analysis = await analyzeHwpxPackage(pkg);

    expect(analysis.totalSize).toBeGreaterThan(0);
    expect(analysis.images).toMatchObject([
      { path: "BinData/image1.png", format: "png", width: 12, height: 8 },
      { path: "BinData/image2.bmp", format: "bmp", isBmpCandidate: true }
    ]);
  });
});
```

- [ ] **Step 2: Run analyzer tests and verify failure**

Run: `npm test -- packages/core/test/analyzer.test.ts`

Expected: FAIL because `analyzer.ts` does not exist.

- [ ] **Step 3: Implement analyzer types and code**

Modify `packages/core/src/types.ts`:

```ts
export type HwpxEntryKind = "xml" | "image" | "font" | "ole" | "bindata" | "other";

export type HwpxEntry = {
  path: string;
  data: Buffer;
  size: number;
  kind: HwpxEntryKind;
};

export type HwpxPackage = {
  entries: HwpxEntry[];
};

export type ImageInventoryItem = {
  path: string;
  size: number;
  format: string;
  width?: number;
  height?: number;
  hasMetadata: boolean;
  isBmpCandidate: boolean;
};

export type PackageAnalysis = {
  totalSize: number;
  entriesByKind: Record<HwpxEntryKind, number>;
  images: ImageInventoryItem[];
};
```

Create `packages/core/src/analyzer.ts`:

```ts
import sharp from "sharp";
import type { HwpxEntryKind, HwpxPackage, ImageInventoryItem, PackageAnalysis } from "./types.js";

export async function analyzeHwpxPackage(pkg: HwpxPackage): Promise<PackageAnalysis> {
  const entriesByKind: Record<HwpxEntryKind, number> = {
    xml: 0,
    image: 0,
    font: 0,
    ole: 0,
    bindata: 0,
    other: 0
  };

  const images: ImageInventoryItem[] = [];
  let totalSize = 0;

  for (const entry of pkg.entries) {
    totalSize += entry.size;
    entriesByKind[entry.kind] += 1;
    if (entry.kind === "image") {
      images.push(await inspectImage(entry.path, entry.data, entry.size));
    }
  }

  return { totalSize, entriesByKind, images };
}

async function inspectImage(path: string, data: Buffer, size: number): Promise<ImageInventoryItem> {
  const extension = extensionFormat(path);
  try {
    const metadata = await sharp(data).metadata();
    return {
      path,
      size,
      format: metadata.format ?? extension,
      width: metadata.width,
      height: metadata.height,
      hasMetadata: Boolean(metadata.exif || metadata.icc || metadata.iptc || metadata.xmp),
      isBmpCandidate: extension === "bmp" || metadata.format === "bmp"
    };
  } catch {
    return {
      path,
      size,
      format: extension,
      hasMetadata: false,
      isBmpCandidate: extension === "bmp"
    };
  }
}

function extensionFormat(path: string): string {
  const match = /\.([^.\/]+)$/.exec(path);
  return match ? match[1].toLowerCase() : "unknown";
}
```

Modify `packages/core/src/index.ts`:

```ts
export * from "./analyzer.js";
export * from "./reader.js";
export * from "./types.js";
export const version = "0.1.0";
```

- [ ] **Step 4: Run analyzer tests**

Run: `npm test -- packages/core/test/analyzer.test.ts`

Expected: PASS.

## Task 4: Reference Graph and Planner

**Files:**
- Create: `packages/core/src/referenceGraph.ts`
- Create: `packages/core/src/planner.ts`
- Create: `packages/core/test/referenceGraph.test.ts`
- Create: `packages/core/test/planner.test.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing reference graph and planner tests**

Create `packages/core/test/referenceGraph.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildReferenceGraph } from "../src/referenceGraph.js";
import { readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

describe("buildReferenceGraph", () => {
  it("marks BinData files referenced by XML text", async () => {
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": "<root><img href=\"BinData/image1.png\" /></root>",
        "BinData/image1.png": Buffer.from("used"),
        "BinData/image2.png": Buffer.from("unused")
      }
    });

    const pkg = await readHwpxPackage(fixture);
    const graph = buildReferenceGraph(pkg);

    expect(graph.resources.get("BinData/image1.png")?.referenced).toBe(true);
    expect(graph.resources.get("BinData/image2.png")?.referenced).toBe(false);
  });
});
```

Create `packages/core/test/planner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { analyzeHwpxPackage } from "../src/analyzer.js";
import { createSafeOptimizationPlan } from "../src/planner.js";
import { buildReferenceGraph } from "../src/referenceGraph.js";
import { readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

describe("createSafeOptimizationPlan", () => {
  it("plans XML minify, ZIP repack, and unreferenced BinData removal", async () => {
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": "<root><img href=\"BinData/used.png\" /></root>",
        "BinData/used.png": Buffer.from("used"),
        "BinData/unused.bin": Buffer.from("unused")
      }
    });
    const pkg = await readHwpxPackage(fixture);
    const analysis = await analyzeHwpxPackage(pkg);
    const graph = buildReferenceGraph(pkg);

    const plan = createSafeOptimizationPlan({ pkg, analysis, graph });

    expect(plan.actions.map((action) => action.type)).toEqual([
      "minify-xml",
      "remove-unused",
      "repack-zip"
    ]);
    expect(plan.actions).not.toContainEqual(expect.objectContaining({ type: "convert-bmp" }));
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- packages/core/test/referenceGraph.test.ts packages/core/test/planner.test.ts`

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement reference graph and planner**

Extend `packages/core/src/types.ts` with:

```ts
export type ResourceReference = {
  path: string;
  referenced: boolean;
  refs: string[];
};

export type ReferenceGraph = {
  resources: Map<string, ResourceReference>;
  missingReferences: string[];
};

export type OptimizationAction =
  | { type: "minify-xml"; target: string; risk: "safe" }
  | { type: "strip-metadata"; target: string; risk: "safe" }
  | { type: "remove-unused"; target: string; risk: "safe" }
  | { type: "repack-zip"; target: "*"; risk: "safe" };

export type OptimizationPlan = {
  mode: "safe";
  actions: OptimizationAction[];
};
```

Create `packages/core/src/referenceGraph.ts`:

```ts
import type { HwpxPackage, ReferenceGraph, ResourceReference } from "./types.js";

export function buildReferenceGraph(pkg: HwpxPackage): ReferenceGraph {
  const resources = new Map<string, ResourceReference>();
  const xmlText = pkg.entries
    .filter((entry) => entry.kind === "xml")
    .map((entry) => ({ path: entry.path, text: entry.data.toString("utf8") }));

  for (const entry of pkg.entries) {
    if (entry.kind === "image" || entry.kind === "bindata" || entry.kind === "font" || entry.kind === "ole") {
      resources.set(entry.path, { path: entry.path, referenced: false, refs: [] });
    }
  }

  const missingReferences: string[] = [];
  for (const xml of xmlText) {
    const refs = extractInternalRefs(xml.text);
    for (const ref of refs) {
      const normalized = normalizePackagePath(ref);
      if (!normalized) continue;
      const resource = resources.get(normalized);
      if (resource) {
        resource.referenced = true;
        resource.refs.push(xml.path);
      } else if (normalized.startsWith("BinData/")) {
        missingReferences.push(normalized);
      }
    }
  }

  return { resources, missingReferences };
}

function extractInternalRefs(xml: string): string[] {
  const refs = new Set<string>();
  const pattern = /(?:href|src|binaryItemIDRef|binItem|file|filename)=["']([^"']+)["']/gi;
  for (const match of xml.matchAll(pattern)) {
    refs.add(match[1]);
  }
  for (const match of xml.matchAll(/BinData\/[^"'()<>\s]+/gi)) {
    refs.add(match[0]);
  }
  return [...refs];
}

function normalizePackagePath(value: string): string | null {
  const cleaned = value.replace(/^#/, "").replace(/^\.?\//, "");
  const binDataIndex = cleaned.toLowerCase().indexOf("bindata/");
  if (binDataIndex >= 0) {
    return cleaned.slice(binDataIndex).replace(/\\/g, "/");
  }
  return null;
}
```

Create `packages/core/src/planner.ts`:

```ts
import type { HwpxPackage, OptimizationPlan, PackageAnalysis, ReferenceGraph } from "./types.js";

export function createSafeOptimizationPlan(input: {
  pkg: HwpxPackage;
  analysis: PackageAnalysis;
  graph: ReferenceGraph;
}): OptimizationPlan {
  const actions: OptimizationPlan["actions"] = [];

  for (const entry of input.pkg.entries) {
    if (entry.kind === "xml") {
      actions.push({ type: "minify-xml", target: entry.path, risk: "safe" });
    }
  }

  for (const image of input.analysis.images) {
    if (image.hasMetadata && !image.isBmpCandidate) {
      actions.push({ type: "strip-metadata", target: image.path, risk: "safe" });
    }
  }

  for (const resource of input.graph.resources.values()) {
    if (!resource.referenced) {
      actions.push({ type: "remove-unused", target: resource.path, risk: "safe" });
    }
  }

  actions.push({ type: "repack-zip", target: "*", risk: "safe" });

  return { mode: "safe", actions };
}
```

Modify `packages/core/src/index.ts` to export both modules.

- [ ] **Step 4: Run tests**

Run: `npm test -- packages/core/test/referenceGraph.test.ts packages/core/test/planner.test.ts`

Expected: PASS.

## Task 5: Optimizer, Writer, Verifier, Report

**Files:**
- Create: `packages/core/src/optimizer.ts`
- Create: `packages/core/src/writer.ts`
- Create: `packages/core/src/verifier.ts`
- Create: `packages/core/src/report.ts`
- Create: `packages/core/src/optimize.ts`
- Create: `packages/core/test/optimize.test.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing optimize flow tests**

Create `packages/core/test/optimize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { analyzeHwpxBuffer, optimizeHwpxBufferSafe } from "../src/optimize.js";
import { readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

describe("optimizeHwpxBufferSafe", () => {
  it("removes unreferenced BinData and writes a verified package", async () => {
    const input = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": "<root> <img href=\"BinData/used.bin\" /> </root>",
        "BinData/used.bin": Buffer.from("used"),
        "BinData/unused.bin": Buffer.from("unused")
      }
    });

    const result = await optimizeHwpxBufferSafe(input);
    const output = await readHwpxPackage(result.output);

    expect(output.entries.map((entry) => entry.path).sort()).toEqual([
      "BinData/used.bin",
      "Contents/section0.xml"
    ]);
    expect(result.report.actions.applied).toContainEqual(
      expect.objectContaining({ type: "remove-unused", target: "BinData/unused.bin" })
    );
  });

  it("analyzes without optimizing", async () => {
    const input = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": "<root />"
      }
    });

    const report = await analyzeHwpxBuffer(input);

    expect(report.originalSize).toBeGreaterThan(0);
    expect(report.images).toEqual([]);
  });
});
```

- [ ] **Step 2: Run optimize tests and verify failure**

Run: `npm test -- packages/core/test/optimize.test.ts`

Expected: FAIL because optimize modules do not exist.

- [ ] **Step 3: Implement optimizer, writer, verifier, report, orchestrator**

Extend `packages/core/src/types.ts` with:

```ts
export type AppliedAction = {
  type: OptimizationAction["type"];
  target: string;
  beforeSize?: number;
  afterSize?: number;
};

export type OptimizationReport = {
  originalSize: number;
  optimizedSize?: number;
  savedBytes?: number;
  savedPercent?: number;
  images: ImageInventoryItem[];
  actions: {
    planned: OptimizationAction[];
    applied: AppliedAction[];
    skipped: AppliedAction[];
  };
  warnings: string[];
};
```

Create `packages/core/src/optimizer.ts`:

```ts
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import sharp from "sharp";
import type { AppliedAction, HwpxPackage, OptimizationPlan } from "./types.js";

export async function applySafeOptimizationPlan(input: {
  pkg: HwpxPackage;
  plan: OptimizationPlan;
}): Promise<{ pkg: HwpxPackage; applied: AppliedAction[]; skipped: AppliedAction[] }> {
  const applied: AppliedAction[] = [];
  const skipped: AppliedAction[] = [];
  const removeTargets = new Set(
    input.plan.actions.filter((action) => action.type === "remove-unused").map((action) => action.target)
  );

  const entries = [];
  for (const entry of input.pkg.entries) {
    if (removeTargets.has(entry.path)) {
      applied.push({ type: "remove-unused", target: entry.path, beforeSize: entry.size, afterSize: 0 });
      continue;
    }

    const strip = input.plan.actions.find(
      (action) => action.type === "strip-metadata" && action.target === entry.path
    );
    if (strip) {
      try {
        const optimized = await sharp(entry.data).toBuffer();
        entries.push({ ...entry, data: optimized, size: optimized.byteLength });
        applied.push({
          type: "strip-metadata",
          target: entry.path,
          beforeSize: entry.size,
          afterSize: optimized.byteLength
        });
        continue;
      } catch {
        skipped.push({ type: "strip-metadata", target: entry.path, beforeSize: entry.size });
      }
    }

    const minify = input.plan.actions.find(
      (action) => action.type === "minify-xml" && action.target === entry.path
    );
    if (minify) {
      try {
        const minified = minifyXml(entry.data.toString("utf8"));
        const data = Buffer.from(minified);
        entries.push({ ...entry, data, size: data.byteLength });
        applied.push({ type: "minify-xml", target: entry.path, beforeSize: entry.size, afterSize: data.byteLength });
        continue;
      } catch {
        skipped.push({ type: "minify-xml", target: entry.path, beforeSize: entry.size });
      }
    }

    entries.push(entry);
  }

  return { pkg: { entries }, applied, skipped };
}

function minifyXml(xml: string): string {
  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true });
  const builder = new XMLBuilder({ ignoreAttributes: false, preserveOrder: true, suppressEmptyNode: false });
  return builder.build(parser.parse(xml));
}
```

Create `packages/core/src/writer.ts`:

```ts
import JSZip from "jszip";
import type { HwpxPackage } from "./types.js";

export async function writeHwpxPackage(pkg: HwpxPackage): Promise<Buffer> {
  const zip = new JSZip();
  for (const entry of pkg.entries) {
    zip.file(entry.path, entry.data);
  }
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } }));
}
```

Create `packages/core/src/verifier.ts`:

```ts
import { XMLParser } from "fast-xml-parser";
import { buildReferenceGraph } from "./referenceGraph.js";
import { readHwpxPackage } from "./reader.js";
import type { HwpxPackage } from "./types.js";

export async function verifyHwpxOutput(output: Buffer): Promise<void> {
  const pkg = await readHwpxPackage(output);
  verifyParsedXml(pkg);
  const graph = buildReferenceGraph(pkg);
  if (graph.missingReferences.length > 0) {
    throw new Error(`Verification failed: missing references ${graph.missingReferences.join(", ")}`);
  }
}

function verifyParsedXml(pkg: HwpxPackage): void {
  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true });
  for (const entry of pkg.entries) {
    if (entry.kind !== "xml") continue;
    try {
      parser.parse(entry.data.toString("utf8"));
    } catch (error) {
      throw new Error(`Verification failed: XML does not parse at ${entry.path}`, { cause: error });
    }
  }
}
```

Create `packages/core/src/report.ts`:

```ts
import type { AppliedAction, OptimizationAction, OptimizationReport, PackageAnalysis } from "./types.js";

export function createAnalysisReport(analysis: PackageAnalysis): OptimizationReport {
  return {
    originalSize: analysis.totalSize,
    images: analysis.images,
    actions: { planned: [], applied: [], skipped: [] },
    warnings: analysis.images
      .filter((image) => image.isBmpCandidate)
      .map((image) => `BMP candidate detected but not converted in safe mode: ${image.path}`)
  };
}

export function createOptimizationReport(input: {
  analysis: PackageAnalysis;
  optimizedSize: number;
  planned: OptimizationAction[];
  applied: AppliedAction[];
  skipped: AppliedAction[];
}): OptimizationReport {
  const savedBytes = input.analysis.totalSize - input.optimizedSize;
  return {
    originalSize: input.analysis.totalSize,
    optimizedSize: input.optimizedSize,
    savedBytes,
    savedPercent: input.analysis.totalSize === 0 ? 0 : (savedBytes / input.analysis.totalSize) * 100,
    images: input.analysis.images,
    actions: {
      planned: input.planned,
      applied: input.applied,
      skipped: input.skipped
    },
    warnings: input.analysis.images
      .filter((image) => image.isBmpCandidate)
      .map((image) => `BMP candidate detected but not converted in safe mode: ${image.path}`)
  };
}
```

Create `packages/core/src/optimize.ts`:

```ts
import { analyzeHwpxPackage } from "./analyzer.js";
import { applySafeOptimizationPlan } from "./optimizer.js";
import { createSafeOptimizationPlan } from "./planner.js";
import { createAnalysisReport, createOptimizationReport } from "./report.js";
import { buildReferenceGraph } from "./referenceGraph.js";
import { readHwpxPackage } from "./reader.js";
import { verifyHwpxOutput } from "./verifier.js";
import { writeHwpxPackage } from "./writer.js";
import type { OptimizationReport } from "./types.js";

export async function analyzeHwpxBuffer(input: Buffer): Promise<OptimizationReport> {
  const pkg = await readHwpxPackage(input);
  const analysis = await analyzeHwpxPackage(pkg);
  return createAnalysisReport(analysis);
}

export async function optimizeHwpxBufferSafe(input: Buffer): Promise<{
  output: Buffer;
  report: OptimizationReport;
}> {
  const pkg = await readHwpxPackage(input);
  const analysis = await analyzeHwpxPackage(pkg);
  const graph = buildReferenceGraph(pkg);
  const plan = createSafeOptimizationPlan({ pkg, analysis, graph });
  const optimized = await applySafeOptimizationPlan({ pkg, plan });
  const output = await writeHwpxPackage(optimized.pkg);
  await verifyHwpxOutput(output);
  const report = createOptimizationReport({
    analysis,
    optimizedSize: output.byteLength,
    planned: plan.actions,
    applied: optimized.applied,
    skipped: optimized.skipped
  });
  return { output, report };
}
```

Modify `packages/core/src/index.ts` to export new modules.

- [ ] **Step 4: Run optimize tests**

Run: `npm test -- packages/core/test/optimize.test.ts`

Expected: PASS.

## Task 6: CLI

**Files:**
- Modify: `packages/cli/src/index.ts`
- Create: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Create `packages/cli/test/cli.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";
import { createHwpxFixture } from "../../core/test/fixtures.js";

describe("runCli", () => {
  it("analyzes a file and writes a report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const reportPath = join(dir, "report.json");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));

    const code = await runCli(["analyze", inputPath, "--report", reportPath]);

    expect(code).toBe(0);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.originalSize).toBeGreaterThan(0);
  });

  it("optimizes a file and writes output plus report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const outputPath = join(dir, "output.hwpx");
    const reportPath = join(dir, "report.json");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));

    const code = await runCli(["optimize", inputPath, "--mode", "safe", "--out", outputPath, "--report", reportPath]);

    expect(code).toBe(0);
    expect((await readFile(outputPath)).byteLength).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(reportPath, "utf8")).optimizedSize).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run CLI tests and verify failure**

Run: `npm test -- packages/cli/test/cli.test.ts`

Expected: FAIL because `runCli` is not implemented.

- [ ] **Step 3: Implement CLI**

Write `packages/cli/src/index.ts`:

```ts
#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { analyzeHwpxBuffer, optimizeHwpxBufferSafe } from "@hwpx-optimizer/core";

export async function runCli(argv: string[]): Promise<number> {
  const [command, inputPath, ...rest] = argv;
  if (!command || !inputPath) {
    printUsage();
    return 1;
  }

  const options = parseOptions(rest);
  try {
    if (command === "analyze") {
      const report = await analyzeHwpxBuffer(await readFile(inputPath));
      const reportPath = options.report ?? `${inputPath}.report.json`;
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log(`Analyzed ${inputPath}`);
      console.log(`Report: ${reportPath}`);
      return 0;
    }

    if (command === "optimize") {
      if ((options.mode ?? "safe") !== "safe") {
        console.error("Only --mode safe is supported in v1");
        return 1;
      }
      const result = await optimizeHwpxBufferSafe(await readFile(inputPath));
      const outputPath = options.out ?? defaultOutputPath(inputPath);
      const reportPath = options.report ?? `${outputPath}.report.json`;
      await writeFile(outputPath, result.output);
      await writeFile(reportPath, JSON.stringify(result.report, null, 2));
      console.log(`Optimized ${inputPath}`);
      console.log(`Output: ${outputPath}`);
      console.log(`Report: ${reportPath}`);
      return 0;
    }

    printUsage();
    return 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function parseOptions(args: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = args[index + 1];
    if (value && !value.startsWith("--")) {
      options[key] = value;
      index += 1;
    } else {
      options[key] = "true";
    }
  }
  return options;
}

function defaultOutputPath(inputPath: string): string {
  const name = basename(inputPath, ".hwpx");
  return join(dirname(inputPath), `${name}.optimized.hwpx`);
}

function printUsage(): void {
  console.error("Usage:");
  console.error("  hwpx-opt analyze <file.hwpx> [--report report.json]");
  console.error("  hwpx-opt optimize <file.hwpx> --mode safe [--out output.hwpx] [--report report.json]");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runCli(process.argv.slice(2));
}
```

- [ ] **Step 4: Run CLI tests**

Run: `npm test -- packages/cli/test/cli.test.ts`

Expected: PASS.

## Task 7: Full Verification

**Files:**
- Modify only if tests reveal defects.

- [ ] **Step 1: Run targeted test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Run a local CLI smoke test**

Run: `npm run cli -- analyze <fixture-file>.hwpx`

Expected: The command writes a JSON report and exits 0. If no fixture file exists on disk yet, skip this step and rely on the CLI integration tests.

- [ ] **Step 4: Review v1 acceptance criteria**

Confirm:

- Analyze works.
- Safe optimize works.
- Original file is never modified.
- Output passes verifier checks.
- JSON report lists size savings and actions.
- Safe mode does not change image dimensions, perform BMP conversion, or reduce JPEG quality.
