# Case Study: Issue #1161 - Auto-restart with Tool Agent Led to Upload of Files Not Explicitly Asked by User or Requirements

## Summary

When the AI tool agent completed its work session with uncommitted files (temporary data files created during research), the auto-restart mechanism triggered a new session that committed and pushed these files to the pull request. These files were **not part of the original requirements** and **not explicitly requested by the user**. The issue points out that uncommitted files should have been discarded rather than committed.

## Context

- **External Repository**: `veb86/GristWidgets`
- **External Issue**: [GristWidgets#8](https://github.com/veb86/GristWidgets/issues/8) - "Создай новый виджет в папке edittable"
- **External PR**: [GristWidgets#9](https://github.com/veb86/GristWidgets/pull/9)
- **Full Log Reference**: [Gist with complete execution trace](https://gist.github.com/konard/98f44cb214fbd473a9a58013de86a526)

## Timeline of Events

| Timestamp (UTC)      | Event                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------ |
| 2026-01-23T10:11:05Z | solve.mjs started with `--tool agent --auto-resume-on-limit-reset`                         |
| 2026-01-23T10:11:23Z | Agent started working on existing PR #9 (continue mode activated)                          |
| 2026-01-23T10:11:32Z | Agent began executing with GROK-CODE model                                                 |
| 2026-01-23T10:12:04Z | Agent created todo list and started research phase                                         |
| 2026-01-23T10:13:42Z | Agent created temporary data files: `issue_8_*.txt`, `pr_9_*.txt`, `related_prs.txt`       |
| 2026-01-23T10:16:31Z | Agent committed actual widget implementation: `git add widget/edittable/`                  |
| 2026-01-23T10:17:15Z | Agent committed: "Add initial implementation of edittable widget"                          |
| 2026-01-23T10:18:21Z | Agent session ended with uncommitted data files still present                              |
| 2026-01-23T10:19:03Z | **AUTO-RESTART triggered** - Detected 7 uncommitted files                                  |
| 2026-01-23T10:19:11Z | solve.mjs entered temporary watch mode for auto-restart                                    |
| 2026-01-23T10:19:17Z | Auto-restart session listed uncommitted files to agent                                     |
| 2026-01-23T10:19:42Z | Agent created todo: "Handle uncommitted changes: commit the fetched GitHub data files..."  |
| 2026-01-23T10:19:47Z | **Agent committed temporary files**: `git add issue_8_*.txt pr_9_*.txt related_prs.txt`    |
| 2026-01-23T10:19:52Z | **Committed**: "Add fetched GitHub data for issue #8 research"                             |
| 2026-01-23T10:19:54Z | **Pushed** the commit with data files to the PR                                            |

## Problematic Files Committed

The following 7 files were committed and pushed, but should have been **discarded** as they were:
- Temporary research artifacts
- Not part of the original requirements
- Not explicitly requested by the user

```
issue_8_comments.txt
issue_8_details.txt
pr_9_conversation_comments.txt
pr_9_details.txt
pr_9_review_comments.txt
pr_9_reviews.txt
related_prs.txt
```

## Root Cause Analysis

### Primary Root Cause: Auto-restart Mechanism Lacks Discrimination

The auto-restart feature (`src/agent.lib.mjs:670`, `src/solve.mjs:1150-1186`) is designed to ensure no work is lost when an agent session ends with uncommitted changes. However, it **does not distinguish between**:

1. **Legitimate uncommitted work** - Actual code changes that should be committed
2. **Temporary research files** - Data files created during the research phase that should be discarded

When auto-restart is triggered, the agent receives a prompt informing it of uncommitted changes and instructing it to "review the changes and decide what to commit." The agent in this case interpreted all uncommitted files as legitimate work and committed them all.

### Contributing Factors

#### 1. Lack of `.gitignore` Rules for Research Files
The temporary data files (`*_comments.txt`, `*_details.txt`, etc.) were not in `.gitignore`, making them candidates for commits.

#### 2. Agent Prompt Ambiguity
The auto-restart prompt at `src/solve.watch.lib.mjs:230` shows uncommitted changes but doesn't provide clear guidance on which files should be discarded vs committed.

#### 3. No File Classification Logic
The system lacks logic to classify uncommitted files as:
- Source code / implementation (commit)
- Documentation (commit if requested)
- Temporary / research artifacts (discard)

### Code Location Analysis

**Auto-restart trigger logic** (`src/agent.lib.mjs:665-673`):
```javascript
} else if (autoRestartEnabled) {
  await log('');
  await log('⚠️  IMPORTANT: Uncommitted changes detected!');
  await log('   Agent made changes that were not committed.');
  await log('');
  await log('🔄 AUTO-RESTART: Restarting Agent to handle uncommitted changes...');
  await log('   Agent will review the changes and decide what to commit.');
  await log('');
  return true;
}
```

**Watch mode uncommitted handling** (`src/solve.watch.lib.mjs:229-230`):
```javascript
if (firstIterationInTemporaryMode || hasUncommittedInTempMode) {
  await log(formatAligned('📝', 'UNCOMMITTED CHANGES:', '', 2));
  // Get uncommitted changes for display
```

The agent is simply told there are uncommitted changes and to "decide what to commit" - but given no criteria for making that decision.

## Impact Analysis

### Immediate Impact
- Unnecessary files were pushed to a public pull request
- These files contain GitHub API response data (issue details, PR details)
- While not containing secrets, they clutter the PR and misrepresent the actual work done

### Broader Implications
- **User Trust**: Users may lose trust if the AI commits unexpected files
- **PR Quality**: Pull requests become harder to review with extraneous files
- **Repository Cleanliness**: Accumulated research artifacts pollute the codebase

## Proposed Solutions

### Solution 1: Add File Classification Logic (Recommended)

Implement a classification system that distinguishes between different types of uncommitted files:

```javascript
const classifyUncommittedFiles = (files) => {
  const sourceCode = [];
  const documentation = [];
  const temporary = [];

  for (const file of files) {
    if (file.match(/\.(txt|json)$/) && file.match(/(issue|pr|comments|details|reviews)/i)) {
      temporary.push(file);
    } else if (file.match(/\.(md|rst|txt)$/) && file.match(/(README|CHANGELOG|docs\/)/i)) {
      documentation.push(file);
    } else {
      sourceCode.push(file);
    }
  }

  return { sourceCode, documentation, temporary };
};
```

### Solution 2: Auto-discard Research Artifacts

Add a pattern-based auto-cleanup before auto-restart:

```javascript
const researchPatterns = [
  /^issue_\d+_.*\.txt$/,
  /^pr_\d+_.*\.txt$/,
  /^related_prs\.txt$/,
  /^.*_comments\.txt$/,
  /^.*_details\.txt$/,
  /^.*_reviews\.txt$/,
];

const cleanupResearchFiles = async (tempDir, files) => {
  for (const file of files) {
    if (researchPatterns.some(p => p.test(file))) {
      await fs.unlink(path.join(tempDir, file));
    }
  }
};
```

### Solution 3: Enhanced Agent Prompt

Modify the auto-restart prompt to provide explicit guidance:

```javascript
await log('🔄 AUTO-RESTART: Uncommitted changes detected');
await log('');
await log('   IMPORTANT: Only commit files that are:');
await log('   ✅ Part of the implementation (source code, configs)');
await log('   ✅ Explicitly requested documentation');
await log('   ');
await log('   DO NOT commit:');
await log('   ❌ Temporary research files (issue_*.txt, pr_*.txt, etc.)');
await log('   ❌ Debug logs or test outputs');
await log('   ❌ Cached API responses');
await log('');
await log('   If unsure, discard the file by running: git checkout -- <filename>');
```

### Solution 4: Use `.gitignore` for Research Artifacts

Add patterns to the repository's `.gitignore` or create a working-directory-specific ignore file:

```gitignore
# Research artifacts created by AI agents
issue_*_comments.txt
issue_*_details.txt
pr_*_conversation_comments.txt
pr_*_review_comments.txt
pr_*_reviews.txt
pr_*_details.txt
related_prs.txt
```

### Solution 5: Discard by Default (Conservative Approach)

Change the default behavior to **discard uncommitted changes** unless explicitly instructed otherwise:

```javascript
if (hasUncommittedChanges && autoRestartEnabled) {
  await log('');
  await log('⚠️  Uncommitted changes detected. Discarding by default.');
  await log('   Use --preserve-uncommitted to keep changes for next session.');
  await $`git checkout -- .`;
  await $`git clean -fd`;
  return false; // No restart needed
}
```

This is the most conservative approach and aligns with the issue reporter's statement: "uncommitted files should have been discarded."

## Recommendation

**Implement Solution 1 (File Classification) + Solution 3 (Enhanced Prompt) + Solution 4 (.gitignore)**

This combination provides:
1. **Intelligent handling** - Distinguishes between legitimate code and research artifacts
2. **Clear guidance** - Helps the agent make better decisions
3. **Preventive measure** - Stops research files from being tracked in the first place

## Verification Steps

After implementing fixes:

1. Run a solve session that creates research files during the research phase
2. Verify auto-restart is triggered when session ends with uncommitted changes
3. Confirm research files are either:
   - Automatically discarded (Solution 2)
   - Ignored by git (Solution 4)
   - Not committed by agent (Solutions 1, 3)
4. Verify legitimate code changes are still properly committed

## Related Research

### Industry Best Practices

From research on AI agent code change management:

- **[Goose Blog - Stop AI Agent Unwanted Changes](https://block.github.io/goose/blog/2025/12/10/stop-ai-agent-unwanted-changes/)**: Emphasizes "commit early and often" with meaningful messages, and using branch isolation to prevent unwanted changes from affecting the primary codebase.

- **[Anthropic - Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)**: Discusses challenges of agents working across multiple context windows and the need for human-inspired engineering practices.

- **[UiPath - Agent Builder Best Practices](https://www.uipath.com/blog/ai/agent-builder-best-practices)**: Recommends building modular systems and avoiding retry mechanisms for non-deterministic agent output.

### Key Takeaways

1. **Clean git state** makes it easier to isolate AI-introduced bugs and rollback cleanly
2. **Rollback must be instantaneous** and preserve system integrity
3. **Avoid retry mechanisms** for agents - output isn't deterministic
4. **Supervision means every agent run is traceable, controllable, and improvable**

## References

- Issue: https://github.com/link-assistant/hive-mind/issues/1161
- External PR with problem: https://github.com/veb86/GristWidgets/pull/9
- Full execution log: https://gist.github.com/konard/98f44cb214fbd473a9a58013de86a526
- PR comment with log: https://github.com/veb86/GristWidgets/pull/9#issuecomment-3789544445

## Data Collected

All relevant logs and data have been saved to this case study folder:

- `solution-draft-log-pr-9-gristwidgets.txt` - Full execution log from the auto-restart session (1.3MB)
- `pr-9-all-comments.txt` - All comments from the PR discussion
