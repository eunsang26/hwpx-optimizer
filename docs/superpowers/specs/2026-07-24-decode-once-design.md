# Decode-once Pipeline — Design

- Date: 2026-07-24
- Status: implementation
- Scope: shared decode cache inside `packages/core` for balanced/aggressive (and safe PNG) hot paths. No format-policy change.

## Problem

The same `Buffer` BinData is often decoded more than once per optimize:

1. same-visual duplicate hashing (`computeDecodedPixelHash`)
2. transform (`resizeJpeg` / `resizePng` / `convertBmpToPng` / …)

Goal: decode each input buffer **once per process lifetime of that Buffer** (WeakMap), then reuse raw pixels where encode stays size-safe.

## Constraints

- Never grow package or transformed BinData bytes vs pre-change baseline (hard gate).
- Verifier / imagePreview PSNR paths stay unchanged (output buffers are new).
- No WebP/jpegli/near-dup policy changes.
- Core stays buffer-oriented; no `process.env` reads in core — timings opt-in via explicit option or a tiny helper that reads env only at CLI/desktop boundary. Prefer `options.enableTimings` threaded from optimize entry, with CLI mapping `HWPX_OPT_TIMINGS=1`.

## Approach

New module `packages/core/src/decodedImage.ts`:

```ts
export type DecodedImage = {
  data: Buffer; // RGB raw
  width: number;
  height: number;
  channels: 3;
  autoOriented: boolean;
  indexed?: boolean; // from BMP palette sources
};

export async function getDecodedImage(
  data: Buffer,
  options?: { rotate?: boolean }
): Promise<DecodedImage | null>;
```

- BMP: `decodeBmp` (indexed flag preserved).
- Else: `sharp(data).rotate?().toColourspace("srgb").removeAlpha().raw()`.
- Cache: `WeakMap<Buffer, { plain?; rotated? }>`.

### Encode wiring (size-safe)

| Action | Strategy |
|---|---|
| `convert-bmp-to-png` | Always from cached/decoded BMP raw (already the path). |
| `resize-png` / `optimize-png` / `convert-tiff-to-png` | Prefer `sharp(raw).…png()`; size non-regression test must pass. |
| `resize-jpeg` | Keep `sharp(data).resize().jpeg()` (mozjpeg on original container) to avoid raw→JPEG byte growth; still **warm** decode cache for dup hashing on the same Buffer. |
| dup hashing | Use `getDecodedImage` then hash raw (same as today’s pixel hash). |

If a PNG/TIFF raw path ever fails the size gate in CI, revert that action to `sharp(data)` while keeping the cache for hashing/BMP.

## Success

- Fixture + optional sample2: package bytes and sum of transformed image bytes **≤ baseline**.
- sample2 balanced wall-clock target ≥20% (record even if missed, if size gate passes).
- Existing core tests green.

## Non-goals

- Changing jpegQuality / maxEdge / palette policy.
- Near-duplicate auto-merge.
- Verifier metric upgrade.
