import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readHwpxPackage, writeHwpxPackage } from "@hwpx-optimizer/core";
import type { HwpxEntry } from "@hwpx-optimizer/core";

export const SPIKE_TEMPLATE_ENV = "HWPX_SPIKE_TEMPLATE";

export type SpikeImage = {
  id: string;
  path: string;
  mediaType: string;
  data: Buffer;
};

type TemplateParts = {
  structuralEntries: HwpxEntry[];
  secPrefix: string;
  picParagraphTemplate: string;
  hpfBeforeManifest: string;
  hpfAfterManifest: string;
};

const benchRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(benchRoot, "../..");

let cachedTemplate: TemplateParts | null = null;
let cachedTemplatePath: string | null = null;

export async function resolveSpikeTemplatePath(): Promise<string> {
  const candidates = [
    process.env[SPIKE_TEMPLATE_ENV]?.trim(),
    join(repoRoot, "sample2.hwpx"),
    join(benchRoot, "fixtures", "spike-template.hwpx")
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    "Hangul spike template HWPX not found. Place sample2.hwpx at repo root or set HWPX_SPIKE_TEMPLATE."
  );
}

function extractSinglePicParagraph(sectionXml: string): string {
  let best: string | null = null;
  for (const match of sectionXml.matchAll(/<hp:p[\s\S]*?<\/hp:p>/g)) {
    const block = match[0]!;
    const picCount = (block.match(/<hp:pic/g) ?? []).length;
    if (picCount === 1 && block.includes("binaryItemIDRef") && (!best || block.length < best.length)) {
      best = block;
    }
  }
  if (!best) {
    throw new Error("Template section0.xml has no single-image paragraph to clone");
  }
  return best;
}

async function loadTemplateParts(templatePath: string): Promise<TemplateParts> {
  if (cachedTemplate && cachedTemplatePath === templatePath) {
    return cachedTemplate;
  }

  const pkg = await readHwpxPackage(await readFile(templatePath));
  const sectionEntry = pkg.entries.find((entry) => entry.path === "Contents/section0.xml");
  const hpfEntry = pkg.entries.find((entry) => entry.path === "Contents/content.hpf");
  if (!sectionEntry || !hpfEntry) {
    throw new Error("Template HWPX missing Contents/section0.xml or Contents/content.hpf");
  }

  const sectionXml = sectionEntry.data.toString("utf8");
  const hpfXml = hpfEntry.data.toString("utf8");
  const manifestStart = hpfXml.indexOf("<opf:manifest>");
  const manifestEnd = hpfXml.indexOf("</opf:manifest>");
  if (manifestStart < 0 || manifestEnd < 0) {
    throw new Error("Template content.hpf missing opf:manifest");
  }

  cachedTemplate = {
    structuralEntries: pkg.entries.filter(
      (entry) =>
        entry.kind !== "image" &&
        !entry.path.startsWith("BinData/") &&
        entry.path !== "Contents/content.hpf" &&
        entry.path !== "Contents/section0.xml"
    ),
    secPrefix: sectionXml.slice(0, sectionXml.indexOf("<hp:p")),
    picParagraphTemplate: extractSinglePicParagraph(sectionXml),
    hpfBeforeManifest: hpfXml.slice(0, manifestStart),
    hpfAfterManifest: hpfXml.slice(manifestEnd + "</opf:manifest>".length)
  };
  cachedTemplatePath = templatePath;
  return cachedTemplate;
}

function buildManifestXml(images: SpikeImage[]): string {
  const items = [
    `<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>`,
    ...images.map(
      (image) =>
        `<opf:item id="${image.id}" href="${image.path}" media-type="${image.mediaType}" isEmbeded="1"/>`
    ),
    `<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>`,
    `<opf:item id="settings" href="settings.xml" media-type="application/xml"/>`
  ];
  return `<opf:manifest>${items.join("")}</opf:manifest>`;
}

function buildSectionXml(parts: TemplateParts, images: SpikeImage[]): string {
  const paragraphs = images.map((image, index) => {
    let paragraph = parts.picParagraphTemplate.replace(
      /binaryItemIDRef="[^"]+"/,
      `binaryItemIDRef="${image.id}"`
    );
    paragraph = paragraph.replace(/<hp:p id="(\d+)"/, `<hp:p id="${2_147_483_648 + index}"`);
    paragraph = paragraph.replace(/<hp:pic id="(\d+)"/, `<hp:pic id="${2_141_777_371 + index}"`);
    paragraph = paragraph.replace(/instid="(\d+)"/, `instid="${1_050_784_073 + index}"`);
    return paragraph;
  });
  return `${parts.secPrefix}${paragraphs.join("")}</hs:sec>`;
}

function sanitizeMetadata(hpfPrefix: string): string {
  return hpfPrefix.replace(
    /<opf:title>[^<]*<\/opf:title>/,
    "<opf:title>Phase A format spike</opf:title>"
  );
}

export async function buildSpikeHwpxFromTemplate(
  templatePath: string,
  images: SpikeImage[]
): Promise<Buffer> {
  const parts = await loadTemplateParts(templatePath);
  const contentHpf = sanitizeMetadata(parts.hpfBeforeManifest) + buildManifestXml(images) + parts.hpfAfterManifest;
  const section0 = buildSectionXml(parts, images);

  const entries: HwpxEntry[] = [
    ...parts.structuralEntries.map((entry) => ({
      ...entry,
      data: Buffer.from(entry.data),
      size: entry.data.byteLength
    })),
    {
      path: "Contents/content.hpf",
      data: Buffer.from(contentHpf, "utf8"),
      size: Buffer.byteLength(contentHpf, "utf8"),
      kind: "xml" as const
    },
    {
      path: "Contents/section0.xml",
      data: Buffer.from(section0, "utf8"),
      size: Buffer.byteLength(section0, "utf8"),
      kind: "xml" as const
    },
    ...images.map((image) => ({
      path: image.path,
      data: image.data,
      size: image.data.byteLength,
      kind: "image" as const
    }))
  ];

  return writeHwpxPackage({ entries });
}
