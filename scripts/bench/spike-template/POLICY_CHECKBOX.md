# Product policy gate (manual decision)

Hangul render OK does not mean shippable. Production verifier policy still allows BMP/TIFF→PNG, JPEG→JPEG, and PNG→PNG only.

- [ ] If compat PASS: accept follow-on project to change product policy + `isAllowedAdvancedFormat` + manifest media-type/extension rewrite.

Without this checkbox, WebP/AVIF remain research-only even after a green compatibility matrix.
