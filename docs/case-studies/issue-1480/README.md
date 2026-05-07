# Case Study: Issue #1480 - `Ready to merge` posted as false positive

## Summary

The auto-restart-until-mergeable monitor posted a "Ready to merge" comment on PR #1479
approximately 19 seconds after the last commit was pushed, while CI workflows had not yet
been registered in the GitHub Actions API. CI later started and failed (lint,
check-file-line-limits).

## Timeline

| Time (UTC) | Event                                                             |
| ---------- | ----------------------------------------------------------------- |
| 09:53:33   | Last commit `9ed29b7` pushed (Revert "Initial commit")            |
| ~09:53:50  | Auto-merge monitor runs `getMergeBlockers()`                      |
| ~09:53:50  | `getDetailedCIStatus()` returns `no_checks`                       |
| ~09:53:50  | `checkPRMergeable()` returns `mergeable: true`                    |
| ~09:53:50  | `getActiveRepoWorkflows()` returns `hasWorkflows: true`           |
| ~09:53:50  | `getWorkflowRunsForSha()` returns **0 runs** (not yet registered) |
| ~09:53:50  | Code concludes: "CI was definitively NOT triggered"               |
| 09:53:52   | "Ready to merge" comment posted (FALSE POSITIVE)                  |
| 09:55:18   | CI workflow actually starts running                               |
| 09:56:11   | CI finishes — `lint` and `check-file-line-limits` FAIL            |

## Root Cause

The fix for issue #1442 added `getWorkflowRunsForSha()` to distinguish between:

- Workflow runs triggered but check-runs not yet registered (race condition)
- CI not triggered at all (fork PR, `paths-ignore`, etc.)

The assumption was: if `workflow_runs` API returns 0 runs, CI was "definitively NOT
triggered." But this assumption is flawed — **GitHub Actions workflow runs also take time
to appear in the API after a push** (typically 30-120 seconds).

The race condition timeline:

```
Push → (0-30s) → Workflow runs appear in API → (0-30s) → Check-runs appear in API
```

The code only protected against the second race (workflow runs exist but check-runs don't)
but not the first race (workflow runs themselves don't exist yet).

## GitHub API Data Sources for CI/CD Status

The fix collects data from all available GitHub API endpoints:

### 1. Check Runs API (`GET /repos/{owner}/{repo}/commits/{sha}/check-runs`)

Returns check-runs created by GitHub Actions jobs. These appear **after** a workflow run
starts executing a job. Fields: `status` (queued/in_progress/completed), `conclusion`
(success/failure/cancelled/etc.).

### 2. Commit Statuses API (`GET /repos/{owner}/{repo}/commits/{sha}/status`)

Returns legacy commit statuses (used by third-party CI systems like Jenkins, CircleCI).
Fields: `state` (pending/success/failure/error), `context` (name).

### 3. Workflow Runs API (`GET /repos/{owner}/{repo}/actions/runs?head_sha={sha}`)

Returns GitHub Actions workflow runs triggered for a specific commit SHA. Appears **before**
check-runs but **after** the GitHub Actions scheduler processes the event (30-120s delay).

### 4. Active Workflows API (`GET /repos/{owner}/{repo}/actions/workflows`)

Lists all workflows configured in the repo with their state (active/disabled). Filtered
to exclude GitHub Pages deployment workflows which only run on default branch.

### 5. Repository Content API (`GET /repos/{owner}/{repo}/contents/.github/workflows`)

Parses actual workflow YAML files to detect PR-related triggers (`on: pull_request`,
`on: push`, `on: pull_request_target`). Provides ground-truth about what CI **should** run.

### 6. PR Commits API (`GET /repos/{owner}/{repo}/pulls/{number}/commits`)

Lists all commits in a PR. Used to check if previous commits had CI workflow runs,
which is a signal that the HEAD commit should also have CI.

### 7. Commit API (`GET /repos/{owner}/{repo}/commits/{sha}`)

Returns commit metadata including `commit.committer.date`, used to calculate commit age
for the grace period check.

## Fix: Multi-Layer Defense

Instead of immediately concluding "CI not triggered" when `getWorkflowRunsForSha()` returns
0 runs, the code now uses a multi-layer defense:

### Layer 1: Empty Workflows Folder Detection

If `.github/workflows/` doesn't exist or has no `.yml`/`.yaml` files, immediately conclude
"no CI configured at file level" — no grace period needed.

### Layer 2: Grace Period (120 seconds)

Check the age of the HEAD commit. If pushed within the last 120 seconds, treat as a
potential race condition and return `ci_pending` blocker. Additionally report workflow
file PR triggers as context.

### Layer 3: Previous Commit CI History

After grace period elapses, check if earlier commits in the same PR had workflow runs.
If previous commits had CI AND workflow files have PR triggers, it's likely a GitHub API
delay — wait one more cycle as safety measure.

### Layer 4: Definitive Conclusion

Only conclude "CI not triggered" when ALL conditions are met:

- Grace period (120s) has elapsed
- No workflow runs for HEAD SHA
- Previous PR commits did NOT have CI, OR workflow files don't have PR triggers

## Code Path (after fix)

```
getMergeBlockers() → src/solve.auto-merge.lib.mjs:190
├── getDetailedCIStatus() → returns no_checks
├── checkPRMergeable() → returns mergeable: true
├── getActiveRepoWorkflows() → returns hasWorkflows: true
├── getWorkflowRunsForSha() → returns [] (0 runs for HEAD SHA)
│   ├── checkWorkflowsHavePRTriggers() → parse .github/workflows/*.yml
│   │   ├── hasWorkflowFiles: false → immediate "no CI" conclusion
│   │   └── hasWorkflowFiles: true →
│   ├── getCommitDate() → check commit age
│   │   ├── < 120s → ci_pending blocker (Layer 2: grace period)
│   │   └── >= 120s →
│   │       ├── checkPreviousPRCommitsHadCI() → check earlier commits
│   │       │   ├── had CI + has PR triggers → ci_pending (Layer 3: safety)
│   │       │   └── no previous CI or no triggers → noCiTriggered: true
│   │       └── (Layer 4: definitive conclusion)
```

## Related Issues

- Issue #1442: No CI timeout handling (introduced the flawed `getWorkflowRunsForSha` check)
- Issue #1466: Auto-restart stuck with `action_required` workflows
- Issue #1363: False positive "ready to merge" for repos with no required checks
- Issue #1345: Differentiate "no CI configured" vs "CI not triggered"
- Issue #1425: False positive "failed CI" detection

## Evidence

- False positive comment: https://github.com/link-assistant/hive-mind/pull/1479#issuecomment-4125186525
- CI run showing failures: PR #1479 statusCheckRollup shows lint FAILURE at 09:56:11
- Solution draft log: https://github.com/link-assistant/hive-mind/pull/1479#issuecomment-4125185439
- PR #1479 details with full CI timeline: `data/pr-1479-details.json`
- PR #1479 comments: `data/pr-1479-all-comments.txt`

## GitHub API Documentation References

- [Check Runs API](https://docs.github.com/en/rest/checks/runs)
- [Commit Statuses API](https://docs.github.com/en/rest/commits/statuses)
- [Workflow Runs API](https://docs.github.com/en/rest/actions/workflow-runs)
- [List Repository Workflows](https://docs.github.com/en/rest/actions/workflows)
- [Get Repository Content](https://docs.github.com/en/rest/repos/contents)
- [List PR Commits](https://docs.github.com/en/rest/pulls/pulls#list-commits-on-a-pull-request)
