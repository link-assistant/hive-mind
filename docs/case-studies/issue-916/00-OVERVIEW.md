# Case Study Overview - Issue #916

## Executive Summary

**Issue**: Add guidance for AI agents to check comments and uncommitted changes before finalizing work

**Status**: Implementing solution

**Impact**: Medium - Affects collaboration quality and PR completeness

**Timeline**: Issue created 2025-12-11, PR #917 in progress

## Problem Statement

AI agents using `--tool claude` and `--tool agent` check for issue/PR comments during initial research but don't explicitly re-check for new feedback that may have arrived during implementation. Additionally, there's no explicit reminder to verify the working tree is clean (no uncommitted changes) before declaring work complete.

This creates two workflow gaps:
1. **Temporal Gap**: Feedback can arrive after work begins but before it's finished
2. **Completeness Gap**: Work may be declared "done" with uncommitted files remaining

## Quick Facts

- **Issue Number**: #916
- **Pull Request**: #917
- **Branch**: issue-916-4aa4af8d2bd1
- **Labels**: bug
- **Files Modified**:
  - `src/agent.prompts.lib.mjs`
  - `src/claude.prompts.lib.mjs`
- **Case Study Location**: `docs/case-studies/issue-916/`

## Root Cause

The system message prompts guide agents on initial research (including checking comments) and finalization (including CI checks, code review), but don't explicitly remind agents to check for NEW comments or verify clean working tree status during the finalization phase.

**Key Finding**: The prompts assume a linear workflow but reality is collaborative with dynamic feedback.

## Solution

Add two new hints following the "When x do y" gentle guidance style:

1. **In "Preparing pull request" → "When you finalize" subsection**:
   - Add: "check for latest comments on the issue and pull request to ensure no recent feedback was missed"

2. **In "Self review" section**:
   - Add: "When you check your solution draft, verify git status shows a clean working tree with no uncommitted changes"

Apply to both `agent.prompts.lib.mjs` and `claude.prompts.lib.mjs` for consistency.

## Impact Assessment

### Before Fix
- Agents might miss feedback that arrived during implementation
- PRs could be marked ready with uncommitted changes
- Reviewers frustrated by ignored feedback
- Follow-up PRs needed to address missed comments

### After Fix
- Agents check for feedback before finalizing
- Working tree verified clean before completion
- Aligns with industry best practices
- Better AI-human collaboration

## Documentation Structure

This case study includes:

- **00-OVERVIEW.md** (this file): Executive summary
- **01-TIMELINE.md**: Chronological sequence of events
- **02-ROOT-CAUSES.md**: Deep dive into root causes
- **03-SOLUTIONS.md**: Detailed solutions and recommendations
- **online-research.md**: External research findings
- **issue-data.json**: Complete issue #916 data
- **pr-data.json**: Complete PR #917 data
- **related-prs.json**: Related pull requests

## Key Learnings

1. **Temporal Awareness**: Guidelines must account for dynamic, ongoing collaboration
2. **Explicit vs Implicit**: Critical checks should be explicit, especially at decision points
3. **Industry Alignment**: Best practices from 2025 research validate the need for these checks
4. **Consistency**: Both agent and claude tools need same guidance for consistent behavior

## External Research

Research conducted on 2025-12-11 identified industry best practices:

### PR Comment Best Practices
- Track comment statuses throughout review process
- Address all feedback before merging
- Check for unresolved issues before finalizing
- Maintain professional, constructive tone
- Sources: Codacy, Crystallize, Aikido, Rewind, Graph AI, Sopa

### Git Workflow Best Practices
- Check `git status` before declaring work complete
- GitHub Actions exist for automated uncommitted changes checks
- Frequent small commits better than large updates
- CI/CD should verify clean working tree
- Sources: ScriptBinary, GitHub Marketplace, LabEx, aCompiler, Daily.dev, DEV Community

## Related Issues

- **Issue #865**: Agent tool default model error (similar case study structure)
- **Issue #867**: Agent error not treated as error
- **Issue #882**: Tool agent infinite loop

## Implementation Details

**Files to Modify**:
1. `src/agent.prompts.lib.mjs` - Lines 153-161, 176-179
2. `src/claude.prompts.lib.mjs` - Lines 169-177, 191-194

**Style Requirements**:
- Use "When x do y." format
- Gentle hints, not commands
- Consistent with existing prompt structure
- Maintain alphabetical/logical ordering

**Testing Strategy**:
- Test comment check with real-time feedback during agent execution
- Test git status check with scenarios involving uncommitted files
- Verify style consistency with existing prompts

## Success Criteria

✅ Both prompt files updated with new hints
✅ Style matches "When x do y" pattern
✅ Case study complete with timeline, root causes, solutions
✅ Online research conducted and cited
✅ All data downloaded to case study folder
✅ Changes maintain backward compatibility
✅ PR ready for review with complete documentation

## Next Steps

1. Implement changes in both prompt library files
2. Run local CI checks (eslint if available)
3. Verify no uncommitted changes remain
4. Check for recent comments on issue/PR
5. Update PR description with implementation details
6. Mark PR ready for review
