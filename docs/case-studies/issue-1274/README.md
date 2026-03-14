# Case Study: No Release by CI/CD for PR #1273 (Issue #1274)

**Date**: 2026-02-13
**Issue**: [#1274](https://github.com/link-assistant/hive-mind/issues/1274)
**Related PR**: [#1273](https://github.com/link-assistant/hive-mind/pull/1273)
**Status**: Root cause identified - concurrency blocking due to slow ARM64 Docker builds

---

## Executive Summary

PR #1273 was merged but its changes were not included in any release. The investigation revealed a **two-layered problem**:

1. **Timing issue**: PR #1273 was merged AFTER v1.22.0 had already been released
2. **Concurrency blocking**: The release workflow for PR #1273's changes is stuck in "pending" state because a previous workflow run is blocked by a slow ARM64 Docker build

**Root Cause**: The workflow concurrency setting `concurrency: ${{ github.workflow }}-${{ github.ref }}` prevents multiple runs on the same branch from executing simultaneously. A previous run for commit `9e53458` (PR #1264 merge) is stuck at the ARM64 Docker publish step, blocking the release run for PR #1273.

---

## Timeline of Events

| Time (UTC) | Event                        | Details                                   |
| ---------- | ---------------------------- | ----------------------------------------- |
| 12:10:43   | PR #1264 merged              | Commit `9e53458` merged to main           |
| 12:10:47   | Run 21986352082 started      | Workflow triggered for PR #1264           |
| 12:16:25   | PR #1273 commit ready        | Commit `9371610` with merge queue fix     |
| 12:16:45   | Release job started          | For run 21986352082 (PR #1264's workflow) |
| 12:17:05   | **v1.22.0 released**         | Published to npm and GitHub               |
| 12:17:30   | Docker amd64 build completed | In run 21986352082                        |
| 12:17:33   | Docker arm64 build started   | **Still running - stuck at build step**   |
| 12:19:22   | PR #1272 merged              | Commit `969f7a9` (AFTER v1.22.0)          |
| 12:32:05   | PR #1273 merged              | Commit `64d9b79` (AFTER v1.22.0)          |
| 12:32:08   | Run 21986955037 queued       | **BLOCKED** - waiting for run 21986352082 |

### Key Insight

The changesets from PR #1272 and PR #1273 are still in the `.changeset/` folder:

- `fix-release-notes-multiple-prs.md` (PR #1272)
- `fix-merge-queue-method.md` (PR #1273)

These will be released in v1.22.1 (or next patch) ONCE the blocking run completes.

---

## Root Cause Analysis

### Primary Root Cause: Concurrency Blocking

The workflow file (`release.yml`) has this concurrency setting:

```yaml
concurrency: ${{ github.workflow }}-${{ github.ref }}
```

This means:

- Only ONE run of "Checks and release" workflow can execute per branch
- New runs are **queued** (not cancelled) until the current run completes
- If a run takes too long (e.g., stuck ARM64 build), subsequent runs wait indefinitely

### Secondary Root Cause: ARM64 Docker Build Performance

Run 21986352082 is stuck at the ARM64 Docker build step:

```json
{
  "name": "Docker Publish (linux/arm64)",
  "status": "in_progress",
  "started_at": "2026-02-13T12:17:33Z",
  "step": "Build and push by digest" // stuck since 12:18:06Z
}
```

This is a **known issue** documented in [Issue #982 Case Study](../issue-982/README.md):

- ARM64 builds use QEMU emulation on x86_64 runners
- QEMU introduces 10-100x performance overhead
- Complex Dockerfiles (1420+ lines) cause extreme slowdown
- Builds can hang indefinitely

### Contributing Factors

1. **No timeout protection**: ARM64 job can run for up to 6 hours (GitHub limit)
2. **Concurrency doesn't cancel**: Old runs block new runs instead of being cancelled
3. **Release before merge**: v1.22.0 was released when PR #1273 was still in review

---

## Impact Assessment

### Immediate Impact

- PR #1273's fix for merge queue is NOT in v1.22.0
- PR #1272's fix for release notes is NOT in v1.22.0
- Users who install v1.22.0 don't get these fixes

### Blocking Impact

- Run 21986955037 is stuck in "pending" state
- No new releases can be published until run 21986352082 completes
- All future merges to main will also be blocked

### Workflow Status

| Run ID      | Status      | Commit  | Wait Reason              |
| ----------- | ----------- | ------- | ------------------------ |
| 21986352082 | in_progress | 9e53458 | ARM64 Docker build stuck |
| 21986955037 | pending     | 64d9b79 | Blocked by 21986352082   |

---

## Solutions

### Immediate Fix: Cancel Blocking Run

```bash
gh run cancel 21986352082 --repo link-assistant/hive-mind
```

This will:

1. Cancel the stuck ARM64 build
2. Allow run 21986955037 to start
3. Release v1.22.1 with PR #1272 and #1273 changes

**Risk**: v1.22.0 Docker ARM64 image may not be available

### Short-term Fix: Add Job Timeout

Add a timeout to prevent indefinite blocking:

```yaml
docker-publish:
  timeout-minutes: 60 # 1 hour max
```

### Long-term Fix: Change Concurrency Strategy

**Option A: Cancel in-progress runs for main branch releases**

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}
```

**Option B: Separate concurrency groups for release and Docker**

```yaml
# For release job
concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

# For Docker jobs
concurrency:
  group: docker-${{ github.ref }}
  cancel-in-progress: true
```

**Option C: Use native ARM64 runners (Recommended)**

As documented in [Issue #982](../issue-982/README.md), use GitHub's native ARM64 runners:

```yaml
docker-publish:
  strategy:
    matrix:
      include:
        - platform: linux/amd64
          runner: ubuntu-latest
        - platform: linux/arm64
          runner: ubuntu-24.04-arm # Native ARM64 runner
  runs-on: ${{ matrix.runner }}
```

---

## Proposed Changes

Based on this analysis, we recommend:

1. **Cancel stuck run 21986352082** to unblock pending releases
2. **Add timeout to Docker jobs** (60-90 minutes max)
3. **Consider changing concurrency strategy** for better release flow
4. **Evaluate native ARM64 runners** as permanent solution to slow builds

---

## Data Files

| File                                                                     | Description                    |
| ------------------------------------------------------------------------ | ------------------------------ |
| [timeline.json](./timeline.json)                                         | Event timeline with timestamps |
| [logs/run-21986352082-details.json](./logs/run-21986352082-details.json) | Details of blocking run        |
| [logs/run-21986955037-details.json](./logs/run-21986955037-details.json) | Details of blocked run         |

---

## Implemented Fix

The fix implemented in this PR changes the concurrency configuration:

**Before:**

```yaml
concurrency: ${{ github.workflow }}-${{ github.ref }}
```

**After:**

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}
```

This ensures:

- **Main branch**: Newer runs cancel older runs, preventing blocking
- **PR branches**: Runs are queued to preserve check history for developers

---

## Related Case Studies

- [Issue #982](../issue-982/README.md) - Docker Multi-Platform Build Stuck/Timeout
- [Issue #962](../issue-962/README.md) - Multi-platform ARM64 support
- [Issue #975](../issue-975/README.md) - Docker publish output issues

---

## References

### GitHub Documentation

- [Concurrency in GitHub Actions](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency)
- [Using concurrency](https://docs.github.com/en/actions/using-jobs/using-concurrency)

### External Resources

- [Why is my workflow stuck in "queued" state?](https://github.com/orgs/community/discussions/147604) - GitHub Community Discussion
- [docker/build-push-action#982](https://github.com/docker/build-push-action/issues/982) - Multiplatform build slowdown
- [Building ARM64 Images in GitHub Actions](https://www.blacksmith.sh/blog/building-multi-platform-docker-images-for-arm64-in-github-actions) - Blacksmith Blog
- [Speeding Up Slow Docker Builds](https://medium.com/@FrankGoortani/speeding-up-slow-docker-builds-in-github-actions-24ca574fac45) - Medium

---

## Appendix A: Workflow Concurrency Configuration

Current configuration in `.github/workflows/release.yml`:

```yaml
concurrency: ${{ github.workflow }}-${{ github.ref }}
```

This creates concurrency group: `Checks and release-refs/heads/main`

All push events to `main` share this same group, meaning only one can run at a time.

## Appendix B: ARM64 Build Performance Issue

The ARM64 build started at 12:17:33Z and was still running at the time of this analysis (12:50+). This is consistent with the QEMU performance issues documented in Issue #982:

| Build Type     | Expected Duration | Actual (QEMU)               |
| -------------- | ----------------- | --------------------------- |
| AMD64          | 5-10 minutes      | ~3 minutes                  |
| ARM64 (native) | 5-10 minutes      | N/A                         |
| ARM64 (QEMU)   | 30-60+ minutes    | Still running after 30+ min |
