# Issue #1761 — Working session summary must always be BEFORE working session log

- **Issue:** https://github.com/link-assistant/hive-mind/issues/1761
- **Pull Request:** https://github.com/link-assistant/hive-mind/pull/1762
- **Reporter:** @konard
- **Filed:** 2026-05-06T12:39:29Z
- **Label:** `bug`
- **Real-world example:** https://github.com/lefinepro/kefine/pull/55

## TL;DR

In every working session iteration of `solve.mjs`'s **auto-restart-until-mergeable** mode (and the **temporary watch / auto-restart** mode), the per-iteration code posted the *log* comment first and the *summary* comment second. As a result, on the PR timeline the summary always appeared **below** the (often very long) log it summarises. The root cause is the order of two consecutive function calls inside two `executeToolIteration` success branches; this case study documents the timeline, root causes, and fix, and lands ordering tests so the bug cannot regress silently.

The top-level (single-shot) flow in `src/solve.mjs` was already correct because it calls `maybeAttachWorkingSessionSummary` before `verifyResults` (which uploads the log). Only the two iteration-level call sites had the wrong order.

## Files in this folder

| File | What it contains |
| --- | --- |
| `issue-1761.json` | The original issue body, author, labels, timestamps. |
| `kefine-pr55-comment-4387930946-log.json` | Real "Auto-restart-until-mergeable Log (iteration 3)" comment from PR #55 — created at `2026-05-06T12:29:39Z`. |
| `kefine-pr55-comment-4387931323-summary.json` | Real "Working session summary" comment for the same iteration — created at `2026-05-06T12:29:42Z` (3 seconds **after** the log — wrong order). |
| `kefine-pr55-comment-4387974056-log.json` | Real "Auto-restart-until-mergeable Log (iteration 4)" comment — `2026-05-06T12:33:23Z`. |
| `kefine-pr55-comment-4387974553-summary.json` | Matching "Working session summary" — `2026-05-06T12:33:26Z` (again 3 s after the log). |
| `kefine-pr55-all-comments.json` | Full conversation comment list of PR #55 (paginated). |

## Reconstructed timeline

The issue cites PR https://github.com/lefinepro/kefine/pull/55, where automated working sessions ran via `solve --auto-restart-until-mergeable`. Two consecutive iterations exhibit the same wrong order:

```
12:29:39Z  comment 4387930946  ## 🔄 Auto-restart-until-mergeable Log (iteration 3)
12:29:42Z  comment 4387931323  ## Working session summary           ← 3 s later
12:33:23Z  comment 4387974056  ## 🔄 Auto-restart-until-mergeable Log (iteration 4)
12:33:26Z  comment 4387974553  ## Working session summary           ← 3 s later
```

Because GitHub renders PR comments in chronological order, the human-readable summary lands beneath a 50+ KB log comment. To read the high-signal summary the user has to first scroll past the entire low-signal log.

The reporter filed the issue at `12:39:29Z`, ~6 minutes after observing the second mis-ordered pair.

## Requirements (from the issue body)

1. **Functional fix** — the working session **summary** comment must always be posted *before* the working session **log** comment, every time both are emitted.
2. **Data archive** — download all logs and data referenced by the issue into `./docs/case-studies/issue-1761/`.
3. **Deep case study** — reconstruct the timeline, list every requirement, identify the root cause(s), propose solutions, and check for known reusable components/libraries.
4. **Online research** — search for additional facts/evidence beyond the linked PR.
5. **Debug visibility** — if root cause cannot be located, add debug output / verbose mode for next-iteration triage.
6. **Cross-repo reports** — file issues against any third-party project involved, with reproducible examples, workarounds, and fix suggestions.
7. **One PR for everything** — plan and execute the work in a single pull request (#1762).

## Root cause

`solve.mjs` runs in three distinct flows that all post the same two comments per session:

| Flow | File | Helper that posts the **summary** | Helper that posts the **log** |
| --- | --- | --- | --- |
| Top-level single shot | `src/solve.mjs` | `maybeAttachWorkingSessionSummary(...)` | `verifyResults(...)` (which calls `attachLogToGitHub`) |
| Auto-restart-until-mergeable | `src/solve.auto-merge.lib.mjs` | `maybeAttachWorkingSessionSummary(...)` | `attachLogToGitHub(...)` directly |
| Watch / temporary auto-restart | `src/solve.watch.lib.mjs` | `maybeAttachWorkingSessionSummary(...)` | `attachLogToGitHub(...)` directly |

In `solve.mjs` the summary is invoked **before** `verifyResults`, so the order is correct. In the other two files the success branch of `executeToolIteration` was structured as:

```
1. attachLogToGitHub(...)            ← posts the (large) log comment first
2. maybeAttachWorkingSessionSummary  ← posts the summary comment second
```

Both posts use HTTP `POST /repos/.../issues/<n>/comments`, which assigns `created_at` server-side. The summary therefore inherits a strictly later timestamp than the log, even though it is the human-readable header that should appear above the log.

The Issue #1728 fix introduced the per-iteration `maybeAttachWorkingSessionSummary` call but accidentally added it **after** the existing log-upload block instead of before it. This case study fixes that ordering.

### Why the auto-attach AI-comment check still works after the swap

The summary is posted only when no AI comment was created during this work session. The check is `checkForAiCreatedComments`, which excludes anything matching `TOOL_GENERATED_COMMENT_MARKERS` — including the log titles `Solution Draft Log`, `Auto-restart-until-mergeable Log`, and `Auto-restart` (see `src/tool-comments.lib.mjs`). So whether the log is posted before or after the summary, it is still filtered out and does not poison the AI-comment check.

The check is scoped from `iterationStartTime` (Issue #1728), which is captured before this whole block executes, so swapping two calls inside it doesn't move the boundary.

## Fix

Move the per-iteration `maybeAttachWorkingSessionSummary` call to run **before** `attachLogToGitHub` in:

- `src/solve.watch.lib.mjs` — success branch of the watch / temporary auto-restart loop.
- `src/solve.auto-merge.lib.mjs` — success branch of the auto-restart-until-mergeable loop.

The call signatures, the `try/catch` error reporting, and the `iterationStartTime` boundary remain unchanged; only the relative position of the two blocks moves.

## Tests

`tests/test-solution-summary.mjs` already enforced (Issue #1728) that both files invoke `maybeAttachWorkingSessionSummary` per iteration. This PR adds three new ordering tests in the same file under "Comment Ordering Tests (Issue #1761)":

1. `solve.watch.lib.mjs posts summary BEFORE log per iteration` — finds the source-code byte index of the first `await maybeAttachWorkingSessionSummary(` and the first `await attachLogToGitHub(` in `src/solve.watch.lib.mjs` and asserts summary < log.
2. `solve.auto-merge.lib.mjs posts summary BEFORE log per iteration` — same assertion for `src/solve.auto-merge.lib.mjs`.
3. `solve.mjs (top-level) posts summary BEFORE log` — asserts the same invariant for the top-level flow, covering either a direct `attachLogToGitHub` call or an `await verifyResults(` invocation, whichever comes first.

These run with the rest of the suite (`node tests/test-solution-summary.mjs`) and pin the ordering at source-code level so a future cleanup that re-shuffles the success branch can't silently flip the order back.

## Considered: existing components / library reuse

- **`maybeAttachWorkingSessionSummary` / `attachSolutionSummary`** (`src/solve.results.lib.mjs`) — already centralises the summary-posting policy (flags, AI-comment check, header text). Reused as-is.
- **`attachLogToGitHub`** (`src/github.lib.mjs`) — already centralises log-upload policy. Reused as-is.
- **`tool-comments.lib.mjs`** — single source of truth for tool-generated comment markers (Issue #1625). Reused; no new markers needed.
- **`postTrackedComment`** (`src/tool-comments.lib.mjs`) — also reused, ensures the new comment ordering doesn't break the in-memory tracked-comment ID set.

No new abstraction or third-party dependency is introduced; only two existing call blocks are reordered.

## Cross-repo reports

The bug is fully internal to `link-assistant/hive-mind`. The `lefinepro/kefine` PR #55 only provides the comment timestamps as evidence; nothing in `kefine` itself needs to change. No third-party report is required.

## Verification checklist

- [x] Identified all three call sites that post both comments.
- [x] Verified top-level flow (`solve.mjs`) was already correct.
- [x] Reordered both per-iteration call sites (`solve.watch.lib.mjs`, `solve.auto-merge.lib.mjs`).
- [x] Added source-level ordering tests for all three flows.
- [x] Confirmed existing Issue #1728 tests still pass (45/45 in `test-solution-summary.mjs`).
- [x] Archived issue + four referenced kefine comments + full PR #55 comment list under `docs/case-studies/issue-1761/`.
