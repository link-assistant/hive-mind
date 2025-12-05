# Timeline: Helm Chart Release Failures

This document provides a complete timeline of events leading to issue #830, reconstructed from GitHub Actions logs, git history, and GitHub API data.

## 2025-12-04 21:58:00 - Initial Helm Chart Addition

### Run #19945272855 - First Attempt (FAILED)
- **Trigger**: PR #695 merged (Add Helm chart support)
- **Run URL**: https://github.com/link-assistant/hive-mind/actions/runs/19945272855
- **Commit**: `3db638cd` - "Merge pull request #695"
- **Result**: ❌ FAILED at lint step

#### Timeline:
```
21:58:42Z - Workflow triggered
21:58:51Z - Checkout repository ✅
21:58:52Z - Install Helm ✅
21:58:52Z - Lint Helm chart ❌ FAILED
```

#### Error:
```
Error: 1 chart(s) linted, 1 chart(s) failed
[ERROR] templates/: template: hive-mind/templates/deployment.yaml:48:22:
executing "hive-mind/templates/deployment.yaml" at <.Values.secrets.githubToken>:
nil pointer evaluating interface {}.githubToken
```

**Impact**: Workflow terminated before reaching chart-releaser action. No release created.

---

## 2025-12-04 22:33:00 - Lint Errors Fixed, gh-pages Issue Discovered

### Run #19946134787 - Second Attempt (PARTIAL SUCCESS)
- **Trigger**: PR #823 merged (Fix helm chart lint errors)
- **Run URL**: https://github.com/link-assistant/hive-mind/actions/runs/19946134787
- **Commit**: `4b40274d` - "Merge pull request #823"
- **Package Version**: 0.37.1 (from package.json)
- **Chart Version**: 1.0.0 (from Chart.yaml)
- **Result**: ❌ FAILED at cr index step, BUT release was created

#### Detailed Timeline:

```
22:33:06Z - Workflow triggered (3 workflows in parallel)
           - Release Helm Chart (this one)
           - CI/CD Pipeline for main branch ✅
           - Docker Build and Publish ✅

22:33:16Z - Checkout repository ✅
           Fetched all tags including:
           - v0.37.0
           - v0.37.1
           - hive-mind-1.0.0 (did not exist yet)

22:33:17Z - Configure Git ✅
           user.name = github-actions
           user.email = github-actions@users.noreply.github.com

22:33:17Z - Install Helm ✅
           Version: v3.14.0

22:33:17Z - Get package version ✅
           VERSION=0.37.1 (from package.json)

22:33:17Z - Update Chart appVersion ✅
           Updated appVersion to "0.37.1" in Chart.yaml

22:33:17Z - Lint Helm chart ✅
           ==> Linting helm/hive-mind
           1 chart(s) linted, 0 chart(s) failed

22:33:17Z - Package Helm chart ✅
           Successfully packaged chart and saved it to:
           .cr-release-packages/hive-mind-1.0.0.tgz

22:33:17Z - Ensure gh-pages branch exists ⚠️ SKIPPED
           (This step did not exist yet in the workflow)

22:33:17Z - Run chart-releaser (PARTIAL SUCCESS)
           Installing chart-releaser v1.6.1...
           Adding cr directory to PATH...

22:33:18Z - cr upload phase ✅ SUCCESS
           Releasing charts...
           [Implicit: Created GitHub release hive-mind-1.0.0]

22:33:03Z - GitHub Release Created (via GitHub API)
           Tag: hive-mind-1.0.0
           Name: hive-mind-1.0.0
           Body: "A Helm chart for deploying Hive Mind..."
           Author: github-actions[bot]

22:33:18Z - GitHub Release Published
           Asset uploaded: hive-mind-1.0.0.tgz

22:33:19Z - cr index phase ❌ FAILED
           Updating charts repo index...
           Loading index file from git repository .cr-index/index.yaml
           fatal: invalid reference: origin/gh-pages
           Error: exit status 128
```

**Key Observation**: The chart-releaser action performs TWO operations:
1. `cr upload` - Creates GitHub release and uploads chart package ✅
2. `cr index` - Updates index.yaml on gh-pages branch ❌

The first operation succeeded, the second failed. This left the system in an inconsistent state:
- ✅ Release `hive-mind-1.0.0` exists
- ✅ Tag `hive-mind-1.0.0` exists
- ❌ No index.yaml on gh-pages
- ❌ Workflow marked as failed

---

## 2025-12-04 23:07:00 - gh-pages Fix Applied, Duplicate Tag Error

### Run #19946870854 - Third Attempt (FAILED - THIS ISSUE)
- **Trigger**: PR #829 merged (Fix helm chart release by ensuring gh-pages exists)
- **Run URL**: https://github.com/link-assistant/hive-mind/actions/runs/19946870854
- **Commit**: `84226a5b` - "Merge pull request #829"
- **Package Version**: 0.37.2 (bumped in PR #829)
- **Chart Version**: 1.0.0 (unchanged)
- **Result**: ❌ FAILED at cr upload step

#### Detailed Timeline:

```
23:07:22Z - Workflow triggered

23:07:28Z - Checkout repository ✅
           Fetched all tags including:
           - v0.37.2
           - hive-mind-1.0.0 (now exists from previous run)

23:07:29Z - Configure Git ✅

23:07:29Z - Install Helm ✅

23:07:29Z - Get package version ✅
           VERSION=0.37.2 (from package.json)

23:07:30Z - Update Chart appVersion ✅
           Updated appVersion to "0.37.2" in Chart.yaml
           (Chart version still 1.0.0)

23:07:31Z - Lint Helm chart ✅
           1 chart(s) linted, 0 chart(s) failed

23:07:31Z - Package Helm chart ✅
           Successfully packaged chart and saved it to:
           .cr-release-packages/hive-mind-1.0.0.tgz
           (Same filename as before!)

23:07:31Z - Ensure gh-pages branch exists ✅
           (New step added in PR #829)
           gh-pages branch already exists
           (Created after PR #829 merge, likely manually or by another process)

23:07:31Z - Run chart-releaser ❌ FAILED

23:07:31Z - Installing chart-releaser ✅
           Installing chart-releaser on /opt/hostedtoolcache/cr/v1.6.1/x86_64...
           Adding cr directory to PATH...

23:07:32Z - cr upload phase ❌ FAILED
           Releasing charts...
           Error: error creating GitHub release hive-mind-1.0.0:
           POST https://api.github.com/repos/link-assistant/hive-mind/releases:
           422 Validation Failed [{Resource:Release Field:tag_name Code:already_exists Message:}]

23:07:32Z - Workflow terminated
           ##[error]Process completed with exit code 1
```

**Root Cause**:
- Chart version is still `1.0.0`
- Chart package is `hive-mind-1.0.0.tgz`
- Release tag would be `hive-mind-1.0.0`
- This tag already exists from run #19946134787
- GitHub API rejects duplicate tag with 422 error

---

## Key Timeline Insights

### Release Creation Pattern

The `helm/chart-releaser-action` uses this pattern:
```
Release Tag = {chart-name}-{chart-version}
```

From `Chart.yaml`:
```yaml
name: hive-mind
version: 1.0.0
```

Result: `hive-mind-1.0.0`

### Version Confusion

There are THREE version fields in play:

1. **package.json version** (0.37.2)
   - Application version
   - Changes frequently with each release
   - Updated automatically by PRs

2. **Chart.yaml appVersion** (0.37.2)
   - Tracks application version
   - Updated automatically by workflow
   - Does NOT affect release tag name

3. **Chart.yaml version** (1.0.0)
   - Chart template version
   - Used for release tag name
   - ❌ NOT updated automatically
   - ❌ Causes duplicate tag errors

### Progression of Failures

| Run | Chart Version | App Version | Failure Point | Release Created? |
|-----|---------------|-------------|---------------|------------------|
| #19945272855 | 1.0.0 | 0.37.0 | Lint | ❌ No |
| #19946134787 | 1.0.0 | 0.37.1 | cr index | ✅ Yes (hive-mind-1.0.0) |
| #19946870854 | 1.0.0 | 0.37.2 | cr upload | ❌ No (already exists) |

## Conclusion

The issue manifested due to:
1. A partial success in run #19946134787 that created the release before failing
2. Static chart version that was never incremented
3. Workflow design that assumes chart version changes with every run
4. No mechanism to handle already-existing releases

The fix requires either:
- Automatically incrementing chart version
- Using `skip_existing` parameter
- Changing release tag naming convention
- Manual chart version management

See `03-SOLUTIONS.md` for detailed solution analysis.
