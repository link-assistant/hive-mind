# Timeline - Issue #916

## Chronological Sequence of Events

### 2025-12-11 16:14:32Z - Issue #916 Created
**Author**: Konstantin Diachenko (@konard)
**Title**: Add a note to system message, that it might be useful to check comments to pull request/issue not only in the beginning of the work, but also after work is finished

**Issue Description**:
The issue identifies two important gaps in the AI agent workflow:

1. **Missing Final Comment Check**: AI agents for both `--tool claude` and `--tool agent` should check for recent comments on issues/pull requests not only at the beginning but also before finishing work. This ensures no latest feedback is missed.

2. **Missing Uncommitted Changes Check**: Need to add a todo/checklist step to verify the repository has no uncommitted changes that should be either committed or discarded.

**Requirements**:
- Keep style as "When x do y." with gentle hints, not commands
- Download all logs and data to `./docs/case-studies/issue-{id}` folder
- Perform deep case study analysis
- Search online for additional facts and data
- Reconstruct timeline/sequence of events
- Find root causes of the problem
- Propose possible solutions

**Labels**: bug

### 2025-12-11 16:15:13Z - Initial Commit
**Commit**: 2811359a75249183aba40f364a4fd92ccb55c8c4
**Author**: konard
**Branch**: issue-916-4aa4af8d2bd1

Initial commit with task details adding CLAUDE.md with task information for AI processing.

### 2025-12-11 16:15:20Z - PR #917 Created
**Title**: [WIP] Add a note to system message, that it might be useful to check comments to pull request/issue not only in the beginning of the work, but also after work is finished

PR created automatically by the AI issue solver to address issue #916.

### 2025-12-11 17:15+ - Case Study Analysis Begins
AI agent begins comprehensive investigation:
- Reading prompt library files (agent.prompts.lib.mjs, claude.prompts.lib.mjs)
- Creating case study folder structure
- Downloading issue and PR data
- Searching for related issues and PRs
- Conducting online research for best practices
- Analyzing current system message patterns

## Key Observations

### Current State (Before Fix)

#### In agent.prompts.lib.mjs (lines 119-132):
**Initial Research Section**:
- Line 131: "When you need latest comments on pull request, use gh api repos/${owner}/${repo}/pulls/${prNumber}/comments."
- Line 132: "When you need latest comments on issue, use gh api repos/${owner}/${repo}/issues/${issueNumber}/comments."
- These hints exist but are in "Initial research" section only, not in "Preparing pull request" or "Self review" sections

#### In claude.prompts.lib.mjs (lines 133-147):
**Initial Research Section**:
- Line 146: "When you need latest comments on pull request (sorted newest first), use appropriate GitHub API commands."
- Line 147: "When you need latest comments on issue (sorted newest first), use appropriate GitHub API commands."
- Same pattern: hints only in initial phase, not at finalization

**"Preparing pull request" Section** (lines 161-177 in claude.prompts.lib.mjs):
- Line 169-177: Extensive checklist for finalization including:
  - Merge default branch
  - Check CI passing
  - Review gh pr diff
  - Verify features not removed per issue/PR comments
- **Gap**: No explicit hint to check for NEW comments before finishing

**No Uncommitted Changes Check**:
- Neither file has a hint to check for uncommitted changes before finalizing
- Line 171 in claude.prompts.lib.mjs says "make sure no uncommitted changes corresponding to the original requirements are left behind" but this is about ensuring work is committed, not checking git status

### External Research Findings

From industry best practices research (2025):
- PRs should be reviewed within 2 hours to maintain momentum
- All comment statuses should be tracked (Active/Pending/Resolved)
- Uncommitted changes should be checked before finalization
- CI checks should verify no uncommitted changes exist
- GitHub Actions exist specifically for checking uncommitted changes using `git status --porcelain`

## Timeline Summary

The issue identifies a real workflow gap where AI agents might finish work without checking for feedback that arrived during the implementation phase. The current system messages guide agents to check comments at the start but not explicitly before marking work as complete.
