---
'@link-assistant/hive-mind': patch
---

Pull requests merged outside Hive Mind (the GitHub UI, a person's `gh pr merge`, GitHub auto-merge) now get their intended issues closed too (issue #3356). The Telegram bot (your own pull requests) and hive (the monitored repository or owner) run a sweeper every 5 minutes over pull requests merged in the last 24 hours. It skips ones merged in the last 5 minutes, checks each one only once, and stores its cursor in `~/.hive-mind/merged-pr-sweeper.json` (or `HIVE_MIND_MERGED_PR_SWEEPER_STATE`). It never touches pull requests merged before it was first enabled. The new `close-linked-issues --pr <url> [--dry-run]` command does the same for one pull request and prints what it would close and what it skips and why. `close-linked-issues --repo <owner/repo> --since <date>` (or `--owner`) backfills older merges.
