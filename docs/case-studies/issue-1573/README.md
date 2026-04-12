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

| Time | Event |
|------|-------|
| ~00:14 | Session starts, solving issue for PR #1735 |
| ~00:24 | PR's own CI completes (all 8 workflow runs + 9 check runs pass) |
| 00:24:42 | First DISAGREE — `Build Windows Portable EXE` on `issue-1805-df6d19c3568b` is in_progress |
| 00:25:36 | Second DISAGREE — same unrelated run still active |
| ... | Would continue indefinitely until the unrelated run finishes |

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

### Approach: Branch-Aware Filtering

In `checkCIConsensus()`, when the PR's own CI is fully passing (`checkRunsOK && workflowsOK`), filter the repo-wide active runs to only include runs on the **PR's own branch**.

```javascript
if (repoInfo.hasActiveRuns && checkRunsOK && workflowsOK && prBranch) {
  const relevantRuns = repoInfo.runs.filter(r => r.head_branch === prBranch);
  filteredCount = repoInfo.count - relevantRuns.length;
  repoOK = relevantRuns.length === 0;
}
```

### Safety Guarantees Preserved

1. **When PR's CI is NOT fully passing** (CheckRuns pending/failed, WorkflowRuns in-progress): No filtering occurs — all repo-wide runs still block, maintaining the original safety behavior
2. **When no `prBranch` is provided**: No filtering occurs (backward compatibility)
3. **Same-branch runs still block**: If the PR's own branch has active runs that aren't yet reflected in CheckRuns/WorkflowRuns, they still block consensus

### Files Changed

- `src/github-merge-repo-actions.lib.mjs` — Branch-aware filtering in `checkCIConsensus()`
- `src/solve.auto-merge.lib.mjs` — Pass `prBranch` to consensus check, improved DISAGREE logging
- `tests/test-repo-actions-consensus-1503.mjs` — 8 new tests for branch filtering behavior

### Test Coverage

| Test | Scenario |
|------|----------|
| Unrelated branch run skipped | Active run on other branch → AGREE |
| Same branch run blocks | Active run on PR branch → DISAGREE |
| Mixed branches | Only same-branch runs block |
| No prBranch (backward compat) | All runs block (no filtering) |
| Pending CheckRuns | No filtering even with unrelated runs |
| In-progress WorkflowRuns | No filtering even with unrelated runs |
| Real-world Issue #1573 | Build Windows EXE on unrelated branch → AGREE |
| Multiple unrelated branches | All filtered → AGREE |

## Data Sources

- Issue log gist: `fd03da4339f428853f3f1da67da6c92e`
- Session ID: `86023b44-4ee9-4161-aa89-36045ba8ebb9`
- Repository: `Jhon-Crow/godot-topdown-MVP`, PR #1735
- Blocking run: `Build Windows Portable EXE` (ID: 24270051875) on branch `issue-1805-df6d19c3568b`
