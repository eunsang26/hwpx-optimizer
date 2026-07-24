import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { ensureNodeExe, nodeDistUrls, parseSha256Sums } from "./fetchNode.mjs";

const VERSION = "20.20.2";
const ZIP_FILE_NAME = `node-v${VERSION}-win-x64.zip`;

async function makeNodeZip(contents = "MZ-fake") {
  const zip = new JSZip();
  zip.file(`node-v${VERSION}-win-x64/node.exe`, contents);
  return zip.generateAsync({ type: "nodebuffer" });
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("fetchNode helpers", () => {
  it("builds official dist URLs", () => {
    const urls = nodeDistUrls(VERSION);
    expect(urls.zipUrl).toBe(
      "https://nodejs.org/dist/v20.20.2/node-v20.20.2-win-x64.zip"
    );
    expect(urls.shasumsUrl).toBe("https://nodejs.org/dist/v20.20.2/SHASUMS256.txt");
  });

  it("parses SHASUMS256 lines", () => {
    const text = [
      "aaaa node-v20.20.2-linux-x64.tar.gz",
      `${"b".repeat(64)}  ${ZIP_FILE_NAME}`,
      ""
    ].join("\n");

    expect(parseSha256Sums(text, ZIP_FILE_NAME)).toBe("b".repeat(64));
  });

  it("downloads, verifies, and extracts only node.exe", async () => {
    const root = await mkdtemp(join(tmpdir(), "fetch-node-"));
    const cacheDir = join(root, "cache");
    const outExePath = join(root, "node", "node.exe");
    const zipBytes = await makeNodeZip();
    const shasums = `${sha256(zipBytes)}  ${ZIP_FILE_NAME}\n`;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/SHASUMS256.txt")) {
        return new Response(shasums);
      }
      if (url.endsWith(`/${ZIP_FILE_NAME}`)) {
        return new Response(zipBytes);
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    await ensureNodeExe({ version: VERSION, cacheDir, outExePath, fetchImpl });

    expect(await readFile(outExePath, "utf8")).toBe("MZ-fake");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await readFile(join(cacheDir, ZIP_FILE_NAME))).toEqual(zipBytes);
    expect(await readFile(join(cacheDir, "SHASUMS256.txt"), "utf8")).toBe(shasums);
  });

  it("rejects a downloaded zip whose checksum does not match", async () => {
    const root = await mkdtemp(join(tmpdir(), "fetch-node-"));
    const zipBytes = await makeNodeZip();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      return String(input).endsWith("/SHASUMS256.txt")
        ? new Response(`${"0".repeat(64)}  ${ZIP_FILE_NAME}\n`)
        : new Response(zipBytes);
    }) as typeof fetch;

    await expect(
      ensureNodeExe({
        version: VERSION,
        cacheDir: join(root, "cache"),
        outExePath: join(root, "node.exe"),
        fetchImpl
      })
    ).rejects.toThrow(/SHA-256 mismatch/);
  });

  it("requires SHASUMS256.txt beside a local node zip", async () => {
    const root = await mkdtemp(join(tmpdir(), "fetch-node-"));
    const nodeZipPath = join(root, ZIP_FILE_NAME);
    await writeFile(nodeZipPath, await makeNodeZip());

    await expect(
      ensureNodeExe({
        version: VERSION,
        cacheDir: join(root, "cache"),
        outExePath: join(root, "node.exe"),
        nodeZipPath
      })
    ).rejects.toThrow(/SHASUMS256\.txt.*local/i);
  });

  it("verifies and extracts a local node zip using its adjacent SHASUMS", async () => {
    const root = await mkdtemp(join(tmpdir(), "fetch-node-"));
    const nodeZipPath = join(root, ZIP_FILE_NAME);
    const zipBytes = await makeNodeZip("MZ-local");
    await writeFile(nodeZipPath, zipBytes);
    await writeFile(
      join(root, "SHASUMS256.txt"),
      `${sha256(zipBytes)}  ${basename(nodeZipPath)}\n`
    );
    const outExePath = join(root, "out", "node.exe");

    await ensureNodeExe({
      version: VERSION,
      cacheDir: join(root, "cache"),
      outExePath,
      nodeZipPath
    });

    expect(await readFile(outExePath, "utf8")).toBe("MZ-local");
  });
});
