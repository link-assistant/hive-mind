# Case Study: `--auto-restart-until-mergeable` stuck on no CI checks

**Issue**: https://github.com/link-assistant/hive-mind/issues/1442
**PR affected**: https://github.com/netkeep80/BinDiffSynchronizer/pull/149
**Date observed**: 2026-03-18

## Timeline

| Time (UTC)          | Event                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| 15:53:36            | `solve` starts for BinDiffSynchronizer/issues/138 with `--model opus --attach-logs --verbose` |
| 15:53:36 – 16:22:26 | AI agent works on the issue, creates PR #149                                                  |
| 16:22:26            | AI session ends, `AUTO-RESTART-UNTIL-MERGEABLE MODE ACTIVE` begins monitoring PR #149         |
| 16:22:27            | Check #1: "1 workflow(s) found — CI check is a transient race condition"                      |
| 16:22:31            | "No checks yet (CI workflows exist, waiting for them to start)" — infinite loop begins        |
| 16:22:31 – 16:45:10 | Checks #1 through #22 repeat identical message every ~60 seconds                              |
| 16:45:57            | User interrupts with CTRL+C after ~23 minutes of stuck waiting                                |

## Root Cause Analysis

### The Problem

The `watchUntilMergeable()` function in `solve.auto-merge.lib.mjs` has a logic path that waits indefinitely when:

1. A repository has active GitHub Actions workflows (detected via API)
2. But no CI check-runs appear for the PR's HEAD SHA

The code assumes this is always a "transient race condition" (GitHub needs ~10-30s to register checks after push) and keeps waiting. But there are several scenarios where CI checks will **never** appear despite active workflows existing:

### Scenario 1: `paths-ignore` filtering (confirmed in this case)

BinDiffSynchronizer's CI workflow has:

```yaml
paths-ignore:
  - '**/*.md'
  - '.gitkeep'
```

PR #149 changed: `plan.md`, `pmem_array.h`, `readme.md`

While `pmem_array.h` should trigger CI, the combination with fork PR approval requirements (see below) prevented it.

### Scenario 2: Fork PR requiring approval (confirmed in this case)

PR #149 is a **cross-repository (fork) PR** from `konard/netkeep80-BinDiffSynchronizer` to `netkeep80/BinDiffSynchronizer`. GitHub Actions requires maintainer approval before running CI on first-time fork contributor PRs. Until approved, no check-runs are created.

### Scenario 3: Other reasons CI may never start

- Workflow `on:` triggers that don't match (e.g., only `push` but not `pull_request`)
- Workflow conditions (`if:`) that evaluate to false
- GitHub Actions outages or rate limits
- Repository-level Actions settings disabling fork PR runs
- All changed files matching `paths-ignore`

### The Code Path

```
watchUntilMergeable() loop
  → getMergeBlockers()
    → getDetailedCIStatus() returns status='no_checks'
    → checkPRMergeable() returns mergeable=true
    → getActiveRepoWorkflows() returns hasWorkflows=true (1 workflow: CI)
    → Returns blocker: {type: 'ci_pending', message: '...have not started yet...'}
  → isNoCIChecks=true, repoHasWorkflows=true
  → Logs "No checks yet (CI workflows exist, waiting for them to start)"
  → NO TIMEOUT → loops forever
```

### Missing: No timeout on "waiting for CI to start"

The code at line 868-870 of `solve.auto-merge.lib.mjs`:

```javascript
} else {
  // Repo has workflows but CI hasn't started yet — transient race condition, keep waiting
  await log(formatAligned('⏳', 'Waiting for CI:', 'No checks yet (CI workflows exist, waiting for them to start)', 2));
}
```

There is no counter, timer, or maximum wait for this specific state. The loop will continue indefinitely until the user manually interrupts.

## Solution

Add a configurable maximum number of iterations to wait for CI checks to appear when the repo has workflows but no checks have started. After this limit:

1. Check if the PR is otherwise mergeable (mergeStateStatus === 'CLEAN')
2. If mergeable: treat as "CI not required for this PR" and exit successfully
3. If not mergeable: report the situation and exit with a diagnostic message

A reasonable default is 10 iterations (10 minutes with default 60s interval), which is well beyond the typical ~10-30s GitHub takes to register checks.

## Artifacts

- `e65b7351-3225-449c-afc3-16f1a6ed80d5.log` — Full solve.mjs log showing the stuck behavior
