# Case Study — Issue #1952: `Cancelled CI/CD Requires Review`

> **Status:** Resolved in PR #1953
> **Source issue:** <https://github.com/link-assistant/hive-mind/issues/1952>
> **Real-world trigger:** [xlabtg/teleton-agent PR #670](https://github.com/xlabtg/teleton-agent/pull/670)
> **Label:** `bug`
> **Reported:** 2026-06-19

This folder contains the downloaded evidence and a deep analysis of issue #1952. The raw data
files referenced throughout are saved alongside this document:

| File                                       | What it is                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| `issue-1952.json`                          | The full hive-mind issue #1952 (title, body, labels).                            |
| `teleton-pr670-comment-4750875952.json`    | "AI Work Session Started" comment on teleton PR #670.                            |
| `teleton-pr670-comment-4751364491.json`    | The **"Cancelled CI/CD Requires Review"** comment (the bug in the wild).         |
| `teleton-pr670-comment-4751364697.json`    | "AI Work Session Completed" comment — the session that finished **with no log**. |
| `teleton-workflowrun-27821270533.json`     | The `CI` workflow run that concluded `failure`.                                  |
| `teleton-workflowrun-27821270533-jobs.txt` | Its jobs (JSONL) — shows the timed-out + failed jobs.                            |

---

## 1. Timeline / sequence of events

All three referenced comments belong to a single AI work session on **xlabtg/teleton-agent PR #670**,
commit `65ac1726e51fc9581d1de2fa58e089206d99390c`.

| Time (UTC)                | Event                                                                                                                                                                                                                                                                                          | Evidence                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 2026-06-19 10:54:46       | **AI Work Session Started.** PR converted to draft, work begins.                                                                                                                                                                                                                               | comment `4750875952`                       |
| (during)                  | hive-mind pushes commit `65ac172…`, CI runs.                                                                                                                                                                                                                                                   | —                                          |
| (during)                  | The `CI` workflow run `27821270533` finishes as **`failure`**. Its jobs: `Build (Runtime) (22)` → **failure**, `Deploy artifacts` → **failure**, `OpenAPI` → **failure**, **and** `Build (Runtime) (20)` → **cancelled** (hit `timeout-minutes`). The `E2E` run `27821270513` was **skipped**. | `teleton-workflowrun-27821270533-jobs.txt` |
| 2026-06-19 12:04 (approx) | hive-mind's auto-merge loop reads **check-runs** only. It sees `CI / Build (Runtime) (20)` as `cancelled` and classifies the whole PR as **"Cancelled CI/CD Requires Review"**, posts the stop comment, and gives up.                                                                          | comment `4751364491`                       |
| 2026-06-19 12:04:28       | **AI Work Session Completed.** PR converted back to ready. **No working-session log was attached, even though `--attach-logs` was enabled.**                                                                                                                                                   | comment `4751364697`                       |

The "Cancelled CI/CD Requires Review" comment itself even lists the contradicting evidence:

```
**Cancelled checks**
- CI / Build (Runtime) (20)

**Workflow runs inspected**
- E2E (27821270513) [completed/skipped] - …
- CI (27821270533) [completed/failure] - …          ←  the workflow run concluded FAILURE

**Automatic re-run result**
Automatic re-run was not possible.
- Unknown workflow run: No cancelled/stale workflow run was found for this commit SHA.
```

The tool printed `CI … [completed/failure]` and _still_ treated the situation as a re-triggerable
cancellation that needs human review. That contradiction is the bug.

---

## 2. Requirements extracted from the issue

The issue body contains four distinct functional requirements plus four process requirements.

| #      | Requirement                                                                                                                                                                                                           | Type       |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **R1** | "If CI/CD was cancelled by timeout — it should be considered as fail."                                                                                                                                                | Functional |
| **R2** | "If we still have other fails in the CI/CD checks — it is fail. Yet we should wait until all checks are success, fail or cancelled, to auto restart."                                                                 | Functional |
| **R3** | "There was no log attached, yet `--attach-logs` were enabled. So we cannot finish any working session with no logs when `--attach-logs` is enabled, double check all logic paths."                                    | Functional |
| **R4** | Download all logs/data into `./docs/case-studies/issue-1952`, produce a deep case study (timeline, requirements, root causes, proposed solutions, existing-component review), and search online for additional facts. | Process    |
| **R5** | If there is not enough data to find the root cause, add debug output / verbose mode (off by default) so the next iteration can.                                                                                       | Process    |
| **R6** | If the issue is related to another repo where we can file issues, report it with a reproducible example, workaround, and fix suggestion.                                                                              | Process    |
| **R7** | Apply the requirements to the **entire** codebase — if a problem exists in multiple places, fix it everywhere.                                                                                                        | Process    |
| **R8** | Plan and execute everything in the single PR #1953.                                                                                                                                                                   | Process    |

---

## 3. Root-cause analysis

### R1 / R2 — Cancelled-by-timeout misclassified as "requires review"

**GitHub Actions semantics (verified against the live teleton run, not just docs):**

- A _job_ that hits its `timeout-minutes` limit is reported as a **check-run** with
  `conclusion = 'cancelled'`. (`CI / Build (Runtime) (20)` above.)
- But the _parent workflow run_ that contains that job concludes
  `conclusion = 'failure'` — **not** `cancelled`. (`CI` run `27821270533` → `failure`.)
- A genuine manual/concurrency cancellation instead makes the **workflow run** itself conclude
  `cancelled`.

So the _level_ at which you inspect the result decides whether a timeout looks like a cancellation
or a failure:

| Inspect…        | Timeout looks like…    | Manual cancel looks like… |
| --------------- | ---------------------- | ------------------------- |
| check-runs only | `cancelled` ❌ (wrong) | `cancelled`               |
| workflow runs   | `failure` ✅ (correct) | `cancelled`               |

**The bug:** `getDetailedCIStatus` (`src/github-merge.lib.mjs:1139`) only inspects **check-runs**.
When the only non-success check-run is a `cancelled` one, the auto-merge loop
(`getMergeBlockers` in `src/solve.auto-merge-helpers.lib.mjs`) produced a `ci_cancelled` blocker and
the loop in `src/solve.auto-merge.lib.mjs` posted the **"Cancelled CI/CD Requires Review"** comment
(`CANCELLED_CI_REVIEW_MARKER`, `src/tool-comments.lib.mjs:63`) and stopped — even though the parent
workflow run concluded `failure` and other jobs in it also failed.

This violates **both** R1 (timeout → fail) and R2 (other real failures present → fail).

### R2 — "wait until all checks are terminal before auto-restart"

The original cancelled path did not distinguish _"a check is cancelled and everything is finished"_
from _"a check is cancelled but other runs are still in progress/queued"_. Restarting (or stopping)
before every workflow run reaches a terminal state (`completed`) risks acting on a half-finished
picture.

### R3 — Session can finish with no log despite `--attach-logs`

Every log-attachment path in `solve.mjs` is **conditional**:

- `verifyResults()` attaches only when the PR is detected as session-owned;
- the temporary-watch block only runs when there were uncommitted changes;
- the auto-merge / watch loops attach **per AI iteration** — but their _stop-for-human-review_ exits
  (`billing_limit`, **`ci_cancelled` → "requires review"**, `external_review_limit`, "limit reached")
  can `return` before any iteration attached anything.

The teleton session hit exactly that last path: it stopped on the cancelled-CI review exit
**before** any iteration uploaded a log, so the session completed (comment `4751364697`) with no log
at all. There was no final safety net guaranteeing the invariant _"if `--attach-logs` is on, a log is
always attached."_

---

## 4. The fix (what shipped in PR #1953)

### R1 + R2 — Classify cancelled CI by **workflow-run** conclusions

New pure helper `classifyCancelledCIByWorkflowRuns({ runs })` in
[`src/cancelled-ci-rerun.lib.mjs`](../../../src/cancelled-ci-rerun.lib.mjs):

```
incomplete runs (status !== 'completed')           → 'pending'   (wait — R2)
else any completed failure-like run                → 'failure'   (restart — R1/R2)
     (failure | timed_out | startup_failure)
else                                               → 'cancelled' (original re-trigger flow)
```

Wired into `getMergeBlockers` (`src/solve.auto-merge-helpers.lib.mjs:~828`): in the cancelled
branch it now fetches the workflow runs for the commit SHA and classifies them:

- `'pending'` → push a `ci_pending` blocker → the loop keeps waiting until **all** runs are terminal
  (**R2**, "wait until all checks are success, fail or cancelled");
- `'failure'` → push a `ci_failure` blocker → the AI is restarted to fix the failure instead of
  stopping for review (**R1**, timeout = fail; **R2**, coexisting real failures = fail);
- otherwise → the original `ci_cancelled` re-trigger / review flow (genuine manual cancellation).

`src/solve.auto-merge.lib.mjs` was updated so the "Cancelled CI/CD Requires Review" stop path is
skipped whenever a `ci_failure` blocker coexists (`cancelledBlocker && !billingBlocker &&
!ciFailureBlocker`), and `src/github-merge-ci.lib.mjs` now counts `startup_failure` as a failing run.

Applied to the **whole** codebase (**R7**): the `FAILURE_LIKE_WORKFLOW_RUN_CONCLUSIONS` set is the
single source of truth, exported and reused by the classifier and the branch-health check.

**On the teleton case:** the `CI` run concluded `failure`, so `classifyCancelledCIByWorkflowRuns`
returns `'failure'` → `ci_failure` → the AI restarts to fix the timeout/failures, instead of posting
"Cancelled CI/CD Requires Review" and giving up. ✅

### R3 — Guarantee a log is always attached

- `attachLogToGitHub` (`src/github.lib.mjs`) now sets a process-global flag
  `global.logAttachedToGitHub = true` on **every** successful upload (both the large-file path and
  the regular-comment path).
- New helper `attachFinalLogIfMissing` in
  [`src/attach-logs-guarantee.lib.mjs`](../../../src/attach-logs-guarantee.lib.mjs) runs as the last
  step of `solve.mjs`. Guard: it only fires when `--attach-logs` is enabled, a PR exists, and
  **nothing** has attached a log yet (`!shouldAttachLogs || !prNumber ||
globalState.logAttachedToGitHub`). It attaches the cumulative session log and reconciles
  `logsAttached` so `endWorkSession` does not double-post.
- The error/interrupt paths (`src/solve.error-handlers.lib.mjs`) already attach on failure, so all
  logic paths are now covered.

The invariant is now: **a session can never finish with no log when `--attach-logs` is enabled.**

---

## 5. Existing components / libraries reviewed (R4)

| Component                                            | Already existed?                                     | Role in the fix                                                                                                                          |
| ---------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `getWorkflowRunsForSha` (`src/github-merge.lib.mjs`) | Yes                                                  | Reused to fetch workflow-run conclusions for the cancelled SHA — no new GitHub plumbing needed.                                          |
| `getDetailedCIStatus` (`src/github-merge.lib.mjs`)   | Yes                                                  | Root of the misclassification (check-runs only); left intact, now _supplemented_ by workflow-run cross-referencing rather than replaced. |
| `cancelled-ci-rerun.lib.mjs`                         | Yes (re-trigger flow + `CANCELLED_CI_REVIEW_MARKER`) | Extended with the classifier; the genuine-cancellation path is unchanged.                                                                |
| `attachLogToGitHub` (`src/github.lib.mjs`)           | Yes                                                  | Extended to record the global success flag; no behavioural change to existing callers.                                                   |
| `ci_pending` blocker (issue #1314)                   | Yes                                                  | Reused as the "keep waiting" signal for R2 instead of inventing a new wait state.                                                        |

No third-party library was needed — the building blocks already existed; the fix reuses them and
adds the missing classification + safety-net glue.

---

## 6. Verbose / debug output (R5)

The data in PR #670's comment was already enough to find the root cause (it printed the
`[completed/failure]` workflow-run conclusion next to the cancelled check). The fix adds verbose
logging in the cancelled branch of `getMergeBlockers` that records each inspected workflow run's
`status/conclusion` and the resulting classification, so future cancelled-CI decisions are traceable
from the session log (which R3 now guarantees is always attached).

---

## 7. Other-repository reporting (R6)

The bug is **entirely within hive-mind's own logic** — xlabtg/teleton-agent merely _exhibited_ it.
GitHub Actions behaves correctly and as documented (timeout job → check-run `cancelled`, workflow run
`failure`). There is no upstream/third-party bug to report; the reproducible example is captured here
and the fix lives in this repository (R7/R8).

---

## 8. Regression tests

| Test                                                    | Covers                                                                                                                                                                                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/test-cancelled-timeout-fail-1952.mjs` (13 tests) | The classifier (timeout/`timed_out`/`startup_failure`/manual-cancel/`stale`/mixed/in-progress/queued/empty) + wiring into the auto-merge decision paths. **Directly reproduces the teleton case** (workflow-run `failure` + cancelled check → `'failure'`). |
| `tests/test-attach-logs-safety-net-1952.mjs` (9 tests)  | The global success flag is set only on real uploads, the safety-net guard, the solve.mjs wiring, and `attachFinalLogIfMissing`'s last-resort behaviour (disabled / no-PR / already-attached / fires).                                                       |
