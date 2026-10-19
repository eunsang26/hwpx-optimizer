import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHwpxFixture } from "../../../packages/core/test/fixtures.js";
import { verifyHwpxOutput } from "../../../packages/core/src/verifier.js";
import { DesktopDocumentController } from "../src/main/documentController.js";
import { DesktopPathPermissions } from "../src/main/pathPermissions.js";
import { DocumentWorkerClient } from "../src/main/documentWorkerClient.js";
import { defaultDesktopSettings } from "../src/main/desktopService.js";

let directory: string;
let input: string;
let source: Buffer;
let controller: DesktopDocumentController;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "desktop-controller-"));
  input = join(directory, "input.hwpx");
  source = await createHwpxFixture({ entries: { "Contents/section0.xml": "<root><p> 00123 original </p></root>" } });
  await writeFile(input, source);
  const bootstrap = join(directory, "worker.mjs");
  await writeFile(bootstrap, `
    import { createRequire } from "node:module";
    import { pathToFileURL } from "node:url";
    const require = createRequire(${JSON.stringify(resolve("package.json"))});
    const { register } = await import(pathToFileURL(require.resolve("tsx/esm/api")).href); register();
    await import(${JSON.stringify(pathToFileURL(resolve("apps/desktop/src/main/documentWorker.ts")).href)});
  `);
  controller = new DesktopDocumentController(async () => ({ ...defaultDesktopSettings, saveReport: true, preventOverwrite: false }),
    new DesktopPathPermissions(), new DocumentWorkerClient(() => new Worker(bootstrap, { execArgv: ["--conditions=development"] })));
});
afterEach(async () => { await controller.close(); await rm(directory, { recursive: true, force: true }); });

describe("session grants independent of document worker lifecycle", () => {
  it("denies ungranted existing files/directories, then grants only selected inputs and generated results", async () => {
    const grants = controller.permissions;
    await expect(controller.analyze(input)).rejects.toThrow("선택된 HWPX");
    await expect(grants.requireGenerated(input)).rejects.toThrow("생성된 결과");
    await expect(grants.requireKnownDocument(input)).rejects.toThrow("선택 또는 생성");
    const other = join(directory, "other"); await mkdir(other);
    await expect(grants.requireOutputDirectory(other)).rejects.toThrow("선택된 저장 위치");
    await grants.registerInput(input);
    expect((await controller.analyze(input)).report.originalSize).toBe(source.length);
    await grants.registerOutputDirectory(other);
    const result = await controller.optimize({ filePath: input, outputDirectory: other, mode: "safe" });
    expect(await grants.requireGenerated(result.outputPath)).toBe(result.outputPath);
    await controller.verify(result.outputPath);
    await verifyHwpxOutput(await readFile(result.outputPath), { original: source, mode: "safe" });
    expect(JSON.parse(await readFile(result.reportPath!, "utf8")).optimizedSize).toBe((await readFile(result.outputPath)).length);
    expect(hash(await readFile(input))).toBe(hash(source));
  });

  it("retains all original identities across worker restarts and refuses to replace an earlier selection", async () => {
    const earlier = join(directory, "input_optimized.hwpx");
    const earlierBytes = await createHwpxFixture({ entries: { "Contents/section0.xml": "<root>Earlier original</root>" } });
    await writeFile(earlier, earlierBytes);
    await controller.permissions.registerInput(earlier);
    await controller.analyze(earlier);
    await controller.worker.dispose();
    await controller.permissions.registerInput(input);
    await expect(controller.optimize({ filePath: input, mode: "safe" })).rejects.toThrow(/original.*input/i);
    expect(hash(await readFile(earlier))).toBe(hash(earlierBytes));
    expect(hash(await readFile(input))).toBe(hash(source));
    expect((await readdir(directory)).sort()).toEqual(["input.hwpx", "input_optimized.hwpx", "worker.mjs"]);
  });

  it("rejects forged batch output paths before report publication", async () => {
    const forged = join(directory, "not-generated.hwpx"); await writeFile(forged, source);
    await controller.permissions.registerInput(input);
    await expect(controller.saveBatchReport({ firstInputPath: input, mode: "safe", items: [
      { input: "input.hwpx", status: "done", output: forged }
    ] })).rejects.toThrow("생성된 결과");
    expect((await readdir(directory)).sort()).toEqual(["input.hwpx", "not-generated.hwpx", "worker.mjs"]);
    expect(hash(await readFile(forged))).toBe(hash(source));
  });

  it("waits for cancellation before closing the worker and refuses subsequent work", async () => {
    await controller.permissions.registerInput(input);
    let reached!: () => void;
    const ready = new Promise<void>(resolve => { reached = resolve; });
    const prepare = controller.worker.prepare;
    controller.worker.prepare = async function (request, signal, progress) {
      const result = await prepare.call(this, request, signal, progress);
      reached();
      await new Promise<void>(resolve => signal.aborted ? resolve() : signal.addEventListener("abort", () => resolve(), { once: true }));
      signal.throwIfAborted();
      return result;
    };
    const result = controller.optimize({ filePath: input, mode: "safe" });
    const rejected = expect(result).rejects.toThrow("Optimization cancelled.");
    await ready;
    expect(controller.busy).toBe(true);
    await controller.close(); await rejected;
    expect(controller.busy).toBe(false);
    await expect(controller.analyze(input)).rejects.toThrow("종료하는 중");
    expect((await readdir(directory)).sort()).toEqual(["input.hwpx", "worker.mjs"]);
    expect(hash(await readFile(input))).toBe(hash(source));
  }, 15_000);

  it("does not turn a directory or a non-HWPX file into an input grant", async () => {
    const text = join(directory, "notes.txt"); await writeFile(text, "unrelated");
    await expect(controller.permissions.registerInput(text)).rejects.toThrow("HWPX 파일만");
    await expect(controller.permissions.registerInput(directory)).rejects.toThrow("유효한 파일");
    expect(controller.permissions.protectedInputs).toEqual([]);
    expect(await readFile(text, "utf8")).toBe("unrelated");
  });
});
