# Case Study: Issue #1141 - CI/CD Line Count Check Synchronization

## Summary

This case study documents a CI/CD failure on the main branch caused by `src/claude.lib.mjs` exceeding the 1500-line limit, while a PR that passed CI validation contributed to pushing the file over the limit.

## Timeline of Events

| Date       | Commit   | Event                                     | claude.lib.mjs Lines |
| ---------- | -------- | ----------------------------------------- | -------------------- |
| 2026-01-11 | -        | PR CI run #20889393003 passes             | 1495                 |
| 2026-01-14 | be6dabdb | Add timezone parsing feature              | 1494                 |
| 2026-01-15 | cf6a9998 | Merge main + add subagents option         | 1512 (over limit!)   |
| 2026-01-15 | 0b6f4c6c | Fix line count attempt                    | 1498                 |
| 2026-01-19 | 593aa64e | Merge PR #1105 (issue #1104 fix)          | 1506 (over limit!)   |
| 2026-01-19 | -        | Main branch CI run #21128634082 **fails** | 1506                 |

## Root Cause Analysis

### Primary Issue: Race Condition Between PRs

1. **PR #1105** was developed against an older main branch where `claude.lib.mjs` had ~1495 lines
2. Meanwhile, other changes on main brought the file to 1498 lines (commit `0b6f4c6c`)
3. PR #1105 added 10 lines (+2 deletions = +8 net lines), which passed its own CI check because it was compared against the older base
4. When PR #1105 was merged, the combined changes pushed the file to **1506 lines**, exceeding the 1500-line limit
5. The main branch CI check ran after the merge and correctly failed

### Secondary Issue: No Pre-merge Rebase Check

The PR CI passed because:

- The check-file-line-limits job validates lines in the **PR branch**, not the **merged result**
- GitHub's merge queue or required merge checks before PR merge would have caught this
- Without these, a PR can pass CI while its merge result would fail

### Tertiary Issue: ESLint Not Configured for Max Lines

The ESLint configuration (`eslint.config.mjs`) does not include a `max-lines` rule, meaning:

- Only the CI workflow shell script checks file line limits
- ESLint could provide an additional layer of protection during local development
- The js-ai-driven-development-pipeline-template recommends 1000 lines as a best practice

## Evidence

### Failed CI Run #21128634082 (Main Branch)

```
check-file-line-limits UNKNOWN STEP 2026-01-19T07:16:51.3187312Z ./src/claude.lib.mjs: 1506 lines
check-file-line-limits UNKNOWN STEP 2026-01-19T07:16:51.3188051Z ERROR: ./src/claude.lib.mjs has 1506 lines, which exceeds the 1500 line limit!
check-file-line-limits UNKNOWN STEP 2026-01-19T07:16:51.3212602Z ##[error]File has 1506 lines (limit: 1500)
check-file-line-limits UNKNOWN STEP 2026-01-19T07:16:51.3845300Z ##[error]Process completed with exit code 1.
```

### Passed CI Run #20889393003 (PR Branch)

```
check-file-line-limits UNKNOWN STEP 2026-01-11T04:27:37.1404799Z ./src/claude.lib.mjs: 1495 lines
```

## Solutions Implemented

### 1. Reduce claude.lib.mjs Below 1500 Lines

Extract functionality into separate modules to bring the file under the limit. Candidates for extraction:

- Usage limit parsing logic
- Configuration constants
- Helper utilities

### 2. Add ESLint max-lines Rule

Add to `eslint.config.mjs`:

```javascript
'max-lines': ['error', { max: 1500, skipBlankLines: true, skipComments: true }]
```

This provides:

- Local development feedback via editor integration
- CI enforcement via `npm run lint`
- Alignment between ESLint and the workflow script check

### 3. Recommendations for Future Prevention

1. **Enable GitHub Merge Queue**: Ensures PRs are tested against the latest main before merge
2. **Require Linear History**: Force PRs to be rebased before merge
3. **Add Pre-merge Hook**: Check line counts locally before pushing

## Best Practices Reference

From [js-ai-driven-development-pipeline-template](https://github.com/link-foundation/js-ai-driven-development-pipeline-template):

> Scripts must stay under 1000 lines for maintainability.

The hive-mind repository uses a 1500-line limit, which is still reasonable but higher than the template's recommendation.

## Files

- `ci-logs/failed-run-21128634082.log` - Full CI log from failed main branch run
- `ci-logs/passed-run-20889393003.log` - Full CI log from passing PR run

## Related Issues

- Issue #1141: Make sure our lines count checks are synchronized in CI/CD
- Issue #1104: Price calculated by Anthropic was not extracted from json stream output
- PR #1105: fix: Preserve Anthropic cost when session ends with error_during_execution

## Conclusion

The CI failure was caused by a classic merge race condition where a PR passes validation against an older base branch but causes failures when merged with newer changes. The fix involves:

1. Reducing the file size to be safely under the limit
2. Adding ESLint rules for additional protection
3. Considering stricter merge policies to prevent future occurrences
