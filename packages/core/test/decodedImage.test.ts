import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { getDecodedImage, peekDecodedImageCache } from "../src/decodedImage.js";

describe("getDecodedImage", () => {
  it("caches decoded raw pixels for the same Buffer identity", async () => {
    const png = await sharp({
      create: { width: 16, height: 12, channels: 3, background: "#336699" }
    })
      .png()
      .toBuffer();

    expect(await peekDecodedImageCache(png, { rotate: true })).toBe("miss");
    const first = await getDecodedImage(png, { rotate: true });
    expect(first).not.toBeNull();
    expect(await peekDecodedImageCache(png, { rotate: true })).toBe("hit");

    const second = await getDecodedImage(png, { rotate: true });
    expect(second).not.toBeNull();
    expect(second!.data).toBe(first!.data);
    expect(hash(second!.data)).toBe(hash(first!.data));
    expect(second!.width).toBe(16);
    expect(second!.height).toBe(12);
    expect(second!.channels).toBe(3);
  });

  it("keeps plain and rotated cache slots independent", async () => {
    const jpeg = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#112233" }
    })
      .jpeg()
      .toBuffer();

    await getDecodedImage(jpeg, { rotate: false });
    expect(await peekDecodedImageCache(jpeg, { rotate: false })).toBe("hit");
    expect(await peekDecodedImageCache(jpeg, { rotate: true })).toBe("miss");
    await getDecodedImage(jpeg, { rotate: true });
    expect(await peekDecodedImageCache(jpeg, { rotate: true })).toBe("hit");
  });
});

function hash(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
