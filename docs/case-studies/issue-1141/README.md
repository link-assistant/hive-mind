# Case Study: Issue #1141 - CI/CD Line Count Check Synchronization

## Summary

This case study documents a CI/CD failure on the main branch caused by `src/claude.lib.mjs` exceeding the 1500-line limit, while a PR that passed CI validation contributed to pushing the file over the limit.

## Timeline of Events

| Date       | Commit   | Event                                     | claude.lib.mjs Lines |
| ---------- | -------- | ----------------------------------------- | -------------------- |
| 2026-01-11 | -        | PR #1105 CI run #20889393003 passes       | 1495                 |
| 2026-01-14 | be6dabdb | Add timezone parsing feature              | 1494                 |
| 2026-01-15 | cf6a9998 | Merge main + add subagents option         | 1512 (over limit!)   |
| 2026-01-15 | 0b6f4c6c | Fix line count attempt                    | 1498                 |
| 2026-01-19 | 593aa64e | Merge PR #1105 (issue #1104 fix)          | 1506 (over limit!)   |
| 2026-01-19 | -        | Main branch CI run #21128634082 **fails** | 1506                 |

## Root Cause Analysis

### Primary Root Cause: Stale Merge Preview

The fundamental issue is how GitHub Actions handles pull request CI checks:

1. When a PR is opened or synchronized, GitHub creates a synthetic merge commit (`refs/pull/{number}/merge`)
2. This merge commit is a **snapshot** that represents what the merge would look like **at that moment**
3. The `actions/checkout@v4` action checks out this merge preview for PR workflows
4. **The merge preview does NOT automatically update** when the base branch changes

**Critical Timeline Gap:**

```
Jan 11: PR #1105 opened/synced
        → GitHub creates merge preview (claude.lib.mjs = 1495 lines)
        → CI runs on merge preview → PASSES

[8 days pass - other PRs merge to main, adding lines to claude.lib.mjs]

Jan 19: PR #1105 merged (without re-running CI)
        → Actual merge result: claude.lib.mjs = 1506 lines
        → Push CI runs on actual merge → FAILS
```

### Why PR CI and Push CI Behaved Differently

**PR CI (January 11):**

- Checked out `refs/remotes/pull/1105/merge` (SHA: 5881b21c17f5)
- This was the merge preview from January 11
- `claude.lib.mjs` had 1495 lines in this snapshot
- Check passed

**Push CI (January 19):**

- Checked out the actual merge commit (SHA: 593aa64e)
- This included all changes from both the PR and 8 days of main branch updates
- `claude.lib.mjs` had 1506 lines in reality
- Check failed

### Evidence from CI Logs

**Passed CI Run #20889393003 (PR Branch):**

```
check-file-line-limits: [command]/usr/bin/git checkout --progress --force refs/remotes/pull/1105/merge
check-file-line-limits: ./src/claude.lib.mjs: 1495 lines
```

**Failed CI Run #21128634082 (Main Branch):**

```
detect-changes: Comparing HEAD^ to HEAD
check-file-line-limits: ./src/claude.lib.mjs: 1506 lines
check-file-line-limits: ERROR: ./src/claude.lib.mjs has 1506 lines, which exceeds the 1500 line limit!
```

## Solutions Implemented

### 1. Fresh Merge Simulation in CI Workflow

Added a step to `check-file-line-limits` and `lint` jobs that:

1. Only runs for PR events
2. Fetches the latest base branch
3. Merges it into the PR to simulate the actual merge result
4. Runs checks on the up-to-date merged state

This ensures PR CI validates the **actual** merge result, not a stale snapshot.

```yaml
- name: Simulate fresh merge with base branch (PR only)
  if: github.event_name == 'pull_request'
  env:
    BASE_REF: ${{ github.base_ref }}
  run: |
    git fetch origin "$BASE_REF"
    BEHIND_COUNT=$(git rev-list --count HEAD..origin/$BASE_REF)
    if [ "$BEHIND_COUNT" -gt 0 ]; then
      git merge origin/$BASE_REF --no-edit || exit 1
    fi
```

### 2. ESLint max-lines Rule

Added to `eslint.config.mjs`:

```javascript
'max-lines': ['error', { max: 1500, skipBlankLines: true, skipComments: true }]
```

This provides:

- Local development feedback via editor integration
- CI enforcement via `npm run lint`
- Alignment between ESLint and the workflow script check

### 3. Reduced claude.lib.mjs Below 1500 Lines

Extracted `handleClaudeRuntimeSwitch` function into `src/claude.runtime-switch.lib.mjs`:

- Before: 1506 lines
- After: 1354 lines

## Prevention Recommendations

For additional protection beyond the implemented fixes:

1. **Enable GitHub Merge Queue**: Ensures PRs are tested against the latest main before merge
2. **Require Linear History**: Force PRs to be rebased before merge
3. **Add Pre-commit Hook**: Check line counts locally before pushing
4. **Branch Protection**: Require branches to be up-to-date before merging

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

The CI failure was caused by GitHub's stale merge preview architecture, where a PR's CI validates against a snapshot taken when the PR was opened/synchronized, not when it's actually merged. This can lead to situations where a PR passes validation but causes failures when merged with newer changes.

The fix involves:

1. Simulating a fresh merge in PR CI workflows to validate against the current base branch state
2. Adding ESLint rules for additional protection during local development
3. Reducing file sizes to be safely under the limit
4. Considering stricter merge policies (merge queues, branch protection) to prevent future occurrences
