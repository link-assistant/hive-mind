---
'@link-assistant/hive-mind': patch
---

Guarantee that a working session converts its pull request back to "ready for review" (issue #2182).

A task ran for 4d 12h 13m 35s and printed `✅ PR IS MERGEABLE!` 2692 times, each followed by `GraphQL: Pull Request is still a draft (mergePullRequest)`. The pull request was a draft because hive-mind had put it there and never took it back out: over the whole 102 244-line run it performed exactly one draft/ready conversion — `Converting PR: To draft mode` — and zero conversions back. The only draft → ready transition came from the AI model itself, running `gh pr ready 142` because the prompt asked it to.

**The state machine is now symmetric.** `pr-draft-state.lib.mjs` tracks every draft it hands out, so the matching ready conversion is guaranteed by code rather than requested from the AI:

- `executeToolIteration` converts the pull request back to ready in a `finally` block, so a crash, an API error or an aborted tool process still ends the iteration with a mergeable pull request. Previously it drafted the pull request (issue #2123) and had no counterpart at all.
- `endWorkSession` performs the ready conversion unconditionally. It used to be gated behind `isContinueMode`, which was `false` for the entire reported run, so the one place responsible for the transition never ran. Only the session _comments_ stay gated — they are `--watch`/`--auto-continue` reporting, not state.
- `solve.mjs` converts the pull request to ready **before** starting the auto-merge watch loop. The AI working session is over at that point; the loop that follows can run for days, and `endWorkSession()` sits behind it.
- The CTRL+C handler and the fatal-error handler drain the outstanding-draft registry, so an aborted session cannot leave a pull request permanently unmergeable. On interrupt this runs before the log upload, which can be cut off by the isolation backend's SIGKILL (issue #2052).
- `solve.results.lib.mjs` no longer shells out to `gh pr ready` inline; every transition goes through the state machine, so merged/closed pull requests are skipped and the registry stays accurate.

The prompt line asking the AI to mark the pull request ready stays, but nothing depends on it any more.

**Defence in depth** — each of these alone would also have ended the reported run, and they bound the damage of a draft pull request whatever its origin:

- **`checkPRMergeable` ignored `isDraft`.** A draft pull request with no other blockers reports `mergeable: MERGEABLE` with `mergeStateStatus: CLEAN` — GitHub does not return `DRAFT` there — so the old `mergeable === 'MERGEABLE'` test said yes. Mergeability is now decided by `evaluatePullRequestMergeability`, which treats a draft as not mergeable and reports why. `getMergeBlockers` emits a `draft` blocker on both its normal path and the early "checks have not started yet" path.
- **Merge failures were unclassified.** Every failed `gh pr merge` was logged as "Will continue monitoring...", regardless of cause. `classifyMergeError` now sorts the error into draft/conflict/blocked/closed/permission/not-mergeable/unknown, the loop self-heals a draft up to three times by marking the pull request ready, and any category stops after `MAX_CONSECUTIVE_MERGE_FAILURES` (3) instead of retrying indefinitely.
- **The watch loop had no wall-clock limit.** `--auto-restart-until-mergeable-timeout-hours` is new and defaults to 24; the loop now checks elapsed time on every pass and stops with a `watch_timeout` reason.

The single-shot merge attempt, the Telegram merge queue and its wait loop use the same classification, so a draft is skipped with the real reason instead of timing out. Every draft/ready conversion now logs the reason it was made, so the log answers "who drafted this and who was supposed to undo it" directly. Full analysis, the run log excerpts and a reproduction script are in `docs/case-studies/issue-2182/`.
