# Hangul WebP/AVIF compatibility checklist

Record product name and build/version strings before testing. Leave cells blank until each step is run.

| Field | Version A | Version B |
| --- | --- | --- |
| Product | | |
| Build / version | | |

## JPEG control (environment sanity)

Open `jpeg-control.hwpx` on each Hangul version. All cells should pass before trusting WebP/AVIF results.

| Test | Version A | Version B | Notes |
| --- | --- | --- | --- |
| Open / render | | | |
| Save As (different name) | | | |
| Re-open saved file | | | |
| Print preview and/or PDF export | | | |

## WebP

Artifacts: `webp-test.hwpx`, `jpeg-webp-mixed.hwpx`

| Test | Version A | Version B | Notes |
| --- | --- | --- | --- |
| Open / render `webp-test.hwpx` | | | |
| Save As (different name) | | | |
| Re-open saved file | | | |
| Mixed doc (`jpeg-webp-mixed.hwpx`) | | | |
| Print preview and/or PDF export | | | |

## AVIF

Artifact: `avif-test.hwpx` (skipped when local sharp build cannot encode AVIF)

| Test | Version A | Version B | Notes |
| --- | --- | --- | --- |
| Open / render | | | |
| Save As (different name) | | | |
| Re-open saved file | | | |
| Mixed doc (use `jpeg-webp-mixed.hwpx` for format mix) | | | |
| Print preview and/or PDF export | | | |

Copy completed results into `RESULT.md` (local only; not committed).
