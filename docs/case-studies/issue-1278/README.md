# Case Study: CI/CD Not Triggered on PR #1277 Merge (Issue #1278)

**Date**: 2026-02-13
**Issue**: [#1278](https://github.com/link-assistant/hive-mind/issues/1278)
**Related PR**: [#1277](https://github.com/link-assistant/hive-mind/pull/1277)
**Status**: Root cause identified - `always()` job conditions prevent workflow cancellation

---

## Executive Summary

PR #1277 was merged to main at 14:02:47Z, but the CI/CD workflow triggered by this merge (run `21989628495`) is stuck in **"pending"** status with **0 jobs created**. This means:

1. No CI checks ran for the merge commit
2. No release was published for PR #1277's changes
3. The changes from PR #1277 are NOT in v1.22.2

**Root Cause**: The concurrency configuration includes `cancel-in-progress: true` for the main branch, but a previous workflow run (`21988480453`) cannot be cancelled because its Docker publish jobs use `if: always()` conditions, which are immune to cancellation in GitHub Actions.

---

## Timeline of Events

| Time (UTC)   | Event                         | Details                                   |
| ------------ | ----------------------------- | ----------------------------------------- |
| 13:25:07     | PR #1275 merged               | Commit `a3ff24ba` merged to main          |
| 13:25:11     | **Run 21988480453 started**   | Workflow triggered for PR #1275           |
| 13:36:59     | PR #1276 work begins          | Initial commit for Issue #1276            |
| 13:37:06     | PR #1277 opened               | PR for false positive error detection fix |
| 13:47:09     | Jobs start in Run 21988480453 | detect-changes, lint, test jobs begin     |
| 13:52:55     | Tests complete                | test-suites job completes successfully    |
| 13:53:21     | **v1.22.2 released**          | Version bump commit `4eff52f6`            |
| 13:53:32     | GitHub Release published      | By Run 21988480453                        |
| 13:53:49     | Docker publish jobs start     | Both amd64 and arm64 platform builds      |
| 13:53:54     | ARM64 build starts            | On native `ubuntu-24.04-arm` runner       |
| 13:54:43     | AMD64 build completes         | 49 seconds build time                     |
| **14:02:47** | **PR #1277 merged**           | Commit `c69e9d73` merged to main          |
| **14:02:51** | **Run 21989628495 triggered** | Should have cancelled Run 21988480453     |
| 14:02:52     | Run 21989628495 stuck         | Status: `pending`, Jobs: 0                |
| 14:11:27+    | ARM64 still building          | Running for 17+ minutes                   |

### Key Insight

The v1.22.2 release was published at 13:53:32Z, which is **BEFORE** PR #1277 was merged (14:02:47Z). The changes from PR #1277 were NOT included in v1.22.2 and will NOT be released until:

1. Run 21988480453 completes (Docker ARM64 build finishes or times out)
2. Run 21989628495 can finally start
3. A new release is published

---

## Root Cause Analysis

### Primary Root Cause: `always()` Job Conditions Prevent Cancellation

The workflow file has the following concurrency configuration:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}
```

This should cancel older runs when new pushes occur on the main branch. However, the Docker publish jobs use `always()` conditions:

```yaml
docker-publish:
  name: Docker Publish (${{ matrix.platform }})
  if: always() && needs.release.result == 'success' && needs.release.outputs.published == 'true'
  timeout-minutes: 60
```

**Problem**: According to [GitHub's documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) and [community discussions](https://github.com/orgs/community/discussions/26303), **jobs with `if: always()` conditions are immune to workflow cancellation**. The condition evaluates to `true` even when cancellation is requested, so the job continues running.

### Secondary Root Cause: Concurrency Limitations

GitHub Actions concurrency has strict limits:

- **Maximum one running and one pending run** per concurrency group
- When cancellation fails (due to `always()`), the old run remains `in_progress`
- New runs are stuck in `pending` until the old run fully completes

### Contributing Factors

1. **ARM64 Build Time**: Native ARM64 builds on `ubuntu-24.04-arm` runners can be slow (currently 17+ minutes and counting)
2. **60-minute Timeout**: The job timeout allows builds to run for up to an hour
3. **No Alternative Cancellation**: GitHub provides no way to force-cancel jobs with `always()` conditions

---

## Impact Assessment

### Immediate Impact

- **No release for PR #1277**: The fix for false positive error detection is NOT in any published release
- **CI checks not run**: The merge commit `c69e9d73` was never validated by CI
- **Blocking state**: No new releases can occur until Run 21988480453 completes

### Timeline for Resolution

| Scenario              | Time to Resolution                       |
| --------------------- | ---------------------------------------- |
| ARM64 build completes | Unknown (currently 17+ min)              |
| ARM64 build times out | ~48 minutes remaining (started 13:53:54) |
| Manual cancellation   | Immediate (but may not work)             |

### Release Status

| Version  | Contains PR #1277 Changes?     |
| -------- | ------------------------------ |
| v1.22.2  | **NO** - Released before merge |
| v1.22.3+ | Yes (once pending run starts)  |

---

## Evidence

### Run 21988480453 (In Progress)

```json
{
  "id": 21988480453,
  "status": "in_progress",
  "head_sha": "a3ff24ba9591b7d4a42dfbe918d5eb5379f0c504",
  "created_at": "2026-02-13T13:25:11Z",
  "jobs_in_progress": ["Docker Publish (linux/arm64)"]
}
```

### Run 21989628495 (Pending)

```json
{
  "id": 21989628495,
  "status": "pending",
  "head_sha": "c69e9d738df9415ab83f70dc14a427f6a1d7f7b0",
  "created_at": "2026-02-13T14:02:51Z",
  "jobs": [],
  "note": "Zero jobs - workflow never started"
}
```

### Check Suite for Pending Run

```json
{
  "id": 57338019355,
  "status": "pending",
  "conclusion": null,
  "latest_check_runs_count": 0,
  "note": "No check runs created - confirms workflow blocked"
}
```

---

## Solutions

### Immediate Fix: Cancel Blocking Run

```bash
gh run cancel 21988480453 --repo link-assistant/hive-mind
```

**Note**: This may fail if the `always()` jobs prevent cancellation. In that case:

```bash
# Force cancel by workflow (may require admin permissions)
gh run cancel 21988480453 --repo link-assistant/hive-mind

# Alternative: Wait for timeout (~48 minutes remaining)
```

### Short-term Fix: Reduce Job Timeout

Reduce Docker publish timeout from 60 minutes to 30 minutes:

```yaml
docker-publish:
  timeout-minutes: 30 # Was 60
```

### Long-term Fix: Remove `always()` from Docker Jobs

**Option A: Use `!cancelled()` instead of `always()`**

```yaml
docker-publish:
  if: |
    !cancelled() &&
    needs.release.result == 'success' &&
    needs.release.outputs.published == 'true'
```

This allows cancellation while still running if dependencies succeeded but other jobs failed.

**Option B: Separate Docker publishing into workflow_run trigger**

Create a separate workflow triggered by successful release:

```yaml
# .github/workflows/docker-publish.yml
name: Docker Publish
on:
  workflow_run:
    workflows: ['Checks and release']
    types: [completed]
    branches: [main]

jobs:
  docker-publish:
    if: github.event.workflow_run.conclusion == 'success'
    # ... rest of job
```

This decouples Docker publishing from the main release workflow, so:

- Main workflow completes faster
- Docker builds don't block subsequent releases
- Multiple Docker builds can run in parallel

**Option C: Use job-level concurrency**

Add separate concurrency groups for Docker jobs:

```yaml
docker-publish:
  concurrency:
    group: docker-publish-${{ github.sha }}
    cancel-in-progress: false # Don't cancel Docker builds
```

This prevents Docker jobs from blocking the main workflow concurrency.

---

## Workarounds

### Workaround 1: Manual Release

If the pending run never starts, manually trigger a release:

```bash
gh workflow run release.yml --repo link-assistant/hive-mind \
  -f release_mode=instant \
  -f bump_type=patch \
  -f description="Release PR #1277 changes"
```

### Workaround 2: Re-run After Timeout

Wait for the ARM64 job to timeout (60 minutes from 13:53:54Z = 14:53:54Z), then:

```bash
gh run rerun 21989628495 --repo link-assistant/hive-mind
```

---

## Related Issues

- **Issue #1274**: Same pattern - concurrency blocking due to slow Docker builds
- **Issue #982**: ARM64 build performance issues with QEMU
- **Issue #998**: ARM64 build slowdowns analysis

---

## References

### GitHub Documentation

- [Control workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [Cancel a workflow run](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/cancel-a-workflow-run)

### GitHub Community Discussions

- [always() prevents cancellation](https://github.com/orgs/community/discussions/26303)
- [cancel-in-progress doesn't cancel running workflows](https://github.com/orgs/community/discussions/26566)
- [Workflow stuck in queued state](https://github.com/orgs/community/discussions/147604)
- [Concurrency shouldn't cancel pending workflows](https://github.com/orgs/community/discussions/41518)

### External Resources

- [GitHub Actions: Troubleshooting pending status](https://manumagalhaes.medium.com/github-actions-bypassing-expected-waiting-for-status-to-be-reported-4712032ef129)
- [Fixing workflows stuck in queued state](https://mindfulchase.com/explore/troubleshooting-tips/fixing-github-actions-workflows-stuck-in-queued-or-pending-state.html)

---

## Data Files

| File                                                                     | Description                       |
| ------------------------------------------------------------------------ | --------------------------------- |
| [data/run-21988480453-details.json](./data/run-21988480453-details.json) | In-progress run details           |
| [data/run-21988480453-jobs.json](./data/run-21988480453-jobs.json)       | Jobs in the blocking run          |
| [data/run-21989628495-details.json](./data/run-21989628495-details.json) | Pending run details               |
| [data/run-21989628495-api.json](./data/run-21989628495-api.json)         | Full API response for pending run |
| [data/check-suite-details.json](./data/check-suite-details.json)         | Check suite information           |
| [data/main-branch-runs.txt](./data/main-branch-runs.txt)                 | Recent main branch workflow runs  |
| [data/main-recent-commits.txt](./data/main-recent-commits.txt)           | Recent commits on main            |
| [data/recent-events.txt](./data/recent-events.txt)                       | Recent repository events          |
| [data/commits-between-runs.txt](./data/commits-between-runs.txt)         | Commits between the two runs      |
| [data/release-workflow.yml](./data/release-workflow.yml)                 | The workflow file                 |
| [data/recent-releases.txt](./data/recent-releases.txt)                   | Recent releases                   |

---

## Appendix A: The `always()` Problem

GitHub Actions' `always()` function is designed to ensure jobs run regardless of the status of previous jobs. However, this creates a side effect: **jobs using `always()` cannot be cancelled**.

From the [GitHub documentation](https://docs.github.com/en/actions/learn-github-actions/expressions#always):

> Causes the step to always execute, and returns `true`, even when canceled.

This behavior is intentional for cleanup tasks but creates problems when combined with concurrency controls. The `cancel-in-progress` option cannot cancel jobs that explicitly request to always run.

### Pattern to Avoid

```yaml
# This prevents cancellation:
if: always() && needs.release.result == 'success'
```

### Recommended Pattern

```yaml
# This allows cancellation:
if: |
  !cancelled() &&
  !contains(needs.*.result, 'failure') &&
  needs.release.result == 'success'
```

## Appendix B: GitHub Actions Concurrency Limits

| Scenario                                   | Behavior                                           |
| ------------------------------------------ | -------------------------------------------------- |
| Run A in progress, Run B triggered         | B waits or cancels A (based on cancel-in-progress) |
| Run A has `always()` jobs, Run B triggered | B cannot cancel A, waits indefinitely              |
| Run A pending, Run B triggered             | A is cancelled, B becomes pending                  |
| 2+ pending runs                            | Only latest pending run kept, others cancelled     |

## Appendix C: Proposed Workflow Changes

### Current State

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}

docker-publish:
  if: always() && needs.release.result == 'success' && needs.release.outputs.published == 'true'
  timeout-minutes: 60
```

### Proposed State

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}

docker-publish:
  if: |
    !cancelled() &&
    needs.release.result == 'success' &&
    needs.release.outputs.published == 'true'
  timeout-minutes: 30
```

**Changes**:

1. Replace `always()` with `!cancelled()` to allow cancellation
2. Reduce timeout from 60 to 30 minutes
3. Keep the rest of the condition logic intact
