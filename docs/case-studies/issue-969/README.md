# Case Study: Issue #969 - Sentry CLI Breaking Change in Release Flow

## Overview

This case study analyzes a CI/CD pipeline failure in the hive-mind project's release workflow caused by a breaking change in `@sentry/cli` version 3.0.0.

## Issue Summary

- **Issue:** [#969 - We need fix our release flow in CI/CD](https://github.com/link-assistant/hive-mind/issues/969)
- **Failed CI Run:** [Run 20441079188](https://github.com/link-assistant/hive-mind/actions/runs/20441079188/job/58734281406)
- **Date of Failure:** December 22, 2025
- **Affected Version:** @link-assistant/hive-mind@0.49.0

## Timeline of Events

### 1. Background: sentry-cli 3.0.0 Release (December 15, 2025)

The Sentry team released `@sentry/cli` version 3.0.0 with several breaking changes, including:

- Removal of all `sentry-cli files ...` and `sentry-cli releases files ...` subcommands
- Legacy API key authentication replaced by Auth Tokens
- Removal of `sourcemaps explain` command
- Node.js 18.0.0 minimum requirement for npm package users

### 2. The Failure (December 22, 2025 at 18:56:23 UTC)

During the release of version 0.49.0, the "Post-publish - Upload Source Maps to Sentry" step failed with:

```
error: unrecognized subcommand 'files'

Usage: sentry-cli releases [OPTIONS] <COMMAND>

For more information, try '--help'.
❌ Failed to upload source maps: Command failed: npx @sentry/cli releases files 0.49.0 upload-sourcemaps ./src --org deepassistant --project hive-mind --url-prefix '~/src'
```

### 3. Root Cause Identification

The script `scripts/upload-sourcemaps.mjs` was using the deprecated command syntax:

```javascript
// OLD (broken) - Line 62
execSync(`npx @sentry/cli releases files ${version} upload-sourcemaps ./src --org ${orgName} --project ${projectName} --url-prefix '~/src'`);
```

This command was removed in sentry-cli 3.0.0 as part of the deprecation of the release files feature.

## Root Cause Analysis

### Why Did This Happen?

1. **Automatic dependency updates**: When using `npx @sentry/cli`, npm automatically fetches the latest version of the CLI if not pinned to a specific version.

2. **No version pinning**: The project did not pin a specific version of `@sentry/cli`, making it vulnerable to breaking changes in major version updates.

3. **Upstream breaking change**: The sentry-cli team removed a long-standing command without providing a direct replacement path in the error message.

### What Changed in sentry-cli 3.0.0?

| Old Command                                                    | New Command                                               |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| `sentry-cli releases files <VERSION> upload-sourcemaps <PATH>` | `sentry-cli sourcemaps upload <PATH> --release <VERSION>` |

The new API follows a more intuitive structure where the action (`sourcemaps upload`) comes first, followed by options.

## Solution

### The Fix

Update `scripts/upload-sourcemaps.mjs` to use the new sentry-cli 3.0.0 command syntax:

```javascript
// NEW (working) - Updated command
execSync(`npx @sentry/cli sourcemaps upload ./src --release ${version} --org ${orgName} --project ${projectName} --url-prefix '~/src'`);
```

### Additional Improvements

1. **Add debug ID injection**: The new Sentry source maps workflow recommends injecting debug IDs for better artifact matching:

```javascript
execSync(`npx @sentry/cli sourcemaps inject ./src`);
```

2. **Consider version pinning**: Pin to a specific version to prevent future breaking changes:

```javascript
execSync('npm install @sentry/cli@3.x');
```

## Lessons Learned

### 1. Dependency Management

- **Pin major versions** for CLI tools used in CI/CD pipelines
- Monitor changelogs for breaking changes in critical dependencies
- Consider using lockfiles for CLI dependencies

### 2. Error Handling

- The sentry-cli error message could have been more helpful by suggesting the new command syntax
- Custom error handling in scripts should catch common failure modes

### 3. Testing Strategy

- CI/CD pipeline changes should be tested in isolation before merging
- Consider adding a "dry-run" mode for source map upload verification

## References

### Documentation

- [Sentry CLI Source Maps Upload Guide](https://docs.sentry.io/platforms/javascript/sourcemaps/uploading/cli/)
- [Sentry CLI Release Management](https://docs.sentry.io/product/cli/releases/)

### GitHub Issues

- [sentry-cli Issue #1727 - "releases files upload-sourcemaps" working, but "sourcemaps upload" not](https://github.com/getsentry/sentry-cli/issues/1727)
- [sentry-cli Releases](https://github.com/getsentry/sentry-cli/releases)

### Changelog

- [sentry-cli 3.0.0 Changelog](https://raw.githubusercontent.com/getsentry/sentry-cli/master/CHANGELOG.md)

## Files Changed

- `scripts/upload-sourcemaps.mjs` - Updated to use new sentry-cli 3.0.0 API

## CI Logs

The full CI logs from the failed run are archived in:

- `ci-logs/release-20441079188.log`
