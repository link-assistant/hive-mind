# Case Study: Issue #975 - Docker Hub Release Not Triggered After CI Fixes

## Executive Summary

Docker images are not being published to Docker Hub after npm releases. The last Docker image was published on **December 9, 2025 (v0.38.1)** while npm has progressed to **v0.50.2 (December 23, 2025)**, creating a significant gap of ~12 versions without Docker updates.

## Timeline of Events

### Docker Hub Publishing History (Last Known)

| Tag     | Published Date       |
| ------- | -------------------- |
| latest  | 2025-12-09T18:14:43Z |
| 0.38.1  | 2025-12-09T18:14:41Z |
| 0.38.0  | 2025-12-09T07:29:32Z |
| 0.37.28 | 2025-12-09T06:05:41Z |

### NPM Publishing History (Recent)

| Version | Published Date       |
| ------- | -------------------- |
| 0.50.2  | 2025-12-23T16:41:40Z |
| 0.50.1  | 2025-12-22T19:35:06Z |
| 0.50.0  | 2025-12-22T19:27:11Z |
| 0.49.0  | 2025-12-22T18:56:14Z |
| ...     | ...                  |
| 0.38.1  | 2025-12-09 (approx)  |

### Gap Analysis

- **Last Docker Publish**: v0.38.1 (Dec 9, 2025)
- **Latest NPM Version**: v0.50.2 (Dec 23, 2025)
- **Missing Docker Versions**: ~12 versions (0.38.2 through 0.50.2)
- **Duration**: ~14 days of missing Docker images

## Root Cause Analysis

### Primary Issue: Instant Release Does Not Trigger Docker/Helm Publishing

The workflow has two release paths:

1. **Regular Release** (`release` job): Triggered on push to main with changesets
2. **Instant Release** (`instant-release` job): Triggered via workflow_dispatch

**Critical Finding**: The `docker-publish` and `helm-release` jobs only depend on the `release` job outputs:

```yaml
docker-publish:
  needs: [release]
  if: needs.release.outputs.published == 'true'

helm-release:
  needs: [release, docker-publish]
  if: needs.release.outputs.published == 'true'
```

When `instant-release` runs, these jobs are skipped because:

1. They depend on `release` job (not `instant-release`)
2. The `release` job doesn't run during workflow_dispatch
3. Therefore `needs.release.outputs.published` is never `'true'`

### Evidence from CI Logs

Workflow run `20466363204` (2025-12-23T16:41:10Z) shows:

- `Instant Release`: **success** - Published v0.50.2 to npm
- `Docker Publish`: **skipped** - No outputs from `release` job
- `Helm Release`: **skipped** - No outputs from `release` job

```json
{"conclusion":"success","name":"Instant Release"}
{"conclusion":"skipped","name":"Docker Publish"}
{"conclusion":"skipped","name":"Helm Release"}
```

### Secondary Issue: release.yml Changes Don't Force Docker Rebuild

The issue description mentions:

> "Make sure we retrigger docker publish on release.yml file changes"

Currently, `docker-pr-check` runs on workflow changes:

```yaml
docker-pr-check:
  if: needs.detect-changes.outputs.docker-changed == 'true' || needs.detect-changes.outputs.workflow-changed == 'true'
```

But `docker-publish` only runs when there's a new npm release:

```yaml
docker-publish:
  if: needs.release.outputs.published == 'true'
```

This means CI/workflow fixes don't trigger a Docker rebuild unless accompanied by a version bump.

## Proposed Solutions

### Solution 1: Add Docker/Helm Publishing to instant-release Job (Recommended)

Create new jobs `docker-publish-instant` and `helm-release-instant` that depend on `instant-release` job outputs:

```yaml
docker-publish-instant:
  needs: [instant-release]
  if: needs.instant-release.outputs.published == 'true'
  # ... same steps as docker-publish

helm-release-instant:
  needs: [instant-release, docker-publish-instant]
  if: needs.instant-release.outputs.published == 'true'
  # ... same steps as helm-release
```

### Solution 2: Unified Publishing Jobs (Alternative)

Create unified publishing jobs that check outputs from either release path:

```yaml
docker-publish:
  needs: [release, instant-release]
  if: |
    always() &&
    (needs.release.outputs.published == 'true' || needs.instant-release.outputs.published == 'true')
```

### Solution 3: Add Workflow-Change Triggered Release (For CI Fixes)

Add a mechanism to trigger Docker rebuild when release.yml changes:

1. Create a new workflow trigger for release.yml changes on main
2. Or add a special "CI-only" release mode that rebuilds Docker without version bump

## Recommended Implementation

1. **Implement Solution 1** for immediate fix - duplicate Docker/Helm jobs for instant-release
2. **Consider Solution 2** as future refactoring to reduce code duplication
3. **Evaluate Solution 3** based on actual need for CI-fix-only Docker rebuilds

## Files to Modify

- `.github/workflows/release.yml`: Add Docker/Helm publishing after instant-release

## Test Plan

1. Trigger an instant release via workflow_dispatch
2. Verify Docker Publish job runs (not skipped)
3. Verify Helm Release job runs (not skipped)
4. Verify images are pushed to Docker Hub with correct tags
5. Verify Helm chart is updated on gh-pages

## References

- [Issue #975](https://github.com/link-assistant/hive-mind/issues/975)
- [Docker Hub Repository](https://hub.docker.com/r/konard/hive-mind)
- [Workflow Run 20466363204](https://github.com/link-assistant/hive-mind/actions/runs/20466363204) - Instant release that skipped Docker
