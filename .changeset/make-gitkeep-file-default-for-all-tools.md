---
'@link-assistant/hive-mind': minor
---

feat: make --gitkeep-file enabled by default for all --tools (Issue #1385)

Previously, `--claude-file` was the default for `--tool claude`, while `--gitkeep-file` was the default for other tools. Now `--gitkeep-file` is the universal default for all `--tool` values, including `--tool claude`.

As explained in the referenced video, CLAUDE.md and AGENT.md files generally do not help AI tools and should be avoided. Users who need CLAUDE.md-based task passing can still explicitly opt in with `--claude-file`.
