import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { writeHwpxPackage } from "@hwpx-optimizer/core";

type SpikeImage = {
  id: string;
  path: string;
  mediaType: string;
  data: Buffer;
  displayWidth: number;
  displayHeight: number;
};

export type SpikeEmitResult = {
  outDir: string;
  files: string[];
  avifSkipped: boolean;
  avifSkipReason?: string;
};

const benchRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const spikeTemplateDir = join(benchRoot, "spike-template");

async function createBaseRgb(): Promise<Buffer> {
  return sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: { r: 30, g: 110, b: 190 }
    }
  })
    .png()
    .toBuffer();
}

async function encodeJpeg(basePng: Buffer): Promise<Buffer> {
  return sharp(basePng).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

async function encodeWebp(basePng: Buffer): Promise<Buffer> {
  return sharp(basePng).webp({ quality: 85 }).toBuffer();
}

async function encodeAvif(basePng: Buffer): Promise<Buffer> {
  return sharp(basePng).avif({ quality: 60 }).toBuffer();
}

function buildHwpxPackage(images: SpikeImage[]): Promise<Buffer> {
  const manifestItems = images
    .map(
      (image) =>
        `<opf:item id="${image.id}" href="${image.path}" media-type="${image.mediaType}" isEmbeded="1"/>`
    )
    .join("");
  const sectionRefs = images
    .map(
      (image) =>
        `<hp:pic><hp:sz width="${image.displayWidth}" height="${image.displayHeight}"/><hc:img binaryItemIDRef="${image.id}"/></hp:pic>`
    )
    .join("");

  const entries = [
    { path: "mimetype", data: Buffer.from("application/hwp+zip"), kind: "other" as const },
    {
      path: "Contents/content.hpf",
      data: Buffer.from(
        `<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:manifest>${manifestItems}</opf:manifest></opf:package>`
      ),
      kind: "xml" as const
    },
    {
      path: "Contents/section0.xml",
      data: Buffer.from(`<root>${sectionRefs}</root>`),
      kind: "xml" as const
    },
    ...images.map((image) => ({
      path: image.path,
      data: image.data,
      kind: "image" as const
    }))
  ].map((entry) => ({ ...entry, size: entry.data.byteLength }));

  return writeHwpxPackage({ entries });
}

async function writeHwpx(outDir: string, filename: string, images: SpikeImage[]): Promise<string> {
  const hwpx = await buildHwpxPackage(images);
  const absPath = join(outDir, filename);
  await writeFile(absPath, hwpx);
  return absPath;
}

async function copyTemplate(name: string, outDir: string): Promise<string> {
  const src = join(spikeTemplateDir, name);
  const dest = join(outDir, name);
  await copyFile(src, dest);
  return dest;
}

export async function emitHangulSpikeArtifacts(outDir: string): Promise<SpikeEmitResult> {
  await mkdir(outDir, { recursive: true });

  const basePng = await createBaseRgb();
  const jpeg = await encodeJpeg(basePng);
  const webp = await encodeWebp(basePng);

  const files: string[] = [];

  files.push(
    await writeHwpx(outDir, "jpeg-control.hwpx", [
      {
        id: "jpegCtrl",
        path: "BinData/control.jpg",
        mediaType: "image/jpeg",
        data: jpeg,
        displayWidth: 4800,
        displayHeight: 3600
      }
    ])
  );

  files.push(
    await writeHwpx(outDir, "webp-test.hwpx", [
      {
        id: "webpTest",
        path: "BinData/test.webp",
        mediaType: "image/webp",
        data: webp,
        displayWidth: 4800,
        displayHeight: 3600
      }
    ])
  );

  let avifSkipped = false;
  let avifSkipReason: string | undefined;

  try {
    const avif = await encodeAvif(basePng);
    files.push(
      await writeHwpx(outDir, "avif-test.hwpx", [
        {
          id: "avifTest",
          path: "BinData/test.avif",
          mediaType: "image/avif",
          data: avif,
          displayWidth: 4800,
          displayHeight: 3600
        }
      ])
    );
  } catch (error) {
    avifSkipped = true;
    avifSkipReason = error instanceof Error ? error.message : String(error);
  }

  files.push(
    await writeHwpx(outDir, "jpeg-webp-mixed.hwpx", [
      {
        id: "mixedJpeg",
        path: "BinData/mixed.jpg",
        mediaType: "image/jpeg",
        data: jpeg,
        displayWidth: 3600,
        displayHeight: 2700
      },
      {
        id: "mixedWebp",
        path: "BinData/mixed.webp",
        mediaType: "image/webp",
        data: webp,
        displayWidth: 3600,
        displayHeight: 2700
      }
    ])
  );

  for (const name of ["CHECKLIST.md", "RESULT.md", "POLICY_CHECKBOX.md"]) {
    files.push(await copyTemplate(name, outDir));
  }

  return { outDir, files, avifSkipped, avifSkipReason };
}
