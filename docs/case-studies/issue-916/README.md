# Case Study: Issue #916 - Final Comment Check and Uncommitted Changes

## Quick Links

- [00-OVERVIEW.md](./00-OVERVIEW.md) - Executive summary and issue details
- [01-TIMELINE.md](./01-TIMELINE.md) - Chronological sequence of events
- [02-ROOT-CAUSES.md](./02-ROOT-CAUSES.md) - Deep dive into root causes
- [03-SOLUTIONS.md](./03-SOLUTIONS.md) - Proposed solutions and recommendations
- [online-research.md](./online-research.md) - External research findings
- [issue-data.json](./issue-data.json) - Complete issue #916 data
- [pr-data.json](./pr-data.json) - Complete PR #917 data
- [related-prs.json](./related-prs.json) - Related pull requests

## Problem Statement

AI agents for both `--tool claude` and `--tool agent` should check for recent comments on issues/pull requests not only during initial research but also before finishing work. Additionally, agents should verify the repository has no uncommitted changes before declaring work complete.

## Root Cause

The system message prompts contain guidance for checking comments during "Initial research" but lack explicit reminders to re-check for new comments during "Preparing pull request" finalization. Similarly, there's no explicit "Self review" step to verify git status shows a clean working tree.

## Solution

Add two new hints to system messages in both prompt libraries:

1. **Comment Check**: In finalization checklist, add "check for latest comments on the issue and pull request to ensure no recent feedback was missed"

2. **Git Status Check**: In self review section, add "When you check your solution draft, verify git status shows a clean working tree with no uncommitted changes"

**Files Modified**:
- `src/agent.prompts.lib.mjs`
- `src/claude.prompts.lib.mjs`

## Key Findings

### Temporal Workflow Gap
- Current prompts assume linear workflow (research → implement → finalize)
- Reality is dynamic: feedback can arrive during implementation
- Missing explicit re-check creates risk of ignored feedback

### Industry Best Practices (2025)
- PR reviews should happen within 2 hours
- All comment statuses should be tracked (Active/Pending/Resolved)
- Git status should be checked before finalization
- GitHub Actions exist for automated uncommitted changes checks

### Style Consistency
- All hints follow "When x do y." pattern
- Gentle guidance, not commands
- Consistent across both prompt libraries

## Impact

**Before Fix**:
- Risk of missing reviewer feedback that arrived during work
- Possible uncommitted changes left behind
- Inconsistent with industry best practices

**After Fix**:
- Agents check for new feedback before declaring done
- Working tree verified clean before finalization
- Better collaboration between AI and human reviewers
- Aligned with 2025 industry standards

## External References

### PR Comment Best Practices
- [Pull Request Best Practices - Codacy](https://blog.codacy.com/pull-request-best-practices)
- [Pull Request Best Practices - Crystallize](https://crystallize.com/blog/pull-request-best-practices)
- [6 Pull Request Best Practices - Aikido](https://www.aikido.dev/blog/pull-request-best-practices)
- [8 Essential Pull Request Best Practices for 2025 - Sopa](https://www.heysopa.com/post/pull-request-best-practices)

### Git Workflow Best Practices
- [Git Best Practices 2025 - ScriptBinary](https://scriptbinary.com/git/git-best-practices-improving-workflow-2025)
- [Check Uncommitted Changes - GitHub Marketplace](https://github.com/marketplace/actions/check-uncommitted-changes)
- [47 Git Best Practices - aCompiler](https://acompiler.com/git-best-practices/)

## Lessons Learned

1. **Temporal Awareness**: Guidelines must account for dynamic collaboration, not just linear workflows
2. **Explicit Reminders**: Critical checks need explicit reminders at decision points
3. **Consistency**: Both agent and claude tools need identical guidance
4. **Industry Alignment**: External research validates the need for these checks
5. **Gentle Guidance**: "When x do y" style preferred over commands

## Testing

Recommended tests after implementation:
1. Create issue with existing comments, add new comment during agent work, verify agent checks before finalizing
2. Create scenario with uncommitted changes, verify agent detects and handles appropriately
3. Verify style consistency with existing prompt patterns

## Related Issues

- Issue #865: Agent tool default model error (similar case study approach)
- Issue #867: Agent error not treated as error
- Issue #882: Tool agent infinite loop
