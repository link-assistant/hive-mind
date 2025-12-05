# Proposed Solutions: Helm Chart Release Duplicate Tag

## Solution Overview Matrix

| Solution | Complexity | Helm Compliance | Auto-increment | Recommended |
|----------|-----------|-----------------|----------------|-------------|
| 1. Enable skip_existing | ⭐ Low | ✅ Yes | ❌ No | ✅ **Quick Fix** |
| 2. Auto-increment chart version | ⭐⭐ Medium | ⚠️ Partial | ✅ Yes | ✅ **Best for current workflow** |
| 3. Manual version management | ⭐ Low | ✅ Yes | ❌ No | ⚠️ Requires discipline |
| 4. Change trigger conditions | ⭐⭐ Medium | ✅ Yes | ❌ No | ⚠️ Limited releases |
| 5. Hybrid tagging | ⭐⭐⭐ High | ❌ No | ✅ Yes | ❌ Breaks standards |

---

## Solution 1: Enable skip_existing (Quick Fix)

### Overview
Add `skip_existing: true` parameter to chart-releaser action, allowing it to gracefully skip releases that already exist.

### Implementation

**Change in `.github/workflows/helm-release.yml`**:
```yaml
- name: Run chart-releaser
  uses: helm/chart-releaser-action@v1.6.0
  env:
    CR_TOKEN: "${{ secrets.GITHUB_TOKEN }}"
  with:
    charts_dir: helm
    skip_packaging: true
    skip_existing: true  # ← ADD THIS LINE
```

### Behavior

**Current**:
```
Chart version: 1.0.0
Release exists: hive-mind-1.0.0
Result: ❌ Error 422, workflow fails
```

**With skip_existing**:
```
Chart version: 1.0.0
Release exists: hive-mind-1.0.0
Result: ⏭️ Skip upload, continue to index update
         ✅ Workflow succeeds
```

### Pros
✅ Minimal code change (1 line)
✅ Immediate fix, no version bumps needed
✅ Workflow will succeed and update index.yaml
✅ Follows Helm best practices (chart version = template version)
✅ Index gets updated with current appVersion
✅ No risk of breaking changes

### Cons
⚠️ Silent skipping may hide issues
⚠️ Doesn't create new release for new app versions
⚠️ Chart version still needs manual management when templates change
⚠️ Less visibility into what was skipped

### Use Case
This solution is ideal when:
- Chart templates rarely change
- appVersion updates don't require new releases
- You want the index.yaml to stay updated
- You follow Helm's intended versioning model

### Test Plan
1. Merge PR with `skip_existing: true`
2. Trigger workflow (should succeed)
3. Verify index.yaml is updated on gh-pages
4. Verify no new release is created
5. Check logs show "skipping" message

---

## Solution 2: Auto-increment Chart Version (Recommended)

### Overview
Automatically sync chart version with application version from package.json, creating a new chart release for each app release.

### Implementation

**Change in `.github/workflows/helm-release.yml`**:
```yaml
- name: Get package version
  id: package-version
  run: |
    VERSION=$(node -p "require('./package.json').version")
    echo "version=$VERSION" >> $GITHUB_OUTPUT
    echo "Package version: $VERSION"

- name: Update Chart version and appVersion  # ← RENAME THIS STEP
  run: |
    VERSION="${{ steps.package-version.outputs.version }}"
    # Update both version and appVersion
    sed -i "s/^version: .*/version: $VERSION/" helm/hive-mind/Chart.yaml
    sed -i "s/^appVersion: .*/appVersion: \"$VERSION\"/" helm/hive-mind/Chart.yaml
    echo "Updated Chart.yaml version to $VERSION"
    echo "Updated Chart.yaml appVersion to $VERSION"

    # Show the changes
    grep -E "^(version|appVersion):" helm/hive-mind/Chart.yaml
```

### Behavior

**Before**:
```yaml
# Chart.yaml
version: 1.0.0
appVersion: "0.37.2"
```
Package: `hive-mind-1.0.0.tgz`
Release: `hive-mind-1.0.0`

**After**:
```yaml
# Chart.yaml (auto-updated)
version: 0.37.2
appVersion: "0.37.2"
```
Package: `hive-mind-0.37.2.tgz`
Release: `hive-mind-0.37.2`

### Pros
✅ New release for each app version
✅ Clear version correlation (chart v0.37.2 contains app v0.37.2)
✅ No manual version management needed
✅ No duplicate tag errors
✅ Works with existing workflow triggers
✅ Users can easily identify which app version they're installing

### Cons
⚠️ Breaks Helm semantic versioning convention
⚠️ Chart version changes even when templates don't
⚠️ Many chart releases (one per app release)
⚠️ Existing release `hive-mind-1.0.0` becomes orphaned

### Helm Convention Compliance

**Standard Helm Model**:
```
Chart version 1.0.0 → app v0.37.0
Chart version 1.0.0 → app v0.37.1  (same chart, different app)
Chart version 1.0.1 → app v0.37.1  (new chart)
```

**Our Model with Auto-increment**:
```
Chart version 0.37.0 → app v0.37.0
Chart version 0.37.1 → app v0.37.1
Chart version 0.37.2 → app v0.37.2
```

This is **pragmatic but non-standard**. It works fine but doesn't follow Helm's intended use.

### Use Case
This solution is ideal when:
- You want a Helm chart release for every app release
- Chart and app versions are tightly coupled
- You value automation over strict Helm conventions
- Your users expect version parity

### Test Plan
1. Update Chart.yaml to start with version matching package.json (0.37.2)
2. Merge PR with auto-increment workflow
3. Trigger workflow
4. Verify new release `hive-mind-0.37.2` is created
5. Verify index.yaml contains correct entry
6. Test installation: `helm install test https://...../hive-mind-0.37.2.tgz`

---

## Solution 3: Manual Version Management with PR Checks

### Overview
Keep chart version manual but add validation to ensure it's incremented when needed.

### Implementation

**Add new workflow file** `.github/workflows/helm-pr-check.yml`:
```yaml
name: Helm Chart PR Validation

on:
  pull_request:
    paths:
      - 'helm/**'

jobs:
  validate-version:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Check chart version changed
        run: |
          # Get chart version from PR branch
          NEW_VERSION=$(grep "^version:" helm/hive-mind/Chart.yaml | awk '{print $2}')

          # Get chart version from main branch
          git checkout origin/main -- helm/hive-mind/Chart.yaml
          OLD_VERSION=$(grep "^version:" helm/hive-mind/Chart.yaml | awk '{print $2}')

          echo "Old version: $OLD_VERSION"
          echo "New version: $NEW_VERSION"

          # Check if templates changed
          if git diff --name-only origin/main...HEAD | grep "^helm/.*\.yaml$" | grep -v Chart.yaml; then
            echo "Templates changed detected"

            if [ "$NEW_VERSION" = "$OLD_VERSION" ]; then
              echo "❌ ERROR: Chart templates changed but version not incremented"
              echo "Please update 'version' in helm/hive-mind/Chart.yaml"
              exit 1
            fi
          fi

          echo "✅ Chart version validation passed"
```

**Update release workflow**:
```yaml
- name: Verify chart version is unique
  run: |
    CHART_VERSION=$(grep "^version:" helm/hive-mind/Chart.yaml | awk '{print $2}')
    TAG_NAME="hive-mind-$CHART_VERSION"

    if gh release view "$TAG_NAME" 2>/dev/null; then
      echo "❌ ERROR: Release $TAG_NAME already exists"
      echo "Please increment version in helm/hive-mind/Chart.yaml"
      exit 1
    fi

    echo "✅ Chart version $CHART_VERSION is unique"
```

### Pros
✅ Follows Helm best practices perfectly
✅ Explicit version management
✅ Clear when new releases are created
✅ Validates before merge
✅ Prevents duplicate tag errors

### Cons
⚠️ Requires manual version bumps
⚠️ Developers need to remember to update version
⚠️ Additional workflow complexity
⚠️ Can block PRs if version not updated

### Use Case
This solution is ideal when:
- Chart templates change infrequently
- You want strict semantic versioning
- You have discipline to update versions
- You prefer explicit over implicit

---

## Solution 4: Change Trigger Conditions

### Overview
Only trigger Helm release workflow when chart version actually changes.

### Implementation

```yaml
name: Release Helm Chart

on:
  push:
    branches:
      - main
    paths:
      - 'helm/**/Chart.yaml'  # Only trigger on Chart.yaml changes
      - '.github/workflows/helm-release.yml'
  workflow_dispatch:  # Allow manual triggers
```

**Remove** `package.json` from paths.

**Add** separate workflow for appVersion updates:
```yaml
name: Update Helm Chart appVersion

on:
  push:
    branches:
      - main
    paths:
      - 'package.json'

jobs:
  update-appversion:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Update appVersion
        run: |
          VERSION=$(node -p "require('./package.json').version")
          sed -i "s/^appVersion: .*/appVersion: \"$VERSION\"/" helm/hive-mind/Chart.yaml

          git config user.name "github-actions"
          git config user.email "github-actions@users.noreply.github.com"
          git add helm/hive-mind/Chart.yaml
          git commit -m "chore: update chart appVersion to $VERSION"
          git push
```

### Pros
✅ Only releases when chart actually changes
✅ Follows Helm model perfectly
✅ No duplicate tag errors
✅ Clear separation of concerns

### Cons
⚠️ Creates commits automatically
⚠️ Triggers additional workflow runs
⚠️ Complex setup
⚠️ appVersion updates don't trigger releases

### Use Case
Limited applicability for this project.

---

## Solution 5: Hybrid Tagging Scheme

### Overview
Include both chart and app version in tag name.

### Implementation

Requires custom script or chart-releaser configuration:
```yaml
- name: Run chart-releaser
  uses: helm/chart-releaser-action@v1.6.0
  with:
    config: .github/chart-releaser-config.yaml
```

**Config file**:
```yaml
release-name-template: "{{ .Name }}-{{ .Version }}-app-{{ .AppVersion }}"
```

Result: `hive-mind-1.0.0-app-0.37.2`

### Pros
✅ Unique tags every time
✅ Clear version correlation
✅ Both versions visible

### Cons
❌ Non-standard Helm tag format
❌ May break Helm tooling
❌ Overly complex
❌ Not recommended by Helm community

### Use Case
Not recommended.

---

## Recommendation

### Immediate Fix: Solution 1 (skip_existing)

**Why**:
- Fixes the immediate CI failure
- Minimal risk
- Can be done in minutes
- Allows time to consider long-term approach

**Implementation**:
```yaml
skip_existing: true
```

### Long-term Fix: Solution 2 (Auto-increment) OR Solution 3 (Manual with validation)

**Choose Solution 2 if**:
- You want releases for every app version
- You want full automation
- Chart and app are tightly coupled
- User convenience > Helm purity

**Choose Solution 3 if**:
- Chart templates change independently
- You want standard Helm conventions
- You're willing to manage versions manually
- Semantic versioning is important

### Recommended Approach: Hybrid

1. **Immediate**: Apply Solution 1 (skip_existing) to unblock CI
2. **Next PR**: Decide between Solution 2 or 3 based on project needs
3. **Clean up**: Delete orphaned `hive-mind-1.0.0` release if using Solution 2

---

## Implementation Plan

### Phase 1: Immediate Fix (Solution 1)
```yaml
# Add to helm-release.yml
skip_existing: true
```
**Time**: 5 minutes
**Risk**: Very low
**Impact**: Unblocks CI

### Phase 2: Choose Long-term Strategy
**Decision Point**: Does chart template change with app version?
- **Usually Yes** → Solution 2 (Auto-increment)
- **Usually No** → Solution 3 (Manual + validation)

### Phase 3: Implementation
See `04-IMPLEMENTATION.md` for detailed steps.

---

## Comparison with Issue #828

### Issue #828: Missing gh-pages
- **Root Cause**: Missing infrastructure (branch)
- **Solution**: Create branch automatically
- **Type**: One-time setup problem
- **Fix**: Deterministic (add branch creation step)

### Issue #830: Duplicate tags
- **Root Cause**: Design mismatch (versioning strategy)
- **Solution**: Multiple valid approaches
- **Type**: Ongoing workflow design issue
- **Fix**: Requires architectural decision

Both issues relate to Helm chart release workflow, but #830 is more fundamental and requires strategic decision-making.
