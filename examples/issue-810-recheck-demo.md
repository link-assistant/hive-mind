# Issue #810 - Queue Item Recheck Demo

This document demonstrates how the queue item rechecking feature works in the hive command.

## Problem Statement

When running hive with concurrent workers and a large queue, conditions can change between when an issue is queued and when it's processed:

1. **Issue gets closed** - Someone manually closes the issue
2. **PR is created** - Another worker or developer creates a PR for the same issue
3. **Repository archived** - The repository becomes archived

Without rechecking, workers would waste time and resources processing issues that should be skipped.

## Solution

The `recheckIssueConditions()` function checks all relevant conditions right before processing:

### Flow Diagram

```
Issue Queue (100 items)
    ↓
Worker dequeues issue #90
    ↓
[NEW] Recheck Conditions:
  1. Is issue still open? ✓
  2. Does issue have PRs? ✓ (if --skip-issues-with-prs)
  3. Is repo archived? ✓
    ↓
Decision:
  - If any check fails → Skip issue
  - If all checks pass → Process issue
    ↓
Spawn solve command
```

## Example Scenarios

### Scenario 1: Issue Closed Between Queue and Processing

```bash
# Start hive with 2 workers, 100 issues in queue
$ hive https://github.com/owner/repo --concurrency 2 --max-issues 100

# Timeline:
# T=0: Issue #50 added to queue (status: open)
# T=30s: Someone closes issue #50
# T=60s: Worker picks up issue #50 from queue
#
# OLD BEHAVIOR: Worker processes closed issue (waste of resources)
# NEW BEHAVIOR: Worker rechecks, sees it's closed, skips it
```

Output with new behavior:

```
👷 Worker 1 processing: https://github.com/owner/repo/issues/50
   🔍 Rechecking conditions for issue #50...
   ❌ Issue is now closed
   ⏭️  Skipping issue: Issue is now closed
   📊 Queue: 48 waiting, 2 processing, 50 completed, 0 failed
```

### Scenario 2: PR Created While Issue in Queue

```bash
# Start hive with --skip-issues-with-prs
$ hive https://github.com/owner/repo --skip-issues-with-prs --concurrency 2

# Timeline:
# T=0: Issue #75 added to queue (no PRs)
# T=45s: Developer creates PR for issue #75
# T=90s: Worker picks up issue #75
#
# NEW BEHAVIOR: Worker rechecks, sees PR exists, skips it
```

Output:

```
👷 Worker 2 processing: https://github.com/owner/repo/issues/75
   🔍 Rechecking conditions for issue #75...
   ✅ Issue is still open
   ❌ Issue now has 1 open PR
   ⏭️  Skipping issue: Issue now has 1 open PR
   📊 Queue: 23 waiting, 2 processing, 75 completed, 0 failed
```

### Scenario 3: Repository Archived

```bash
$ hive https://github.com/owner --concurrency 2

# Timeline:
# T=0: Issue from repo-alpha added to queue
# T=60s: Admin archives repo-alpha
# T=120s: Worker picks up issue
#
# NEW BEHAVIOR: Worker rechecks, sees repo is archived, skips it
```

Output:

```
👷 Worker 1 processing: https://github.com/owner/repo-alpha/issues/10
   🔍 Rechecking conditions for issue #10...
   ✅ Issue is still open
   ✅ Issue still has no open PRs
   ❌ Repository is now archived
   ⏭️  Skipping issue: Repository is now archived
   📊 Queue: 95 waiting, 2 processing, 5 completed, 0 failed
```

## Performance Impact

The recheck adds minimal overhead:

- **Issue state check**: 1 GitHub API call (~100ms)
- **PR check**: Only if `--skip-issues-with-prs` is enabled (batched GraphQL, ~200ms)
- **Archive check**: Batched GraphQL (~200ms)

**Total**: ~300-500ms per issue (negligible compared to typical solve time of 5-15 minutes)

## Error Handling

The recheck uses "fail open" philosophy - if the recheck fails, the issue is still processed:

```javascript
// If any error occurs during recheck
catch (error) {
  log('⚠️  Error rechecking conditions: ' + error.message);
  return { shouldProcess: true }; // Allow processing on error
}
```

This ensures that temporary GitHub API issues don't block legitimate work.

## Testing

Run the validation script:

```bash
node experiments/test-issue-recheck.mjs
```

## Benefits

1. **Resource Efficiency**: Don't waste AI model tokens on closed issues
2. **Cost Savings**: Avoid unnecessary solve command execution
3. **Better UX**: No duplicate PRs or work on archived repos
4. **Graceful Handling**: Skip conditions updated dynamically
