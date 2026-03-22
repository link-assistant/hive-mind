# Case Study: Issue #1466 — Auto-restart stuck at waiting for CI/CD

## Summary

The auto-restart-until-mergeable loop gets stuck indefinitely waiting for CI/CD checks
that will never appear, when GitHub Actions workflow runs complete with `conclusion=action_required`.

## Root Cause

### Problem 1: Infinite CI waiting loop with `action_required` workflows

**Location:** `src/solve.auto-merge.lib.mjs` → `getMergeBlockers()` (lines ~196-244)

When a PR has no CI check-runs (`getDetailedCIStatus` returns `no_checks`), the code
checks if workflow runs were triggered via `getWorkflowRunsForSha()`. The decision tree is:

```
no_checks + PR is mergeable?
  → Yes: check if repo has workflows
    → Yes: check if workflow runs exist for this SHA
      → workflowRuns.length > 0 → "genuine race condition" → WAIT (ci_pending blocker)
      → workflowRuns.length === 0 → "CI not triggered" → proceed
    → No: "no CI configured" → proceed
  → No: treat as pending race condition → WAIT
```

The flaw is in the `workflowRuns.length > 0` branch. It assumes workflow runs with
results mean check-runs will eventually appear. But when workflow runs have:
- `status: "completed"`
- `conclusion: "action_required"`

...the workflows completed **without executing any jobs** because they need manual
maintainer approval (first-time fork contributor). Check-runs will **never** appear.

This is common with:
- First-time fork contributors (GitHub's "Approve and run" feature)
- Workflows requiring deployment approval
- Any workflow that completes without producing check-runs

### Problem 2: Verbose output not captured in log files

**Location:** `src/github-merge.lib.mjs`, `src/github-merge-ci.lib.mjs`

Functions like `getWorkflowRunsForSha()`, `getDetailedCIStatus()`, `getActiveRepoWorkflows()`,
`checkPRMergeable()`, etc. use `console.log()` directly for `[VERBOSE]` output instead of
the `log()` function from `lib.mjs`. The `log()` function writes to both console AND the
log file, while `console.log()` only goes to the terminal.

This makes debugging harder because the log files lack the detailed diagnostic information
that would reveal the root cause (e.g., the `conclusion=action_required` data).

## Timeline Reconstruction

### Case 1: PR in `VisageDvachevsky/katana_docs` (Log: 48fdb846)
- The system detected 3 pending CI checks: Performance Regression Detection, Pull Request CI, Code Coverage
- Started waiting at ~09:26 UTC on 2026-03-22
- Continued for **268 iterations** (~4.5 hours) at 60-second intervals
- User interrupted with Ctrl+C at ~14:14 UTC

### Case 2: PR #5 in `VisageDvachevsky/katana_docs` (Log: 6f8c135b)
- The system detected 2 pending CI checks: Code Coverage, Pull Request CI
- Verbose output (visible in terminal, not in log) showed:
  - `PR #5 has no CI checks yet - treating as no_checks`
  - 6 active workflows in the repo, 2 workflow runs for SHA bd94b85
  - Both runs: `status=completed, conclusion=action_required`
  - Code classified this as "genuine race condition (waiting for check-runs to appear)"
- Continued for **272 iterations** (~4.5 hours) at 60-second intervals
- User interrupted with Ctrl+C

## Impact

- 4.5+ hours of wasted compute time per stuck session
- Requires manual user intervention (Ctrl+C) to break the loop
- No timeout or backoff mechanism for this specific scenario
- Missing verbose output in logs makes the problem harder to diagnose

## Solution

### Fix 1: Handle `action_required` workflow runs

In `getMergeBlockers()`, before treating `workflowRuns.length > 0` as a race condition,
check if ALL workflow runs are completed with `action_required` conclusion. If so, treat
as "CI not triggered" (similar to `workflowRuns.length === 0`) instead of waiting.

Also handle other non-executing completion states: if all workflow runs are completed but
none produced check-runs, they won't produce them in the future either.

### Fix 2: Add a maximum wait timeout for the "race condition" path

Even for legitimate race conditions, add a configurable timeout (e.g., 10 minutes) after
which the system stops waiting and either proceeds or reports the issue.

### Fix 3: Route verbose output through the `log()` function

Change `console.log('[VERBOSE] ...')` calls in `github-merge.lib.mjs` and
`github-merge-ci.lib.mjs` to use the `log()` function with `{ verbose: true }` option
so they appear in both terminal and log files.

## Affected Files

- `src/solve.auto-merge.lib.mjs` — Main fix for `getMergeBlockers()`
- `src/github-merge.lib.mjs` — Log routing fix + workflow run status detection
- `src/github-merge-ci.lib.mjs` — Log routing fix
- `src/lib.mjs` — No changes needed (already supports verbose option)

## References

- GitHub Actions: "Approving workflow runs from public forks" — https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/approving-workflow-runs-from-public-forks
- GitHub Check Runs API — https://docs.github.com/en/rest/checks/runs
- GitHub Actions Workflow Runs API — https://docs.github.com/en/rest/actions/workflow-runs

## Log Files

- `logs/48fdb846-main-log.log` — First stuck session (268 iterations, ~4.5 hours)
- `logs/6f8c135b-full-log.log` — Second stuck session with verbose terminal output (272 iterations)
- `logs/solution-draft-log-1774189530369.log` — Related solution draft log
- `logs/solution-draft-log-1774189638296.log` — Related solution draft log
- `logs/solution-draft-log-1774189736054.log` — Related solution draft log
