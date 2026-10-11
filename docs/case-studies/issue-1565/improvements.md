# Proposed Improvements

## Summary

Four improvements to prevent AI solver from ignoring changed/expanded requirements:

| #   | Solution                                             | Priority | Effort | Impact       |
| --- | ---------------------------------------------------- | -------- | ------ | ------------ |
| 1   | Include latest reviewer comment in prompt            | High     | Low    | Direct       |
| 2   | Anti-scope-narrowing system prompt instruction       | Medium   | Low    | Preventive   |
| 3   | Requirement verification checklist before completion | Medium   | Medium | Catch at end |
| 4   | Cross-session feedback repetition detection          | Low      | High   | Long-term    |

## Solution 1: Include Latest Reviewer Comment Verbatim in Prompt

### Problem

The current `feedbackLines` only includes metadata: `"New comments on the pull request: 2"`. The AI must fetch and interpret comments itself, creating an opportunity for it to deprioritize or reinterpret them.

### File: `src/solve.feedback.lib.mjs`

After line 132 (after filtering PR conversation comments), add:

```javascript
// Include the latest non-bot, non-log reviewer comment verbatim in the prompt
// so the AI cannot miss or reinterpret the requirement
const latestReviewerComment = filteredPrConversationComments.filter(c => !currentUser || c.user.login !== currentUser).pop();

if (latestReviewerComment && latestReviewerComment.body) {
  feedbackLines.push('');
  feedbackLines.push('--- LATEST REVIEWER COMMENT (address ALL requirements below) ---');
  feedbackLines.push(latestReviewerComment.body.trim());
  feedbackLines.push('--- END OF REVIEWER COMMENT ---');
  feedbackLines.push('');
  feedbackLines.push('IMPORTANT: You MUST address every requirement in the comment above.');
  feedbackLines.push('If you believe a requirement is out of scope, you MUST ask the reviewer');
  feedbackLines.push('for clarification via a PR comment BEFORE proceeding without it.');
}
```

### Rationale

When the requirement is embedded directly in the prompt (not discovered through tool use), the AI treats it with higher priority. This is similar to how system prompt instructions carry more weight than instructions found in tool results.

## Solution 2: Anti-Scope-Narrowing System Prompt Instruction

### File: `src/claude.prompts.lib.mjs`

Add to the system prompt after the "Solution development and testing" section (around line 213):

```javascript
Scope management.
   - When a reviewer or issue commenter expands the scope of work beyond the original issue title (e.g., "not only X, but also Y and Z"), treat their expanded scope as the new binding requirement. DO NOT narrow scope back to the original issue title.
   - When you read all requirements and plan your work, the user's LATEST comment defines scope, not the issue title. If the latest comment says "sync all features", you must sync all features — not just the one mentioned in the issue title.
   - When you believe a requirement is too large or risky to implement in the current PR, you MUST write a PR comment explaining your concern and asking for confirmation BEFORE reducing scope. Never silently reduce scope and present partial work as complete.
   - When you notice you are rationalizing why a requirement "doesn't apply" or is "out of scope" despite the user explicitly requesting it, stop and re-read the requirement. If the user said it, it is in scope.
```

## Solution 3: Requirement Verification Checklist

### File: `src/claude.prompts.lib.mjs`

Add to the "Preparing pull request" section's finalization checklist (around line 244):

```javascript
   - When finalizing, extract each requirement from the latest reviewer/commenter feedback
     and verify EACH ONE is addressed in your changes. Create a mental checklist:
     □ Requirement 1 from comment → verified in diff? (yes/no)
     □ Requirement 2 from comment → verified in diff? (yes/no)
     ...
     If ANY requirement is not addressed, continue working. Do not mark as ready.
```

## Solution 4: Cross-Session Feedback Repetition Detection

### File: `src/solve.feedback.lib.mjs`

This is a longer-term improvement. The idea is to detect when the same reviewer makes similar comments across sessions, indicating the previous session failed to address their feedback.

```javascript
// After fetching all filtered comments, check for repetition patterns
const reviewerComments = filteredPrConversationComments.filter(c => !currentUser || c.user.login !== currentUser);

if (reviewerComments.length >= 2) {
  const latestBody = reviewerComments[reviewerComments.length - 1]?.body || '';
  const previousBody = reviewerComments[reviewerComments.length - 2]?.body || '';

  // Simple similarity check: if both comments contain similar keywords
  const extractKeyPhrases = text => {
    const words = text.toLowerCase().split(/\s+/);
    return new Set(words.filter(w => w.length > 4));
  };

  const latestPhrases = extractKeyPhrases(latestBody);
  const previousPhrases = extractKeyPhrases(previousBody);
  const overlap = [...latestPhrases].filter(w => previousPhrases.has(w));

  if (overlap.length > 5) {
    feedbackLines.push('');
    feedbackLines.push('⚠️ WARNING: The reviewer appears to be REPEATING a previous requirement.');
    feedbackLines.push('This likely means the previous session failed to address it.');
    feedbackLines.push('Treat this requirement with HIGHEST PRIORITY and implement it FULLY.');
  }
}
```

## Implementation Priority

1. **Immediate (this PR):** Solution 1 + Solution 2 — low effort, directly prevents the exact failure mode observed
2. **Next iteration:** Solution 3 — adds verification step
3. **Future:** Solution 4 — requires more testing and tuning of similarity detection
