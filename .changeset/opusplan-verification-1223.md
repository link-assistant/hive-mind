---
'@link-assistant/hive-mind': patch
---

feat: add opusplan runtime verification and upstream bug case study (Issue #1223)

- Added runtime detection of Claude Code's opusplan model-switching bug
- Warns when opusplan silently falls back to sonnet instead of using opus for planning
- Improved model display to show plan/execution model split when opusplan is active
- Updated case study with full evidence of upstream bug (anthropics/claude-code#16982)
