# Root Causes - Issue #916

## Deep Dive into Root Causes

### Primary Root Cause: Temporal Workflow Gap

**Problem**: The system messages guide AI agents on what to do at the START of work but don't explicitly remind them to check for feedback received DURING work before finishing.

**Why This Matters**:
- Issues and PRs are collaborative spaces where feedback can arrive at any time
- An agent might start work at T0, work for hours, and feedback arrives at T1, T2, T3
- Current system messages only encourage checking comments at T0 (initial research phase)
- When finalizing at T4, there's no explicit reminder to check for comments from T1-T3
- This can lead to merged PRs that don't address reviewer feedback

**Evidence from Code Analysis**:

In `agent.prompts.lib.mjs`:
```
Lines 119-132: Initial research section
  - "When you need latest comments on pull request, use gh api..."
  - "When you need latest comments on issue, use gh api..."

Lines 153-161: Preparing pull request - finalization checklist
  - "When you finalize the pull request:"
  - Checks: CI passing, gh pr diff, requirements met
  - Missing: Check for new comments since work began
```

In `claude.prompts.lib.mjs`:
```
Lines 133-147: Initial research section
  - "When you need latest comments on pull request (sorted newest first)..."
  - "When you need latest comments on issue (sorted newest first)..."

Lines 169-177: Preparing pull request - finalization checklist
  - "When you finalize the pull request:"
  - Line 176: "...features were removed without an explicit request from users via the issue description, issue comments, and/or pull request comments."
  - This mentions checking comments but in context of verifying original requirements, not NEW feedback
  - Missing: Explicit step to fetch and review latest comments before marking ready
```

### Secondary Root Cause: Missing Working Tree Status Check

**Problem**: No guidance for checking uncommitted changes before finalizing work.

**Why This Matters**:
- Uncommitted changes represent incomplete work
- Industry best practice is to check `git status` before declaring work complete
- AI agents might consider work "done" while having uncommitted files
- This violates the principle of atomic, complete pull requests

**Evidence from Code Analysis**:

In `claude.prompts.lib.mjs` line 171:
```
"make sure no uncommitted changes corresponding to the original requirements are left behind"
```

This hint exists but focuses on ensuring work IS committed, not on CHECKING for uncommitted changes as a verification step.

**What's Missing**:
- No explicit "When you finalize" hint to run `git status` and verify clean working tree
- No guidance on what to do if uncommitted changes are found (commit or discard)

### Underlying Cause: Insufficient Temporal Awareness in Guidelines

**Root Issue**: The guidelines structure follows a linear workflow (Initial → Development → Finalization) but doesn't account for the dynamic nature of collaborative development.

**Linear Assumption**:
```
Start → Research (check comments) → Implement → Finalize (check CI, code)
```

**Reality**:
```
Start → Research (check comments at T0) → Implement (T1-T3) → [Comments arrive at T1, T2, T3] → Finalize (should re-check comments)
```

### Contributing Factors

#### 1. Implicit vs Explicit Instructions
- The system messages prefer gentle hints ("When x do y")
- Some checks are explicit (CI passing, merge main branch)
- Others are implicit (check comments is only in initial research)
- Finalization phase needs equally explicit reminders

#### 2. Mental Model Gap
The current mental model is:
- "Initial research" = gather information once at start
- "Finalization" = verify technical correctness

Should be:
- "Initial research" = gather information to understand requirements
- "Finalization" = verify technical correctness AND check for new information

#### 3. Workflow Assumption
Current assumption: Work is isolated once started
Reality: Work is continuous collaboration with potential feedback loops

### Industry Standards Gap

From external research, industry best practices recommend:

1. **PR Review Timeline**: Review within 2 hours to maintain momentum
2. **Comment Status Tracking**: Track Active/Pending/Resolved throughout process
3. **Pre-Merge Checklist**:
   - All comments addressed
   - CI passing
   - Working tree clean (`git status --porcelain` returns empty)
4. **GitHub Actions**: Tools exist to automate uncommitted changes checks

**Gap**: Current system messages don't align with these industry standards for the finalization phase.

### Impact Assessment

**Without the fix**:
- Agents might mark PRs ready while missing critical feedback
- Work may be "complete" with uncommitted changes left behind
- Reviewers frustrated by agents ignoring their feedback
- Need to re-open PRs or create follow-up issues

**With the fix**:
- Agents check for feedback before declaring work complete
- Ensures working tree is clean before finalizing
- Aligns with industry best practices
- Better collaboration between AI agents and human reviewers

## Summary

The root causes are:
1. **Temporal workflow gap**: Comments are only checked at start, not before finish
2. **Missing git status check**: No verification of clean working tree
3. **Implicit vs explicit guidance**: Finalization lacks explicit collaborative checks
4. **Linear workflow assumption**: Doesn't account for dynamic feedback during work

The solution needs to add explicit hints in the finalization section to close these gaps.
