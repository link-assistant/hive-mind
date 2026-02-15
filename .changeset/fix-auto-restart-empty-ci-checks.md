---
'@link-assistant/hive-mind': patch
---

Fix --auto-restart-until-mergable false positive on empty CI checks

The `--auto-restart-until-mergable` mode was incorrectly posting "Ready to merge" when CI checks hadn't started yet. This was caused by JavaScript's vacuous truth: `[].every(fn)` returns `true`, so an empty checks array would pass all validation.

Fix: Return `pending` status when no CI checks exist yet, instead of `success`.
