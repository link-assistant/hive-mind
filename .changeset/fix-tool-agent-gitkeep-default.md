---
'@link-assistant/hive-mind': patch
---

Use .gitkeep by default for --tool agent/opencode/codex instead of CLAUDE.md

When using non-Claude tools (agent, opencode, codex), the system now defaults to creating a `.gitkeep` file for task details instead of `CLAUDE.md`. This prevents pollution of CLAUDE.md, which has special meaning for Claude Code as a project-level instruction file.

**Tool-Specific Defaults:**

- `--tool claude`: defaults to `--claude-file` (existing behavior)
- `--tool agent/opencode/codex`: defaults to `--gitkeep-file`

Users can still explicitly override defaults with `--claude-file` or `--gitkeep-file` flags regardless of the selected tool.
