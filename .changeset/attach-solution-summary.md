---
'@link-assistant/hive-mind': minor
---

Add `--attach-solution-summary` and `--auto-attach-solution-summary` options

This feature allows users to automatically attach the AI's result summary as a PR/issue comment:

- `--attach-solution-summary`: Always attach the solution summary when available
- `--auto-attach-solution-summary`: Only attach the summary if the AI didn't create any comments during the session

The solution summary is extracted from the `result` field in the AI tool's JSON output (available for `--tool claude`). For other tools (agent, opencode, codex), the feature is integrated but those tools don't currently provide summaries in the same format.

Fixes #1263
