# Case Study: Helm Chart Release Failure

**Issue:** #828 - Fix helm chart release
**Date:** 2025-12-04
**Failed Run:** https://github.com/link-assistant/hive-mind/actions/runs/19946134787/job/57195859499
**Status:** Resolved

## Executive Summary

The Helm chart release workflow failed during the initial setup because the `gh-pages` branch did not exist in the repository. The `chart-releaser-action` requires this branch to store and manage the Helm chart index, but the workflow did not handle the first-time setup scenario.

## Timeline of Events

### 2025-12-04T22:33:17.5111304Z - Workflow Started
- The Release Helm Chart workflow was triggered
- Trigger: Push to `main` branch with changes to helm-related files or package.json

### 2025-12-04T22:33:17.5546012Z - Chart Linting
```
==> Linting helm/hive-mind
1 chart(s) linted, 0 chart(s) failed
```
**Status:** ✅ SUCCESS

### 2025-12-04T22:33:17.5590171Z - Chart Packaging
```
mkdir -p .cr-release-packages
helm package helm/hive-mind -d .cr-release-packages
```
**Status:** ✅ SUCCESS

### 2025-12-04T22:33:17.6116234Z - Chart Releaser Action Execution
The `helm/chart-releaser-action@v1.6.0` was executed with:
- `charts_dir: helm`
- `skip_packaging: true`
- `version: v1.6.1`

### 2025-12-04T22:33:19.6915902Z - Index Update Attempt
```
Updating charts repo index...
Loading index file from git repository .cr-index/index.yaml
```
**Status:** ⏳ IN PROGRESS

### 2025-12-04T22:33:19.7105483Z - CRITICAL FAILURE
```
fatal: invalid reference: origin/gh-pages
Error: exit status 128
```
**Status:** ❌ FAILED

The chart-releaser tool attempted to load the existing index from the `gh-pages` branch, but the branch did not exist, causing a fatal git error.

### 2025-12-04T22:33:19.7145688Z - Workflow Termination
```
##[error]Process completed with exit code 1.
```
The workflow terminated with a failure status.

## Root Cause Analysis

### Primary Cause
The `helm/chart-releaser-action` expects the `gh-pages` branch to exist before it can run. This is a **first-time setup issue** that occurs when:

1. The repository has never had a `gh-pages` branch created
2. The chart-releaser action tries to:
   - Fetch the existing index.yaml from `origin/gh-pages`
   - Update it with new chart releases
   - Push the changes back to `gh-pages`

### Technical Details

The chart-releaser tool runs the following command internally:
```bash
cr index --owner link-assistant --repo hive-mind
```

This command attempts to:
1. Clone or fetch the `gh-pages` branch
2. Read the existing `index.yaml` file from `.cr-index/index.yaml`
3. Merge new chart packages into the index
4. Commit and push the updated index

However, when the `gh-pages` branch doesn't exist, the git command `git fetch origin gh-pages` fails with:
```
fatal: invalid reference: origin/gh-pages
```

### Contributing Factors

1. **No first-time setup documentation**: The workflow assumed the `gh-pages` branch already existed
2. **No error handling**: The workflow did not include a fallback for the first-time setup scenario
3. **Branch creation order**: The workflow attempted to use `gh-pages` before the `peaceiris/actions-gh-pages@v4` step could create it

### Why This Happens

The workflow has two steps that interact with `gh-pages`:

1. **Step 6: Run chart-releaser** (line 60-66)
   - Runs FIRST
   - Tries to UPDATE existing index on `gh-pages`
   - ❌ FAILS if `gh-pages` doesn't exist

2. **Step 7: Deploy to GitHub Pages** (line 68-78)
   - Runs SECOND
   - Would CREATE `gh-pages` if it doesn't exist
   - ⏭️ NEVER RUNS because Step 6 failed

## Evidence and Logs

### Error Message from CI Logs
```
release	Run chart-releaser	2025-12-04T22:33:19.7090345Z Loading index file from git repository .cr-index/index.yaml
release	Run chart-releaser	2025-12-04T22:33:19.7105483Z fatal: invalid reference: origin/gh-pages
release	Run chart-releaser	2025-12-04T22:33:19.7107888Z Error: exit status 128
```

### Chart-Releaser Configuration
From `.github/workflows/helm-release.yml`:
```yaml
- name: Run chart-releaser
  uses: helm/chart-releaser-action@v1.6.0
  env:
    CR_TOKEN: "${{ secrets.GITHUB_TOKEN }}"
  with:
    charts_dir: helm
    skip_packaging: true
```

### Repository State
- **Branch checked:** `gh-pages` existence verification
- **Result:** Branch does not exist
- **Command used:** `gh api repos/link-assistant/hive-mind/branches --jq '.[].name' | grep "gh-pages"`
- **Output:** No matches found

## Known Issue in Upstream Project

This is a documented issue in the helm/chart-releaser-action project:
- **Issue:** [release fails if gh-pages branch doesn't yet exist · Issue #10](https://github.com/helm/chart-releaser-action/issues/10)
- **Status:** Open since 2020
- **Impact:** Affects all first-time users of the action

## Proposed Solutions

### Solution 1: Manual Branch Creation (Immediate Fix)
Create the `gh-pages` branch manually before running the workflow:

```bash
git checkout --orphan gh-pages
git reset --hard
git commit --allow-empty -m "Initialize gh-pages branch for Helm charts"
git push origin gh-pages
```

**Pros:**
- Immediate fix
- Simple to implement
- No workflow changes needed

**Cons:**
- Manual intervention required
- Doesn't prevent the issue for other repositories

### Solution 2: Workflow Modification (Automated Fix)
Modify the workflow to create the `gh-pages` branch automatically if it doesn't exist:

```yaml
- name: Ensure gh-pages branch exists
  run: |
    # Check if gh-pages branch exists
    if ! git ls-remote --exit-code --heads origin gh-pages >/dev/null 2>&1; then
      echo "Creating gh-pages branch..."
      git checkout --orphan gh-pages
      git reset --hard
      git commit --allow-empty -m "Initialize gh-pages branch for Helm charts"
      git push origin gh-pages
      git checkout main
    else
      echo "gh-pages branch already exists"
    fi
```

**Pros:**
- Fully automated
- Handles first-time setup gracefully
- Prevents future occurrences
- No manual intervention needed

**Cons:**
- Requires workflow modification
- Adds complexity to the workflow

### Solution 3: Reorder Workflow Steps (Alternative Fix)
Move the GitHub Pages deployment step before the chart-releaser step and use `continue-on-error`:

**Pros:**
- Leverages existing GitHub Actions
- Minimal changes

**Cons:**
- Less explicit about the intention
- Relies on error handling

### Solution 4: Use Chart Releaser with `--push` flag
Configure the chart-releaser to handle the initial push:

```yaml
- name: Run chart-releaser
  uses: helm/chart-releaser-action@v1.6.0
  env:
    CR_TOKEN: "${{ secrets.GITHUB_TOKEN }}"
  with:
    charts_dir: helm
    skip_packaging: true
    pages_branch: gh-pages
  continue-on-error: true  # Allow first-time setup to fail
```

**Pros:**
- Minimal changes
- Explicit configuration

**Cons:**
- Still requires the gh-pages branch to exist
- Doesn't solve the root cause

## Recommended Solution

**Solution 2: Workflow Modification (Automated Fix)** is the recommended approach because:

1. **Fully automated**: No manual intervention required
2. **Robust**: Handles both first-time setup and subsequent runs
3. **Clear intent**: Explicitly documents the gh-pages branch requirement
4. **Future-proof**: Prevents the issue from occurring again in other repositories
5. **Self-healing**: Automatically fixes the problem if the branch is deleted

## Implementation Plan

1. Add a new workflow step before "Run chart-releaser"
2. Check if the `gh-pages` branch exists
3. Create it if it doesn't exist with an empty commit
4. Continue with the normal workflow
5. Test the workflow with a trigger

## Additional Recommendations

1. **Update documentation**: Add a note about the `gh-pages` branch requirement in the project README
2. **Add workflow comments**: Document the purpose of each step for future maintainers
3. **Monitor first run**: Watch the first successful run to ensure the fix works
4. **GitHub Pages configuration**: Ensure GitHub Pages is configured to serve from the `gh-pages` branch in repository settings

## References

- [Chart Releaser Action to Automate GitHub Page Charts | Helm](https://helm.sh/docs/howto/chart_releaser_action/)
- [release fails if gh-pages branch doesn't yet exist · Issue #10 · helm/chart-releaser-action](https://github.com/helm/chart-releaser-action/issues/10)
- [GitHub - helm/chart-releaser-action](https://github.com/helm/chart-releaser-action)
- [Host Helm Charts via GitHub with Chart Releaser](https://lippertmarkus.com/2020/08/13/chartreleaser/)

## Conclusion

The Helm chart release failure was caused by a missing `gh-pages` branch, which is required by the chart-releaser-action. The recommended fix is to modify the workflow to automatically create this branch during the first run, ensuring a smooth and automated setup process without manual intervention.
