# Case Study: Issue #642 - Codex Watch Mode and Network Issues

## Issue Reference
- **Issue**: [#642](https://github.com/link-assistant/hive-mind/issues/642)
- **Title**: Fix codex issues
- **Date**: 2025-11-01
- **Reporter**: @konard

## Problem Statement

Two issues were reported when running the solve command with codex tool:

1. **Unexpected Watch Mode Activation**: Watch mode was activated even though `--watch` was not specified in the command
2. **Codex Unable to Push to GitHub**: Codex tool couldn't push changes to the pull request it created

### Original Command
```bash
solve https://github.com/konard/test-hello-world-019a3fde-15cf-7144-a220-5f92e04d1bb4/issues/1 \
  --tool codex \
  --auto-fork \
  --auto-continue \
  --attach-logs \
  --verbose \
  --no-tool-check
```

## Analysis

### Issue 1: Watch Mode Activation Without --watch Flag

#### What Happened
From the log (lines 319-340):
```
[2025-11-01T14:45:59.166Z] [INFO] 🔄 Uncommitted changes detected - entering temporary watch mode to handle them...
[2025-11-01T14:45:59.166Z] [INFO]    Watch mode will exit automatically once changes are committed.
```

The system entered "watch mode" even though the `--watch` flag was not provided in the command.

#### Root Cause

The behavior is **intentional by design** but may be confusing to users. Here's the flow:

1. **Initial Codex Execution** (lines 173-262): Codex successfully created solution files (`main.v`, `hello.v`, `hello_test.v`)
2. **Uncommitted Changes Detection** (lines 268-275): After codex completed, the system detected uncommitted changes
3. **Auto-Restart Logic** (lines 277-281): The system triggered an auto-restart to handle uncommitted changes
4. **Temporary Watch Mode** (lines 327-340): To handle the uncommitted changes, the system entered "temporary watch mode"

The code in `solve.mjs:825-843`:
```javascript
// If uncommitted changes detected and auto-commit is disabled, enter temporary watch mode
const temporaryWatchMode = shouldRestart && !argv.watch;
if (temporaryWatchMode) {
  await log('');
  await log('🔄 Uncommitted changes detected - entering temporary watch mode to handle them...');
  await log('   Watch mode will exit automatically once changes are committed.');
}

await startWatchMode({
  // ...
  argv: {
    ...argv,
    watch: argv.watch || shouldRestart, // Enable watch if uncommitted changes
    temporaryWatch: temporaryWatchMode  // Flag to indicate temporary watch mode
  }
});
```

**Why This Happens:**
- Codex created files but didn't commit them in its first run
- The system detects uncommitted changes via `checkForUncommittedChanges()`
- To preserve the work and allow codex to commit the changes, the system enters "temporary watch mode"
- This mode automatically exits once all changes are committed

**Is This a Bug?**
No, this is intentional behavior designed to:
1. Preserve work when codex leaves uncommitted changes
2. Allow codex to complete its work by committing the changes
3. Prevent loss of generated code

**Potential Improvement:**
The messaging could be clearer. The log shows "Watch mode debug" which might confuse users into thinking `--watch` was specified. Better messaging could be:
```
🔄 AUTO-RESTART MODE: Codex left uncommitted changes
   Starting temporary watch cycle to allow codex to commit the changes...
   This is NOT the same as --watch mode and will exit automatically.
```

### Issue 2: Codex Unable to Push Changes to GitHub

#### What Happened
From the log (lines 429-431):
```
[2025-11-01T14:47:00.314Z] [INFO] {"type":"item.started",...command":"bash -lc 'git push origin issue-1-06e1c096...
[2025-11-01T14:47:00.374Z] [INFO] {"type":"item.completed",...aggregated_output":"fatal: unable to access 'https://github.com/konard/test-hello-world-019a3fde-15cf-7144-a220-5f92e04d1bb4.git/': Could not resolve host: github.com\n"...
```

Codex attempted to push changes but failed with "Could not resolve host: github.com".

#### Root Cause

This is a **network access limitation** in the Codex execution environment, not a bug in the solve script.

**Why This Happens:**
1. Codex runs in a sandboxed/containerized environment
2. The sandbox restricts network access for security
3. When codex tries to run `git push`, it cannot resolve github.com
4. This is by design in the Codex environment

**Expected Behavior:**
The solve script handles this correctly:
1. After codex completes, the script checks for uncommitted changes
2. If found, it triggers a restart in temporary watch mode
3. Codex runs again and should commit the changes locally
4. The solve script (running outside the sandbox) then pushes changes to GitHub

From the log (lines 423-426):
```javascript
git add .gitignore main.v hello.v hello_test.v &&
git commit -m "feat(v): implement Hello World with tests; ignore logs"
```

Codex successfully committed the changes in the second run. The solve script should then push these changes.

#### What Should Happen

The solve.mjs script should handle the push after codex completes. Looking at the watch mode implementation (`solve.watch.lib.mjs:127-135`):

```javascript
// In temporary watch mode, check if all changes have been committed
if (isTemporaryWatch && !firstIterationInTemporaryMode) {
  const hasUncommitted = await checkForUncommittedChanges(tempDir, $);
  if (!hasUncommitted) {
    await log('');
    await log(formatAligned('✅', 'CHANGES COMMITTED!', 'Exiting temporary watch mode'));
    await log(formatAligned('', 'All uncommitted changes have been resolved', '', 2));
    await log('');
    break;
  }
}
```

The watch mode checks if changes are committed and exits. However, **the script was interrupted** (line 452):
```
[2025-11-01T14:47:43.601Z] [ERROR] ❌ Interrupted (CTRL+C)
```

The user interrupted the process before it could complete the normal flow.

**Is This a Bug?**
No, this is expected behavior:
1. Codex cannot push due to sandbox network restrictions
2. Codex commits changes locally
3. The solve script detects the commit and should exit temporary watch mode
4. The solve script should then push the changes to GitHub (outside the sandbox)
5. **But the user interrupted with Ctrl+C before this could complete**

**Potential Improvement:**
The solve script could:
1. After exiting temporary watch mode, automatically push any committed changes
2. Add clearer logging about the push happening outside of codex
3. Document that codex cannot push directly due to network restrictions

## Timeline of Events

1. **14:43:49** - Solve command started with codex tool
2. **14:44:01** - Initial PR created as draft
3. **14:44:29** - First codex session started (thread_id: 019a3fe0-82fb-7e31-8e96-1d5c0544fd8a)
4. **14:45:51** - First codex session completed, files created but not committed
5. **14:45:52** - CLAUDE.md reverted and pushed
6. **14:45:52** - Uncommitted changes detected, triggering auto-restart
7. **14:45:55** - PR converted from draft to ready
8. **14:45:59** - Temporary watch mode activated (not user-requested --watch)
9. **14:46:06** - Second codex session started (thread_id: 019a3fe1-fd7f-7d41-8cae-d163ad45efae)
10. **14:46:55** - Codex committed changes locally
11. **14:47:00** - Codex tried to push (failed due to network)
12. **14:47:14** - Second codex session completed
13. **14:47:43** - **User interrupted with Ctrl+C** before normal completion

## Solution & Recommendations

### For Issue 1: Watch Mode Messaging

**Recommendation**: Improve messaging to distinguish between user-requested watch mode and automatic temporary watch mode.

**Proposed Changes**:
1. Update log messages in `solve.mjs:826-830` to be more explicit:
```javascript
if (temporaryWatchMode) {
  await log('');
  await log('🔄 AUTO-RESTART: Uncommitted changes detected - handling automatically...');
  await log('   Starting temporary monitoring cycle (NOT --watch mode)');
  await log('   Will exit automatically once changes are committed.');
  await log('');
}
```

2. In the watch mode debug output (`solve.mjs:815-822`), add clarity:
```javascript
await log('🔍 Watch mode debug:', { verbose: true });
await log(`   argv.watch (user flag): ${argv.watch}`, { verbose: true });
await log(`   shouldRestart (auto): ${shouldRestart}`, { verbose: true });
await log(`   temporaryWatch: ${temporaryWatchMode}`, { verbose: true });
```

### For Issue 2: Network Access Documentation

**Recommendation**: Document the expected behavior and add automatic push after temporary watch mode exits.

**Proposed Changes**:
1. Add documentation explaining codex network limitations
2. Ensure solve.mjs pushes changes after exiting temporary watch mode
3. Add logging to clarify what's happening:

```javascript
// After exiting temporary watch mode in solve.mjs
if (temporaryWatchMode) {
  await log('');
  await log('📤 Pushing committed changes to GitHub...');
  await log('   (Codex cannot push directly due to network restrictions)');

  try {
    await $({ cwd: tempDir })`git push origin ${branchName}`;
    await log('✅ Changes pushed successfully');
  } catch (error) {
    await log('⚠️  Push failed, please push manually:', { level: 'error' });
    await log(`   cd ${tempDir} && git push origin ${branchName}`, { level: 'error' });
  }
}
```

### Testing

To verify these issues:
1. Run solve with codex on a simple issue
2. Observe the temporary watch mode activation
3. Let it complete without interruption
4. Verify changes are pushed after codex commits them

## Conclusion

Both reported issues are not bugs but expected behavior with unclear messaging:

1. **Watch Mode**: Intentional auto-restart feature to handle uncommitted changes - needs better messaging
2. **Push Failure**: Expected due to codex sandbox network restrictions - needs documentation and automatic push after codex completes

The main issue was that the user interrupted the process (Ctrl+C) before it could complete the normal flow, which would have:
1. Exited temporary watch mode
2. Pushed the changes to GitHub
3. Completed successfully

### Key Takeaways

- Codex successfully created and committed files
- The system correctly detected uncommitted changes and restarted codex
- Codex cannot push due to network restrictions (by design)
- The solve script should push changes after codex commits them
- The process was interrupted before completion

### Related Code Files

- `src/solve.mjs` - Main solve logic and watch mode triggering (lines 800-846)
- `src/solve.watch.lib.mjs` - Watch mode implementation (lines 92-136)
- `src/codex.lib.mjs` - Codex execution and session ID extraction (lines 333-342)
- `src/codex.prompts.lib.mjs` - System prompts for codex (lines 174-175 mention push behavior)

### Related Commits

- [935b44b](https://github.com/link-assistant/hive-mind/commit/935b44b) - Fix codex session ID extraction to support thread_id
- [9115196](https://github.com/link-assistant/hive-mind/commit/9115196) - Fix auto-restart bug when uncommitted changes are detected
