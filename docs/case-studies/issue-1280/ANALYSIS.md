# Case Study: `--tool claude` Command Execution Stuck After Success

## Issue Summary

**Issue URL**: https://github.com/link-assistant/hive-mind/issues/1280
**Report Date**: 2026-02-13
**Reporter**: @konard
**Severity**: High - Requires manual interrupt (CTRL+C) to terminate

## Problem Description

The `solve` command using `--tool claude` becomes stuck after successful task completion. The Claude Code CLI successfully completes its work (all CI checks pass, PR marked ready, final summary output), but the process hangs indefinitely until manually interrupted with CTRL+C.

## Timeline Reconstruction

Based on the log file `2ab1d239-9581-4d03-a895-af10c9fcb863.log`:

| Timestamp       | Event                                                         | Duration          |
| --------------- | ------------------------------------------------------------- | ----------------- |
| `20:51:52.702Z` | solve.mjs started                                             | -                 |
| `20:51:53.183Z` | Version: solve v1.22.4                                        | ~0.5s             |
| `20:52:00.361Z` | PR #158 branch identified: `issue-157-7ec6d0dc0010`           | ~7s               |
| `20:52:12.388Z` | Claude execution started                                      | ~12s              |
| `21:09:37.151Z` | Final tool use (CI check wait + sleep 60)                     | ~17min            |
| `21:09:43.587Z` | CI passing confirmed                                          | ~6s               |
| `21:09:52.131Z` | `gh pr ready 158` executed                                    | ~8s               |
| `21:10:07.696Z` | PR summary comment posted                                     | ~15s              |
| `21:10:17.135Z` | Final assistant message output                                | ~10s              |
| `21:10:17.168Z` | **SUCCESS RESULT** - `"type": "result", "subtype": "success"` | -                 |
| `21:10:17.169Z` | Cost captured: $5.573962                                      | < 1ms             |
| `21:10:17.169Z` | "Captured result summary from Claude output"                  | < 1ms             |
| **GAP**         | **PROCESS STUCK - NO ACTIVITY**                               | **~5 min 26 sec** |
| `21:15:43.123Z` | User interrupted with CTRL+C                                  | -                 |
| `21:15:43.126Z` | "Claude command completed"                                    | ~3ms              |
| `21:15:43.127Z` | "Interrupted (CTRL+C)"                                        | ~1ms              |

**Critical Gap**: Between `21:10:17.169Z` (last logged activity) and `21:15:43.123Z` (CTRL+C interrupt), there was **5 minutes 26 seconds** of no activity, despite the Claude execution having completed successfully.

## Root Cause Analysis

### 1. Known Claude Code CLI Hanging Issues

The investigation found multiple related issues in the `anthropics/claude-code` repository:

#### Issue #1920: Missing Final Result Event in Streaming JSON Output

- **Status**: Closed (auto-closed due to inactivity)
- **Description**: Claude Code CLI intermittently fails to send the final `{"type":"result",...}` event after successful tool execution, causing the process to hang indefinitely
- **Pattern**: Same behavior - functional completion occurs, but process never exits
- **URL**: https://github.com/anthropics/claude-code/issues/1920

#### Issue #3187: Claude Code Input Stream JSON Hang

- **Status**: Closed
- **Description**: Print/headless mode significantly slower than interactive; process hangs after first conversation
- **URL**: https://github.com/anthropics/claude-code/issues/3187

#### Issue #24478: Claude Code CLI Freezes and Becomes Unresponsive

- **Status**: Open (as of 2026-02-13)
- **Description**: CLI becomes completely unresponsive after ~10 minutes, all signals ignored except SIGKILL
- **Possible causes**: Event loop blocking, conversation state serialization issues, signal handler problems
- **URL**: https://github.com/anthropics/claude-code/issues/24478

#### Issue #24481: CLI Hangs Indefinitely on Simple Queries

- **Status**: Closed (duplicate of #24324)
- **Description**: CLI hangs indefinitely in print mode, never completes or exits
- **Pattern**: MCP initialization completes but process never proceeds
- **URL**: https://github.com/anthropics/claude-code/issues/24481

### 2. Exit Code Evidence

The log shows `exit code: 130` which corresponds to:

- `128 + SIGINT (2) = 130`
- This confirms the process was killed by SIGINT (Ctrl+C), not a graceful exit

### 3. Execution Flow Analysis

Looking at the code in `src/claude.lib.mjs`:

```javascript
// Line 950: Stream processing loop
for await (const chunk of execCommand.stream()) {
  if (chunk.type === 'stdout') {
    // Process NDJSON lines...
  }
}
```

The `for await` loop processes streaming output from Claude CLI. When Claude sends the final `result` event, the loop should complete. However, the issue appears to be that:

1. The Claude CLI sends the `result` event (logged at `21:10:17.168Z`)
2. The solve.mjs processes and logs it (`21:10:17.169Z`)
3. **But the `for await` loop doesn't complete** because the stdout stream hasn't closed

This suggests the Claude CLI process remains running after sending the result event, keeping stdout open.

### 4. command-stream Library

The `command-stream` library (v0.9.4) is used for async iteration over command output. Related issues in that repository:

- Issue #43: "Stream output handling issues" - mentions real-time output handling problems
- **URL**: https://github.com/link-foundation/command-stream

## Proposed Solutions

### Solution 1: Add Timeout After Result Event (Workaround)

In `src/claude.lib.mjs`, add a timeout mechanism after receiving the `result` event:

```javascript
let resultReceived = false;
let resultTimeout = null;

for await (const chunk of execCommand.stream()) {
  if (chunk.type === 'stdout') {
    // ... existing code ...
    if (data.type === 'result') {
      resultReceived = true;
      // Set a timeout to force exit if stream doesn't close
      resultTimeout = setTimeout(() => {
        log('⚠️  Timeout waiting for stream to close after result, forcing exit');
        // Force kill the child process
        execCommand.kill('SIGKILL');
      }, 30000); // 30 second timeout
    }
  }
}

if (resultTimeout) clearTimeout(resultTimeout);
```

### Solution 2: Report Upstream Bug to Anthropic

The root cause appears to be in Claude Code CLI itself. A detailed bug report should be filed:

**Suggested Report Content:**

- Title: "Claude Code CLI hangs after streaming result event - process doesn't exit cleanly"
- Symptoms: Process sends `{"type":"result","subtype":"success",...}` but doesn't close stdout or exit
- Environment: Headless mode with `--output-format stream-json --dangerously-skip-permissions`
- Reproducible: Intermittent, more likely with longer sessions (~18 minutes in this case)

### Solution 3: Graceful Termination on Result

Modify the streaming loop to proactively terminate when a `result` event is received:

```javascript
if (data.type === 'result') {
  // Process result...

  // Break out of the stream loop - we have everything we need
  break;
}
```

This requires restructuring the code to properly handle the early exit.

### Solution 4: Use Process Exit Code Instead of Stream Completion

Instead of waiting for the stream to complete, monitor the child process exit:

```javascript
const exitPromise = new Promise(resolve => {
  execCommand.on('exit', code => resolve(code));
});

const streamPromise = processStream(execCommand.stream());

// Race between stream completion and process exit
await Promise.race([streamPromise, exitPromise]);
```

## Impact Assessment

| Impact Area     | Severity | Description                                                          |
| --------------- | -------- | -------------------------------------------------------------------- |
| Automation      | High     | Automated CI/CD pipelines using solve command will hang indefinitely |
| Resource Usage  | Medium   | Stuck processes consume memory and may accumulate                    |
| User Experience | High     | Users must manually monitor and interrupt stuck processes            |
| Data Integrity  | Low      | Work is saved before hang occurs; no data loss                       |

## Recommendations

### Immediate (Workaround)

1. Implement Solution 1 (timeout after result event) in hive-mind
2. Add verbose logging to identify exactly where the hang occurs

### Short-term

1. File detailed bug report to `anthropics/claude-code` with session ID and logs
2. Add a CLI flag `--force-exit-after-result` to solve.mjs for users experiencing this issue

### Long-term

1. Work with Anthropic to fix the root cause in Claude Code CLI
2. Consider alternative approaches like using the Claude API directly instead of CLI

## Files and Evidence

- Log file: `./full-log.log` (1.16 MB, 8302 lines)
- Screenshot 1: `./screenshot1.png` - Shows success result JSON
- Screenshot 2: `./screenshot2.png` - Shows CTRL+C interrupt and subsequent cleanup

## Related Links

- Original Issue: https://github.com/link-assistant/hive-mind/issues/1280
- Related PR: https://github.com/link-assistant/agent/pull/158
- Claude Code Issues:
  - https://github.com/anthropics/claude-code/issues/1920
  - https://github.com/anthropics/claude-code/issues/3187
  - https://github.com/anthropics/claude-code/issues/24478
  - https://github.com/anthropics/claude-code/issues/24481
- command-stream Repository: https://github.com/link-foundation/command-stream
