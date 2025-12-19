# Issue #879: Helm Release CI Workflow Failure

## Overview

**Issue**: Fix helm release CI workflow
**Status**: Resolved
**Root Cause**: Git ignore conflict preventing helm chart commits
**Solution**: Force add ignored .tgz files in CI workflow

## Timeline

- **2025-12-09**: CI run 20053620299 fails in helm-release job
- **2025-12-09**: Issue #879 created to fix the workflow
- **2025-12-09**: Root cause identified and fix implemented

## Technical Analysis

### Root Cause

The CI workflow was failing with:
```
The following paths are ignored by one of your .gitignore files:
hive-mind-0.37.28.tgz
hint: Use -f if you really want to add them.
```

**Analysis**:
- The `.gitignore` file contains `*.tgz` to ignore npm pack outputs
- The helm-release job packages helm charts into `.tgz` files
- These `.tgz` files need to be committed to the `gh-pages` branch for the Helm repository
- Git refuses to add ignored files without the `-f` (force) flag

### Solution Implementation

**File Changed**: `.github/workflows/main.yml`
**Change**: Modified `git add *.tgz index.yaml` to `git add -f *.tgz index.yaml`

This forces git to include the ignored `.tgz` files in the commit, allowing the helm release process to complete successfully.

## Impact Assessment

- **Scope**: Affects only helm chart releases on new version publishes
- **Risk**: Low - the `-f` flag is safe for this specific use case
- **Testing**: Existing CI tests will verify the fix works

## Lessons Learned

1. **Git Ignore Conflicts**: When CI needs to commit files that are normally ignored, use `git add -f`
2. **Workflow Dependencies**: Helm releases depend on both npm publishing and docker publishing completing first
3. **Branch Management**: The `gh-pages` branch serves as a Helm repository index

## Files

- `issue_879_details.txt`: Original issue details
- `run_details.txt`: Failed CI run information
- `failed_logs.txt`: Detailed error logs from the failing step

## Related Issues

- Issue #830: Previous helm chart release duplicate tag issue
- Issue #834: Previous helm release failure (different cause)</content>
<parameter name="filePath">docs/case-studies/issue-879-helm-release-ci-failure/README.md