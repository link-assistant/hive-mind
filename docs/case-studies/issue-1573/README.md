# Case Study: Issue #1573 — CI/CD Consensus Stuck for Long

## Problem

The multi-mechanism CI consensus check (`checkCIConsensus`) would get stuck indefinitely when an unrelated branch in the same repository had a long-running CI job.

### Observed Behavior

From the log (`86023b44-4ee9-4161-aa89-36045ba8ebb9`):

```
[00:24:42] CI mechanisms DISAGREE: CheckRuns=success, WorkflowRuns=0 in-progress, RepoActions=1 active
[00:24:42] repo-actions:   Build Windows Portable EXE (in_progress) on issue-1805-df6d19c3568b
[00:24:42] consensus: CheckRuns=true(success), WorkflowRuns=true(8), RepoActions=false → DISAGREE
[00:25:36] consensus: CheckRuns=true(success), WorkflowRuns=true(8), RepoActions=false → DISAGREE
```

PR #1735 (repo: `Jhon-Crow/godot-topdown-MVP`) had:

- **CheckRuns**: All 9 passed (success)
- **WorkflowRuns**: All 8 completed successfully
- **RepoActions**: 1 active — `Build Windows Portable EXE` on branch `issue-1805-df6d19c3568b`

The consensus check kept reporting DISAGREE because the repo-wide check saw an active run on a **completely unrelated branch**.

## Timeline

| Time     | Event                                                                                     |
| -------- | ----------------------------------------------------------------------------------------- |
| ~00:14   | Session starts, solving issue for PR #1735                                                |
| ~00:24   | PR's own CI completes (all 8 workflow runs + 9 check runs pass)                           |
| 00:24:42 | First DISAGREE — `Build Windows Portable EXE` on `issue-1805-df6d19c3568b` is in_progress |
| 00:25:36 | Second DISAGREE — same unrelated run still active                                         |
| ...      | Would continue indefinitely until the unrelated run finishes                              |

## Root Cause Analysis

### Three-Tier Consensus Mechanism

The consensus system (introduced in Issue #1503) requires three independent CI detection mechanisms to agree:

1. **Check Runs API** — queries PR's head commit check runs
2. **Workflow Runs API** — queries workflow runs for PR's head SHA
3. **Repository-wide Active Runs** — queries ALL active runs across the entire repo

### The Bug

`getAllActiveRepoRuns()` fetches all active runs with **no branch filtering**:

```javascript
const activeFilter = '.workflow_runs[] | select(.status=="in_progress" or .status=="queued" ...)';
// Query: repos/{owner}/{repo}/actions/runs?per_page=100
```

This means any active run on ANY branch in the repository blocks ALL PRs from being declared mergeable. While this was designed as a safety mechanism (to catch interacting CI/CD pipelines), it is overly broad.

### Impact

- **False blocking**: PRs with fully-passing CI are blocked by unrelated branches' CI
- **Duration**: Block persists for as long as the unrelated run takes (could be hours for builds)
- **Scale**: In active repositories with many PRs, this creates a bottleneck where only one PR can be considered mergeable at a time

## Fix

### Approach 1: Default to PR-Branch-Only Checking

Changed `--wait-for-all-actions-in-repository-before-mergable` default from `true` to `false`. By default, the consensus check now only verifies CI on the PR branch itself (via CheckRuns API and WorkflowRuns API), not all repo-wide runs. The flag can still be explicitly enabled for the rare cases where repo-wide safety is needed.

### Approach 2: All-Commits CI Check

Added verification that CI has completed for **all commits** on the PR branch, not just the HEAD SHA. New functions `getPRCommitShas()` and `checkAllPRCommitsCI()` iterate over every commit in the PR and check their workflow run statuses. This ensures no commit's CI is still running before declaring the PR mergeable.

### Approach 3: Branch-Aware Filtering (when repo-wide flag is enabled)

When `--wait-for-all-actions-in-repository-before-mergable` is explicitly enabled, and the PR's own CI is fully passing, filter repo-wide active runs to only include runs on the **PR's own branch**.

```javascript
if (repoInfo.hasActiveRuns && checkRunsOK && workflowsOK && allCommitsOK && prBranch) {
  const relevantRuns = repoInfo.runs.filter(r => r.head_branch === prBranch);
  filteredCount = repoInfo.count - relevantRuns.length;
  repoOK = relevantRuns.length === 0;
}
```

### Safety Guarantees Preserved

1. **Default (flag off)**: Only PR branch CI is checked — CheckRuns API, WorkflowRuns for HEAD SHA, and all-commits CI check
2. **When flag is on + PR CI not fully passing**: No branch filtering — all repo-wide runs block (original behavior)
3. **When no `prBranch` is provided**: No filtering occurs (backward compatibility)
4. **Same-branch runs still block**: When flag is on, active runs on the PR's own branch still block consensus
5. **All commits must complete**: Even when HEAD is passing, pending CI on earlier commits blocks consensus

### Files Changed

- `src/github-merge-repo-actions.lib.mjs` — Branch-aware filtering + `getPRCommitShas()` + `checkAllPRCommitsCI()` in `checkCIConsensus()`
- `src/github-merge.lib.mjs` — Re-export new functions
- `src/solve.auto-merge.lib.mjs` — Default flag change, AllCommits in DISAGREE/AGREE logging
- `tests/test-repo-actions-consensus-1503.mjs` — 14 new tests (46 total, all passing)

### Test Coverage

| Test                                       | Scenario                                            |
| ------------------------------------------ | --------------------------------------------------- |
| Default flag is false                      | Issue #1573: disabled by default                    |
| Explicitly enabled via camelCase/kebab     | Can still opt-in to repo-wide checking              |
| All commits complete → CONSENSUS           | All PR commits CI done                              |
| Some commits pending → DISAGREE            | Blocks when earlier commits still running           |
| All-commits skipped when head not passing  | Only checks all commits after head passes           |
| No prCommitsCI → skipped (backward compat) | Graceful when not provided                          |
| Both all-commits + repo-wide must pass     | Combined safety                                     |
| Pending commits block even with clear repo | All-commits is independent of repo-wide             |
| Unrelated branch run skipped               | Active run on other branch → AGREE                  |
| Same branch run blocks                     | Active run on PR branch → DISAGREE                  |
| Mixed branches                             | Only same-branch runs block                         |
| No prBranch (backward compat)              | All runs block (no filtering)                       |
| Real-world Issue #1573                     | Build Windows EXE on unrelated branch → AGREE       |
| Multiple unrelated branches all filtered   | All filtered → AGREE                                |

## Data Sources

- Issue log gist: `fd03da4339f428853f3f1da67da6c92e`
- Session ID: `86023b44-4ee9-4161-aa89-36045ba8ebb9`
- Repository: `Jhon-Crow/godot-topdown-MVP`, PR #1735
- Blocking run: `Build Windows Portable EXE` (ID: 24270051875) on branch `issue-1805-df6d19c3568b`
