# Case Study: Issue #1763 — PR ↔ Issue Link Lost Between Iteration Loops

## Summary

Issue #1763 reported that `lefinepro/kefine#54` was left without a linked
pull request even though the solver had created `lefinepro/kefine` PR #55 to
fix it. The PR body was created correctly with `Fixes lefinepro/kefine#54`,
and the first auto-restart pass kept the keyword in place. The link was lost
later, during an `--auto-restart-until-mergeable` iteration: the AI agent
ran `gh pr edit … --body "…"` mid-session and rewrote the description with
plain English text ("This PR implements the frontend refactor for issue
#54.") that contains no GitHub closing keyword. The next iteration started
but was interrupted before completing, so the top-level `verifyResults()` /
`ensurePullRequestIssueLink()` end-of-run guard never ran to restore the
keyword.

The fix carried forward issue #1616's solution (a reusable
`ensurePullRequestIssueLink()` helper) and plugs the same check into every
iteration loop — `--watch`, `--auto-restart-until-mergeable`, and
`--finalize` — so a clobbered PR body is restored at the boundary of every
work session, not only at the top-level exit.

## Requirements From Issue #1763

1. Run automatic detection for `closes` / `fixes` keywords in the PR
   description **after each work session log**, because any work session may
   end up being the last one.
2. Never leave the pull request without a link to the issue at finish, even
   if the AI forgets to use the correct keywords.
3. Download all logs and data for the failing PR/issue under
   `docs/case-studies/issue-1763/`.
4. Compile a deep case study analysis: timeline, requirements, root causes,
   proposed solutions, existing-library reuse.
5. Search online for additional facts and data relevant to the problem.
6. If there is not enough data to find the root cause, add debug output
   and a verbose mode.
7. Plan and execute everything in a single PR (#1764 on branch
   `issue-1763-8f44881d8b63`).
8. Continue until every requirement is fully addressed.

## Raw Data Collected

| Path                                      | Source                                               |
| ----------------------------------------- | ---------------------------------------------------- |
| `raw-data/issue-1763.json`                | `gh issue view 1763 --repo link-assistant/hive-mind` |
| `raw-data/lefinepro-kefine-pr-55.json`    | `gh pr view 55 --repo lefinepro/kefine`              |
| `raw-data/lefinepro-kefine-issue-54.json` | `gh issue view 54 --repo lefinepro/kefine`           |

The full session log shared on the issue
(`solution-draft-log-pr-...txt`, ≈38 MB / 571 263 lines) was downloaded with
authenticated `curl` for offline analysis. It is intentionally **not**
committed here because of size; the salient excerpts are reproduced in the
Timeline section below and quoted directly in the PR description.

## External Facts

GitHub's documentation lists the supported closing keywords (`close`,
`closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`, `resolves`,
`resolved`) and is unambiguous that **the keyword has to appear in the PR
body for GitHub to record a closing reference**. Documentation:
https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue

A 2025 GitHub change added a repository-level setting that can disable
automatic issue closure even for linked PRs, but the linkage itself is
still keyword-driven, so this bug is not affected by that toggle:
https://github.blog/changelog/2025-04-23-users-can-now-choose-whether-merging-linked-pull-requests-automatically-closes-the-issue/

## Timeline (UTC)

| Time                  | Evidence (session log line)                        | Event                                                                                                                                                                                                                       |
| --------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 07:24                 | initial PR creation block                          | PR #55 was created with body containing `Fixes lefinepro/kefine#54`.                                                                                                                                                        |
| 07:35                 | `verifyPullRequestIssueLinkAfterAutoRestart` block | Auto-restart 1 confirmed body still contained the keyword.                                                                                                                                                                  |
| 12:29                 | line ≈539 953                                      | Inside `--auto-restart-until-mergeable` iteration 3 the AI agent ran `gh pr edit 55 --body "…"`, replacing the body with prose ("This PR implements the frontend refactor for issue #54…") **without any closing keyword**. |
| 12:31                 | iteration 4 start                                  | Iteration 4 began but was interrupted before completion; no end-of-run `verifyResults()` ran.                                                                                                                               |
| At investigation time | `raw-data/lefinepro-kefine-pr-55.json`             | PR #55's `closingIssuesReferences` is empty.                                                                                                                                                                                |

## Root Cause

A coverage gap in the iteration loops. `ensurePullRequestIssueLink()`
already exists in `src/solve.results.lib.mjs` and is invoked from two
places:

1. The end-of-run `verifyResults()` flow in `src/solve.mjs:1142`.
2. `verifyPullRequestIssueLinkAfterAutoRestart()` from `src/solve.mjs:1290`,
   only on the temporary-watch path that issue #1616 fixed.

Neither call site fires per-iteration inside the long-running loops:

- `src/solve.watch.lib.mjs` — `--watch` mode loop.
- `src/solve.auto-merge.lib.mjs` — `--auto-restart-until-mergeable` loop.
- `src/solve.auto-ensure.lib.mjs` — `--finalize` requirements-check loop.

That gap is fatal because **any** iteration may turn out to be the last
one (interrupt, max-iters cap, billing limit, mergeable detection, etc.),
and once the AI rewrites the PR body without a closing keyword inside an
iteration the keyword stays gone until something restores it. In the
incident, iteration 4 started but never reached the end-of-run guard.

This is not a Codex-only or AI-prompt problem; it is a lifecycle gap in
the iteration loops. Any tool (Claude / OpenCode / Codex / Agent) that
edits the PR description from a shell command can hit it.

## Solution

1. Re-export `ensurePullRequestIssueLink` from `src/solve.results.lib.mjs`
   (already exported as of #1616 — no change needed).
2. Call it after every successful `executeToolIteration()` inside each
   long-running loop, wrapped in `try/catch` with `reportError` so a
   transient `gh` failure cannot break the loop:
   - `src/solve.watch.lib.mjs` — after the per-iteration
     `maybeAttachWorkingSessionSummary()` block.
   - `src/solve.auto-merge.lib.mjs` — same, in the
     `--auto-restart-until-mergeable` success branch.
   - `src/solve.auto-ensure.lib.mjs` — after each `--finalize` iteration.
3. Add a regression test
   (`tests/test-issue-1763-per-iteration-pr-issue-link.mjs`) that
   source-pins the per-iteration call sites so future refactors don't
   silently drop them, and exercises the helper with the exact "AI
   overwrote the body with prose mentioning #N but no keyword" scenario
   from the kefine#54 / kefine#55 incident.

## Regression Coverage

The new regression test verifies, for each of the three iteration files:

- The file imports/uses `ensurePullRequestIssueLink`.
- The call is awaited inside the iteration loop.
- The call sits near the iteration-completion boundary (proximity check
  against an iteration-context marker like `Resuming watch mode` /
  `Checking if PR is now mergeable` / `FINALIZE iteration`).
- The call is wrapped in `try/catch` so transient failures don't break
  the loop.
- The call is guarded on a present `issueNumber`.

It also pins the helper's behaviour on the exact failure-mode body from
this incident — "This PR implements the frontend refactor for issue #54."
— and asserts that it appends `\n\nFixes #54` while preserving the
existing prose verbatim.

## Residual Risk

The solver can now enforce the link at the boundary of every work session
inside its own lifecycle. It still cannot prevent a human or external
automation from editing the PR body **after** the solver exits. If that
becomes a real problem, a scheduled GitHub Action that re-applies the
keyword would be the next layer of defence; it is intentionally out of
scope here because issue #1763 only requires that the solver itself never
leaves the PR un-linked at finish.
