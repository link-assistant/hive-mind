# Case Study: Issue #702 - PR Detection Race Condition

This directory contains a detailed case study of a race condition in the `/hive` command's PR detection logic.

## Quick Summary

**Problem:** The `/hive` command failed to skip issues #698 and #700 despite both having open PRs.

**Root Cause:** Race condition between PR creation and GitHub GraphQL API indexing of cross-reference events.

**Impact:** Issues with recently created PRs (< ~10 minutes old) may not be detected, causing duplicate work attempts.

## Files in This Directory

- **[CASE_STUDY.md](./CASE_STUDY.md)** - Complete detailed analysis with:
  - Executive summary
  - Timeline of events
  - Root cause analysis
  - 5 proposed solutions with pros/cons
  - Prevention guidelines
  - Testing recommendations

- **case-study-log.txt** - Original hive command output showing the bug

- **issue-698-data.json** - GraphQL response for issue #698 (showing current state)

- **issue-700-data.json** - GraphQL response for issue #700 (showing current state)

- **pr-699-data.json** - Complete PR #699 data

- **pr-701-data.json** - Complete PR #701 data

## Key Findings

1. **PRs were created 2-8 minutes before the check**, yet were not detected
2. **Cross-reference events were created within 1 second** of PR creation
3. **Events are now visible** in GraphQL queries (hours later)
4. **Conclusion:** GitHub's GraphQL API has an **indexing delay** for timeline events

## Recommended Solutions

### Immediate (Quick Fix)
Implement retry logic with exponential backoff for issues where no PR is found.

### Long-term
Implement hybrid approach that detects suspicious cases and uses heuristics to identify likely race conditions.

## Testing

Run the timing experiment to see if a PR is currently detectable:

```bash
node experiments/test-pr-detection-timing.mjs deep-assistant hive-mind 698 699
```

This will show:
- PR age
- Whether cross-reference events are present
- Whether the PR would be detected by current logic

## Related Code

- `src/github.batch.lib.mjs:21-157` - PR detection logic
- `src/hive.mjs:1194-1243` - PR filtering in fetchIssues()

## Issue Link

https://github.com/deep-assistant/hive-mind/issues/702
