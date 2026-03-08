# Case Study: Issue #1399 — No CI Checks Not Treated as "Ready to Merge"

## Overview

**Issue:** https://github.com/link-assistant/hive-mind/issues/1399
**PR:** https://github.com/link-assistant/hive-mind/pull/1400
**Affected PR:** https://github.com/konard/links-visuals/pull/5
**Full log:** stored in `./full.log` (19,001 lines)

When `solve` ran with `--auto-restart-until-mergeable` on a repository that only has GitHub Pages deployment configured (no user-defined CI workflows), it got stuck in an infinite loop waiting for `pages-build-deployment` CI to complete — instead of correctly identifying the PR as "ready to merge".

---

## Timeline Reconstruction

| Timestamp (UTC)     | Event                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| 2026-03-07 23:53:13 | `solve` starts for `konard/links-visuals` issue #3, with `--auto-restart-until-mergeable` |
| 2026-03-07 23:53:24 | Branch `issue-3-57a79ede43e6` created; draft PR #5 created                                |
| 2026-03-07 23:56:38 | First Claude session completes the SVG z-ordering fix                                     |
| 2026-03-07 23:56:38 | Uncommitted changes (`docs/`) detected; second Claude session starts                      |
| 2026-03-07 23:58:00 | Second session commits screenshot; PR marked ready for review                             |
| 2026-03-07 23:58:09 | `AUTO-RESTART-UNTIL-MERGEABLE MODE ACTIVE` begins polling PR #5                           |
| 2026-03-07 23:58:13 | **Check #1:** `Waiting for CI: pages-build-deployment`                                    |
| 2026-03-07 23:59:13 | **Check #2:** `Waiting for CI: pages-build-deployment`                                    |
| 2026-03-08 00:00:17 | **Check #3:** `Waiting for CI: pages-build-deployment`                                    |
| 2026-03-08 00:01:21 | **Check #4:** `Waiting for CI: pages-build-deployment`                                    |
| 2026-03-08 00:01:50 | User presses Ctrl+C — `ERROR: Interrupted (CTRL+C)`                                       |

The loop never posted a "Ready to merge" comment. It would have continued indefinitely without user intervention.

---

## Root Cause Analysis

### The Affected Repository

**`konard/links-visuals`** is a small repository with:

- **No user-defined CI workflows** (no `.github/workflows/*.yml` files)
- **GitHub Pages enabled** — which causes GitHub to auto-create a special workflow named `pages-build-deployment` at path `dynamic/pages/pages-build-deployment`
- PR #5 had `mergeStateStatus: CLEAN` and `statusCheckRollup: []` (empty)

### Step-by-Step Bug Flow

```
1. getDetailedCIStatus() queries:
   GET /repos/konard/links-visuals/commits/{sha}/check-runs
   → Returns: { total_count: 0, check_runs: [] }

2. getDetailedCIStatus() returns: { status: 'no_checks', checks: [] }

3. getMergeBlockers() sees status === 'no_checks'
   → Calls checkPRMergeable() → returns { mergeable: true }  (mergeStateStatus=CLEAN)

4. getMergeBlockers() checks getActiveRepoWorkflows():
   GET /repos/konard/links-visuals/actions/workflows
   → Returns: [{ name: 'pages-build-deployment', path: 'dynamic/pages/pages-build-deployment', state: 'active' }]

5. repoWorkflows.hasWorkflows === true
   → getMergeBlockers() adds ci_pending blocker: "CI hasn't started yet (1 workflow configured)"
   → Returns { blockers: [ci_pending], noCiConfigured: false }

6. watchUntilMergeable() sees blockers.length > 0
   → Waits 60 seconds, loops forever (INFINITE LOOP)
```

### Why `pages-build-deployment` Is Different

The `pages-build-deployment` workflow is a **GitHub Pages internal deployment workflow**:

- **Path:** `dynamic/pages/pages-build-deployment` (not `.github/workflows/`)
- **Trigger:** Runs only on the **default branch** (e.g., `main`) **after a merge**, NOT on PR branches
- **Effect:** Never produces check runs for a PR's head SHA
- **Purpose:** Deploys the GitHub Pages site to `github.io` — not a CI validation check

Because it never creates check runs on PR branches, any loop waiting for it to appear in `check-runs` will wait forever.

### The Missing Distinction

The code in `getActiveRepoWorkflows` (github-merge.lib.mjs:1411) was designed to distinguish:

- Repos with NO CI → treat as "no CI configured"
- Repos with CI workflows → treat empty check-runs as a race condition (CI hasn't started)

But it failed to distinguish between:

- User-defined CI workflows in `.github/workflows/` that run on PRs
- System-generated deployment workflows in `dynamic/pages/` that only run on default branch

### Bug Chain

```
Issue #1345 fix: no_checks + MERGEABLE → noCiConfigured=true (exits loop correctly)
Issue #1363 fix: no_checks + MERGEABLE + hasWorkflows → ci_pending (prevents false positive)
Issue #1399 bug: pages-build-deployment counted as "hasWorkflow" but never runs on PRs
```

---

## Evidence

### PR #5 API Response

```json
{
  "title": "fix: reorder SVG circles so start (green) is above center but below end (red)",
  "state": "open",
  "mergeable": true,
  "mergeStateStatus": "CLEAN",
  "statusCheckRollup": []
}
```

### Check Suites (queued, 0 runs)

Three check suites existed but all had `latest_check_runs_count: 0`:

- GitHub Pages (queued, no conclusion)
- Vercel (queued, no conclusion)
- Cursor (queued, no conclusion)

### Active Workflows

```json
{
  "total_count": 1,
  "workflows": [
    {
      "id": 144453964,
      "name": "pages-build-deployment",
      "path": "dynamic/pages/pages-build-deployment",
      "state": "active"
    }
  ]
}
```

Note: `path` is `dynamic/pages/pages-build-deployment`, not a `.github/workflows/` path.

### Log Evidence (lines 18981–18994)

```
[2026-03-07T23:58:13.481Z] [INFO]   Waiting for CI: pages-build-deployment
[2026-03-07T23:59:17.568Z] [INFO]   Waiting for CI: pages-build-deployment
[2026-03-08T00:00:21.877Z] [INFO]   Waiting for CI: pages-build-deployment
[2026-03-08T00:01:25.709Z] [INFO]   Waiting for CI: pages-build-deployment
[2026-03-08T00:01:50.720Z] [ERROR]  Interrupted (CTRL+C)
```

---

## Fix

### Approach

Filter out GitHub Pages deployment workflows from `getActiveRepoWorkflows()` when determining whether a repo has "real" CI workflows that would produce PR checks. GitHub Pages deployment workflows are identified by their path starting with `dynamic/pages/`.

### Implementation

In `src/github-merge.lib.mjs`, modify `getActiveRepoWorkflows()` to filter out workflows with `dynamic/pages/` prefix in their path, as these are GitHub Pages internal workflows that never run on PR branches.

**File:** `src/github-merge.lib.mjs`
**Function:** `getActiveRepoWorkflows` (line 1411)

**Change:** After fetching workflows, filter them to exclude those with paths starting with `dynamic/pages/` (GitHub Pages internal workflows):

```javascript
// Filter out GitHub Pages deployment workflows - they only run on the default
// branch after merge (path: dynamic/pages/pages-build-deployment) and never
// create check-runs on PR branches. Including them causes infinite loops when
// waiting for PR CI that will never appear.
// @see https://github.com/link-assistant/hive-mind/issues/1399
const prWorkflows = workflows.filter(wf => !wf.path.startsWith('dynamic/pages/'));
```

---

## Related Issues

- **Issue #1345:** "No CI checks" caused infinite loop — fixed by checking `mergeStateStatus=CLEAN` before concluding "no CI configured"
- **Issue #1363:** False positive "Ready to merge" for repos WITH CI workflows but NO branch protection — fixed by checking `getActiveRepoWorkflows()`
- **Issue #1399:** (this issue) GitHub Pages deployment workflow (`dynamic/pages/`) counted as "a CI workflow" causing infinite loop

---

## External References

- [GitHub Pages deployment stuck in deployment_queued](https://github.com/orgs/community/discussions/184211)
- [Pages build and deployment queued for 10 hours](https://github.com/orgs/community/discussions/49074)
- [GitHub Actions workflow `pages-build-deployment` documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-github-pages)
- [GitHub REST API: List repository workflows](https://docs.github.com/en/rest/actions/workflows#list-repository-workflows)
- [GitHub check suites API](https://docs.github.com/en/rest/checks/suites)

---

## Recommendations for Future Improvements

1. **Log the workflow paths** in `getActiveRepoWorkflows` verbose output so future debugging is easier.
2. **Add a maximum timeout** to `watchUntilMergeable` as a safety net (e.g., 4 hours) to prevent infinite loops even if new edge cases arise.
3. **Log the `mergeStateStatus`** at each polling cycle to make the state machine transparent in logs.
4. Consider also filtering workflows that only trigger on `push` to protected branches (not `pull_request`), though this requires parsing workflow YAML files which is more complex.
