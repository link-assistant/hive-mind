# Case Study: Dockerfile Changes Don't Trigger Docker Image Rebuild

**Issue:** [#1423](https://github.com/link-assistant/hive-mind/issues/1423)
**PR:** [#1424](https://github.com/link-assistant/hive-mind/pull/1424)
**Date:** 2026-03-13
**Status:** Fix Implemented

---

## Executive Summary

When PR #1420 was merged to `main` (commit `14fdb8bd`), it changed both `Dockerfile` and `coolify/Dockerfile` to fix the `/home/hive/.config` permission error (issue #1419). Despite these Dockerfile changes, all Docker-related jobs were skipped in the resulting CI run ([actions/runs/23040959919](https://github.com/link-assistant/hive-mind/actions/runs/23040959919)). No Docker image rebuild occurred.

**Root Cause:** The `scripts/detect-code-changes.mjs` script correctly detected `docker=true` but output `code=false` for the same commit. The `codePattern` regex (`/\.(mjs|json|yml|yaml)$|\.github\/workflows\//`) matches only files with specific extensions or workflow paths. `Dockerfile` has no extension, so it was not matched as a "code change." All downstream test jobs and the `release` job require `any-code-changed == 'true'`, so they were all skipped — and since `docker-publish` depends on `release`, no Docker image was published.

**Fix:** Extend the `codePattern` regex in `detect-code-changes.mjs` to also match `Dockerfile`, `coolify/Dockerfile`, and `.dockerignore`. This makes Dockerfile-only commits produce `code=true`, which unblocks the full test → release → Docker publish pipeline.

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

### Why `docker-changed` Alone Is Not Sufficient

The `docker-publish` job intentionally depends on `release` because Docker images are tagged with the npm package version (e.g., `konard/hive-mind:1.30.5`). Publishing a Docker image without a corresponding npm release would result in version mismatches.

Therefore, the correct fix is to ensure that Dockerfile changes are included in `code=true` so that the full test → release → Docker pipeline runs.

---

## Fix Applied (PR #1424)

### `scripts/detect-code-changes.mjs`

The `codePattern` regex was extended to also match Docker-related files:

**Before:**

```js
// Check if any code files changed (.mjs, .json, .yml, .yaml, or workflow files)
const codePattern = /\.(mjs|json|yml|yaml)$|\.github\/workflows\//;
```

**After:**

```js
// Check if any code files changed (.mjs, .json, .yml, .yaml, workflow files, or Docker files)
const codePattern = /\.(mjs|json|yml|yaml)$|\.github\/workflows\/|^(Dockerfile|coolify\/Dockerfile|\.dockerignore)$/;
```

This ensures that commits touching only Dockerfiles produce `code=true`, triggering the full CI → release → Docker publish pipeline.

### Why This Approach

- **Minimal change**: Only the regex is modified; no workflow logic changes required.
- **Correct semantics**: Dockerfile changes are real code changes that affect the published artifact. They require tests to run and a new release to be published.
- **Consistent**: The same docker file patterns from `dockerPattern` are reused in `codePattern`.
- **No false negatives**: `.dockerignore` and `coolify/Dockerfile` are also covered.

---

## Verification

After the fix, a commit that changes only `Dockerfile` will produce:

```
Changed files:
  Dockerfile

docker=true
code=true   ← now correctly set to true

→ test-compilation runs
→ test-suites runs
→ release runs (if changesets present)
→ docker-publish runs
```

---

## Lessons Learned

1. **Two detection systems for the same files can diverge.** The `dockerPattern` and `codePattern` detect the same Docker files via separate regexes. This duplication created a gap where Docker files were "known" to the docker detector but "invisible" to the code detector.

2. **Extensionless files are a regex edge case.** Most file-based CI conditions use extension matching (`*.mjs`, `*.json`). Files without extensions (`Dockerfile`, `Makefile`, `.gitkeep`) require explicit pattern matching.

3. **Silent skips are harder to detect than failures.** When jobs are skipped, the CI run still shows `✓ success` overall (if no job explicitly fails). The missing Docker rebuild was only noticed when the container still had the bug after the fix was merged.

4. **Publish pipelines have implicit assumptions about release coupling.** The Docker publish job is correctly coupled to npm release. The fix must ensure the release pipeline is triggered, not bypass the coupling.
