# Case Study: Node.js 24 Migration for GitHub Actions (Issue #1417)

## Problem Summary

GitHub Actions CI/CD pipeline was generating deprecation warnings indicating that Node.js 20 actions would be forced to run with Node.js 24 by default starting June 2nd, 2026.

## Timeline of Events

1. **September 19, 2025**: GitHub announced deprecation of Node.js 20 on GitHub Actions runners
2. **June 2, 2026 (upcoming)**: Actions will be forced to run with Node.js 24 by default
3. **Summer 2026 (upcoming)**: Node.js 20 will be removed from runners entirely

## Root Cause Analysis

### Primary Cause
The workflow files were using outdated versions of GitHub Actions that were built to run on Node.js 20. While these actions still function, they generate deprecation warnings and will eventually stop working when GitHub enforces Node.js 24.

### Affected Actions (Before Fix)

| Action | Old Version | Runtime |
|--------|-------------|---------|
| actions/checkout | @v4 | Node 20 |
| actions/setup-node | @v4 | Node 20 |
| actions/upload-artifact | @v4 | Node 20 |
| actions/download-artifact | @v4 | Node 20 |
| docker/build-push-action | @v5 | Node 20 |
| docker/login-action | @v3 | Node 20 |
| docker/metadata-action | @v5 | Node 20 |
| docker/setup-buildx-action | @v3 | Node 20 |
| azure/setup-helm | @v4 | Node 20 |
| softprops/action-gh-release | @v2 | Node 20 (updated to Node 24 in v2.3.0) |
| peter-evans/create-pull-request | @v7 | Node 20 |

## Solution

### Action Version Updates

| Action | Old Version | New Version | Node.js Runtime |
|--------|-------------|-------------|-----------------|
| actions/checkout | @v4 | @v5 | Node 24 |
| actions/setup-node | @v4 | @v5 | Node 24 |
| actions/upload-artifact | @v4 | @v7 | Node 24 |
| actions/download-artifact | @v4 | @v8 | Node 24 |
| docker/build-push-action | @v5 | @v7 | Node 24 |
| docker/login-action | @v3 | @v4 | Node 24 |
| docker/metadata-action | @v5 | @v6 | Node 24 |
| docker/setup-buildx-action | @v3 | @v4 | Node 24 |
| azure/setup-helm | @v4 | @v4.3 | Node 20 (forced to Node 24 via env var) |
| softprops/action-gh-release | @v2 | @v2 (unchanged) | Node 24 (since v2.3.0) |
| peter-evans/create-pull-request | @v7 | @v8 | Node 24 |

### Special Case: azure/setup-helm

The `azure/setup-helm` action does not yet have a version that natively supports Node.js 24 (as of March 2026). To address this, we added a workflow-level environment variable:

```yaml
env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true
```

This forces the action to run on Node.js 24 even though it was built for Node.js 20.

## Files Modified

1. `.github/workflows/release.yml` - Main CI/CD workflow
2. `.github/workflows/cleanup-test-repos.yml` - Test repository cleanup workflow

## Breaking Changes Considerations

Most action version upgrades were straightforward, but teams should be aware of potential breaking changes:

1. **actions/upload-artifact v4 -> v7**: Introduced ESM module support and direct file upload functionality
2. **actions/download-artifact v4 -> v8**: Updated to match new artifact storage API
3. **docker/build-push-action v5 -> v7**: Removed deprecated environment variables, switched to ESM
4. **peter-evans/create-pull-request v7 -> v8**: Requires Actions Runner v2.327.1 or later

## Verification

After applying the fix, the workflow should:
1. No longer display Node.js 20 deprecation warnings
2. Continue to function correctly with all CI/CD operations
3. Be prepared for the June 2026 deadline when Node.js 24 becomes mandatory

## References

- [GitHub Changelog: Deprecation of Node 20 on GitHub Actions runners](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/)
- [GitHub Community Discussion: Actions Runner Node.js Plan](https://github.com/orgs/community/discussions/160454)
- [actions/checkout releases](https://github.com/actions/checkout/releases)
- [actions/setup-node releases](https://github.com/actions/setup-node/releases)
- [docker/build-push-action releases](https://github.com/docker/build-push-action/releases)
- [azure/setup-helm releases](https://github.com/Azure/setup-helm/releases)

## Upstream Issues to Track

- **azure/setup-helm**: No native Node.js 24 support yet. Monitor for future v5 release.
  - Existing issue: [Azure/setup-helm#189 - Node types are for node 24, yet action runs with node 20](https://github.com/Azure/setup-helm/issues/189)
  - Workaround: Use `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` environment variable

## Lessons Learned

1. **Proactive monitoring**: GitHub Actions deprecation announcements should be monitored regularly
2. **Staged migration**: Test Node.js 24 compatibility early using the `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` env variable
3. **Fallback option**: The `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true` env variable can temporarily opt out of Node.js 24 after June 2026, but this is not recommended for long-term use
