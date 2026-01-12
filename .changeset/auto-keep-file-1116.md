---
'@link-assistant/hive-mind': minor
---

Add --auto-keep-file option to automatically fallback to .gitkeep when CLAUDE.md is in .gitignore

This feature pre-checks if CLAUDE.md would be ignored by .gitignore BEFORE creating the file, preventing the "paths are ignored by one of your .gitignore files" error. When detected, automatically switches to .gitkeep mode. Enabled by default (--auto-keep-file=true).
