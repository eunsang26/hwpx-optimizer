import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  buildSpikeHwpxFromTemplate,
  resolveSpikeTemplatePath,
  type SpikeImage
} from "./spikeFromTemplate.js";

export type { SpikeImage };

export type SpikeEmitResult = {
  outDir: string;
  files: string[];
  avifSkipped: boolean;
  avifSkipReason?: string;
  templatePath: string;
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

async function writeHwpx(outDir: string, filename: string, images: SpikeImage[], templatePath: string): Promise<string> {
  const hwpx = await buildSpikeHwpxFromTemplate(templatePath, images);
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
  const templatePath = await resolveSpikeTemplatePath();

  const basePng = await createBaseRgb();
  const jpeg = await encodeJpeg(basePng);
  const webp = await encodeWebp(basePng);

  const files: string[] = [];

  files.push(
    await writeHwpx(
      outDir,
      "jpeg-control.hwpx",
      [
        {
          id: "jpegCtrl",
          path: "BinData/control.jpg",
          mediaType: "image/jpg",
          data: jpeg
        }
      ],
      templatePath
    )
  );

  files.push(
    await writeHwpx(
      outDir,
      "webp-test.hwpx",
      [
        {
          id: "webpTest",
          path: "BinData/test.webp",
          mediaType: "image/webp",
          data: webp
        }
      ],
      templatePath
    )
  );

  let avifSkipped = false;
  let avifSkipReason: string | undefined;

  try {
    const avif = await encodeAvif(basePng);
    files.push(
      await writeHwpx(
        outDir,
        "avif-test.hwpx",
        [
          {
            id: "avifTest",
            path: "BinData/test.avif",
            mediaType: "image/avif",
            data: avif
          }
        ],
        templatePath
      )
    );
  } catch (error) {
    avifSkipped = true;
    avifSkipReason = error instanceof Error ? error.message : String(error);
  }

  files.push(
    await writeHwpx(
      outDir,
      "jpeg-webp-mixed.hwpx",
      [
        {
          id: "mixedJpeg",
          path: "BinData/mixed.jpg",
          mediaType: "image/jpg",
          data: jpeg
        },
        {
          id: "mixedWebp",
          path: "BinData/mixed.webp",
          mediaType: "image/webp",
          data: webp
        }
      ],
      templatePath
    )
  );

  for (const name of ["CHECKLIST.md", "RESULT.md", "POLICY_CHECKBOX.md"]) {
    files.push(await copyTemplate(name, outDir));
  }

  return { outDir, files, avifSkipped, avifSkipReason, templatePath };
}
