# Technical Summary: Conflict Resolution Failure Analysis

## System Architecture Overview

The `solve.mjs` system handles conflict detection and agent prompting through the following components:

### 1. Auto-Continue Module (`src/solve.auto-continue.lib.mjs`)

Fetches PR merge state status via GitHub API:

```javascript
// Lines 289, 312
jsonFields: 'headRefName,body,number,mergeStateStatus,headRepositoryOwner',
...
mergeStateStatus = prData.mergeStateStatus;
```

### 2. Feedback Module (`src/solve.feedback.lib.mjs`)

Converts merge state to human-readable feedback:

```javascript
// Lines 316-328
if (mergeStateStatus && mergeStateStatus !== 'CLEAN') {
  const statusDescriptions = {
    DIRTY: 'Merge status is DIRTY (conflicts detected)',
    UNSTABLE: 'Merge status is UNSTABLE (non-passing commit status)',
    BLOCKED: 'Merge status is BLOCKED',
    BEHIND: 'Merge status is BEHIND (head ref is out of date)',
    HAS_HOOKS: 'Merge status is HAS_HOOKS (has pre-receive hooks)',
    UNKNOWN: 'Merge status is UNKNOWN',
  };
  const description = statusDescriptions[mergeStateStatus] || `Merge status is ${mergeStateStatus}`;
  feedbackLines.push(description);
  feedbackDetected = true;
  feedbackSources.push(`Merge status ${mergeStateStatus}`);
}
```

### 3. Agent Prompts Module (`src/agent.prompts.lib.mjs`)

The system prompt includes conflict handling as a guideline:

```javascript
// Line 190
"make sure the default branch is merged to the pull request's branch,"
```

This appears within the "When you finalize the pull request" section, making it a checklist item rather than an immediate action.

## Flow Diagram

```
┌─────────────────────┐
│ solve.mjs starts    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Check PR status     │
│ via GitHub API      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ mergeStateStatus =  │
│ "DIRTY"             │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Add to feedbackLines│
│ "Merge status is    │
│ DIRTY (conflicts)"  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Build user prompt   │
│ with feedbackLines  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Agent receives      │
│ prompt with         │
│ conflict info       │
└──────────┬──────────┘
           │
           ▼
    ┌──────┴──────┐
    │   Agent     │
    │  DOES NOT   │
    │   resolve   │  ← Issue occurs here
    │  conflicts  │
    └─────────────┘
```

## Why The Agent Doesn't Act on DIRTY Status

### Current Prompt Structure

The user prompt received by the agent:

```
Issue to solve: https://github.com/veb86/GristWidgets/issues/8
Your prepared branch: issue-8-d4719601faa7
Your prepared working directory: /tmp/gh-issue-solver-1769164320916
Your prepared Pull Request: https://github.com/veb86/GristWidgets/pull/9

New comments on the pull request: 1
Merge status is DIRTY (conflicts detected)

Continue.
```

### Issues with This Approach

1. **Informational Only**: The DIRTY status is presented as information, not as an action item
2. **No Urgency Indicator**: Nothing signals that this must be addressed immediately
3. **Buried in Guidelines**: The system prompt's conflict handling is part of a "finalize" checklist
4. **Model Interpretation**: Grok Code Fast 1 may prioritize task completion over addressing status messages

## Agent Session Analysis

### Session pr-1769164538444 (Conflicts NOT Resolved)

**Agent's behavior pattern:**

1. Read PR details - checked what was needed
2. Read code files - understood the codebase
3. Searched for information about jQuery Tabledit
4. Made code improvements
5. Ran `gh pr ready` - marked PR ready
6. Stated task complete

**Missing step**: Never ran `git merge` or `git rebase` to resolve conflicts

### Session pr-1769183633153 (Conflicts RESOLVED)

After receiving explicit comment "Resolve conflicts, please.":

**Agent's behavior pattern:**

1. Read the new comment
2. Attempted `git merge origin/main` (exit code 1 - conflicts detected)
3. Analyzed conflicts
4. Made necessary file changes
5. Committed the merge
6. Pushed changes

**Key difference**: Explicit instruction triggered immediate action

## Comparison with Claude Code Prompts

The Claude prompts (`src/claude.prompts.lib.mjs`) have a nearly identical structure:

```javascript
// Line 234
"make sure the default branch is merged to the pull request's branch,"
```

However, Claude models typically exhibit stronger adherence to checklist-style instructions in system prompts.

## Code Path for Agent Tool

```
solve.mjs
  └── executeAgentTool() in agent.lib.mjs
       └── buildUserPrompt() in agent.prompts.lib.mjs
       └── buildSystemPrompt() in agent.prompts.lib.mjs
            └── Runs: agent --model opencode/grok-code
```

## Token Usage Comparison

| Session | Input Tokens | Output Tokens | Reasoning Tokens |
|---------|--------------|---------------|------------------|
| pr-1769164538444 | 49,213 | 52 | 8 |
| pr-1769183633153 | 113,024 | 55 | 5 |

The session that resolved conflicts used significantly more context (cached), suggesting it needed more information to understand the conflict resolution task.

## Repository Setup Module (`src/solve.repository.lib.mjs`)

The system does sync the default branch with upstream:

```javascript
// Lines 974-1006
await log(`${formatAligned('🔄', 'Syncing default branch...', '')}`);
...
const syncResult = await $({ cwd: tempDir })`git reset --hard upstream/${upstreamDefaultBranch}`;
```

**But**: This only syncs the default branch (`main`), not the PR branch. The PR branch must be manually merged/rebased by the agent.

## GitHub Merge State Status Values

Reference from GitHub API documentation:

| Status | Meaning |
|--------|---------|
| CLEAN | Branch can be merged cleanly |
| DIRTY | Conflicts exist between branches |
| UNSTABLE | Merge would include non-passing commit statuses |
| BLOCKED | Blocked by branch protection rules |
| BEHIND | Head ref is out of date with base branch |
| HAS_HOOKS | Repository has pre-receive hooks |
| UNKNOWN | Status cannot be determined |

## Technical Constraints

1. **No Automatic Merge**: The system cannot automatically merge branches because:
   - Conflict resolution may require code understanding
   - Wrong resolutions could break functionality
   - Human oversight is needed for non-trivial conflicts

2. **Agent Autonomy**: The agent must decide when and how to merge:
   - Check for conflicts
   - Understand both versions of conflicting code
   - Apply appropriate resolution strategy
   - Test the result

3. **Fork Workflow**: When working with forks:
   - The upstream remote is set up automatically
   - But merging upstream changes must be done by the agent
