---
'@link-assistant/hive-mind': patch
---

Count active executions and foreground CLI task trees for queue display and throttling. Exclude idle Codex app-server/updater services and vendor helpers, deduplicate wrappers and tracked jobs, and retain Docker and detached task counts.
