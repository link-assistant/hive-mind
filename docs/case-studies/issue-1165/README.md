# Case Study: Issue #1165 - False Positive "Claude Command Completed" When Claude CLI Not Installed

## Issue Summary

When the `claude` CLI command is not found (not installed or not in PATH), the solve.mjs tool incorrectly reports "✅ Claude command completed" instead of detecting the failure.

## Timeline of Events (from PR #1164 logs)

```
[2026-01-23T18:31:31.463Z] /bin/sh: 1: claude: not found
[2026-01-23T18:31:31.464Z]
✅ Claude command completed
[2026-01-23T18:31:31.464Z] 📊 Total messages: 0, Tool uses: 0
```

## Root Cause Analysis

### 1. Exit Event Not Received

The `command-stream` library's `.stream()` method does not emit an 'exit' chunk type when the command fails to start. The code at `claude.lib.mjs:1069-1075` that checks for exit events:

```javascript
} else if (chunk.type === 'exit') {
  exitCode = chunk.code;
  if (chunk.code !== 0) {
    commandFailed = true;
  }
}
```

...never executes because the exit event is not emitted.

**Evidence from experiments:**

```
=== Test: Exit event with command not found (immediate failure) ===
stderr: /bin/sh: 1: nonexistent_cmd_xyz_123: not found
Final exit code: null
Chunk types received: [ 'stderr' ]
```

### 2. stderr Error Detection Pattern Too Narrow

The code at `claude.lib.mjs:1064-1067` only captures stderr errors matching specific keywords:

```javascript
if (trimmed && !isWarning && (trimmed.includes('Error:') || trimmed.includes('error') || trimmed.includes('failed'))) {
  stderrErrors.push(trimmed);
}
```

The message `/bin/sh: 1: claude: not found` contains `not found` which was NOT matched by this pattern.

### 3. Fallback Detection Fails

The code at line 1211-1218 has a fallback for detecting failures:

```javascript
if (!commandFailed && stderrErrors.length > 0 && messageCount === 0 && toolUseCount === 0) {
  commandFailed = true;
  // ...
}
```

But since `stderrErrors` was empty (due to issue #2), this fallback never triggered.

## Solution

The fix implements **two layers of protection** for maximum reliability:

### Layer 1: Text Pattern Matching (Original Fix)

Add `not found` to the stderr error detection pattern at `claude.lib.mjs:1067`:

```javascript
// Issue #1165: Also detect "command not found" errors (e.g., "/bin/sh: 1: claude: not found")
// These indicate the Claude CLI is not installed or not in PATH
if (trimmed && !isWarning && (trimmed.includes('Error:') || trimmed.includes('error') || trimmed.includes('failed') || trimmed.includes('not found'))) {
  stderrErrors.push(trimmed);
}
```

This ensures the following error messages are correctly detected:

| Shell       | Error Message                                                   |
| ----------- | --------------------------------------------------------------- |
| sh (Ubuntu) | `/bin/sh: 1: claude: not found`                                 |
| bash        | `bash: claude: command not found`                               |
| zsh         | `command not found: claude` or `zsh: command not found: claude` |

### Layer 2: Exit Code Detection (Enhanced Fix)

Per PR feedback requesting "something more reliable like actual code of command", added exit code 127 detection after the streaming loop:

```javascript
// Issue #1165: Check actual exit code from command result for more reliable detection
// The .stream() method may not emit 'exit' chunks, but the command object still tracks the exit code
// Exit code 127 is the standard Unix convention for "command not found"
if (execCommand.result && typeof execCommand.result.code === 'number') {
  const resultExitCode = execCommand.result.code;
  if (exitCode === 0 && resultExitCode !== 0) {
    exitCode = resultExitCode;
    await log(`⚠️ Updated exit code from command result: ${resultExitCode}`, { verbose: true });
  }
  // Specifically detect "command not found" via exit code 127
  if (resultExitCode === 127 && !commandFailed) {
    commandFailed = true;
    await log(`\n❌ Command not found (exit code 127) - "${claudePath}" is not installed or not in PATH`, { level: 'error' });
    await log('   Please ensure Claude CLI is installed: npm install -g @anthropic-ai/claude-code', { level: 'error' });
  }
}
```

**Why exit code 127?**

Exit code 127 is the standard Unix/POSIX convention for "command not found":

- All POSIX-compliant shells return 127 when a command cannot be found
- This is more reliable than text pattern matching which can vary by shell and locale
- The `command-stream` library stores the exit code in `execCommand.result.code` after streaming completes

## Test Verification

Created `experiments/test-fix-verification.mjs` to verify both layers of the fix work:

```
=== Issue #1165 Fix Verification ===

✅ PASS: Shell command not found
  Input: "/bin/sh: 1: claude: not found"
  Expected: true, Got: true

✅ PASS: Zsh command not found
  Input: "command not found: claude"
  Expected: true, Got: true

✅ PASS: Bash command not found
  Input: "bash: claude: command not found"
  Expected: true, Got: true

...

=== Summary: Text Pattern Detection ===
Passed: 12/12
Failed: 0/12

=== Exit Code Detection (PR #1166 Enhancement) ===

✅ PASS: Exit code 127 (command not found)
  Exit code: 127
  Expected command not found: true, Got: true

✅ PASS: Exit code 126 (permission denied) - not command not found specific
  Exit code: 126
  Expected command not found: false, Got: false

✅ PASS: Exit code 0 (success)
  Exit code: 0
  Expected command not found: false, Got: false

=== Final Summary ===
Total passed: 16
Total failed: 0
```

## Files Modified

- `src/claude.lib.mjs` - Two changes:
  1. Added `|| trimmed.includes('not found')` to stderr error detection pattern (line 1067)
  2. Added exit code 127 detection after streaming loop (lines 1080-1094)

## Experiments Created

- `experiments/test-command-not-found.mjs` - Investigation of command-stream behavior
- `experiments/test-command-stream-exit.mjs` - Investigation of exit event behavior
- `experiments/test-fix-verification.mjs` - Verification of the fix

## Lessons Learned

1. **command-stream streaming behavior**: The `.stream()` method may not always emit exit events, especially for commands that fail to start. However, the exit code is still available via `execCommand.result.code` after streaming completes.
2. **Error detection patterns need to be comprehensive**: Shell error messages vary by shell type and should cover common patterns like "not found"
3. **Multiple layers of failure detection**: Having fallback detection (like the `stderrErrors` check) is good practice, but each layer needs complete patterns
4. **Exit codes are more reliable than text patterns**: Exit code 127 is a universal POSIX convention for "command not found", making it more reliable than parsing shell-specific error messages
5. **Defense in depth**: Implementing both text pattern matching AND exit code detection provides redundancy in case either method fails

## References

- Original issue: https://github.com/link-assistant/hive-mind/issues/1165
- Related PR: https://github.com/link-assistant/hive-mind/pull/1164
- Fix PR: https://github.com/link-assistant/hive-mind/pull/1166
