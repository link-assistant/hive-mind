---
'@link-assistant/hive-mind': minor
---

Add the opt-in `--auto-base-branch-creation` option to solve and hive. A missing explicit base branch is created in the target repository from its default branch before cloning, while existing branches are preserved. Telegram preflight allows the request through without creating a branch. Creation failures report the target branch, repository, and GitHub error.
