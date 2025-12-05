# Case Study: Helm Chart Release Failure

## Issue Summary

**Issue:** [#836 - Fix helm chart release](https://github.com/link-assistant/hive-mind/issues/836)
**Date of Incident:** December 5, 2025
**Affected Workflow:** [GitHub Actions Run #19965046071](https://github.com/link-assistant/hive-mind/actions/runs/19965046071/job/57254531876)
**Status:** Analysis Complete

## Timeline of Events

| Timestamp (UTC) | Event |
|-----------------|-------|
| 2025-12-05 13:52:21 | GitHub Actions workflow `Release Helm Chart` started |
| 2025-12-05 13:52:25 | Repository checkout completed successfully |
| 2025-12-05 13:52:29 | Helm lint completed: "1 chart(s) linted, 0 chart(s) failed" |
| 2025-12-05 13:52:29 | Helm package completed: "Successfully packaged chart and saved it to: .cr-release-packages/hive-mind-1.0.0.tgz" |
| 2025-12-05 13:52:30 | gh-pages branch check: "gh-pages branch already exists" |
| 2025-12-05 13:52:30 | chart-releaser-action v1.7.0 started with `skip_packaging: true` |
| 2025-12-05 13:52:31 | chart-releaser v1.7.0 installed |
| 2025-12-05 13:52:31 | "Releasing charts..." |
| 2025-12-05 13:52:31 | "Updating charts repo index..." |
| 2025-12-05 13:52:32 | "Found hive-mind-1.0.0.tgz" |
| 2025-12-05 13:52:32 | "Index .cr-index/index.yaml did not change" (chart already released) |
| 2025-12-05 13:52:32 | **ERROR:** `/home/runner/work/_actions/helm/chart-releaser-action/v1.7.0/cr.sh: line 111: latest_tag: unbound variable` |
| 2025-12-05 13:52:32 | Process completed with exit code 1 |

## Error Details

### The Error Message

```
/home/runner/work/_actions/helm/chart-releaser-action/v1.7.0/cr.sh: line 111: latest_tag: unbound variable
##[error]Process completed with exit code 1.
```

### Workflow Configuration

From `.github/workflows/helm-release.yml`:

```yaml
- name: Run chart-releaser
  uses: helm/chart-releaser-action@v1.7.0
  env:
    CR_TOKEN: "${{ secrets.GITHUB_TOKEN }}"
  with:
    charts_dir: helm
    skip_packaging: true   # <-- This flag triggers the bug
    skip_existing: true
```

## Root Cause Analysis

### The Bug in chart-releaser-action v1.7.0

The bug exists in the `cr.sh` script at line 111 within the `helm/chart-releaser-action@v1.7.0` release.

#### Problematic Code (v1.7.0)

```bash
# Lines 71-115 in cr.sh (v1.7.0)
if [[ -z "$skip_packaging" ]]; then
    echo 'Looking up latest tag...'
    local latest_tag                          # Line 73: Declared here
    latest_tag=$(lookup_latest_tag)           # Line 74: Assigned here

    # ... chart discovery and packaging logic ...

    echo "changed_charts=..." >changed_charts.txt
else
    # skip_packaging branch - latest_tag is NEVER set
    install_chart_releaser
    rm -rf .cr-index
    mkdir -p .cr-index
    release_charts
    update_index
fi

echo "chart_version=${latest_tag}" >chart_version.txt  # Line 111: ALWAYS executed!
```

#### The Problem

1. The script uses `set -o nounset` (strict mode) which fails on unbound variables
2. The `latest_tag` variable is only declared and assigned inside the `if [[ -z "$skip_packaging" ]]` block
3. The line `echo "chart_version=${latest_tag}" >chart_version.txt` is **outside** the conditional block
4. When `skip_packaging: true` is set, the `else` branch executes, skipping the `latest_tag` assignment
5. Line 111 then tries to access the unbound `latest_tag` variable, causing the failure

### Why This Happened

This is a scoping bug introduced in v1.6.0 as part of adding new output features. The `chart_version` output was added to provide version information, but the code incorrectly placed the output statement outside the conditional block where the variable is defined.

### Known Issue

This bug is documented in [GitHub Issue #171](https://github.com/helm/chart-releaser-action/issues/171) in the helm/chart-releaser-action repository.

## Evidence

### CI Log Excerpts

```
release	Run chart-releaser	2025-12-05T13:52:30.3350581Z   charts_dir: helm
release	Run chart-releaser	2025-12-05T13:52:30.3350767Z   skip_packaging: true
release	Run chart-releaser	2025-12-05T13:52:30.3350948Z   skip_existing: true
...
release	Run chart-releaser	2025-12-05T13:52:32.7773511Z Found hive-mind-1.0.0.tgz
release	Run chart-releaser	2025-12-05T13:52:32.7774001Z Index .cr-index/index.yaml did not change
release	Run chart-releaser	2025-12-05T13:52:32.8335535Z /home/runner/work/_actions/helm/chart-releaser-action/v1.7.0/cr.sh: line 111: latest_tag: unbound variable
```

### Comparison: v1.7.0 vs main branch

The fix has been merged to main branch via [PR #202](https://github.com/helm/chart-releaser-action/pull/202), which moves the `chart_version.txt` output inside the appropriate conditional blocks:

**Fixed code (main branch):**

```bash
if [[ -z "$skip_packaging" ]]; then
    # ... packaging logic with latest_tag ...
    echo "chart_version=${latest_tag}" >chart_version.txt  # Inside if block
else
    # skip_packaging branch - no chart_version output
    install_chart_releaser
    rm -rf .cr-index
    mkdir -p .cr-index
    release_charts
    update_index
    # No chart_version.txt written here
fi
```

## Proposed Solutions

### Solution 1: Use main branch (Recommended for immediate fix)

```yaml
- name: Run chart-releaser
  uses: helm/chart-releaser-action@main
  env:
    CR_TOKEN: "${{ secrets.GITHUB_TOKEN }}"
  with:
    charts_dir: helm
    skip_packaging: true
    skip_existing: true
```

**Pros:** Contains the fix from PR #202
**Cons:** Using `@main` is not recommended for production (unstable)

### Solution 2: Remove skip_packaging and let action handle packaging

```yaml
- name: Run chart-releaser
  uses: helm/chart-releaser-action@v1.7.0
  env:
    CR_TOKEN: "${{ secrets.GITHUB_TOKEN }}"
  with:
    charts_dir: helm
    skip_existing: true
    # Remove skip_packaging: true - let the action handle packaging
```

**Pros:** Avoids the bug entirely
**Cons:** Removes custom packaging step; may not update appVersion correctly

### Solution 3: Wait for v1.8.0 release

The fix is merged to main. Once v1.8.0 is released, upgrade to that version.

**Pros:** Stable release version
**Cons:** Unknown timeline for release

### Solution 4: Redesign workflow without chart-releaser-action

Create a custom workflow that doesn't rely on the problematic action:

```yaml
- name: Package and Release Helm chart manually
  run: |
    # Custom packaging logic
    helm package helm/hive-mind -d .cr-release-packages

    # Upload to release
    gh release create "hive-mind-${VERSION}" .cr-release-packages/*.tgz --title "Helm Chart ${VERSION}"

    # Update index
    helm repo index .cr-release-packages --url https://github.com/...
```

**Pros:** Full control, no dependency on buggy action
**Cons:** More complex, requires maintenance

## Implemented Solution

Based on the analysis, **Solution 2** was implemented with enhancements:

### Changes Made to `.github/workflows/helm-release.yml`

1. **Removed `skip_packaging: true`** - This avoids the unbound variable bug entirely
2. **Removed redundant manual packaging step** - Since chart-releaser-action now handles packaging
3. **Synced chart version with appVersion** - Both now use the `package.json` version, ensuring a new Helm release is created each time the application version changes

### Key Workflow Changes

```yaml
# BEFORE (broken)
- name: Package Helm chart
  run: |
    mkdir -p .cr-release-packages
    helm package helm/hive-mind -d .cr-release-packages

- name: Run chart-releaser
  uses: helm/chart-releaser-action@v1.7.0
  with:
    skip_packaging: true  # <-- This triggered the bug

# AFTER (fixed)
- name: Update Chart versions
  run: |
    # Sync both version and appVersion with package.json
    sed -i "s/^appVersion: .*/appVersion: \"$APP_VERSION\"/" helm/hive-mind/Chart.yaml
    sed -i "s/^version: .*/version: $APP_VERSION/" helm/hive-mind/Chart.yaml

- name: Run chart-releaser
  uses: helm/chart-releaser-action@v1.7.0
  with:
    skip_existing: true  # No skip_packaging - action handles packaging
```

### Benefits of This Solution

1. **Avoids the bug** - By not using `skip_packaging`, the `latest_tag` variable is properly initialized
2. **Simpler workflow** - Removes redundant manual packaging step
3. **Automatic versioning** - Chart version now tracks application version
4. **Works with stable release** - Uses v1.7.0 without needing unreleased fixes

## References

- [GitHub Issue #171 - cr.sh: line 109: latest_tag: unbound variable](https://github.com/helm/chart-releaser-action/issues/171)
- [PR #202 - Fix for unbound variable when skip_packaging is set](https://github.com/helm/chart-releaser-action/pull/202)
- [chart-releaser-action Releases](https://github.com/helm/chart-releaser-action/releases)
- [Helm Chart Releaser Documentation](https://helm.sh/docs/howto/chart_releaser_action/)
- [Failed CI Run Logs](https://github.com/link-assistant/hive-mind/actions/runs/19965046071/job/57254531876)

## Appendix: Key Log Excerpts

### Error Output (Lines 961-973)

```
release	Run chart-releaser	2025-12-05T13:52:31.0806376Z Adding cr directory to PATH...
release	Run chart-releaser	2025-12-05T13:52:31.0849187Z Releasing charts...
release	Run chart-releaser	2025-12-05T13:52:31.1019382Z Preparing worktree (detached HEAD 68e826e)
release	Run chart-releaser	2025-12-05T13:52:31.5301472Z HEAD is now at 68e826e Update index.yaml
release	Run chart-releaser	2025-12-05T13:52:31.8928970Z Updating charts repo index...
release	Run chart-releaser	2025-12-05T13:52:31.9086596Z Loading index file from git repository .cr-index/index.yaml
release	Run chart-releaser	2025-12-05T13:52:31.9103001Z Preparing worktree (detached HEAD 68e826e)
release	Run chart-releaser	2025-12-05T13:52:32.3377131Z HEAD is now at 68e826e Update index.yaml
release	Run chart-releaser	2025-12-05T13:52:32.7773511Z Found hive-mind-1.0.0.tgz
release	Run chart-releaser	2025-12-05T13:52:32.7774001Z Index .cr-index/index.yaml did not change
release	Run chart-releaser	2025-12-05T13:52:32.8335535Z /home/runner/work/_actions/helm/chart-releaser-action/v1.7.0/cr.sh: line 111: latest_tag: unbound variable
release	Run chart-releaser	2025-12-05T13:52:32.8351225Z ##[error]Process completed with exit code 1.
```

### Configuration Used

```
release	Run chart-releaser	2025-12-05T13:52:30.3350581Z   charts_dir: helm
release	Run chart-releaser	2025-12-05T13:52:30.3350767Z   skip_packaging: true
release	Run chart-releaser	2025-12-05T13:52:30.3350948Z   skip_existing: true
release	Run chart-releaser	2025-12-05T13:52:30.3351139Z   version: v1.7.0
release	Run chart-releaser	2025-12-05T13:52:30.3351312Z   mark_as_latest: true
```

Full CI logs are available at the GitHub Actions run link above.
