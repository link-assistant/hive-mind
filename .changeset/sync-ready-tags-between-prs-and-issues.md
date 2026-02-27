---
'@link-assistant/hive-mind': minor
---

feat: /merge command syncs ready tags between linked PRs and issues (Issue #1367)

The `/merge` Telegram bot command now syncs the `ready` label between PRs and their linked issues before building the merge queue.

- If a PR has the `ready` label and its body links to an issue via standard GitHub closing keywords (fixes/closes/resolves #N), the linked issue also gets the `ready` label
- If an issue has the `ready` label and has a clearly linked open PR (found via body search), the PR also gets the `ready` label
- Sync happens during `MergeQueueProcessor.initialize()`, before the final list of ready PRs is collected
