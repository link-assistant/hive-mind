# Proposed Solutions: Discussion Comments Not Loaded to AI Context

## Overview

This document outlines the proposed solutions for Issue #964, where the AI solver failed to see and respond to repository owner feedback on a pull request.

## Solution Matrix

| Solution                               | Priority | Effort | Impact | Risk   |
| -------------------------------------- | -------- | ------ | ------ | ------ |
| 1. Include Comment Content in Feedback | Critical | Medium | High   | Low    |
| 2. Document All Comment API Types      | High     | Low    | Medium | None   |
| 3. Add Pre-Ready Verification          | Medium   | Medium | High   | Low    |
| 4. Automated Comment Verification Tool | Low      | High   | High   | Medium |

## Solution 1: Include Comment Content in Feedback (Critical Priority)

### Problem Addressed

Root Cause #1: The system tells the AI "N comments exist" but doesn't show what they say.

### Implementation

**File**: `src/solve.feedback.lib.mjs`

**Current Code (lines 179-184):**

```javascript
// Add comment info if counts are > 0 to avoid wasting tokens
if (newPrComments > 0) {
  feedbackLines.push(`New comments on the pull request: ${newPrComments}`);
}
if (newIssueComments > 0) {
  feedbackLines.push(`New comments on the issue: ${newIssueComments}`);
}
```

**Proposed Code:**

```javascript
// Include comment content to ensure AI sees feedback
// Prioritize external user comments and truncate for token efficiency
if (filteredPrComments.length > 0) {
  feedbackLines.push(`New comments on the pull request (${filteredPrComments.length}):`);

  // Sort to prioritize non-bot comments
  const sortedComments = [...filteredPrComments].sort((a, b) => {
    // Prioritize comments from non-current-user (external feedback)
    const aIsExternal = a.user?.login !== currentUser ? 1 : 0;
    const bIsExternal = b.user?.login !== currentUser ? 1 : 0;
    if (aIsExternal !== bIsExternal) return bIsExternal - aIsExternal;
    // Then sort by date (newest first)
    return new Date(b.created_at) - new Date(a.created_at);
  });

  // Include up to 10 most relevant comments
  const maxComments = 10;
  const maxBodyLength = 500;

  for (const comment of sortedComments.slice(0, maxComments)) {
    const author = comment.user?.login || 'unknown';
    const path = comment.path ? ` (on ${comment.path})` : '';
    const isReviewComment = !!comment.path;
    const type = isReviewComment ? '[review]' : '[comment]';

    let body = (comment.body || '').trim();
    if (body.length > maxBodyLength) {
      body = body.substring(0, maxBodyLength) + '...';
    }
    body = body.replace(/\n/g, ' ').replace(/\s+/g, ' ');

    feedbackLines.push(`  ${type} @${author}${path}: ${body}`);
  }

  if (sortedComments.length > maxComments) {
    feedbackLines.push(`  ... and ${sortedComments.length - maxComments} more comments`);
  }
}

// Same treatment for issue comments
if (filteredIssueComments && filteredIssueComments.length > 0) {
  feedbackLines.push(`New comments on the issue (${filteredIssueComments.length}):`);

  for (const comment of filteredIssueComments.slice(0, 5)) {
    const author = comment.user?.login || 'unknown';
    let body = (comment.body || '').trim();
    if (body.length > maxBodyLength) {
      body = body.substring(0, maxBodyLength) + '...';
    }
    body = body.replace(/\n/g, ' ').replace(/\s+/g, ' ');

    feedbackLines.push(`  [issue] @${author}: ${body}`);
  }
}
```

### Token Usage Consideration

The original code avoided including content to "save tokens". However:

1. **10 comments at 500 chars each = ~5,000 chars = ~1,250 tokens**
2. This is a small cost compared to the cost of:
   - AI making additional API calls to fetch comments
   - AI missing feedback and requiring re-runs
   - User frustration and manual intervention
   - Multiple AI sessions instead of one

The token "savings" from not including content actually **increases** total token usage by requiring the AI to fetch comments separately, often multiple times.

### Benefits

- AI immediately sees what comments say
- No additional API calls needed
- Cannot miss review comments if they're included in the feedback
- Prioritizes external user feedback over bot comments
- Truncates long comments to balance detail vs tokens

### Risks

- Minimal: slightly higher token usage per session
- Mitigated by: truncation and comment limits

## Solution 2: Document All Comment API Types (High Priority)

### Problem Addressed

Root Cause #2: AI uses incomplete command that misses review comments.

### Implementation

**File**: `src/claude.prompts.lib.mjs`

**Add to System Prompt:**

```markdown
## Fetching Pull Request Comments

IMPORTANT: GitHub has THREE different comment types on pull requests, each with different API endpoints:

### 1. Conversation Comments (General PR Discussion)

These are comments in the main PR timeline.
\`\`\`bash
gh api repos/{owner}/{repo}/issues/{pr_number}/comments
\`\`\`
Note: Pull requests are also issues in GitHub's data model.

### 2. Review Comments (Inline Code Comments)

These are comments on specific lines of code in the diff view.
\`\`\`bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments
\`\`\`
This is where code review feedback typically appears!

### 3. Pull Request Reviews

These are the review submissions (approve, request changes, comment).
\`\`\`bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews
\`\`\`

### WARNING

The command \`gh pr view --json comments\` ONLY returns conversation comments!
It does NOT return review comments (inline code feedback).

To ensure you see ALL feedback on a PR, you must check:

1. Conversation comments (issues API)
2. Review comments (pulls API)
3. PR reviews (pulls reviews API)
```

### Benefits

- Educates the AI about GitHub's confusing API structure
- Provides correct commands for each comment type
- Explicit warning about the `gh pr view` limitation

### Risks

- None - pure documentation improvement

## Solution 3: Add Pre-Ready Verification (Medium Priority)

### Problem Addressed

Prevents AI from marking PR ready without addressing feedback.

### Implementation

**File**: `src/claude.prompts.lib.mjs`

**Add to System Prompt:**

```markdown
## Before Marking a PR Ready for Review

CRITICAL: Before using \`gh pr ready {pr_number}\`, you MUST:

1. **Fetch ALL comment types**:
   \`\`\`bash

   # Get conversation comments

   gh api repos/{owner}/{repo}/issues/{pr_number}/comments --jq '.[].body'

   # Get review comments (inline code feedback)

   gh api repos/{owner}/{repo}/pulls/{pr_number}/comments --jq '.[].body'

   # Get PR reviews

   gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews --jq '.[] | select(.state != "PENDING") | .body'
   \`\`\`

2. **Check for unaddressed feedback** from:
   - Repository owner
   - Maintainers
   - Collaborators
   - Anyone who is NOT the bot user

3. **If feedback exists that hasn't been addressed**:
   - Address the feedback in your changes
   - Leave a comment explaining how you addressed it
   - Only THEN mark the PR ready

4. **If you cannot address the feedback**:
   - Leave a comment explaining the situation
   - Ask for clarification or help
   - Do NOT mark the PR ready

NEVER mark a PR ready if there is unaddressed feedback from repository stakeholders!
```

### Benefits

- Creates explicit checkpoint before marking ready
- Prevents premature PR ready marking
- Documents expected behavior clearly

### Risks

- AI might still skip verification if rushed
- Mitigated by: Solution 1 which shows comments directly

## Solution 4: Automated Comment Verification Tool (Low Priority)

### Problem Addressed

Provides fail-safe verification independent of AI behavior.

### Implementation Concept

Create a new function in `solve.feedback.lib.mjs` or a new file:

```javascript
/**
 * Verifies all comments on a PR have been addressed before marking ready.
 * Returns true if safe to mark ready, false if unaddressed feedback exists.
 */
export async function verifyCommentsAddressed(params) {
  const { owner, repo, prNumber, currentUser, lastCommitTime, $ } = params;

  const unaddressedComments = [];

  // Fetch all comment types
  const [reviewComments, conversationComments, reviews] = await Promise.all([fetchReviewComments(owner, repo, prNumber, $), fetchConversationComments(owner, repo, prNumber, $), fetchReviews(owner, repo, prNumber, $)]);

  // Check for unaddressed feedback from external users
  const allComments = [...reviewComments, ...conversationComments];

  for (const comment of allComments) {
    const isExternal = comment.user?.login !== currentUser;
    const isAfterLastCommit = new Date(comment.created_at) > lastCommitTime;

    if (isExternal && isAfterLastCommit) {
      unaddressedComments.push({
        author: comment.user?.login,
        body: comment.body?.substring(0, 200),
        type: comment.path ? 'review' : 'conversation',
        path: comment.path,
      });
    }
  }

  // Check for changes requested in reviews
  const changesRequested = reviews.filter(r => r.state === 'CHANGES_REQUESTED' && new Date(r.submitted_at) > lastCommitTime);

  if (changesRequested.length > 0) {
    for (const review of changesRequested) {
      unaddressedComments.push({
        author: review.user?.login,
        body: review.body?.substring(0, 200),
        type: 'changes_requested',
      });
    }
  }

  return {
    safe: unaddressedComments.length === 0,
    unaddressedComments,
  };
}
```

This could be integrated as a pre-check before `gh pr ready` is executed.

### Benefits

- Systematic, automated verification
- Cannot be bypassed by AI
- Provides detailed information about unaddressed comments

### Risks

- More complex implementation
- Could block legitimate PR ready operations
- Requires careful tuning to avoid false positives

## Implementation Timeline

### Phase 1: Critical Fix (Immediate)

- Implement Solution 1: Include comment content in feedback
- Test with the vapor-rice-i3 PR #13 case
- Release as patch version

### Phase 2: Documentation (1-2 days)

- Implement Solution 2: Update AI instructions
- Implement Solution 3: Add pre-ready verification instructions
- Release as minor version

### Phase 3: Future Enhancement (Optional)

- Evaluate need for Solution 4 based on Phase 1-2 results
- Implement if issues persist
- Release as feature in next major version

## Success Criteria

After implementation:

1. **Test Case**: Simulate vapor-rice-i3 scenario
   - Create PR
   - Add review comment from different user
   - Run continue mode
   - **Expected**: AI sees and responds to the comment
   - **Pass**: AI does NOT mark PR ready without addressing feedback

2. **Metrics**:
   - Zero instances of ignored repository owner feedback
   - AI acknowledges all comment types in its responses
   - No increase in "missed feedback" reports

## Conclusion

The critical fix is **Solution 1** - including comment content directly in the feedback passed to the AI. This addresses the root cause most directly and prevents the failure mode observed in Issue #964.

Solutions 2 and 3 provide defense in depth by educating the AI about the comment API structure and creating explicit verification checkpoints.

Solution 4 is a future enhancement if the first three solutions prove insufficient.
