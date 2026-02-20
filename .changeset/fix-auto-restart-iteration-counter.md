---
'@link-assistant/hive-mind': patch
---

Fix incorrect iteration counter and duplicate comments in auto-restart mode

- Fixed iteration counter to show actual AI restart count instead of check cycle number
- Added deduplication check to prevent duplicate "Ready to merge" status comments
- Added case study documentation for issue #1323
