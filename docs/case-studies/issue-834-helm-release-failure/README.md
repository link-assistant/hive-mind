# Case Study: Helm Chart Release Failure (Issue #834)

## Executive Summary

This case study documents the investigation and resolution of a critical failure in the Helm chart release pipeline that prevented automated chart releases to GitHub Pages.

**Issue:** [#834 - Fix helm chart release](https://github.com/link-assistant/hive-mind/issues/834)
**Failed CI Run:** [#19947598686](https://github.com/link-assistant/hive-mind/actions/runs/19947598686/job/57200519431)
**Date of Failure:** 2025-12-04
**Severity:** High - Blocking automated releases
**Root Cause:** Bug in helm/chart-releaser-action v1.6.0
**Resolution:** Upgrade to v1.7.0

---

## Timeline of Events

### 2025-12-04 23:43:16 UTC - Workflow Initiated
- Helm release workflow triggered on main branch
- Environment: GitHub Actions runner with Ubuntu 24.04
- Workflow file: `.github/workflows/helm-release.yml`
- chart-releaser-action version: v1.6.0

### 2025-12-04 23:43:24 UTC - Chart Packaging Succeeded
- Helm chart linted successfully: "1 chart(s) linted, 0 chart(s) failed"
- Chart packaged to `.cr-release-packages/hive-mind-1.0.0.tgz`
- gh-pages branch verification passed

### 2025-12-04 23:43:25-27 UTC - Index Update Process Started
- chart-releaser installed at `/opt/hostedtoolcache/cr/v1.6.1/x86_64`
- Chart metadata extracted from package
- Index file updated: `.cr-index/index.yaml`
- Git operations completed: commit created, pushed to gh-pages

### 2025-12-04 23:43:28 UTC - FAILURE
```
/home/runner/work/_actions/helm/chart-releaser-action/v1.6.0/cr.sh: line 109: latest_tag: unbound variable
##[error]Process completed with exit code 1.
```

---

## Detailed Analysis

### 1. Error Description

The workflow failed with an "unbound variable" error when the `cr.sh` script attempted to access the `latest_tag` variable at line 109. This error occurred despite successful completion of all previous steps including:
- Chart linting
- Package creation
- Index file update
- Git push to gh-pages branch

### 2. Root Cause Investigation

#### 2.1 Bash Strict Mode
The `cr.sh` script from chart-releaser-action v1.6.0 uses strict bash options:
```bash
set -o errexit   # Exit on any error
set -o nounset   # Error on undefined variables
set -o pipefail  # Fail on any pipeline error
```

The `set -o nounset` option causes the script to fail when accessing undefined variables, which is exactly what happened with `latest_tag`.

#### 2.2 Variable Scoping Bug
The bug was introduced in chart-releaser-action between v1.5.0 and v1.6.0 through PR #130. The problematic code structure:

```bash
if [[ -z "$skip_packaging" ]]; then
    local latest_tag
    latest_tag=$(lookup_latest_tag)
    # ... other operations using latest_tag
fi

# Later in the script (line 109):
echo "chart_version=${latest_tag}" >chart_version.txt  # FAILS HERE
```

**Issue:** The `latest_tag` variable is declared as `local` inside the conditional block but referenced outside it. When `skip_packaging=true` (our configuration), the variable is never initialized, causing the unbound variable error.

#### 2.3 Our Configuration
In our workflow file, we explicitly set:
```yaml
- name: Run chart-releaser
  uses: helm/chart-releaser-action@v1.6.0
  with:
    skip_packaging: true  # WE PACKAGE MANUALLY
    skip_existing: true
```

We use `skip_packaging: true` because we manually package the chart in a previous step to update the `appVersion` from `package.json`. This triggers the bug.

### 3. Why This Happened Now

1. **Recent Helm Chart Addition:** The hive-mind Helm chart was recently added to the repository
2. **Manual Packaging Requirement:** We need to update appVersion dynamically from package.json
3. **v1.6.0 Regression:** This version introduced the scoping bug that affects `skip_packaging: true` scenarios

### 4. Impact Assessment

**Immediate Impact:**
- Helm chart releases blocked
- GitHub Pages index not updated (though index.yaml was successfully pushed)
- Manual intervention required for chart distribution

**Severity Factors:**
- Workflow completes 95% successfully (only final output writing fails)
- Chart is actually packaged and index updated successfully
- Only affects automated release metadata

---

## Related Issues and References

### Upstream Issue
- **GitHub Issue:** [helm/chart-releaser-action#171](https://github.com/helm/chart-releaser-action/issues/171)
- **Title:** "cr.sh: line 109: latest_tag: unbound variable"
- **Status:** Fixed
- **Fix PR:** [helm/chart-releaser-action#202](https://github.com/helm/chart-releaser-action/pull/202)
- **Merged:** January 20, 2025
- **Released in:** v1.7.0

### Version Information
- **Broken versions:** v1.6.0
- **Working versions:** v1.5.0 (before bug), v1.7.0 (after fix)
- **Fix release date:** January 20, 2025

---

## Proposed Solutions

### Solution 1: Upgrade to v1.7.0 (RECOMMENDED)

**Description:** Update chart-releaser-action from v1.6.0 to v1.7.0

**Advantages:**
- Official fix for the exact issue we're experiencing
- Maintains all v1.6.0 features
- Includes additional improvements and security updates
- Forward-compatible

**Implementation:**
```yaml
- name: Run chart-releaser
  uses: helm/chart-releaser-action@v1.7.0  # Changed from v1.6.0
  with:
    skip_packaging: true
    skip_existing: true
```

**Risk Level:** Low
- Official release with fix specifically for this issue
- Released January 20, 2025
- Backward compatible with our configuration

### Solution 2: Downgrade to v1.5.0

**Description:** Revert to the last known working version

**Advantages:**
- Proven to work with skip_packaging
- Quick rollback option

**Disadvantages:**
- Missing v1.6.0 features (mark_as_latest, skip_existing improvements)
- Not forward-compatible
- Temporary solution only

**Risk Level:** Medium
- Loses newer features we might want
- Not a long-term solution

### Solution 3: Remove skip_packaging

**Description:** Let chart-releaser-action handle packaging

**Challenges:**
- Cannot update appVersion from package.json
- Would need alternative approach for version synchronization
- More complex workflow changes required

**Risk Level:** High
- Requires workflow redesign
- May not meet our requirements

---

## Recommended Action Plan

1. **Immediate Fix:** Upgrade to chart-releaser-action@v1.7.0
2. **Verification:** Test with next chart version bump
3. **Monitoring:** Observe release workflow for one cycle
4. **Documentation:** Update workflow comments with version rationale

---

## Prevention Measures

### For Future Similar Issues

1. **Upstream Monitoring:**
   - Subscribe to helm/chart-releaser-action releases
   - Review changelogs before upgrading
   - Test in non-production environment when possible

2. **Workflow Validation:**
   - Add workflow testing for critical paths
   - Consider workflow testing tools
   - Document version dependencies

3. **Version Pinning Strategy:**
   - Pin to specific versions (not @main)
   - Review and test before upgrading
   - Maintain changelog of workflow changes

4. **Error Handling:**
   - Add fallback mechanisms for critical workflows
   - Consider notification alerts for failed releases
   - Implement manual release procedure as backup

---

## Lessons Learned

1. **Version Pinning is Critical:** Using `@v1.6.0` instead of `@main` allowed us to identify the exact problematic version

2. **Strict Bash Options are Double-Edged:** While `set -u` catches bugs, it can also expose issues in upstream tools

3. **Manual Packaging Has Trade-offs:** Our requirement to update appVersion exposed us to this bug; simpler configurations avoided it

4. **Upstream Fixes Happen:** The issue was reported, fixed, and released upstream within months

5. **Partial Success Can Be Misleading:** The workflow appeared mostly successful (chart packaged, index updated) but still failed at the end

---

## Technical Details

### Failed Workflow Configuration
```yaml
name: Release Helm Chart
on:
  push:
    branches: [main]
    paths: ['helm/**', 'package.json', '.github/workflows/helm-release.yml']

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      # ... setup steps ...

      - name: Package Helm chart
        run: |
          mkdir -p .cr-release-packages
          helm package helm/hive-mind -d .cr-release-packages

      - name: Run chart-releaser
        uses: helm/chart-releaser-action@v1.6.0  # PROBLEMATIC VERSION
        env:
          CR_TOKEN: "${{ secrets.GITHUB_TOKEN }}"
        with:
          charts_dir: helm
          skip_packaging: true  # TRIGGERS BUG
          skip_existing: true
```

### Error Stack Trace
```
Releasing charts...
Updating charts repo index...
Found hive-mind-1.0.0.tgz
Extracting chart metadata from .cr-release-packages/hive-mind-1.0.0.tgz
Calculating Hash for .cr-release-packages/hive-mind-1.0.0.tgz
Updating index .cr-index/index.yaml
[detached HEAD 68e826e] Update index.yaml
 1 file changed, 59 insertions(+)
 create mode 100644 index.yaml
Pushing to branch "gh-pages"
To https://github.com/link-assistant/hive-mind
   4b40274..68e826e  HEAD -> gh-pages
/home/runner/work/_actions/helm/chart-releaser-action/v1.6.0/cr.sh: line 109: latest_tag: unbound variable
##[error]Process completed with exit code 1.
```

### Chart Information
- **Chart Name:** hive-mind
- **Version:** 1.0.0
- **Package:** hive-mind-1.0.0.tgz
- **Repository:** link-assistant/hive-mind
- **Pages Branch:** gh-pages

---

## Verification Checklist

After implementing the fix:

- [ ] Workflow runs without errors
- [ ] Chart is packaged correctly
- [ ] GitHub release is created
- [ ] gh-pages branch is updated
- [ ] index.yaml contains correct chart metadata
- [ ] Chart can be installed from GitHub Pages repository
- [ ] ArtifactHub integration works (if applicable)

---

## Additional Resources

- [Helm Chart Releaser Action Documentation](https://github.com/helm/chart-releaser-action)
- [Helm Chart Repository Guide](https://helm.sh/docs/topics/chart_repository/)
- [GitHub Pages for Helm Charts](https://helm.sh/docs/howto/chart_releaser_action/)

---

## Appendix

### A. Full CI Logs
The full CI logs from the failed run are available via:
- GitHub Actions: https://github.com/link-assistant/hive-mind/actions/runs/19947598686
- Download command: `gh run view 19947598686 --repo link-assistant/hive-mind --log`

Note: Log files are excluded from git repository per .gitignore configuration.

### B. Relevant Files
- Workflow: `.github/workflows/helm-release.yml`
- Chart: `helm/hive-mind/Chart.yaml`
- Package metadata: `package.json`

### C. Timeline Summary
```
23:43:16 - Workflow started
23:43:24 - Chart linted (✓)
23:43:24 - Chart packaged (✓)
23:43:25 - gh-pages verified (✓)
23:43:26 - chart-releaser installed (✓)
23:43:27 - Index updated (✓)
23:43:28 - Git push to gh-pages (✓)
23:43:28 - Variable access FAILED (✗)
```

### D. Issue Resolution Status
- **Investigation:** Complete
- **Root Cause:** Identified
- **Solution:** Determined
- **Implementation:** Pending
- **Verification:** Pending
