---
'@link-assistant/hive-mind': minor
---

Disable Claude Code built-in tools and MCP servers that have no value in autonomous headless runs. A new `--useless-tools-disabled` flag (default: `true`, use `--no-useless-tools-disabled` to opt out) adds `AskUserQuestion`, `CronCreate/Delete/List`, `EnterPlanMode/ExitPlanMode`, `EnterWorktree/ExitWorktree`, `Monitor`, `NotebookEdit`, `PushNotification`, `RemoteTrigger`, `ScheduleWakeup` and the three `claude.ai` OAuth MCP connectors (Gmail, Google Drive, Google Calendar) to `--disallowedTools` / `--strict-mcp-config` on each `solve` run. The Docker images (`Dockerfile`, `coolify/Dockerfile`) also bake the same `disallowedTools` list into the baseline `~/.claude/settings.json` so interactive `claude` sessions inside the image don't surface them either (issue #1627).
