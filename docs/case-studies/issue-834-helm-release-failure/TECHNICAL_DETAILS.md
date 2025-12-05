# Technical Deep Dive: chart-releaser-action v1.6.0 Bug

## Bug Analysis

### Problematic Code (v1.6.0)

Located in `cr.sh` at line 109:

```bash
#!/usr/bin/env bash

set -o errexit
set -o nounset  # THIS IS KEY - fails on undefined variables
set -o pipefail

# ... earlier code ...

if [[ -z "$skip_packaging" ]]; then
    local latest_tag  # Variable scoped INSIDE the if block
    latest_tag=$(lookup_latest_tag)

    echo "Looking up charts..."
    changed_charts=$(lookup_changed_charts "$latest_tag")

    if [[ -n "$changed_charts" ]]; then
        # ... packaging logic ...
    fi
else
    echo "Skipping packaging"
fi

# LINE 109 - OUTSIDE THE IF BLOCK
# This fails when skip_packaging is set because latest_tag was never defined
echo "chart_version=${latest_tag}" >chart_version.txt
```

### The lookup_latest_tag Function

```bash
lookup_latest_tag() {
    git fetch --tags >/dev/null 2>&1

    if ! git describe --tags --abbrev=0 HEAD~ 2>/dev/null; then
        git rev-list --max-parents=0 --first-parent HEAD
    fi
}
```

**Behavior:**
- Fetches tags from remote
- Attempts to describe the latest tag on HEAD~
- Falls back to first commit hash if no tags exist
- Returns empty string in certain edge cases

### Why Our Configuration Triggers the Bug

Our workflow configuration:

```yaml
- name: Run chart-releaser
  uses: helm/chart-releaser-action@v1.6.0
  with:
    charts_dir: helm
    skip_packaging: true    # <-- TRIGGERS THE BUG
    skip_existing: true
```

**Flow when skip_packaging=true:**

1. Script evaluates `if [[ -z "$skip_packaging" ]]` → FALSE
2. Skips the entire if block
3. `latest_tag` is never declared or assigned
4. Script reaches line 109: `echo "chart_version=${latest_tag}"`
5. Bash's `set -o nounset` detects undefined variable
6. Script exits with error code 1

### Why It Worked Without skip_packaging

**Flow when skip_packaging is NOT set:**

1. Script evaluates `if [[ -z "$skip_packaging" ]]` → TRUE
2. Enters if block
3. Declares `local latest_tag`
4. Assigns `latest_tag=$(lookup_latest_tag)`
5. Uses latest_tag for chart discovery
6. Line 109 can access latest_tag (though it's local to function scope - still a bug!)

**Note:** Even without skip_packaging, this code has a scope issue. The `local` keyword makes the variable function-scoped, but it "worked" in practice due to bash's behavior with local variables in the same function.

## The Fix (v1.7.0)

PR #202 implemented a conditional write:

```bash
# Only write chart_version if latest_tag is defined
if [[ -n "${latest_tag:-}" ]]; then
    echo "chart_version=${latest_tag}" >chart_version.txt
fi
```

**Key improvements:**
1. Uses `${latest_tag:-}` which expands to empty string if undefined (safe with set -u)
2. Only writes chart_version.txt if latest_tag has a value
3. Recognizes that chart_version isn't meaningful when packaging is skipped

## Alternative Approaches Considered

### 1. Declare variable at script level

```bash
#!/usr/bin/env bash
set -o errexit
set -o nounset
set -o pipefail

latest_tag=""  # Initialize at script level

# ... rest of script
```

**Pros:** Simple, ensures variable always exists
**Cons:** May hide logic issues, unnecessary when skip_packaging=true

### 2. Remove local keyword

```bash
if [[ -z "$skip_packaging" ]]; then
    latest_tag=$(lookup_latest_tag)  # No 'local' keyword
    # ...
fi
```

**Pros:** Variable accessible outside if block
**Cons:** Global variable pollution, not idiomatic bash

### 3. Skip output when not relevant (CHOSEN)

```bash
if [[ -n "${latest_tag:-}" ]]; then
    echo "chart_version=${latest_tag}" >chart_version.txt
fi
```

**Pros:**
- Only outputs when meaningful
- Safe with undefined variables
- Logically correct (no chart_version when we didn't look it up)

**Cons:** None significant

## Bash -u (nounset) Behavior Deep Dive

The `set -o nounset` option changes bash's default behavior:

### Default Bash Behavior
```bash
# Without set -u
unset myvar
echo "Value: $myvar"  # Prints "Value: " (empty string)
exit_code=$?          # 0 (success)
```

### With set -u
```bash
set -o nounset
unset myvar
echo "Value: $myvar"  # ERROR: myvar: unbound variable
exit_code=$?          # 1 (failure)
```

### Safe Parameter Expansion with set -u

```bash
set -o nounset

# These are all safe:
echo "${myvar:-}"           # Empty string if unset
echo "${myvar:-default}"    # "default" if unset
echo "${myvar:+value}"      # "value" if set, empty if unset
[[ -n "${myvar:-}" ]]       # Safe existence check
```

## Impact on CI/CD Pipeline

### What Succeeded Despite the Error

1. ✅ Helm chart linting
2. ✅ Chart packaging
3. ✅ Package creation in .cr-release-packages/
4. ✅ GitHub release creation (if chart was new)
5. ✅ Index file generation
6. ✅ Git commit to gh-pages
7. ✅ Git push to gh-pages

### What Failed

1. ❌ chart_version.txt output file creation
2. ❌ Workflow marked as failed
3. ❌ Subsequent workflow steps skipped (Deploy to GitHub Pages)
4. ❌ ArtifactHub metadata creation skipped

### Actual vs Perceived Impact

**Perceived Impact:** Complete workflow failure

**Actual Impact:**
- Chart was successfully packaged
- Index was updated and pushed
- Only metadata file creation failed
- Subsequent steps didn't run due to step failure

**Critical Missing:**
- GitHub Pages deployment step was skipped
- This means the index.yaml wasn't published via GitHub Pages action
- Chart might be in gh-pages branch but not served via GitHub Pages

## Testing Strategy

### Unit Test for the Fix

```bash
#!/usr/bin/env bash

test_skip_packaging_with_set_u() {
    set -o nounset

    skip_packaging="true"

    # Simulate the fixed code
    if [[ -n "${latest_tag:-}" ]]; then
        echo "chart_version=${latest_tag}" >chart_version.txt
    fi

    # Should not fail
    if [[ $? -eq 0 ]]; then
        echo "PASS: No error with undefined latest_tag"
        return 0
    else
        echo "FAIL: Error occurred"
        return 1
    fi
}

test_skip_packaging_with_set_u
```

### Integration Test

```yaml
name: Test Helm Release Fix

on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install Helm
        uses: azure/setup-helm@v4

      - name: Package chart
        run: |
          mkdir -p .cr-release-packages
          helm package helm/hive-mind -d .cr-release-packages

      - name: Test chart-releaser with skip_packaging
        uses: helm/chart-releaser-action@v1.7.0
        env:
          CR_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          charts_dir: helm
          skip_packaging: true
          skip_existing: true

      - name: Verify success
        run: echo "✅ Test passed - no unbound variable error"
```

## Lessons for Action Developers

1. **Always initialize variables used across scopes**
   ```bash
   # Good
   my_var=""
   if condition; then
       my_var="value"
   fi
   use "$my_var"

   # Bad
   if condition; then
       local my_var="value"  # Scoped inside if
   fi
   use "$my_var"  # May be undefined
   ```

2. **Use parameter expansion for safety**
   ```bash
   # Safe with set -u
   if [[ -n "${var:-}" ]]; then
       echo "var is set to: $var"
   fi
   ```

3. **Test with all combination of inputs**
   - Test with skip_packaging=true
   - Test with skip_packaging=false
   - Test with skip_packaging unset
   - Test with and without existing tags

4. **Consider strict mode implications**
   - `set -u` is great for catching bugs
   - But requires defensive programming
   - Document assumptions about variables

5. **Conditional outputs should check conditions**
   ```bash
   # Don't output chart_version if we didn't determine it
   if [[ -n "${latest_tag:-}" ]]; then
       echo "chart_version=${latest_tag}" >chart_version.txt
   fi
   ```

## Version Comparison

| Version | skip_packaging=true | skip_packaging=false | Notes |
|---------|-------------------|---------------------|--------|
| v1.5.0  | ✅ Works | ✅ Works | Before the bug |
| v1.6.0  | ❌ Fails | ✅ Works | Bug introduced in PR #130 |
| v1.7.0  | ✅ Works | ✅ Works | Fixed in PR #202 |

## References

- [Bash Parameter Expansion](https://www.gnu.org/software/bash/manual/html_node/Shell-Parameter-Expansion.html)
- [Bash Set Builtin](https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html)
- [helm/chart-releaser-action Issue #171](https://github.com/helm/chart-releaser-action/issues/171)
- [helm/chart-releaser-action PR #202](https://github.com/helm/chart-releaser-action/pull/202)
