# Case Study: Issue #1559 — Fix CI/CD error, to make all releases pass

## Summary

CI/CD pipeline failed on the `main` branch after merging PR #1546 (issue #1545 — isolation screen session monitoring tests). The `lint` job failed because the jscpd code duplication checker found 11.03% duplicated lines, exceeding the configured 11% threshold.

## Timeline

1. **2026-04-10T16:41:48Z** — Push to `main` (commit `93959bd7`) triggered CI workflow run [#24253636325](https://github.com/link-assistant/hive-mind/actions/runs/24253636325)
2. **2026-04-10T16:42:51Z** — `lint` job failed at the "Run code duplication check" step
3. The merge of PR #1546 introduced two new test files with duplicated assert/summary patterns that pushed duplication over threshold

## Root Cause Analysis

### Direct Cause

The jscpd code duplication checker reported **11.03%** duplicated lines (6998 out of 63419), exceeding the **11% threshold** configured in `.jscpd.json`.

### Contributing Factors

PR #1546 added two new test files:

- `tests/test-isolation-screen-fallback-1545.mjs` (87 lines)
- `tests/test-isolation-screen-integration-1545.mjs` (194 lines)

These files contained duplicated boilerplate patterns that are common across the test suite:

1. **`assert(condition, message)` function** — duplicated in 3+ test files (8 lines each)
2. **Results/summary block** — duplicated in 3+ test files (7 lines each)
3. **`skip(message)` function** — duplicated in 2+ test files (4 lines each)

The codebase already had a shared test helper (`tests/test-helpers.mjs`) with `test()`, `asyncTest()`, `printSummary()`, and `getFailCount()` exports, but many test files did not use it. The new files followed the existing (duplicated) pattern instead of using the shared helper.

### Evidence

From CI logs (`ci-run-24253636325.log`):

```
ERROR: jscpd found too many duplicates (11.03%) over threshold (11%)
```

jscpd report summary:
| Metric | Value |
|--------|-------|
| Files analyzed | 229 |
| Total lines | 63,419 |
| Clones found | 622 |
| Duplicated lines | 6,998 (11.03%) |

Specific duplications involving new files:

- `test-isolation-screen-fallback-1545.mjs` <-> `test-session-monitor-isolation.mjs`: 38 lines across 3 clone pairs
- `test-isolation-screen-integration-1545.mjs` <-> `test-session-monitor-isolation.mjs`: 21 lines across 2 clone pairs
- `src/isolation-runner.lib.mjs` <-> `src/youtrack/youtrack.lib.mjs`: 7 lines (import pattern)

## Solution

### Approach

Extended the existing shared test helper (`tests/test-helpers.mjs`) with `assert()`, `skip()` functions that match the pattern used across test files, then refactored the three most duplicated test files to use these shared helpers.

### Changes

1. **`tests/test-helpers.mjs`** — Added `assert(condition, message)`, `skip(message)` exports; updated `printSummary()` to support skip counts and configurable separator width
2. **`tests/test-isolation-screen-fallback-1545.mjs`** — Replaced inline `assert` function and results block with imports from `test-helpers.mjs`
3. **`tests/test-isolation-screen-integration-1545.mjs`** — Replaced inline `assert`, `skip` functions and results block with imports from `test-helpers.mjs`
4. **`tests/test-session-monitor-isolation.mjs`** — Replaced inline `assert` function and results block with imports from `test-helpers.mjs`

### Result

| Metric           | Before         | After          | Change             |
| ---------------- | -------------- | -------------- | ------------------ |
| Duplicated lines | 6,998 (11.03%) | 6,925 (10.93%) | -73 lines (-0.10%) |
| Clones found     | 622            | 616            | -6 clones          |
| Total lines      | 63,419         | 63,381         | -38 lines          |

Duplication is now **10.93%**, safely below the **11% threshold**.

## Lessons Learned

1. **Use shared helpers**: The codebase has `tests/test-helpers.mjs` but many test files don't use it. New tests should import from this shared module instead of duplicating boilerplate.
2. **Monitor duplication trends**: The threshold was only barely exceeded (0.03% over). Regular monitoring of duplication trends could catch these issues before they block CI.
3. **PR review checklist**: PRs adding test files should be checked for use of shared test utilities.

## References

- Issue: https://github.com/link-assistant/hive-mind/issues/1559
- Failing CI run: https://github.com/link-assistant/hive-mind/actions/runs/24253636325
- PR #1546 that introduced the threshold breach: https://github.com/link-assistant/hive-mind/pull/1546
- jscpd configuration: `.jscpd.json` (threshold: 11%, minTokens: 30, minLines: 5)
