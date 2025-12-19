# Proposed Improvements for Issue #642

## Overview

This document outlines the improvements to address the confusion around automatic watch mode activation and codex network limitations.

## Improvement 1: Better Messaging for Auto-Restart

### Problem
Users are confused when "watch mode" is activated even though they didn't specify `--watch`.

### Solution
Update messaging to clearly distinguish between:
- User-requested `--watch` mode (continuous monitoring)
- Automatic temporary watch mode (one-time restart to handle uncommitted changes)

### Implementation

#### File: `src/solve.mjs` (lines 815-830)

**Current code:**
```javascript
if (argv.verbose) {
  await log('');
  await log('🔍 Watch mode debug:', { verbose: true });
  await log(`   argv.watch: ${argv.watch}`, { verbose: true });
  await log(`   shouldRestart: ${shouldRestart}`, { verbose: true });
  await log(`   prNumber: ${prNumber || 'null'}`, { verbose: true });
  await log(`   prBranch: ${prBranch || 'null'}`, { verbose: true });
  await log(`   branchName: ${branchName}`, { verbose: true });
  await log(`   isContinueMode: ${isContinueMode}`, { verbose: true });
}

// If uncommitted changes detected and auto-commit is disabled, enter temporary watch mode
const temporaryWatchMode = shouldRestart && !argv.watch;
if (temporaryWatchMode) {
  await log('');
  await log('🔄 Uncommitted changes detected - entering temporary watch mode to handle them...');
  await log('   Watch mode will exit automatically once changes are committed.');
}
```

**Improved code:**
```javascript
if (argv.verbose) {
  await log('');
  await log('🔍 Auto-restart debug:', { verbose: true });
  await log(`   argv.watch (user flag): ${argv.watch}`, { verbose: true });
  await log(`   shouldRestart (auto-detected): ${shouldRestart}`, { verbose: true });
  await log(`   temporaryWatch (will be enabled): ${shouldRestart && !argv.watch}`, { verbose: true });
  await log(`   prNumber: ${prNumber || 'null'}`, { verbose: true });
  await log(`   prBranch: ${prBranch || 'null'}`, { verbose: true });
  await log(`   branchName: ${branchName}`, { verbose: true });
  await log(`   isContinueMode: ${isContinueMode}`, { verbose: true });
}

// If uncommitted changes detected and auto-commit is disabled, enter temporary watch mode
const temporaryWatchMode = shouldRestart && !argv.watch;
if (temporaryWatchMode) {
  await log('');
  await log('🔄 AUTO-RESTART: Uncommitted changes detected');
  await log('   Starting temporary monitoring cycle (NOT --watch mode)');
  await log('   The tool will run once more to commit the changes');
  await log('   Will exit automatically after changes are committed');
  await log('');
}
```

#### File: `src/solve.watch.lib.mjs` (lines 94-106)

**Current code:**
```javascript
await log('');
await log(formatAligned('👁️', 'WATCH MODE ACTIVATED', ''));
await log(formatAligned('', 'Checking interval:', `${watchInterval} seconds`, 2));
await log(formatAligned('', 'Monitoring PR:', `#${prNumber}`, 2));
if (isTemporaryWatch) {
  await log(formatAligned('', 'Mode:', 'Temporary (will exit when changes are committed)', 2));
  await log(formatAligned('', 'Stop conditions:', 'All changes committed OR PR merged', 2));
} else {
  await log(formatAligned('', 'Stop condition:', 'PR merged by maintainer', 2));
}
await log('');
await log('Press Ctrl+C to stop watching manually');
await log('');
```

**Improved code:**
```javascript
await log('');
if (isTemporaryWatch) {
  await log(formatAligned('🔄', 'AUTO-RESTART MODE ACTIVE', ''));
  await log(formatAligned('', 'Purpose:', 'Complete unfinished work from previous run', 2));
  await log(formatAligned('', 'Monitoring PR:', `#${prNumber}`, 2));
  await log(formatAligned('', 'Mode:', 'Temporary (NOT user-requested --watch)', 2));
  await log(formatAligned('', 'Stop conditions:', 'All changes committed OR PR merged', 2));
  await log(formatAligned('', 'Check interval:', `${watchInterval} seconds`, 2));
} else {
  await log(formatAligned('👁️', 'WATCH MODE ACTIVATED', ''));
  await log(formatAligned('', 'Checking interval:', `${watchInterval} seconds`, 2));
  await log(formatAligned('', 'Monitoring PR:', `#${prNumber}`, 2));
  await log(formatAligned('', 'Stop condition:', 'PR merged by maintainer', 2));
}
await log('');
await log('Press Ctrl+C to stop watching manually');
await log('');
```

## Improvement 2: Automatic Push After Temporary Watch Mode

### Problem
When codex commits changes but cannot push (due to network restrictions), the solve script should push them.

### Solution
Add automatic push logic after temporary watch mode exits successfully.

### Implementation

#### File: `src/solve.mjs` (after line 846)

**Add new code after `startWatchMode()` call:**

```javascript
// After watch mode completes (either user watch or temporary)
if (temporaryWatchMode) {
  await log('');
  await log('📤 Pushing committed changes to GitHub...');
  await log('   (Tool cannot push directly due to network restrictions)');
  await log('');

  try {
    const pushResult = await $({ cwd: tempDir })`git push origin ${branchName}`;
    if (pushResult.code === 0) {
      await log('✅ Changes pushed successfully to remote branch');
      await log(`   Branch: ${branchName}`);
      await log('');
    } else {
      const errorMsg = pushResult.stderr?.toString() || 'Unknown error';
      await log('⚠️  Push failed:', { level: 'error' });
      await log(`   ${errorMsg.trim()}`, { level: 'error' });
      await log('   Please push manually:', { level: 'error' });
      await log(`   cd ${tempDir} && git push origin ${branchName}`, { level: 'error' });
    }
  } catch (error) {
    await log('⚠️  Push failed:', { level: 'error' });
    await log(`   ${cleanErrorMessage(error)}`, { level: 'error' });
    await log('   Please push manually:', { level: 'error' });
    await log(`   cd ${tempDir} && git push origin ${branchName}`, { level: 'error' });
  }
}
```

## Improvement 3: Documentation

### Problem
Users don't understand why codex can't push directly.

### Solution
Add documentation explaining the codex sandbox environment and network restrictions.

### Implementation

#### Create new file: `docs/codex-limitations.md`

```markdown
# Codex Tool Limitations

## Network Restrictions

The Codex tool runs in a sandboxed environment with restricted network access for security reasons.

### What This Means

1. **Cannot Push to GitHub**: Codex cannot run `git push` directly
2. **Cannot Fetch External Resources**: Limited access to external APIs
3. **Cannot Run Network Commands**: Commands like `curl`, `wget` may fail

### How solve.mjs Handles This

The solve script works around these limitations:

1. **Initial Setup**: solve.mjs clones the repo and sets up the branch (before codex runs)
2. **Codex Execution**: Codex creates and modifies files, commits locally
3. **Auto-Restart**: If codex leaves uncommitted changes, solve.mjs restarts codex automatically
4. **Final Push**: After codex completes, solve.mjs pushes changes to GitHub (outside sandbox)

### Expected Workflow

```
[solve.mjs] Clone repo and create branch
            ↓
[codex]     Make changes and commit locally
            ↓
[solve.mjs] Detect uncommitted changes? → Restart codex
            ↓
[codex]     Commit remaining changes
            ↓
[solve.mjs] Push all commits to GitHub
            ↓
[solve.mjs] Exit successfully
```

### Troubleshooting

If you see "Could not resolve host: github.com" in codex output:
- ✅ This is expected and normal
- ✅ solve.mjs will handle the push after codex completes
- ⚠️  Don't interrupt with Ctrl+C - let the process complete

If solve.mjs doesn't push after codex completes:
- Check if you interrupted the process early
- Manually push: `git push origin <branch-name>`
- Report as a bug if it consistently fails
```

#### Update existing file: `README.md`

Add a section about codex limitations in the README:

```markdown
### Using Codex Tool

The `--tool codex` option uses OpenAI's Codex CLI for solving issues.

**Network Limitations**: Codex runs in a sandboxed environment and cannot push to GitHub directly. The solve script automatically pushes changes after Codex completes. See [Codex Limitations](docs/codex-limitations.md) for details.

**Auto-Restart**: If Codex leaves uncommitted changes, the script will automatically restart Codex to commit them. This is not the same as `--watch` mode and exits automatically.
```

## Testing Plan

### Test Case 1: Verify Improved Messaging

1. Run solve with codex on a simple issue
2. Verify the tool creates files but doesn't commit them initially
3. Check that the log shows "AUTO-RESTART" not "WATCH MODE ACTIVATED"
4. Verify the log clearly states it's not user-requested watch mode

**Expected Output:**
```
🔄 AUTO-RESTART: Uncommitted changes detected
   Starting temporary monitoring cycle (NOT --watch mode)
   The tool will run once more to commit the changes
   Will exit automatically after changes are committed

🔄 AUTO-RESTART MODE ACTIVE
   Purpose: Complete unfinished work from previous run
   Mode: Temporary (NOT user-requested --watch)
```

### Test Case 2: Verify Automatic Push

1. Run solve with codex on a simple issue
2. Let it complete without interruption
3. Verify that after codex commits changes, solve.mjs pushes them
4. Check that the remote branch is updated

**Expected Output:**
```
📤 Pushing committed changes to GitHub...
   (Tool cannot push directly due to network restrictions)

✅ Changes pushed successfully to remote branch
   Branch: issue-X-xxxxxxxx
```

### Test Case 3: Verify Push Error Handling

1. Run solve with codex
2. Simulate a push failure (e.g., no network, auth issue)
3. Verify clear error message and manual push instructions

**Expected Output:**
```
⚠️  Push failed:
   [error details]
   Please push manually:
   cd /tmp/gh-issue-solver-... && git push origin issue-X-xxxxxxxx
```

## Implementation Checklist

- [ ] Update messaging in `src/solve.mjs` (lines 815-830)
- [ ] Update messaging in `src/solve.watch.lib.mjs` (lines 94-106)
- [ ] Add automatic push logic in `src/solve.mjs` (after line 846)
- [ ] Create `docs/codex-limitations.md` documentation
- [ ] Update `README.md` with codex limitations section
- [ ] Test with actual codex execution
- [ ] Verify improved messaging is clear
- [ ] Verify automatic push works correctly
- [ ] Verify error handling for push failures
- [ ] Update case study with implementation results

## Summary

These improvements address the user confusion by:
1. **Clearer Messaging**: Distinguishing auto-restart from user-requested watch mode
2. **Automatic Push**: Handling the push after codex commits changes
3. **Better Documentation**: Explaining codex limitations and expected behavior

The changes maintain backward compatibility while making the behavior more transparent and user-friendly.
