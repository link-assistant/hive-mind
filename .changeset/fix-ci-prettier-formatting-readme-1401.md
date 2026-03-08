---
'@link-assistant/hive-mind': patch
---

fix: resolve Prettier formatting issue in README.md (Issue #1401)

The CI/CD `lint` job was failing on the `main` branch because README.md had Prettier formatting violations after commit `da376061` ("Clarify Time Freedom and Any Device Programming features"). That commit added longer text to two table cells, which made the table column widths inconsistent with Prettier's expected format.

The fix runs `prettier --write` on README.md to re-align the table column widths, bringing the file back into conformance with the `format:check` CI step.
