---
'@link-assistant/hive-mind': patch
---

Stop the auto-merge watch loop from spinning forever on a draft pull request (issue #2182).

A task ran for 4d 12h 13m 35s and printed `✅ PR IS MERGEABLE!` 2692 times, each followed by `GraphQL: Pull Request is still a draft (mergePullRequest)`. Four separate defects lined up to make that possible, and each is fixed:

- **The pull request was never converted back to ready.** A restart drafts the pull request (issue #2123) before handing it to the tool, but nothing converted it back once the iteration finished. `executeToolIteration` now calls `ensurePullRequestIsReady` at the end of every iteration, so the state machine closes.
- **`checkPRMergeable` ignored `isDraft`.** A draft pull request with no other blockers reports `mergeable: MERGEABLE` with `mergeStateStatus: CLEAN` — GitHub does not return `DRAFT` there — so the old `mergeable === 'MERGEABLE'` test said yes. Mergeability is now decided by `evaluatePullRequestMergeability`, which treats a draft as not mergeable and reports why. `getMergeBlockers` emits a `draft` blocker on both its normal path and the early "checks have not started yet" path.
- **Merge failures were unclassified.** Every failed `gh pr merge` was logged as "Will continue monitoring...", regardless of cause. `classifyMergeError` now sorts the error into draft/conflict/blocked/closed/permission/not-mergeable/unknown, the loop self-heals a draft up to three times by marking the pull request ready, and any category stops after `MAX_CONSECUTIVE_MERGE_FAILURES` (3) instead of retrying indefinitely.
- **The watch loop had no wall-clock limit.** `--auto-restart-until-mergeable-timeout-hours` is new and defaults to 24; the loop now checks elapsed time on every pass and stops with a `watch_timeout` reason.

The single-shot merge attempt, the Telegram merge queue and its wait loop use the same classification, so a draft is skipped with the real reason instead of timing out. Full analysis, the run log excerpts and a reproduction script are in `docs/case-studies/issue-2182/`.
