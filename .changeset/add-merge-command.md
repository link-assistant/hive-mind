---
'@link-assistant/hive-mind': minor
---

Add experimental /merge command to hive-telegram-bot for sequential PR merging

- New `/merge <repository-url>` command to process merge queues
- Automatically checks/creates 'ready' label in repository
- Merges PRs with 'ready' label sequentially (oldest first)
- Waits for CI/CD completion between each merge
- Includes `/merge_cancel` and `/merge_status` helper commands
- Supports linking issues to PRs (uses minimum creation date for ordering)
