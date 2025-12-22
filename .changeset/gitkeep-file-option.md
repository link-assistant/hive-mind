---
'@link-assistant/hive-mind': minor
---

Add --claude-file and --gitkeep-file CLI options for choosing between CLAUDE.md and .gitkeep files

This feature allows users to choose which file type to use for PR creation:

- `--claude-file` (default: true): Use CLAUDE.md file for task details
- `--gitkeep-file` (default: false, experimental): Use .gitkeep file instead

The flags are mutually exclusive:

- Using `--gitkeep-file` automatically disables `--claude-file`
- Using `--no-claude-file` automatically enables `--gitkeep-file`
- Both flags cannot be disabled simultaneously

This is a step toward making .gitkeep the default behavior in future releases.
