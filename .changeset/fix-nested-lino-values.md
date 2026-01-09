---
'@link-assistant/hive-mind': patch
---

Fix nested LINO values not being extracted in parseStringValues

- Fix issue where options placed on the same line in LINO configuration were silently dropped
- Update `parseStringValues()` to recursively extract all string values from nested LINO structures
- This ensures all configuration options (like `--auto-resume-on-limit-reset` and `--tokens-budget-stats`) are properly parsed regardless of formatting

Fixes #1086
