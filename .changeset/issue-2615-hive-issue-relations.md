---
'@link-assistant/hive-mind': minor
---

`hive` now respects GitHub sub-issues and issue dependencies (#2615). It only queues issues that have no open "blocked by" issues (their own or inherited from a parent issue) and no open sub-issues, and starts the issue that unblocks the longest chain of work first, so `--concurrency` runs exactly the issues that can be worked on in parallel. Waiting issues are listed with the reason, dependency cycles are reported, and a worker rechecks relations right before it starts an issue. With `--once`, hive checks again for newly unblocked issues while work keeps completing (for example with `--auto-merge`). `hive https://github.com/owner/repo/issues` is now accepted as the repository URL. Use `--no-respect-issue-relations` to queue every matching issue at once as before.
