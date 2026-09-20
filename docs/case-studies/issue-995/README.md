# Issue #995: Docker Image Not Published After npm Release

## Summary

Docker publish jobs were being skipped despite successful npm releases because of a known GitHub Actions bug where job-level `if` conditions don't properly evaluate `needs.job.outputs` when there are skipped jobs in the dependency chain.

## Timeline of Events

1. **PR #990** added a changeset for version 0.51.2
2. **Workflow Run 20505206037** (push to main):
   - Release job ran successfully at 12:43:02 - 12:43:46
   - npm package 0.51.2 was published successfully
   - Job outputs were set: `published=true`, `published_version=0.51.2`
   - Docker Publish jobs were created at 12:43:47 but **immediately skipped**
   - The condition `needs.release.outputs.published == 'true'` evaluated to false

## Root Cause Analysis

### The Problem

The `docker-publish` job had this condition:

```yaml
docker-publish:
  needs: [release]
  if: needs.release.outputs.published == 'true'
```

Even though:

1. The `release` job completed successfully
2. The `publish` step ran and set outputs to `GITHUB_OUTPUT`
3. The job outputs were properly declared in the workflow

The `docker-publish` job was still skipped.

### Why This Happens

This is a known GitHub Actions behavior documented in:

- [actions/runner#491](https://github.com/actions/runner/issues/491) - Job-level "if" condition not evaluated correctly if job in "needs" property is skipped
- [community/discussions/26945](https://github.com/orgs/community/discussions/26945) - Jobs being skipped while using both `needs` and `if`
- [community/discussions/60350](https://github.com/orgs/community/discussions/60350) - Empty Output of previous job is not evaluated on next job inside of if condition

When a workflow has jobs that can be skipped (like `changeset-check` which only runs on PRs), the default `success()` condition applied to job-level `if` statements can cause unexpected behavior. Even if the immediate dependency (`release`) succeeded, if any job in the broader dependency chain was skipped, the output propagation may not work as expected.

## Solution

Add `always()` to force the condition to be evaluated, combined with explicit result checks:

```yaml
docker-publish:
  needs: [release]
  # Use always() to ensure the condition is evaluated even if some jobs were skipped in the dependency chain
  if: always() && needs.release.result == 'success' && needs.release.outputs.published == 'true'
```

This pattern:

1. `always()` - Ensures the condition is evaluated regardless of skipped jobs
2. `needs.release.result == 'success'` - Explicitly checks the job succeeded
3. `needs.release.outputs.published == 'true'` - Checks the output value

## Files Changed

- `.github/workflows/release.yml` - Updated `if` conditions for:
  - `docker-publish`
  - `docker-publish-merge`
  - `helm-release`
  - `docker-publish-instant`
  - `docker-publish-instant-merge`
  - `helm-release-instant`

## Verification

After this fix, Docker images should be published for all releases:

- Both `linux/amd64` and `linux/arm64` architectures
- Multi-platform manifest merged
- Helm chart updated with new image version

## Lessons Learned

1. Always use `always()` in job-level `if` conditions when depending on jobs that might be skipped
2. Explicitly check `needs.job.result == 'success'` instead of relying on implicit success checks
3. Test workflow changes with real releases, not just dry-run modes

## References

- [GitHub Actions Runner Issue #491](https://github.com/actions/runner/issues/491)
- [GitHub Community Discussion #26945](https://github.com/orgs/community/discussions/26945)
- [GitHub Community Discussion #60350](https://github.com/orgs/community/discussions/60350)
- [GitHub Docs: Workflow syntax](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions)
