# Case Study: Helm Chart Release - Duplicate Tag Error (Issue #830)

## Quick Links
- **Issue**: https://github.com/link-assistant/hive-mind/issues/830
- **Pull Request**: https://github.com/link-assistant/hive-mind/pull/831
- **Failed Run**: https://github.com/link-assistant/hive-mind/actions/runs/19946870854

## TL;DR

**Problem**: Helm chart release workflow fails with 422 error: "tag_name already_exists"

**Root Cause**: Chart version is static (1.0.0) but workflow runs on every package.json change, attempting to create duplicate releases.

**Quick Fix**: Add `skip_existing: true` to chart-releaser-action

**Long-term Solution**: Choose between auto-incrementing chart version or manual version management with validation.

## Document Index

### [00-OVERVIEW.md](00-OVERVIEW.md)
- Problem statement
- Background context on issue #828
- Current state of the system
- Impact assessment
- High-level root cause summary

### [01-TIMELINE.md](01-TIMELINE.md)
- Complete timeline of all three workflow runs
- Detailed timestamps and logs
- Sequence of events leading to the error
- Analysis of partial success in run #19946134787
- How the hive-mind-1.0.0 release was created

### [02-ROOT-CAUSES.md](02-ROOT-CAUSES.md)
- Deep dive into static chart version issue
- Contributing factors analysis
- Architectural mismatch between Helm model and workflow
- Evidence from logs and API responses
- Comparison with Helm best practices

### [03-SOLUTIONS.md](03-SOLUTIONS.md)
- Five detailed solution approaches
- Pros/cons matrix for each solution
- Helm convention compliance analysis
- Implementation recommendations
- Immediate vs. long-term fixes

## Key Findings

### The Core Issue

The workflow implements an **app-version-per-release** model using Helm tooling designed for a **chart-version-per-release** model.

```yaml
# What the workflow does:
package.json version: 0.37.0 → 0.37.1 → 0.37.2 (changes frequently)
Chart.yaml version: 1.0.0 → 1.0.0 → 1.0.0 (never changes)
Release tag: hive-mind-1.0.0 (duplicate!)

# What Helm expects:
Chart templates change → increment chart version → new release
Chart templates same → keep chart version → reuse existing chart
```

### Three Versions in Play

1. **package.json version** (0.37.2)
   - Application code version
   - Changes with every app release
   - Managed automatically

2. **Chart.yaml appVersion** (0.37.2)
   - Version of app deployed by chart
   - Updated automatically by workflow
   - Metadata only, doesn't affect releases

3. **Chart.yaml version** (1.0.0)
   - Version of chart templates
   - Used for release tag generation
   - ❌ **Never updated** → causes duplicates

### The Partial Success

Run #19946134787 succeeded in creating the release but failed updating the index:

```
22:33:18Z - cr upload ✅ → Created release hive-mind-1.0.0
22:33:19Z - cr index ❌ → Failed (no gh-pages branch)
```

This left the system in an inconsistent state:
- ✅ Release exists
- ✅ Tag exists
- ❌ No index.yaml
- ❌ Workflow marked as failed

Next run attempts to create the same release → 422 error.

## Recommended Solution

### Immediate Fix (5 minutes)

Add one line to `.github/workflows/helm-release.yml`:

```yaml
- name: Run chart-releaser
  uses: helm/chart-releaser-action@v1.6.0
  env:
    CR_TOKEN: "${{ secrets.GITHUB_TOKEN }}"
  with:
    charts_dir: helm
    skip_packaging: true
    skip_existing: true  # ← ADD THIS
```

**Effect**:
- ✅ Workflow will succeed
- ✅ Index.yaml will be updated
- ⏭️ Duplicate release creation will be skipped
- ✅ CI unblocked

### Long-term Strategy

Choose based on your release model:

**Option A: Auto-increment chart version** (recommended for tight app-chart coupling)
- Chart version = app version (0.37.2)
- New chart release for every app release
- Breaks Helm conventions but fully automated

**Option B: Manual chart version** (recommended for Helm best practices)
- Increment chart version only when templates change
- Add PR validation to enforce updates
- Follows Helm standards

See [03-SOLUTIONS.md](03-SOLUTIONS.md) for detailed comparison.

## Data Collected

All artifacts from the investigation:

### CI Logs
- `ci-logs/helm-release-19945272855.log` - First run (lint failure)
- `ci-logs/helm-release-19946134787.log` - Second run (gh-pages failure, release created)
- `ci-logs/helm-release-19946870854.log` - Third run (duplicate tag error)

### GitHub Data
- Existing release: `hive-mind-1.0.0` created 2025-12-04T22:33:03Z
- Tag: `hive-mind-1.0.0`
- Asset: `hive-mind-1.0.0.tgz`

### Configuration
- Chart version: `1.0.0` (static)
- App version: `0.37.2` (from package.json)
- appVersion: `0.37.2` (auto-updated)

## Related Issues

### Issue #828: Missing gh-pages Branch
- **Status**: ✅ Resolved in PR #829
- **Relationship**: Prerequisite issue
- **Fix**: Added automatic gh-pages branch creation
- **Documentation**: `docs/case-studies/issue-828-helm-chart-release-failure.md`

### Issue #830: Duplicate Tag Error
- **Status**: 🔄 This issue
- **Relationship**: Surfaced after #828 was fixed
- **Root Cause**: Different (versioning strategy vs infrastructure)

Both issues affect the same workflow but have different root causes:
- #828: Missing infrastructure → One-time fix
- #830: Design mismatch → Requires architectural decision

## Key Learnings

1. **Partial failures can create inconsistent state**
   - chart-releaser does upload then index
   - If index fails, release still exists
   - Next run sees duplicate

2. **Helm chart version != app version**
   - Chart version: template version
   - appVersion: app version deployed
   - Confusion causes workflow issues

3. **Trigger paths matter**
   - Triggering on package.json changes
   - But chart version doesn't change
   - Mismatch causes duplicate attempts

4. **Design validation is critical**
   - Workflow assumes version increments
   - Reality: version is static
   - Gap causes failures

## Implementation

See PR #831 for the implementation of the recommended fix.

## References

- [Helm Chart Best Practices](https://helm.sh/docs/topics/charts/)
- [helm/chart-releaser-action](https://github.com/helm/chart-releaser-action)
- [Semantic Versioning](https://semver.org/)
- [GitHub Releases API](https://docs.github.com/en/rest/releases)
