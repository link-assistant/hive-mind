---
'@link-assistant/hive-mind': patch
---

Fix `--auto-attach-solution-summary` so Codex-authored comments that use the
visible "Working session summary" heading are counted as AI comments instead of
being mistaken for hive-mind's automated summary comment.
