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

### The Code Path (before fix)

```
watchUntilMergeable() loop
  → getMergeBlockers()
    → getDetailedCIStatus() returns status='no_checks'
    → checkPRMergeable() returns mergeable=true
    → getActiveRepoWorkflows() returns hasWorkflows=true (1 workflow: CI)
    → Returns blocker: {type: 'ci_pending', message: '...have not started yet...'}
  → isNoCIChecks=true, repoHasWorkflows=true
  → Logs "No checks yet (CI workflows exist, waiting for them to start)"
  → NO EXIT CONDITION → loops forever
```

### Key Insight: GitHub API provides definitive answer

The reviewer asked: "Does GitHub API have a clear answer whether CI/CD will ever be started on the commit?"

**Yes.** The GitHub Actions workflow runs API (`GET /repos/{owner}/{repo}/actions/runs?head_sha={sha}`) definitively shows if any workflow runs were triggered for a specific commit:

- `total_count > 0` → workflows were triggered, check-runs will appear soon (genuine race condition)
- `total_count === 0` → no workflows were triggered for this commit (CI will NOT start)

This is more reliable than a timeout because it gives an immediate, definitive answer.

## Solution

Use the workflow runs API in `getMergeBlockers()` to check if any workflow runs were triggered for the PR's HEAD SHA. This creates a four-way discrimination:

1. `no_checks + NOT MERGEABLE` → pending race condition (wait)
2. `no_checks + MERGEABLE + no workflows` → no CI configured (exit immediately)
3. `no_checks + MERGEABLE + has workflows + has workflow runs` → genuine race condition (wait)
4. `no_checks + MERGEABLE + has workflows + NO workflow runs` → **CI not triggered** (exit immediately)

State 4 is the new state that fixes the infinite loop. The existing `getWorkflowRunsForSha()` function was already available in the codebase but not used in this detection path.

### Advantages over timeout approach

- **Immediate**: Detects the condition on the first check, not after N minutes of waiting
- **Definitive**: Based on actual API data, not heuristic timeout
- **No configuration needed**: Removed the `--no-ci-checks-timeout` option since detection is instant

## Artifacts

- `e65b7351-3225-449c-afc3-16f1a6ed80d5.log` — Full solve.mjs log showing the stuck behavior
