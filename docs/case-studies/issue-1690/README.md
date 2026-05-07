# Case Study: Issue #1690 — Auto-restart-until-mergeable stuck on invalid workflow file

> _No `ready to merge` for too long_

- Issue: [link-assistant/hive-mind#1690](https://github.com/link-assistant/hive-mind/issues/1690)
- PR: [link-assistant/hive-mind#1691](https://github.com/link-assistant/hive-mind/pull/1691)
- Reported: 2026-04-26 by @konard
- Affected component: `src/solve.auto-merge-helpers.lib.mjs::getMergeBlockers`
- Affected user-facing command: `/merge` (and `solve --auto-restart-until-mergeable`)

## TL;DR

`/merge` (and the `--auto-restart-until-mergeable` loop in `solve`) entered an
infinite "waiting for check-runs to appear" state on PR
[Jhon-Crow/One-try#22](https://github.com/Jhon-Crow/One-try/pull/22) because the
target repository's only workflow file (`.github/workflows/build.yml`) had a
syntax error. GitHub created the workflow run with
`status=completed, conclusion=failure` but produced **zero jobs** and therefore
**zero check-runs** — yet the auto-merge logic interpreted the existence of the
workflow run as evidence that check-runs would arrive any moment now.

The fix detects this case by querying the jobs API for failed completed runs:
when a `failure`/`startup_failure`/`timed_out` workflow run reports zero jobs,
treat it as a real `ci_failure` blocker. The auto-restart loop then propagates
the workflow run URL back to the AI solver as actionable feedback instead of
spinning forever.

## Reconstruction of the Timeline

| #   | Time (from log)          | Event                                                                                                                                                                 |
| --- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | _earlier in session_     | `solve --auto-restart-until-mergeable` was started against `Jhon-Crow/One-try#22`                                                                                     |
| 2   | check #1                 | AI pushed commit `0789b04` for SHA `0789b04808bdcfdb8b7e82a877d1fc98abb065f0`                                                                                         |
| 3   | check #1                 | GitHub triggered workflow run `24943234488` for `.github/workflows/build.yml`                                                                                         |
| 4   | check #1                 | Workflow run failed _instantly_ — `run_started_at == updated_at == 2026-04-25T23:30:28Z`                                                                              |
| 5   | check #1                 | GitHub UI showed `Invalid workflow file: .github/workflows/build.yml#L1` — `Unrecognized named-value: 'env'`                                                          |
| 6   | every minute, ~check #1+ | `[VERBOSE] /merge: PR #22 has no CI check-runs yet, but 1 workflow run(s) were triggered for SHA 0789b04 - genuine race condition (waiting for check-runs to appear)` |
| 7   | check #198, 06:24:49 AM  | Same message logged for the **198th** consecutive iteration (~3.3 hours)                                                                                              |
| 8   | manual                   | User killed the process with Ctrl+C                                                                                                                                   |

The log (`raw-data/full-log.txt`, 16 318 lines) shows the same 16-line stanza
repeating from check #1 through check #198 with identical SHAs and identical
output.

## Reproduction (with current API state)

```bash
$ gh api repos/Jhon-Crow/One-try/actions/runs/24943234488 \
    --jq '{name, status, conclusion, run_started_at, updated_at, run_attempt}'
{
  "name": ".github/workflows/build.yml",
  "status": "completed",
  "conclusion": "failure",
  "run_started_at": "2026-04-25T23:30:28Z",
  "updated_at":     "2026-04-25T23:30:28Z",
  "run_attempt": 1
}

$ gh api repos/Jhon-Crow/One-try/actions/runs/24943234488/jobs \
    --jq '.total_count'
0

$ gh api repos/Jhon-Crow/One-try/commits/0789b04.../check-runs \
    --jq '.total_count'
0

$ gh api repos/Jhon-Crow/One-try/pulls/22 \
    --jq '{mergeable, mergeable_state}'
{"mergeable": true, "mergeable_state": "clean"}
```

Snapshots of the above are saved in `raw-data/`:

- [`workflow-run-24943234488.json`](raw-data/workflow-run-24943234488.json) — the failed workflow run
- [`workflow-run-jobs.json`](raw-data/workflow-run-jobs.json) — `{"total_count": 0, "jobs": []}`
- [`check-runs.json`](raw-data/check-runs.json) — `{"total_count": 0, "check_runs": []}`
- [`check-suites.json`](raw-data/check-suites.json) — one check-suite with `conclusion: "failure"` and zero check-runs
- [`pr-22.json`](raw-data/pr-22.json) — PR is `mergeable: true, mergeable_state: "clean"`

## Requirements (as stated in the issue)

1. **Diagnose root cause** of the stuck `/merge` loop on the `0789b04` log.
2. **Compile a case study** under `./docs/case-studies/issue-1690/` that includes
   - Logs and external data needed to understand the issue.
   - Timeline / sequence of events.
   - Each requirement called out from the issue.
   - Root cause for each problem.
   - Proposed solution(s) for each requirement, citing existing libraries / components when available.
3. **If we lack data to find the root cause**, add debug output and a `--verbose`
   path so the next iteration has the data we need.
4. **Fix the auto-restart mechanism** so that an _invalid CI/CD workflow_ is
   treated as a real failure, the auto-restart fires, and the failure is
   propagated to the AI solver.
5. **File upstream issues** for any external project / library implicated in the
   bug (with reproduction steps, workarounds, suggested fixes).

## Root Cause Analysis

### Where the stuck check happens

`src/solve.auto-merge-helpers.lib.mjs::getMergeBlockers()` handles the
`no_checks` branch like this (pre-fix):

```js
const workflowRuns = await getWorkflowRunsForSha(owner, repo, ciStatus.sha, verbose);
if (workflowRuns.length > 0) {
  const allRunsCompleted = workflowRuns.every(r => r.status === 'completed');
  const allRunsNonExecuting = allRunsCompleted && workflowRuns.every(r =>
    r.conclusion === 'action_required' ||
    r.conclusion === 'cancelled' ||
    r.conclusion === 'stale' ||
    r.conclusion === 'skipped',
  );
  if (allRunsNonExecuting) { … treat as noCiTriggered … }

  // “Some workflow runs are still in progress or produced results — genuine race condition”
  blockers.push({ type: 'ci_pending', message: 'CI/CD checks have not started yet …' });
}
```

The list of "non-executing" conclusions intentionally **excluded** `failure` (and
`startup_failure`, `timed_out`) because the previous fix authors assumed
`failure` ⇒ jobs ran ⇒ check-runs are about to appear.

That assumption is false for **invalid workflow files**. If the YAML or
expression layer fails to parse, GitHub:

- registers a workflow_run (`status=completed, conclusion=failure`),
- never instantiates any jobs (`/jobs` → `total_count: 0`),
- never produces check-runs (`/commits/{sha}/check-runs` → `total_count: 0`).

The auto-merge loop therefore settles on the `ci_pending` blocker and re-checks
on every iteration without ever recovering.

### Why this isn't covered by previous fixes

| Fix   | Scope                                                                             | Why it didn't catch #1690                                                       |
| ----- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| #1442 | "no workflow runs at all" → `noCiTriggered`                                       | Not applicable: a workflow run **does** exist                                   |
| #1466 | Completed `action_required` / `cancelled` / `stale` / `skipped` ⇒ `noCiTriggered` | Conclusion `failure` was deliberately excluded from the non-executing list      |
| #1480 | Race-condition grace period & PR trigger detection                                | Only applies when `workflowRuns.length === 0`                                   |
| #1503 | Multi-mechanism CI consensus                                                      | The consensus check is gated behind `blockers.length === 0`, never reached here |

### Why "propagate to AI" matters

Even if the loop bailed out via the existing `noCiTriggered` path, the AI would
not learn about the broken workflow file — `noCiTriggered` is treated as
"PR is mergeable" and posts a Ready-to-merge comment. That's wrong: there is a
real, fixable failure that the AI should address (broken `.github/workflows/build.yml`).

## Fix

Implemented in PR #1691.

### Code changes

- **`src/github-merge.lib.mjs`** — new helper:
  ```js
  export async function getWorkflowRunJobsCount(owner, repo, runId, verbose = false)
  ```
  Returns the number of jobs instantiated by a workflow run (or `null` on error).
  Uses `gh api repos/.../actions/runs/{id}/jobs --jq '.total_count'` with `per_page=1`.
- **`src/solve.auto-merge-helpers.lib.mjs::getMergeBlockers`** — after the
  existing "non-executing" check, scan completed `failure` /
  `startup_failure` / `timed_out` runs. For each, query
  `getWorkflowRunJobsCount`; if it returns `0`, register a
  ```js
  { type: 'ci_failure',
    message: 'CI/CD workflow file is invalid — no jobs were instantiated',
    details: ['<workflow path> — see <run html_url>'] }
  ```
  blocker so the surrounding loop restarts the AI with feedback.
- **`src/solve.auto-merge.lib.mjs`** — when emitting `ci_failure` feedback,
  surface the structured blocker message (so the new "invalid workflow file"
  hint reaches the AI, not just the run name).

### Why the jobs check matters (vs. blanket "treat any failure as invalid")

`status=completed && conclusion=failure` happens for both:

1. Real failures (jobs ran, some failed). Check-runs **already** exist for the
   failing jobs, so the surrounding code path (`ciStatus.status === 'failure'`)
   handles them — we won't even land in the `no_checks` branch.
2. Invalid-workflow-file failures (jobs never created). Zero jobs, zero
   check-runs. This is the case at hand.

The jobs API gives us a single, authoritative signal to distinguish them
without relying on heuristics like commit age or run timing.

### Tests

`tests/test-invalid-workflow-file-1690.mjs`:

| Test                                  | Expectation                             |
| ------------------------------------- | --------------------------------------- |
| Single failed run, jobs=0             | `ci_failure` blocker                    |
| `startup_failure`, jobs=0             | `ci_failure` blocker                    |
| `timed_out`, jobs=0                   | `ci_failure` blocker                    |
| Multiple failed runs, all jobs=0      | `ci_failure` with all listed            |
| Failed run with jobs=5                | unchanged (race condition)              |
| Mix of invalid + in_progress          | `ci_failure` (don't ignore the bad one) |
| All `action_required`                 | unchanged (`noCiTriggered`)             |
| All `cancelled`                       | unchanged (`noCiTriggered`)             |
| `getWorkflowRunJobsCount` is exported | sanity check                            |

`tests/test-action-required-ci-stuck-1466.mjs` is updated to clarify that its
"completed with failure → race condition" assertion only models the issue #1466
detection layer; the integrated behavior is now covered by #1690's tests.

## Verification on the original case

Plugging the recorded data into the new logic:

```js
workflowRuns = [
  { id: 24943234488, status: 'completed', conclusion: 'failure',
    name: '.github/workflows/build.yml',
    path: '.github/workflows/build.yml',
    html_url: 'https://github.com/Jhon-Crow/One-try/actions/runs/24943234488' },
];
getWorkflowRunJobsCount(...) → 0
```

Result: a `ci_failure` blocker is registered with details
`['.github/workflows/build.yml — see https://github.com/Jhon-Crow/One-try/actions/runs/24943234488']`.
The auto-restart loop's `Reason 2: CI failures` branch fires, restartReason
becomes `"CI failures detected"`, and the AI receives:

```
❌ CI/CD checks are failing:
  CI/CD workflow file is invalid — no jobs were instantiated
  - .github/workflows/build.yml — see https://github.com/Jhon-Crow/One-try/actions/runs/24943234488

Please fix the failing CI checks.
```

…instead of waiting another 197 iterations for a check-run that will never come.

## Upstream / external issues

The bug is entirely in `link-assistant/hive-mind`. The third-party repo
`Jhon-Crow/One-try` does have a broken workflow file, but that is a normal user
error that the AI solver is expected to detect and propose a fix for once it
gets the failure feedback. No upstream issue is needed.

(For completeness: GitHub's REST API returns `total_count: 0` consistently for
runs that completed without instantiating jobs; this is documented behaviour, no
upstream report required.)

## Defensive next steps

- **Soft-cap on `ci_pending` waits**: even with this fix, other future causes
  could keep the loop in `ci_pending` indefinitely. A subsequent PR could add a
  soft cap (similar to issue #1466 Fix 2) that escalates to a `ci_failure` after
  N consecutive `ci_pending` iterations to provide the AI with feedback.
- **Verbose log surfacing**: the `[VERBOSE]` log already captured the failed
  workflow run's metadata. The new helper logs additional `[VERBOSE]` lines for
  the jobs lookup, which will make the next iteration of debugging easier.
