# Root Cause Analysis: Duplicate Helm Chart Release Tag

## Executive Summary

The Helm chart release failure is caused by a **mismatch between chart versioning strategy and workflow expectations**. The workflow assumes the chart version will change with every run, but the chart version is static and only the appVersion changes. This causes attempts to create duplicate GitHub releases with the same tag.

## Primary Root Cause

### Static Chart Version Without Increment Mechanism

**Location**: `helm/hive-mind/Chart.yaml:8`

```yaml
version: 1.0.0  # This never changes automatically
```

**Problem**:
- Chart version determines the GitHub release tag name: `{chart-name}-{version}`
- The version is hardcoded and requires manual updates
- The workflow runs on every push that changes helm files or package.json
- Each run attempts to create a release with the same tag
- GitHub rejects duplicate tags with HTTP 422 error

**Why This Happens**:

1. **Chart Version vs App Version Confusion**
   ```yaml
   version: 1.0.0          # Chart template version (rarely changes)
   appVersion: "0.37.2"    # Application version (changes frequently)
   ```

2. **Workflow Updates Only appVersion**
   ```yaml
   - name: Update Chart appVersion
     run: |
       VERSION="${{ steps.package-version.outputs.version }}"
       sed -i "s/^appVersion: .*/appVersion: \"$VERSION\"/" helm/hive-mind/Chart.yaml
   ```

   This updates appVersion but NOT version.

3. **Release Tag Uses Chart Version**
   ```
   helm package helm/hive-mind → hive-mind-1.0.0.tgz
   cr upload → Creates release with tag: hive-mind-1.0.0
   ```

## Contributing Factors

### 1. Partial Success in Previous Run

**Evidence from Run #19946134787**:

The chart-releaser action has two phases:
```
cr upload  → Creates GitHub release ✅ (succeeded at 22:33:18Z)
cr index   → Updates index.yaml     ❌ (failed at 22:33:19Z)
```

**Impact**:
- Release `hive-mind-1.0.0` was created
- Tag `hive-mind-1.0.0` was created
- Workflow marked as failed
- Next run encounters "already exists" error

**Why This Is Problematic**:
- Workflows typically either fully succeed or fully fail
- Partial success creates inconsistent state
- GitHub doesn't provide atomic "create release + update index" operation
- No cleanup mechanism for failed workflows

### 2. Missing skip_existing Parameter

**Current Configuration** (`.github/workflows/helm-release.yml:86-92`):
```yaml
- name: Run chart-releaser
  uses: helm/chart-releaser-action@v1.6.0
  env:
    CR_TOKEN: "${{ secrets.GITHUB_TOKEN }}"
  with:
    charts_dir: helm
    skip_packaging: true
    # skip_existing is NOT set (defaults to false)
```

**Available Option**:
```yaml
skip_existing: true  # Skip charts that have already been released
```

**Impact**:
- Without `skip_existing`, the action fails if release exists
- With `skip_existing`, the action would skip the duplicate and succeed
- This is a design choice: fail loudly vs. skip silently

### 3. Workflow Trigger Too Broad

**Current Trigger** (`.github/workflows/helm-release.yml:3-10`):
```yaml
on:
  push:
    branches:
      - main
    paths:
      - 'helm/**'
      - 'package.json'        # ← Triggers on app version changes
      - '.github/workflows/helm-release.yml'
```

**Problem**:
- Workflow runs when package.json changes (frequent)
- But chart version doesn't change (infrequent)
- This causes many attempts to create the same release

**Ideal Behavior**:
- Workflow should run only when chart version changes
- Or workflow should handle unchanged chart version gracefully

### 4. Lack of Version Validation

The workflow doesn't check if the chart version has changed or if a release already exists before attempting to create one.

**Missing Checks**:
```bash
# Check if release already exists
if gh release view "hive-mind-$CHART_VERSION" 2>/dev/null; then
  echo "Release already exists, skipping..."
  exit 0
fi

# Check if chart version changed
git diff HEAD~1 helm/hive-mind/Chart.yaml | grep "^+version:"
```

## Architectural Issues

### 1. Semantic Versioning Confusion

**Helm Best Practices** (from https://helm.sh/docs/topics/charts/):

> **Chart Version** (`version`):
> - The version of the chart itself
> - Must be incremented when templates change
> - Follows SemVer
>
> **App Version** (`appVersion`):
> - The version of the application
> - Can be any string
> - Doesn't affect chart functionality

**Current Problem**:
- Application version changes frequently (0.37.0 → 0.37.1 → 0.37.2)
- Chart templates don't change frequently
- Chart version should stay at 1.0.0 until templates change
- But workflow creates new "releases" for each app version

### 2. Release Model Mismatch

**Current Model** (Implicit):
- Release per application version
- Using Helm chart releases as application release mechanism
- Release tag: `hive-mind-{chart-version}`

**Helm Best Practice Model**:
- Release per chart version
- Chart version only increments when chart changes
- Application version tracked in appVersion field
- Same chart version can deploy different app versions

**Mismatch**:
- Workflow wants: Release for every app version
- Helm expects: Release for every chart version
- Result: Conflicts when app version changes but chart doesn't

### 3. Tag Naming Convention

**Current**: `hive-mind-{chart-version}` (e.g., `hive-mind-1.0.0`)

**Problems**:
- Doesn't include app version
- Same tag for different app versions
- Can't distinguish which app version a chart release contains

**Alternative Patterns**:

1. **Chart-only versioning** (Helm standard)
   - Tag: `hive-mind-1.0.0`
   - AppVersion: 0.37.2 (in metadata)
   - Pro: Follows Helm conventions
   - Con: Need to update chart version for each app release

2. **Hybrid versioning**
   - Tag: `hive-mind-1.0.0-app-0.37.2`
   - Pro: Clear what app version is included
   - Con: Non-standard, may break tooling

3. **App-version-based**
   - Tag: `v0.37.2` (matches package.json)
   - Pro: Simple, matches app releases
   - Con: Breaks Helm chart repository conventions

## Evidence from Logs

### Error Message Analysis

```
Error: error creating GitHub release hive-mind-1.0.0:
POST https://api.github.com/repos/link-assistant/hive-mind/releases:
422 Validation Failed [{Resource:Release Field:tag_name Code:already_exists Message:}]
```

**Breakdown**:
- `Error: error creating GitHub release` → Failure during `cr upload`
- `hive-mind-1.0.0` → Tag derived from chart name + version
- `422 Validation Failed` → GitHub HTTP status for validation error
- `tag_name Code:already_exists` → Specific field and error code
- Root cause: Attempting to create duplicate tag

### GitHub API Response

When querying the existing release:

```bash
gh api /repos/link-assistant/hive-mind/releases/tags/hive-mind-1.0.0
```

Returns:
```json
{
  "tag_name": "hive-mind-1.0.0",
  "name": "hive-mind-1.0.0",
  "created_at": "2025-12-04T22:33:03Z",
  "published_at": "2025-12-04T22:33:18Z",
  "author": {
    "login": "github-actions[bot]"
  }
}
```

This confirms:
- Release was created in run #19946134787
- Created during `cr upload` phase (22:33:18Z)
- Before the workflow failed in `cr index` phase (22:33:19Z)

## Comparison with Standard Practices

### helm/chart-releaser-action Documentation

From the action's README:
> It will also update the chart version in the `Chart.yaml` file by default.

**Our configuration**:
```yaml
skip_packaging: true  # We package manually before the action
```

**Implication**:
- We handle packaging ourselves
- The action doesn't get a chance to auto-increment versions
- We're responsible for version management

### Other Projects' Approaches

1. **Manual Version Management**
   - Developers manually bump chart version in PR
   - Workflow validates version is new
   - Simple but requires discipline

2. **Automated Version from App**
   - Chart version = app version (0.37.2)
   - Each app release = new chart release
   - Works but breaks Helm conventions

3. **CalVer for Charts**
   - Chart version = YYYY.MM.patch
   - Automatically incremented
   - Clear but decouples from semantic meaning

4. **Use skip_existing**
   - Let workflow run but skip if exists
   - Simple fix for our case
   - Downside: Silent failures if chart should have updated

## Dependencies and Constraints

### GitHub API Constraints
- Tags are immutable once created
- Cannot update/replace a release tag
- Must use unique tag names
- 422 error is correct behavior

### Helm Chart Repository Constraints
- Chart version must follow SemVer
- Chart version must be unique in repository
- Multiple app versions can use same chart
- Index.yaml maps version → download URL

### CI/CD Constraints
- Workflow runs on push to main
- No pre-merge validation of chart version
- Cannot easily detect if version changed
- Partial failures leave inconsistent state

## Conclusion

The root cause is **architectural**: the workflow implements an app-version-per-release model using Helm chart tooling that expects a chart-version-per-release model.

**The core issue is not a bug, but a design mismatch.**

Possible resolutions:
1. Align with Helm model: Only release when chart version changes
2. Modify workflow: Auto-increment chart version with app version
3. Use workaround: Enable `skip_existing` to handle duplicates
4. Change approach: Use different tagging/versioning scheme

See `03-SOLUTIONS.md` for detailed analysis of each approach.
