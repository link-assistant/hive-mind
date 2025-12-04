# Case Study: Helm Chart Release - Duplicate Tag Error (Issue #830)

## Issue Reference
- **Issue**: https://github.com/link-assistant/hive-mind/issues/830
- **Pull Request**: https://github.com/link-assistant/hive-mind/pull/831
- **Date**: 2025-12-04
- **Failed Run**: https://github.com/link-assistant/hive-mind/actions/runs/19946870854/job/57198267390
- **Related Issue**: #828 (Helm chart release - missing gh-pages branch)
- **Related PR**: #829 (Fixed gh-pages branch issue)

## Problem Statement

After fixing the missing `gh-pages` branch issue (#828, PR #829), the Helm chart release workflow still fails with a duplicate tag error when attempting to create a GitHub release. The error occurs because:

1. **Previous partial success** - The first successful run (after fixing gh-pages) created the `hive-mind-1.0.0` release and tag
2. **Static chart version** - The chart version in `Chart.yaml` is hardcoded to `1.0.0`
3. **No version increment** - Subsequent runs attempt to create the same release again, causing a 422 error

### Error Observed

From the CI logs (run 19946870854):

**Error received:**
```
Error: error creating GitHub release hive-mind-1.0.0: POST https://api.github.com/repos/link-assistant/hive-mind/releases: 422 Validation Failed [{Resource:Release Field:tag_name Code:already_exists Message:}]
```

**Timestamp:** 2025-12-04T23:07:32.6035348Z

## Background Context

### Previous Issue (#828)

The initial problem was that the `helm/chart-releaser-action` failed because the `gh-pages` branch didn't exist:

```
fatal: invalid reference: origin/gh-pages
Error: exit status 128
```

This was fixed in PR #829 by adding a workflow step to automatically create the `gh-pages` branch if it doesn't exist.

### Sequence of Events

1. **Run #19945272855** (2025-12-04 21:58:42Z)
   - Failed at helm lint step
   - Did not reach chart-releaser action

2. **Run #19946134787** (2025-12-04 22:33:06Z) - PR #829 merged
   - Fixed lint errors
   - Created `gh-pages` branch successfully
   - **Successfully created release `hive-mind-1.0.0`** during `cr upload` phase (22:33:18Z)
   - Failed during `cr index` phase due to missing gh-pages (22:33:19Z)
   - Even though workflow failed, the release and tag were already created

3. **Run #19946870854** (2025-12-04 23:07:22Z) - This issue
   - All previous steps passed (gh-pages now exists)
   - Failed during `cr upload` phase because release `hive-mind-1.0.0` already exists
   - Error: 422 Validation Failed - tag_name already_exists

## Current State

### Chart Configuration

From `helm/hive-mind/Chart.yaml`:
```yaml
apiVersion: v2
name: hive-mind
description: A Helm chart for deploying Hive Mind
type: application
version: 1.0.0          # This is the chart version - STATIC
appVersion: "0.37.0"    # This is updated automatically from package.json
```

### Workflow Behavior

From `.github/workflows/helm-release.yml`:
- Triggered on push to main branch when helm files or package.json change
- Updates `appVersion` to match package.json version
- Does NOT update `version` field (chart version)
- Packages chart as `hive-mind-{version}.tgz`
- chart-releaser creates GitHub release with tag `hive-mind-{version}`

### Existing Release

The `hive-mind-1.0.0` release exists:
- **Tag**: `hive-mind-1.0.0`
- **Created**: 2025-12-04T22:33:03Z
- **Published**: 2025-12-04T22:33:18Z
- **Author**: github-actions[bot]
- **Asset**: `hive-mind-1.0.0.tgz`

## Impact

### Immediate Impact
- ❌ Helm chart releases are blocked
- ❌ CI/CD pipeline fails on main branch
- ❌ Chart index cannot be updated with new appVersion changes

### User Impact
- Users cannot get updated Helm charts with new application versions
- Chart repository index is stale
- No automated releases until chart version is incremented

## Root Cause Analysis

### Primary Cause

**Static chart version without automatic increment mechanism.**

The chart version in `Chart.yaml` is hardcoded to `1.0.0` and is never automatically updated. When the workflow runs:

1. It packages the chart with the same version (`1.0.0`)
2. Attempts to create a release with tag `hive-mind-1.0.0`
3. GitHub rejects it because that tag already exists
4. Workflow fails

### Contributing Factors

1. **Chart version semantics not documented**
   - No clear guidance on when to increment chart version vs appVersion
   - Chart version should increment when chart templates change
   - appVersion should track application version (package.json)

2. **No skip-existing mechanism**
   - The chart-releaser-action has a `skip_existing` parameter
   - This is not enabled in the current workflow
   - Would allow workflow to succeed if release already exists

3. **Workflow design assumption**
   - The workflow assumes chart version changes with every trigger
   - In reality, chart templates may not change frequently
   - appVersion changes don't require new chart releases if templates are unchanged

## Next Steps

See:
- `01-TIMELINE.md` - Detailed timeline reconstruction
- `02-ROOT-CAUSES.md` - Deep dive into root causes
- `03-SOLUTIONS.md` - Proposed solutions and trade-offs
- `04-IMPLEMENTATION.md` - Implementation details
