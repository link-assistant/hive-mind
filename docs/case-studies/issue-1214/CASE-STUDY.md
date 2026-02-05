# Case Study: Pull Request Unexpectedly Closed During AI-Assisted Work Session

## Issue Reference
- **Issue**: [link-assistant/hive-mind#1214](https://github.com/link-assistant/hive-mind/issues/1214)
- **Related PR**: [netkeep80/jsonRVM#7](https://github.com/netkeep80/jsonRVM/pull/7)

## Executive Summary

During an AI-assisted work session on February 4, 2026, a cross-repository pull request was unexpectedly closed at 19:06:17Z, approximately 2 seconds after a push to the head branch. The AI assistant (operating under the "konard" user account) did not explicitly issue a close command. The repository owner (netkeep80) manually reopened the PR at 19:12:39Z, and the PR was subsequently merged at 19:18:43Z.

This case study investigates the root cause and proposes solutions to prevent similar incidents.

## Timeline of Events

### Session 1 (18:26:00Z - 18:49:11Z) - Successful

| Timestamp | Event | Actor |
|-----------|-------|-------|
| 18:26:54Z | Session 1 started | AI (konard) |
| 18:41:52Z | PR #7 created from fork | AI (konard) |
| 18:48:16Z | PR renamed with bilingual title | AI (konard) |
| 18:48:51Z | PR marked ready for review | AI (konard) |
| 18:48:56Z | CI triggered (Rocq Proofs CI) | GitHub Actions |
| 18:49:11Z | Session 1 completed successfully | AI (konard) |

### Session 2 (19:03:30Z - 19:19:16Z) - PR Closed Unexpectedly

| Timestamp | Event | Actor |
|-----------|-------|-------|
| 19:03:30Z | Session 2 started (continue mode) | AI (konard) |
| 19:03:31Z | PR converted to draft | AI (konard) |
| 19:03:32Z | "Work session started" comment posted | AI (konard) |
| 19:05:53Z | First fix committed: permission workaround | AI (konard) |
| 19:06:09Z | Second commit: include workflow in paths filter | AI (konard) |
| 19:06:15Z | Push to fork completed | AI (konard) |
| **19:06:17Z** | **PR CLOSED** | **konard (unexpected)** |
| 19:06:18Z | AI continues unaware PR is closed | AI (konard) |
| 19:06:51Z | AI checks CI status, sees no new runs | AI (konard) |
| 19:07:01Z | "no checks reported" error | GitHub CLI |
| 19:12:33Z | AI discovers PR is closed | AI (konard) |
| 19:12:39Z | PR reopened manually | Repository owner (netkeep80) |
| 19:15:22Z | AI pushes final fix | AI (konard) |
| 19:17:01Z | CI passes (both Coq 8.18 and 8.19) | GitHub Actions |
| 19:18:33Z | PR marked ready for review | Repository owner (netkeep80) |
| 19:18:43Z | PR merged | Repository owner (netkeep80) |
| 19:19:16Z | Session 2 completed | AI (konard) |

## Key Observations

### 1. No Explicit Close Command
Searching through 8,384 lines of logs, there is **no `gh pr close` command** executed by the AI. The close event occurred between 19:06:15Z (push completed) and 19:06:17Z (PR closed).

### 2. Cross-Repository Configuration
- **Upstream repository**: `netkeep80/jsonRVM`
- **Fork repository**: `konard/netkeep80-jsonRVM`
- **PR type**: Cross-repository (from fork to upstream)
- **`isCrossRepository`**: `true`

### 3. Fork Sync Mechanics
The PR was using commit `f081cbe24b8ae27c4364393d566b1b39d4955fb0` from the fork. After pushing, the fork was updated to `b74e4e6985713179e982792a36fff6ba79d047a6`, but the PR head ref was not updated synchronously.

### 4. AI Behavior
The AI continued working for approximately 6 minutes after the PR was closed before discovering the issue at 19:12:33Z. This indicates a need for more frequent PR state validation.

### 5. Hive-Mind Tool Command
The solve tool was invoked with:
```bash
solve https://github.com/netkeep80/jsonRVM/pull/7 --model opus --attach-logs --verbose --no-tool-check --auto-resume-on-limit-reset --tokens-budget-stats
```

**Notably**: The `--auto-close-pull-request-on-fail` flag was **NOT** used, confirming this was not a programmatic closure by the hive-mind tool.

## Root Cause Analysis

### Hypothesis 1: GitHub Head Ref Desync (Most Likely)

When commits are pushed to a cross-repository fork PR, GitHub must synchronize the head reference between the fork and the upstream PR view. If this synchronization fails or encounters a race condition, the PR may be marked as having an invalid head ref.

**Evidence**:
- The PR `head_sha` showed `f081cbe` even after the fork was updated to `b74e4e6`
- The PR was closed within 2 seconds of push completion
- GitHub documentation mentions that PRs can be closed when the head branch becomes unavailable

**GitHub Behavior**: According to [GitHub documentation](https://docs.github.com/articles/deleting-and-restoring-branches-in-a-pull-request), if a branch is associated with at least one open pull request, deleting the branch will close the pull requests.

### Hypothesis 2: Temporary Branch Unavailability

During the push operation, there may be a brief moment where the branch reference is being updated. If GitHub's PR system checked the branch availability during this window, it might have incorrectly determined the branch was deleted or unavailable.

### Hypothesis 3: GitHub Actions Token Scope Issue

The AI was using a GitHub token with certain permissions. If a workflow or GitHub App attempted to validate the PR and couldn't access the head ref due to token scope issues, this could trigger a close event.

### Hypothesis 4: Race Condition in GitHub's Internal Systems

The 2-second gap between push (19:06:15Z) and close (19:06:17Z) suggests a potential race condition in GitHub's internal PR state management for cross-repository forks.

## Impact Assessment

### Severity: Medium

**Positive mitigations**:
- Repository owner was able to manually reopen the PR
- No code was lost
- PR was eventually merged successfully

**Negative impacts**:
- ~6 minutes of AI work wasted (unaware of closed state)
- Manual intervention required from repository owner
- Potential confusion and trust issues with automated systems

## Proposed Solutions

### Solution 1: Implement PR State Validation (Recommended)

Add a pre-commit check in the AI workflow to validate PR state before and after every push operation.

```javascript
async function validatePRState(owner, repo, prNumber) {
  const state = await gh(`api repos/${owner}/${repo}/pulls/${prNumber} --jq .state`);
  if (state !== 'open') {
    throw new Error(`PR #${prNumber} is ${state}, expected 'open'`);
  }
}

// Before push
await validatePRState(owner, repo, prNumber);

// After push
await sleep(5000); // Wait for GitHub to sync
await validatePRState(owner, repo, prNumber);
```

### Solution 2: Auto-Reopen Mechanism

Implement automatic PR reopening when the AI detects an unexpected close event:

```javascript
async function ensurePROpen(owner, repo, prNumber) {
  const pr = await getPRDetails(owner, repo, prNumber);
  if (pr.state === 'closed' && !pr.merged) {
    console.log(`PR #${prNumber} was unexpectedly closed, attempting to reopen...`);
    await gh(`pr reopen ${prNumber} --repo ${owner}/${repo}`);
    await notifyOwner(owner, repo, prNumber, 'PR was automatically reopened after unexpected closure');
  }
}
```

### Solution 3: Avoid Force Pushes to Open PRs

When working with cross-repository forks, prefer regular pushes over force pushes to minimize the risk of head ref synchronization issues.

### Solution 4: Add Periodic State Checks

During long-running AI work sessions, periodically check PR state every 2-3 minutes:

```javascript
const stateCheckInterval = setInterval(async () => {
  await validatePRState(owner, repo, prNumber);
}, 120000); // Every 2 minutes
```

### Solution 5: Implement Retry Logic with Exponential Backoff

For cross-repository operations, implement retry logic to handle transient synchronization issues:

```javascript
async function pushWithRetry(branch, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await git(`push origin ${branch}`);
      await sleep(5000); // Wait for sync
      await validatePRState(owner, repo, prNumber);
      return;
    } catch (error) {
      if (i < maxRetries - 1) {
        await sleep(Math.pow(2, i) * 1000); // Exponential backoff
        continue;
      }
      throw error;
    }
  }
}
```

## Recommendations for GitHub

Based on this investigation, we recommend GitHub consider:

1. **Improve Synchronization for Cross-Repository PRs**: Add more robust handling for the brief window during push operations to prevent spurious closures.

2. **Add Close Reason to Events API**: The `closed` event in the issues/events API doesn't include a `state_reason` for PRs (unlike issues which have `completed`, `not_planned`, etc.). Adding context would help diagnose unexpected closures.

3. **Implement Grace Period**: Consider implementing a brief grace period (e.g., 10-30 seconds) after push operations before marking a PR as having an invalid head ref.

## Related Issues and Documentation

- [How to reopen a pull-request after a force-push?](https://gist.github.com/robertpainsi/2c42c15f1ce6dab03a0675348edd4e2c)
- [Allow to reopen pull requests after a force push](https://github.com/isaacs/github/issues/361)
- [Deleting a branch auto-closes any PRs targeting the deleted branch](https://github.com/microsoft/vscode-pull-request-github/issues/6799)
- [Syncing a fork - GitHub Docs](https://docs.github.com/articles/syncing-a-fork)
- [Deleting and restoring branches in a pull request - GitHub Docs](https://docs.github.com/articles/deleting-and-restoring-branches-in-a-pull-request)

## Conclusion

The unexpected PR closure appears to be caused by a synchronization issue between GitHub's fork and upstream PR systems during a push operation. While the exact trigger cannot be definitively determined without access to GitHub's internal logs, the 2-second window between push completion and PR closure strongly suggests an automated mechanism rather than user action.

The most effective mitigation is implementing comprehensive state validation checks before and after PR operations, combined with an auto-recovery mechanism to reopen unexpectedly closed PRs.

## Files in This Case Study

- `CASE-STUDY.md` - This document
- `solution-draft-log.txt.gz` - Session 2 full log (8,384 lines, gzip compressed)
- `solution-draft-log-session1.txt.gz` - Session 1 full log (5,626 lines, gzip compressed)

To decompress logs: `gunzip -k *.gz`

---

*Case study prepared on 2026-02-05*
