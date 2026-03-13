# Case Study: Dockerfile Changes Don't Trigger Docker Image Rebuild

**Issue:** [#1423](https://github.com/link-assistant/hive-mind/issues/1423)
**PR:** [#1424](https://github.com/link-assistant/hive-mind/pull/1424)
**Date:** 2026-03-13
**Status:** Fix Implemented

---

## Executive Summary

When PR #1420 was merged to `main` (commit `14fdb8bd`), it changed both `Dockerfile` and `coolify/Dockerfile` to fix the `/home/hive/.config` permission error (issue #1419). Despite these Dockerfile changes, all Docker-related jobs were skipped in the resulting CI run ([actions/runs/23040959919](https://github.com/link-assistant/hive-mind/actions/runs/23040959919)). No Docker image rebuild occurred.

**Root Cause:** The `scripts/detect-code-changes.mjs` script correctly detected `docker=true` but output `code=false` for the same commit. The `codePattern` regex (`/\.(mjs|json|yml|yaml)$|\.github\/workflows\//`) matches only files with specific extensions or workflow paths. `Dockerfile` has no extension, so it was not matched as a "code change." All downstream test jobs and the `release` job require `any-code-changed == 'true'`, so they were all skipped — and since `docker-publish` depends on `release`, no Docker image was published.

**Fix:** Update the `release` job condition in `.github/workflows/release.yml` to also trigger when `docker-changed == 'true'`, accepting `skipped` (not just `success`) for test jobs that were not needed for a Docker-only change. This directly configures CI/CD to react to `docker=true` — without misclassifying Dockerfile as a "code" file.

---

## Problem Statement

After merging PR #1420 (`fix: prevent root from polluting /home/hive/.config during Docker build`), the Dockerfiles were changed to ensure correct file ownership. However, the Docker images were never rebuilt and the fix was not published. This was discovered in issue #1423.

The affected CI run: [actions/runs/23040959919](https://github.com/link-assistant/hive-mind/actions/runs/23040959919)

All Docker-related jobs showed **"skipped"** (0s duration):

- `Docker Publish (${{ matrix.platform }})` — skipped
- `Docker Publish (Merge)` — skipped
- `docker-pr-check` — skipped (N/A on push events)

---

## Timeline Reconstruction

### 2026-03-13: PR #1419 Fix and Merge

- PR #1420 merges commit `14fdb8bd` to `main`
- Changed files: `.gitkeep`, `Dockerfile`, `coolify/Dockerfile`, `docs/case-studies/issue-1419/README.md`
- CI run `23040959919` is triggered

### CI Run `23040959919` Execution

**Step 1: `detect-changes` job (SUCCESS, 9s)**

The `detect-code-changes.mjs` script ran and produced these outputs (from CI logs):

```
Changed files:
  .gitkeep
  Dockerfile
  coolify/Dockerfile
  docs/case-studies/issue-1419/README.md

mjs=false
package=false
docs=true
workflow=false
docker=true

Files considered as code changes:
  .gitkeep
  Dockerfile
  coolify/Dockerfile

code=false
```

Key observation: `docker=true` but `code=false`. The Dockerfiles were correctly identified for `docker` detection, but not for `code` detection.

**Step 2: Downstream jobs skipped**

Because `any-code-changed == 'false'` and `workflow-changed == 'false'`:

- `test-compilation` — **skipped** (requires `any-code-changed == 'true'`)
- `test-suites` — **skipped** (requires `test-compilation` success)
- `test-execution` — **skipped** (requires `test-compilation` success)
- `memory-check-linux` — **skipped** (requires `any-code-changed == 'true'`)
- `Release` — **skipped** (requires all test jobs to succeed)
- `Docker Publish` — **skipped** (requires `release` success and published)
- `Docker Publish (Merge)` — **skipped** (requires `docker-publish` success)

---

## Root Cause Analysis

### Primary Root Cause: `codePattern` Regex Excludes Extensionless Files

In `scripts/detect-code-changes.mjs`, two separate detections occur for Docker files:

**Detection 1 — `docker` output (correct):**

```js
const dockerPattern = /^(Dockerfile|coolify\/Dockerfile|\.dockerignore)$/;
const dockerChanged = changedFiles.some(file => dockerPattern.test(file));
setOutput('docker', dockerChanged ? 'true' : 'false');
```

**Detection 2 — `code` output (broken):**

```js
// After filtering out .md, .changeset/, docs/, experiments/, data/
const codePattern = /\.(mjs|json|yml|yaml)$|\.github\/workflows\//;
const codeChanged = codeChangedFiles.some(file => codePattern.test(file));
setOutput('code', codeChanged ? 'true' : 'false');
```

The `codePattern` regex only matches:

- `.mjs` files
- `.json` files
- `.yml` / `.yaml` files
- Files under `.github/workflows/`

`Dockerfile` has **no file extension**. It is not under `.github/workflows/`. Therefore `codePattern.test('Dockerfile')` returns `false`.

### Why `.gitkeep` Also Failed

`.gitkeep` (which changes when placeholders are updated) also has no extension. It too fails the `codePattern` test. However, `.gitkeep` changes are intentionally trivial, so this is not a problem worth fixing.

### The Dependency Chain

The full dependency chain that causes Docker rebuilds to be skipped:

```
Dockerfile changed
      ↓
detect-code-changes.mjs
  docker=true   ← correctly detected
  code=false    ← BUG: Dockerfile doesn't match codePattern

      ↓ code=false

test-compilation  → skipped (needs any-code-changed == 'true')
test-suites       → skipped (needs test-compilation success)
test-execution    → skipped (needs test-compilation success)
memory-check-linux→ skipped (needs any-code-changed == 'true')

      ↓ all skipped

release           → skipped (needs lint + test-suites + test-execution + memory-check-linux)

      ↓ release skipped

docker-publish    → skipped (needs release.result == 'success' && published == 'true')
docker-publish-merge → skipped (needs docker-publish success)
```

### Why `docker-changed` Alone Is Not Sufficient (Naively)

The `docker-publish` job intentionally depends on `release` because Docker images are tagged with the npm package version (e.g., `konard/hive-mind:1.30.5`). Publishing a Docker image without a corresponding npm release would result in version mismatches.

The `release` job requires that test jobs (`test-suites`, `test-execution`, `memory-check-linux`) all succeed. When only Docker files change, these test jobs are rightly skipped (they test JavaScript code, not Docker images). The release job was requiring `success` — but `skipped` is also an acceptable result when there's nothing to test.

Therefore, the correct fix is to update the `release` job condition to:

1. Accept `skipped` as well as `success` for test/lint jobs (they were skipped because no code changed — that is correct and acceptable).
2. Also trigger when `docker-changed == 'true'`, not only when `any-code-changed == 'true'`.

---

## Fix Applied (PR #1424)

### `.github/workflows/release.yml`

The `release` job condition was updated to accept `skipped` for test jobs and also trigger on `docker-changed == 'true'`:

**Before:**

```yaml
release:
  needs: [detect-changes, lint, test-suites, test-execution, memory-check-linux]
  if: always() && github.ref == 'refs/heads/main' && github.event_name == 'push' &&
    needs.lint.result == 'success' &&
    needs.test-suites.result == 'success' &&
    needs.test-execution.result == 'success' &&
    needs.memory-check-linux.result == 'success'
```

**After:**

```yaml
release:
  needs: [detect-changes, lint, test-suites, test-execution, memory-check-linux]
  if: |
    always() &&
    github.ref == 'refs/heads/main' &&
    github.event_name == 'push' &&
    !contains(needs.*.result, 'failure') &&
    (needs.lint.result == 'success' || needs.lint.result == 'skipped') &&
    (needs.test-suites.result == 'success' || needs.test-suites.result == 'skipped') &&
    (needs.test-execution.result == 'success' || needs.test-execution.result == 'skipped') &&
    (needs.memory-check-linux.result == 'success' || needs.memory-check-linux.result == 'skipped') &&
    (needs.detect-changes.outputs.any-code-changed == 'true' ||
     needs.detect-changes.outputs.docker-changed == 'true' ||
     needs.detect-changes.outputs.workflow-changed == 'true')
```

Key changes:

- **`skipped` is now accepted** for test/lint jobs — correct when those jobs were intentionally skipped.
- **`docker-changed == 'true'` triggers release** — directly reacting to Docker file changes.
- **`!contains(needs.*.result, 'failure')`** — ensures that if any job actually ran and failed, release is blocked.
- **`any-code-changed || docker-changed || workflow-changed`** — prevents release on docs-only pushes.

### Why This Approach Is Better

- **Architecturally correct**: Dockerfiles are Docker artifacts, not JavaScript code. The `docker=true` signal already correctly identifies them. CI/CD should react to that signal directly.
- **No duplication**: Avoids adding Docker file patterns to `codePattern` (which would create two places to maintain the same list of Docker files).
- **Explicit intent**: The `release` job now explicitly states that Docker changes are releasable, rather than relying on an indirect hack in change detection.
- **Safe**: Tests can only be skipped if they were never triggered — i.e., `code=false`. If they were triggered and failed, release is still blocked.

---

## Verification

After the fix, a commit that changes only `Dockerfile` will produce:

```
Changed files:
  Dockerfile

docker=true
code=false   ← still false (Dockerfile is not JS code — correct)

→ test-compilation SKIPPED (no code changed — correct)
→ test-suites SKIPPED (no code changed — correct)
→ release RUNS (docker-changed=true, no failures — fixed!)
→ docker-publish RUNS
```

Before the fix:

```
release condition: needs.test-suites.result == 'success'  → false (it was skipped)
→ release SKIPPED ← BUG
```

After the fix:

```
release condition: (needs.test-suites.result == 'success' || needs.test-suites.result == 'skipped') && docker-changed == 'true'
→ release RUNS ← FIXED
```

---

## Lessons Learned

1. **React to the right signal.** The `docker=true` signal was already correct. The bug was that `release` only reacted to `code=true`. The fix is to teach `release` to also react to `docker=true`, not to misclassify Docker files as code.

2. **`skipped` vs `failure` matters.** GitHub Actions job results are `success`, `failure`, `cancelled`, or `skipped`. A job that was intentionally not triggered (no code to test) returns `skipped` — which is a good outcome. Requiring `== 'success'` for jobs that are legitimately skipped silently blocks the pipeline.

3. **Silent skips are harder to detect than failures.** When jobs are skipped, the CI run still shows `✓ success` overall (if no job explicitly fails). The missing Docker rebuild was only noticed when the container still had the bug after the fix was merged.

4. **Publish pipelines have implicit assumptions about release coupling.** The Docker publish job is correctly coupled to npm release. The fix ensures the release pipeline is triggered for Docker changes, not that the coupling is bypassed.
