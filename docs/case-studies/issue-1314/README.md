# Case Study: Issue #1314 - `--auto-restart-until-mergeable` should adhere to limits of GitHub Actions

## Issue Summary

**Issue:** [#1314 - --auto-restart-until-mergeable should adhere to limits of GitHub Actions](https://github.com/link-assistant/hive-mind/issues/1314)

**Reference PR:** [unidel2035/btc#1436](https://github.com/unidel2035/btc/pull/1436) - Shows the billing limit error in action

**Root Cause:** The `--auto-restart-until-mergeable` mode does not detect when GitHub Actions jobs fail due to billing/spending limits, treating them as regular CI failures and potentially triggering unnecessary AI restarts.

## Problem Statement

When GitHub Actions workflows fail due to billing limits, the error message is:

```
The job was not started because recent account payments have failed or your spending limit needs to be increased
```

Current behavior:

1. The `--auto-restart-until-mergeable` mode detects CI failure and triggers an AI restart
2. The AI cannot fix billing issues - only humans can resolve payment/spending limit problems
3. This leads to wasted API credits and an infinite loop of restarts

Expected behavior:

1. Detect billing limit errors via check run annotations
2. For private repositories: Post a comment and stop (requires human intervention)
3. For cases where limit reset time is known: Wait until limits reset with exponential backoff
4. Avoid triggering AI restarts for non-code issues

## Timeline of Events

### Evidence from Reference PR (unidel2035/btc#1436)

**Date:** 2026-02-16

1. **CI runs show continuous failures** - All 10 recent runs have `conclusion: "failure"`
2. **Jobs have `runner_id: 0` and `steps: []`** - Indicates the runner was never assigned
3. **Annotations contain the billing limit message** - This is the key detection signature

### API Response Analysis

**Job data when billing limits are reached:**

```json
{
  "id": 63730323137,
  "status": "completed",
  "conclusion": "failure",
  "created_at": "2026-02-16T09:50:29Z",
  "started_at": "2026-02-16T09:50:29Z",
  "completed_at": "2026-02-16T09:50:31Z",
  "name": "Deploy to Staging",
  "steps": [],
  "runner_id": 0,
  "runner_name": ""
}
```

**Key indicators:**

- `steps` array is empty (no steps were executed)
- `runner_id` is 0 (no runner was assigned)
- Very short duration (created to completed in ~2 seconds)
- `conclusion` is "failure"

**Check run annotations:**

```json
{
  "path": ".github",
  "annotation_level": "failure",
  "title": "",
  "message": "The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings"
}
```

## Root Cause Analysis

### Primary Issue: No Detection of Billing Limit Errors

The `checkPRCIStatus` function in `github-merge.lib.mjs` correctly fetches check runs but does not:

1. Fetch annotations for failed check runs
2. Distinguish between code failures and billing limit failures
3. Return specific failure types for different handling

### Secondary Issue: No Graceful Handling Strategy

When billing limits are detected, the system should:

1. **For private repositories:** Post a comment explaining the issue and stop
2. **For public repositories:** This shouldn't happen (free tier)
3. **For any repository with known reset time:** Apply exponential backoff

### Affected Code Paths

1. `src/github-merge.lib.mjs:checkPRCIStatus()` - Does not fetch annotations
2. `src/solve.auto-merge.lib.mjs:getMergeBlockers()` - Cannot distinguish billing failures
3. `src/solve.auto-merge.lib.mjs:watchUntilMergeable()` - Treats all CI failures the same

## Proposed Solution

### 1. Add Billing Limit Detection Function

Create a new function to check for billing limit errors:

```javascript
/**
 * Check if CI failure is due to billing/spending limits
 * @returns {Promise<{isBillingLimitError: boolean, message: string|null, affectedJobs: string[]}>}
 */
export async function checkForBillingLimitError(owner, repo, sha, verbose = false) {
  // Fetch check runs
  const checkRuns = await getCheckRuns(owner, repo, sha);

  const billingLimitJobs = [];
  const billingMessage = 'The job was not started because recent account payments have failed or your spending limit needs to be increased';

  for (const run of checkRuns) {
    // Check for billing limit indicators:
    // 1. Empty steps array
    // 2. runner_id === 0
    // 3. Conclusion is failure
    if (run.conclusion === 'failure' && run.steps?.length === 0 && run.runner_id === 0) {
      // Fetch annotations to confirm
      const annotations = await getCheckRunAnnotations(owner, repo, run.id);
      if (annotations.some(a => a.message?.includes(billingMessage))) {
        billingLimitJobs.push(run.name);
      }
    }
  }

  return {
    isBillingLimitError: billingLimitJobs.length > 0,
    message: billingMessage,
    affectedJobs: billingLimitJobs,
  };
}
```

### 2. Modify watchUntilMergeable to Handle Billing Limits

In `solve.auto-merge.lib.mjs`, add special handling:

```javascript
// Check if CI failure is due to billing limits
const billingCheck = await checkForBillingLimitError(owner, repo, headSha, verbose);

if (billingCheck.isBillingLimitError) {
  // This is a billing limit issue, not a code issue
  await log(formatAligned('💳', 'BILLING LIMIT DETECTED', ''));
  await log(formatAligned('', 'Affected jobs:', billingCheck.affectedJobs.join(', '), 2));

  // Post comment and stop for private repos (human intervention required)
  const repoInfo = await getRepoInfo(owner, repo);
  if (repoInfo.isPrivate) {
    const commentBody = `## 💳 GitHub Actions Billing Limit Reached

The CI/CD jobs could not start due to billing limits:
- ${billingCheck.affectedJobs.join('\n- ')}

**Error:** ${billingCheck.message}

**Action Required:**
Please check the 'Billing & plans' section in your GitHub settings and either:
1. Add a payment method
2. Increase your spending limit
3. Wait for the free tier to reset

---
*Detected by hive-mind --auto-restart-until-mergeable*`;
    await postPRComment(owner, repo, prNumber, commentBody);

    return { success: false, reason: 'billing_limit', latestSessionId, latestAnthropicCost };
  }

  // For public repos, apply exponential backoff and wait
  // (This shouldn't normally happen as public repos have unlimited CI)
  await log(formatAligned('⏳', 'Applying exponential backoff...', `${currentBackoffSeconds}s`, 2));
}
```

### 3. Add Repository Visibility Check

```javascript
async function getRepoInfo(owner, repo) {
  const result = await $`gh api repos/${owner}/${repo} --jq '{isPrivate: .private, visibility: .visibility}'`;
  if (result.code === 0) {
    return JSON.parse(result.stdout.toString());
  }
  return { isPrivate: true }; // Assume private if unknown
}
```

## Solution Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  auto-restart-until-mergeable loop              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐                                          │
│  │ Check CI Status  │                                          │
│  └────────┬─────────┘                                          │
│           │                                                     │
│           ▼                                                     │
│  ┌──────────────────┐    Yes    ┌────────────────────┐         │
│  │ CI Failed?       │──────────►│ Check for Billing  │         │
│  └────────┬─────────┘           │ Limit Error        │         │
│           │ No                  └────────┬───────────┘         │
│           ▼                              │                      │
│  ┌──────────────────┐                    │                      │
│  │ Continue normal  │                    ▼                      │
│  │ flow             │    ┌──────────────────────────────┐      │
│  └──────────────────┘    │ Is Billing Limit Error?      │      │
│                          └───────────┬──────────────────┘      │
│                           Yes        │        No               │
│                    ┌─────────────────┴────────────────┐        │
│                    │                                  │        │
│                    ▼                                  ▼        │
│      ┌─────────────────────────┐     ┌─────────────────────┐  │
│      │ Is Private Repository?  │     │ Normal CI Failure:  │  │
│      └──────────┬──────────────┘     │ Restart AI agent    │  │
│           Yes   │    No              └─────────────────────┘  │
│       ┌─────────┴─────────┐                                   │
│       │                   │                                   │
│       ▼                   ▼                                   │
│  ┌──────────────┐  ┌────────────────┐                        │
│  │ Post comment │  │ Apply backoff  │                        │
│  │ and STOP     │  │ and wait       │                        │
│  │ (human req.) │  │                │                        │
│  └──────────────┘  └────────────────┘                        │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

## Implementation Plan

1. **Phase 1: Detection**
   - Add `checkForBillingLimitError()` function to `github-merge.lib.mjs`
   - Add `getCheckRunAnnotations()` helper function
   - Add `getRepoInfo()` helper function

2. **Phase 2: Handling**
   - Modify `getMergeBlockers()` to return blocker type
   - Update `watchUntilMergeable()` to handle billing limit errors
   - Implement exponential backoff for non-private repos

3. **Phase 3: Communication**
   - Add specific comment templates for billing limit scenarios
   - Add logging for billing limit detection

4. **Phase 4: Testing**
   - Add unit tests for billing limit detection
   - Add integration test mocking billing limit responses

## Files to Modify

| File                                     | Changes                                                       |
| ---------------------------------------- | ------------------------------------------------------------- |
| `src/github-merge.lib.mjs`               | Add `checkForBillingLimitError()`, `getCheckRunAnnotations()` |
| `src/solve.auto-merge.lib.mjs`           | Handle billing limits in `watchUntilMergeable()`              |
| `tests/test-billing-limit-detection.mjs` | New test file                                                 |
| `docs/CONFIGURATION.md`                  | Document the new behavior                                     |

## Risk Assessment

| Risk                                     | Impact | Mitigation                                                                 |
| ---------------------------------------- | ------ | -------------------------------------------------------------------------- |
| False positives                          | Low    | Multiple indicators checked (steps empty, runner_id=0, annotation message) |
| API rate limits from annotation fetching | Low    | Only fetch annotations for failed runs with suspicious indicators          |
| Breaking existing behavior               | Medium | Extensive testing, backward-compatible changes                             |

## Success Criteria

1. Billing limit errors are correctly detected via annotations
2. Private repo billing limits result in comment + stop (no infinite loop)
3. AI restarts are NOT triggered for billing limit issues
4. Existing CI failure handling continues to work

## References

- [GitHub Community Discussion: "The job was not started because recent account payments have failed"](https://github.com/orgs/community/discussions/151956)
- [Issue #1304: --auto-restart-until-mergeable false positive on empty CI checks](https://github.com/link-assistant/hive-mind/issues/1304)
- [GitHub Actions Billing Documentation](https://docs.github.com/en/billing/managing-billing-for-github-actions)
