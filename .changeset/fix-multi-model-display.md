---
'@link-assistant/hive-mind': patch
---

fix: use result JSON modelUsage for accurate multi-model display in GitHub comments

When Claude Code uses multiple models (e.g., main model + subagent), the completion
comment now correctly displays all models instead of just the main model.
