---
'@link-assistant/hive-mind': patch
---

A no-change Formal AI run no longer marks its draft pull request "ready for review (solution draft verified)" (issue #3330). If a run's effect cannot be measured (no baseline, unreadable git, or unreadable comments), the pull request keeps the state it had before the run and gets a "Could not verify the session's effect" notice that says why. A Formal AI non-executed terminal state such as `planned_not_executed`, with no commit, now counts as finished without changes (exit code 5) on its own, without reading comments. When `/user` is forbidden to an installation token, the comment author is taken from GraphQL `viewer` (`<app-slug>[bot]`), or `github-actions[bot]` inside GitHub Actions. The readiness gate (`getPullRequestChangeStats`) now ignores `dev/log/**` and AI tool scratch files, using the same predicate as the session verdict.
