# Proposed Solutions for Automatic Conflict Resolution

## Problem Summary

When using `--tool agent`, merge conflicts are not automatically resolved by the AI agent (Grok Code Fast 1), requiring manual human intervention.

## Proposed Solutions

### Solution 1: Prompt Enhancement (Low Complexity, Recommended First Step)

**Approach**: Modify the system prompt to include explicit conflict resolution instructions that are not just guidelines but immediate actions.

**Changes to `src/agent.prompts.lib.mjs`**:

```javascript
// Add at the beginning of buildSystemPrompt()
const conflictResolutionInstructions = `
CRITICAL: Merge Conflict Resolution
   - When merge status is DIRTY (conflicts detected), you MUST resolve conflicts BEFORE any other work.
   - Steps to resolve conflicts:
      1. Run: git fetch origin main (or upstream/main for forks)
      2. Run: git merge origin/main (this will show conflicts)
      3. For each conflicting file, read both versions and resolve appropriately
      4. Stage resolved files: git add <file>
      5. Commit the merge: git commit -m "Merge branch 'main' into <pr-branch>"
      6. Push changes: git push origin <pr-branch>
   - NEVER mark PR as ready for review until conflicts are resolved.
   - NEVER skip conflict resolution to proceed with other tasks.
`;
```

**Changes to `src/agent.prompts.lib.mjs` for user prompt**:

```javascript
// In buildUserPrompt(), when feedbackLines contains DIRTY status:
if (feedbackLines.some(line => line.includes('DIRTY'))) {
  promptLines.push('');
  promptLines.push('URGENT: Merge conflicts must be resolved before proceeding with any other work.');
  promptLines.push('');
}
```

**Pros**:

- Simple to implement
- No architectural changes
- Works with existing infrastructure

**Cons**:

- Relies on model following instructions
- May not work consistently across all models

---

### Solution 2: Pre-Flight Conflict Resolution (Medium Complexity)

**Approach**: Add automated conflict resolution as a pre-flight step in `solve.mjs` before the agent starts working.

**New module: `src/solve.conflict-resolution.lib.mjs`**:

```javascript
/**
 * Attempt to automatically resolve conflicts before agent session
 */
export const attemptAutoMerge = async params => {
  const { tempDir, branchName, mergeStateStatus, log, formatAligned, $ } = params;

  if (mergeStateStatus !== 'DIRTY') {
    return { resolved: true, method: 'no-conflicts' };
  }

  await log(formatAligned('🔄', 'Attempting auto-merge:', 'Resolving conflicts...'));

  // Fetch latest from origin
  await $({ cwd: tempDir })`git fetch origin`;

  // Try to merge with default options
  const mergeResult = await $({ cwd: tempDir, ignoreExitCode: true })`git merge origin/main`;

  if (mergeResult.code === 0) {
    await log(formatAligned('✅', 'Auto-merge:', 'Successful'));
    return { resolved: true, method: 'auto-merge' };
  }

  // Check if conflicts can be resolved with "ours" or "theirs" strategy
  // (Only for simple conflicts in non-critical files)

  // Abort the failed merge
  await $({ cwd: tempDir })`git merge --abort`;

  return { resolved: false, method: 'manual-required' };
};
```

**Integration in `solve.mjs`**:

```javascript
// After checking mergeStateStatus
if (mergeStateStatus === 'DIRTY') {
  const autoMergeResult = await attemptAutoMerge({
    tempDir,
    branchName,
    mergeStateStatus,
    log,
    formatAligned,
    $,
  });

  if (!autoMergeResult.resolved) {
    // Add explicit instruction to agent prompt
    feedbackLines.push('CRITICAL: Manual conflict resolution required.');
    feedbackLines.push('You must resolve merge conflicts before proceeding.');
  }
}
```

**Pros**:

- Handles simple conflicts automatically
- Reduces agent workload
- Faster resolution for trivial conflicts

**Cons**:

- May not work for complex conflicts
- Risk of incorrect automatic resolution

---

### Solution 3: Conflict-Aware Session Gating (High Complexity)

**Approach**: Prevent agent from marking PR ready if conflicts exist.

**New validation in `src/solve.results.lib.mjs`**:

```javascript
/**
 * Validate PR state before marking ready
 */
export const validatePrReadiness = async (prNumber, owner, repo) => {
  const prStatusResult = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json mergeStateStatus`;
  const prStatus = JSON.parse(prStatusResult.stdout);

  if (prStatus.mergeStateStatus === 'DIRTY') {
    return {
      ready: false,
      reason: 'Merge conflicts must be resolved before marking PR ready',
      action: 'resolve-conflicts',
    };
  }

  return { ready: true };
};
```

**Hook into agent tool execution**:

- Intercept `gh pr ready` commands
- Validate PR state before allowing execution
- Return error message if conflicts exist

**Pros**:

- Prevents premature "ready" status
- Forces agent to address conflicts
- Clear feedback mechanism

**Cons**:

- Complex to implement (command interception)
- May confuse agent if command fails unexpectedly

---

### Solution 4: Post-Session Conflict Check (Medium Complexity)

**Approach**: After agent session completes, check if conflicts still exist and restart session if needed.

**Changes to `solve.mjs`**:

```javascript
// After agent session completes
const postSessionPrStatus = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json mergeStateStatus`;
const postStatus = JSON.parse(postSessionPrStatus.stdout);

if (postStatus.mergeStateStatus === 'DIRTY') {
  await log(formatAligned('⚠️', 'Post-session check:', 'Conflicts still exist'));

  // Restart session with explicit conflict resolution instruction
  feedbackLines = ['CRITICAL: Merge conflicts were not resolved. You must resolve them now.'];
  // Re-run agent session
}
```

**Pros**:

- Self-correcting mechanism
- Ensures conflicts are eventually resolved
- No changes to agent behavior required

**Cons**:

- May cause session restart loops
- Wastes tokens if agent consistently fails
- Delays overall completion

---

### Solution 5: AI-Powered Merge Tool Integration (High Complexity)

**Approach**: Integrate with specialized AI merge tools like Reconcile-AI or Syncwright.

**New module: `src/ai-merge.lib.mjs`**:

```javascript
import { exec } from 'child_process';

/**
 * Use external AI merge tool
 */
export const resolveConflictsWithAI = async params => {
  const { tempDir, conflictFiles, log, formatAligned } = params;

  await log(formatAligned('🤖', 'AI Merge:', 'Using external conflict resolver...'));

  // Use syncwright or reconcile-ai CLI
  const result = await exec(`syncwright resolve --path ${tempDir} --confidence 0.8`);

  if (result.success) {
    // Stage and commit resolved files
    await $({ cwd: tempDir })`git add .`;
    await $({ cwd: tempDir })`git commit -m "Resolve merge conflicts (AI-assisted)"`;
    return { resolved: true };
  }

  return { resolved: false, reason: result.error };
};
```

**Pros**:

- Specialized tool for conflict resolution
- High-quality resolutions
- Confidence scoring for safety

**Cons**:

- External dependency
- May require API keys/costs
- Additional installation required

---

## Recommended Implementation Order

1. **Phase 1** (Immediate): Solution 1 - Prompt Enhancement
   - Low risk, quick implementation
   - Test effectiveness with current agent

2. **Phase 2** (Short-term): Solution 4 - Post-Session Conflict Check
   - Self-correcting behavior
   - Works as safety net

3. **Phase 3** (Medium-term): Solution 2 - Pre-Flight Conflict Resolution
   - Handles simple conflicts automatically
   - Reduces agent burden

4. **Phase 4** (Long-term): Solution 5 - AI Merge Tool Integration
   - For complex conflict scenarios
   - Professional-grade resolution

---

## Implementation Notes

### For Solution 1 (Prompt Enhancement)

**File changes needed:**

- `src/agent.prompts.lib.mjs` - Add conflict resolution instructions
- `src/claude.prompts.lib.mjs` - Mirror changes for consistency

**Testing:**

1. Create a test PR with intentional conflicts
2. Run `solve` with `--tool agent`
3. Verify agent resolves conflicts before other work
4. Check that PR status changes from DIRTY to CLEAN

### Metrics to Track

- Number of sessions with unresolved conflicts
- Time to conflict resolution
- Success rate of automatic resolution
- Agent token usage for conflict resolution tasks

---

## Online Research Findings

Several AI-powered merge conflict resolution tools exist:

1. **Reconcile-AI**: Open-source headless merge conflict resolver
   - [GitHub](https://github.com/kailashchanel/reconcile-ai)

2. **Syncwright**: Production-ready CLI tool with confidence scoring
   - [GitHub](https://github.com/NeuBlink/syncwright)

3. **VS Code AI Merge**: Built-in to VS Code 1.105+
   - Uses agentic flow with merge base context

4. **GitHub Copilot Pro+**: Automatic merge conflict handling
   - Integrated with GitHub PRs

### Best Practices from Research

From [Graphite Guides](https://graphite.com/guides/ai-code-merge-conflict-resolution):

- "While AI can provide valuable assistance, it's essential to review its suggestions"
- Combine AI suggestions with manual reviews

From [Medium (Elisheba Anderson)](https://medium.com/@elisheba.t.anderson/building-with-ai-coding-agents-best-practices-for-agent-workflows-be1d7095901b):

- "Treat every AI output as a draft requiring human oversight"
- "Strong Git practices keep your work transparent and easy to review"

From [Git Advanced Merging](https://git-scm.com/book/en/v2/Git-Tools-Advanced-Merging):

- "Git does not try to be overly clever about merge conflict resolution"
- "If there is a conflict, it does not try to be clever about automatically resolving it"
