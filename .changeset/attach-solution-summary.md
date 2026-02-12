---
'@link-assistant/hive-mind': minor
---

Add `--attach-solution-summary` and `--auto-attach-solution-summary` options

This feature allows users to automatically attach the AI's result summary as a PR/issue comment:

- `--attach-solution-summary`: Always attach the solution summary when available
- `--auto-attach-solution-summary`: Only attach the summary if the AI didn't create any comments during the session

The solution summary is extracted from the JSON output stream of all AI tools (claude, agent, codex, opencode). Each tool captures the last text content from various JSON event types (text, assistant, message, result) to provide a summary of the work done.

Fixes #1263
