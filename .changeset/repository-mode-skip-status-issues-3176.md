---
'@link-assistant/hive-mind': patch
---

Repository mode (`/solve <repository-url>`) no longer selects status pages as work (issue #3176). Open issues opened by a bot (coverage reports, dependency dashboards), issues with a label from the new `--skip-issue-labels` option (default `hive-mind:skip,dashboard,status`, `none` to turn it off) and issues whose body contains `<!-- hive-mind:skip -->` are left out of the combined issue, its sub-issues and its required closing references, so the pull request no longer closes them and their workflow no longer reopens them into the next run. The combined issue and the log list each skipped issue with the reason; `--include-bot-issues` selects bot-authored issues again. A repository whose only open issues are skipped is reported as having no work, and the Telegram preflight applies the same options.
