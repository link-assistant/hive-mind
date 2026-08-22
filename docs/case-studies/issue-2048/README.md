# Case Study — Issue #2048

> `--development-log` should add logs before we signal about the pull request
> readiness, and if CI/CD fails it must restart the AI agent to fix it.

- **Issue:** [#2048](https://github.com/link-assistant/hive-mind/issues/2048) (bug)
- **Triggering PR:** [#2046](https://github.com/link-assistant/hive-mind/pull/2046) — "fix: lower default disk admission threshold to 65%" (solves #2045)
- **Fixing PR:** [#2050](https://github.com/link-assistant/hive-mind/pull/2050)
- **Raw evidence:** [`data/`](./data)

---

## 1. Requirements extracted from the issue

| #   | Requirement                                                                                                                                                | Status                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | The `--development-log` artifacts must be committed **before** the tool signals that the pull request is ready.                                            | ✅ Fixed                                                                                                                                                 |
| R2  | If CI/CD fails (including a failure caused by the development-log commit itself), the AI agent **must restart** to fix it.                                 | ✅ Addressed (see §4)                                                                                                                                    |
| R3  | Download all logs/data related to the incident into `docs/case-studies/issue-2048/`.                                                                       | ✅ This folder                                                                                                                                           |
| R4  | Deep case-study analysis: reconstruct the timeline, list requirements, find root causes, propose solutions and plans; check existing components/libraries. | ✅ This document                                                                                                                                         |
| R5  | If there is not enough data to find the root cause, add debug output / verbose mode for the next iteration.                                                | ✅ Added verbose trace (§5)                                                                                                                              |
| R6  | If the issue is related to another repository, report it there with reproducible examples, workarounds and fix suggestions.                                | ✅ N/A — the defect is entirely inside this repository (`src/solve.mjs` ordering). No external project is involved.                                      |
| R7  | Apply the fix across the entire codebase (fix in every place the problem occurs).                                                                          | ✅ The readiness-ordering is centralised in `solve.mjs`; `--auto-restart-until-mergeable` already covers the CI-failure restart for all iteration paths. |

---

## 2. Timeline of events (PR #2046)

All timestamps are UTC on 2026-07-11. Sources: `data/pr-2046.json` (commits),
`data/pr-2046-comments.json` (comments), `data/checkruns-6b8aae27.json` (CI).

| Time     | Event                                                           | Kind                              |
| -------- | --------------------------------------------------------------- | --------------------------------- |
| 15:19:58 | `ec1f3af3` Initial commit with task details                     | commit                            |
| 15:22:42 | `d005663a` fix(#2045): lower default disk admission threshold   | commit                            |
| 15:23:13 | Working session summary — "PR is ready"                         | **readiness signal**              |
| 15:23:27 | Solution Draft Log attached                                     | log                               |
| 15:23:41 | Auto-restart 1/5 (uncommitted `.gitkeep`)                       | restart                           |
| 15:24:16 | `d82bc92e` chore: remove temporary PR placeholder               | commit                            |
| 15:25:03 | `4fbbf96d` chore: refresh PR metadata                           | commit                            |
| 15:25:23 | Working session summary (2nd)                                   | readiness signal                  |
| 15:28:12 | **"✅ Ready to merge"** comment ("All CI checks have passed")   | **readiness signal**              |
| 15:28:13 | `6b8aae27` **Add development log for issue #2045 PR #2046**     | commit (1 s **after** readiness!) |
| 15:29:12 | CI on `6b8aae27` resolves: **`Check for Changesets` = failure** | **CI failure**                    |
| 22:22:47 | `da84b0c8` chore: add disk threshold changeset (human fix)      | commit                            |
| 22:35:22 | `9cd76841` test: update disk display threshold expectation      | commit                            |

The smoking gun: the development-log commit (`6b8aae27`) was created **one second
after** the "Ready to merge" comment, and its CI run failed the `Check for
Changesets` gate. Because the auto-restart-until-mergeable loop had already
posted "Ready to merge" and exited, nothing re-evaluated the new commit. A human
had to add the changeset ~7 hours later.

---

## 3. Root-cause analysis

### 3.1 Ordering defect (R1)

In `src/solve.mjs`, the completion sequence of `solve()` was:

```
verifyResults()                    → attaches Solution Draft Log, working summary
runEscalation / keep-working …
startWatchMode()
startAutoRestartUntilMergeable()   → posts "✅ Ready to merge"
attachFinalLogIfMissing()
cleanupClaudeFile()
finalizeDevelopmentLog()           → git add/commit/push the dev log  ← LAST
endWorkSession()                   → gh pr ready (undraft)
```

`finalizeDevelopmentLog()` — which stages, commits and pushes
`dev/log/issues/<id>/pulls/<pr>/…` — ran at the very **end**, after every
readiness signal. So the development-log commit was always the last commit on the
branch, pushed after the PR had already been advertised as ready/mergeable. See
`src/development-log.lib.mjs → collectAndCommitDevelopmentLogArtifacts` for the
commit+push, and the finalizer wiring in `src/solve.mjs`
(`createDevelopmentLogFinalizer`).

**Root cause:** the development-log commit was ordered _after_ the readiness
signal instead of _before_ it.

### 3.2 Why CI actually broke

The repo enforces a `Check for Changesets` CI gate. The development-log commit
touched only `dev/log/**` and carried no changeset, so the gate failed
(`data/checkruns-6b8aae27.json`). Any commit pushed after "Ready to merge" that
lacks a changeset would reproduce this. The dev-log commit is simply the most
common such trailing commit.

### 3.3 Why no restart happened (R2)

`--auto-restart-until-mergeable` (in `src/solve.auto-merge.lib.mjs`) _does_ treat
CI failures as a restart trigger (its restart triggers include "CI failures,
merge conflicts", and a `ci_failure` blocker restarts the AI). But the loop
posts "Ready to merge" and **returns** once CI is green. The development-log
commit was pushed _after_ that return, so it was never inside the watch window.

---

## 4. Solution

### 4.1 R1 — commit the development log before readiness (implemented)

Move development-log finalization to run **before** any readiness signal — right
after `enforceRequestedBaseBranch()` and before `maybeAttachWorkingSessionSummary`,
`verifyResults`, and `startAutoRestartUntilMergeable`:

```js
await enforceRequestedBaseBranch();
// Issue #2048: commit+push dev log BEFORE any PR readiness signal so its CI gates readiness.
await finalizeDevelopmentLog();
```

`createDevelopmentLogFinalizer` is idempotent (once-only `Promise` memoisation),
so the trailing `finalizeDevelopmentLog()` before `endWorkSession()` — and the
ones on the error/`finally` paths — become no-ops on the success path while still
guarding interrupted runs.

### 4.2 R2 — restart on CI failure (existing mechanism, now reachable)

Because the dev-log commit is now part of the diff _before_ readiness:

- `--auto-restart-until-mergeable` / `--auto-merge` watch that commit's CI. If the
  changeset gate (or any check) fails, the existing `ci_failure` blocker restarts
  the agent with feedback — exactly what R2 asks for, with no new machinery.
- The self-hosted fixing PR (#2050) demonstrates the loop by including its own
  changeset, so the dev-log commit will pass CI rather than break it.

The CI-failure-restart itself was already implemented for every iteration path
(`solve.auto-merge.lib.mjs`); the ordering fix is what makes it actually apply to
the development-log commit.

---

## 5. Debug output added (R5)

`collectAndCommitDevelopmentLogArtifacts` now emits a verbose trace of the
finalize context (issue/PR/branch/session), so the _timing_ of the dev-log commit
relative to readiness signals is diagnosable from the logs in future incidents:

```
🔍 Development log finalize: issue #2048, PR #2050, branch …, session …
```

Enabled with `--verbose`.

---

## 6. Existing components / libraries reused

- `createDevelopmentLogFinalizer` (`src/development-log.finalize.lib.mjs`) — the
  once-only guard that makes an early call safe; no new dedup logic was needed.
- `startAutoRestartUntilMergeable` (`src/solve.auto-merge.lib.mjs`) — the
  established CI-failure → agent-restart loop; reused as-is for R2.
- Changesets (`@changesets/cli`) — the CI gate that failed; the fix ships its own
  changeset.

---

## 7. Regression protection

- `tests/test-development-log-before-readiness-2048.mjs` — source-ordering guard
  asserting `finalizeDevelopmentLog()` precedes `maybeAttachWorkingSessionSummary`,
  `verifyResults`, and `startAutoRestartUntilMergeable` in `solve.mjs`.
- `tests/test-development-log-option-1596.mjs` — continues to assert the finalizer
  is once-only across success and error paths.
