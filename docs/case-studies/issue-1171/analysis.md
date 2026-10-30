# Case Study: Issue #1171 - Analysis of AI Solver Termination

## Executive Summary

This document analyzes the unexpected termination of an AI issue solver session on 2026-01-23. The solve.mjs process was working on issue #131 in the `link-assistant/agent` repository when it received a SIGTERM signal after approximately 36 minutes of execution.

## Source Data

- **Full Log File**: `original-log.txt` (13,956 lines)
- **Gist Reference**: https://gist.github.com/konard/6f3e31e2775e1da3e296ac6849fba815
- **Session ID**: `3ac5805a-e7bf-44c8-bdce-a4ff0de215db`
- **Target Issue**: https://github.com/link-assistant/agent/issues/131
- **Created PR**: https://github.com/link-assistant/agent/pull/132

---

## Timeline of Events

### Phase 1: Initialization (19:30:08 - 19:30:36)

| Timestamp | Event |
|-----------|-------|
| 19:30:08.541Z | Solve v1.9.0 started |
| 19:30:08.543Z | Log file created: `/home/hive/solve-2026-01-23T19-30-08-541Z.log` |
| 19:30:14.110Z | Disk space check passed (45,909 MB available) |
| 19:30:14.111Z | Memory check passed (9,749 MB available) |
| 19:30:17.892Z | Repository cloned to `/tmp/gh-issue-solver-1769196616847` |
| 19:30:18.264Z | Branch created: `issue-131-e0fcd2d405df` |
| 19:30:27.284Z | PR #132 created as draft |
| 19:30:36.538Z | Claude CLI execution started with Opus model |

### Phase 2: Claude Execution (19:30:36 - 20:06:14)

The Claude AI agent was actively working on the issue:
- **Issue Being Solved**: "Agent CLI outputs stderr instead of stdout"
- **Model Used**: `claude-opus-4-5-20251101`
- **Total Duration**: ~36 minutes

#### Key Activities During Execution:

1. **19:30:38Z** - Session initialized with tools (Bash, Glob, Grep, Read, Edit, Write, etc.)
2. **Multiple test runs** - AI agent ran `bun test` commands to verify changes
3. **Code modifications** - Changes were being made to fix the stderr/stdout issue
4. **20:03:09Z** - AI started a background test command with 180s timeout:
   ```bash
   AGENT_CLI_COMPACT=1 bun test 2>&1 | head -100
   ```

### Phase 3: Termination Sequence (20:06:11 - 20:06:15)

| Timestamp | Event | Notes |
|-----------|-------|-------|
| 20:06:11.246Z | Background task ID `badbe79` registered | Test command running in background |
| 20:06:13.720Z | TaskOutput tool called | AI waiting for test results with 180s timeout |
| **20:06:14.681Z** | "Keeping directory" logged | **Cleanup function triggered - indicates SIGTERM received** |
| 20:06:14.875Z | TaskOutput result received | Exit code 144 (from bun test process) |
| 20:06:14.966Z | Empty line logged | |
| **20:06:14.976Z** | "Terminated" logged | Process exits |

---

## Root Cause Analysis

### Primary Finding: SIGTERM Signal Received

The solve.mjs process received a **SIGTERM signal** (signal 15), which triggered:

1. The cleanup function (`cleanupTempDirectory`) which logged:
   ```
   📁 Keeping directory (--no-auto-cleanup): /tmp/gh-issue-solver-1769196616847
   ```

2. The exit handler's `showExitMessage('Terminated', 143)` call

### Evidence from Source Code

From `src/exit-handler.lib.mjs:130-148`:
```javascript
// Handle SIGTERM
process.on('SIGTERM', async () => {
  if (cleanupFunction) {
    try {
      await cleanupFunction();
    } catch {
      // Ignore cleanup errors on signal
    }
  }
  await showExitMessage('Terminated', 143);
  // ...
  process.exit(143);
});
```

### The Exit Code 144 Confusion

The log shows exit code 144, but this came from the **bun test subprocess**, not from solve.mjs itself:

- Exit code 144 = 128 + 16 (Signal 16 = SIGSTKFLT on x86/SIGUSR1 on some systems)
- This was the exit code of the background `bun test` command
- The solve.mjs process itself would have exited with code 143 (SIGTERM)

The timing shows the TaskOutput result (with exit code 144 from bun test) arrived **after** the cleanup function started but **before** the final termination message.

### Likely Cause of SIGTERM

The SIGTERM signal was most likely sent by one of:

1. **System Process Manager**: A parent process managing solve.mjs
2. **Timeout Mechanism**: External timeout on the solve operation
3. **User Action**: Manual termination via kill command
4. **Resource Monitor**: System watchdog detecting resource usage

**Note**: Without access to system logs or the process tree at termination time, the exact source cannot be definitively determined.

---

## Contributing Factors

### Factor 1: Long-Running Test with Timeout Issues

The AI was running tests that had timeout issues:
```
(fail) Agent-cli still accepts JSON input [60000.54ms]
  ^ this test timed out after 60000ms.
```

Multiple test runs showed:
- Tests were timing out after 60 seconds
- Tests were producing "killed 1 dangling process" messages
- JSON parsing errors were occurring

### Factor 2: Background Task Complexity

The background task system introduced timing complexities:
- Task `badbe79` was started as a background process
- TaskOutput was called to wait for results
- The termination occurred during this wait period

### Factor 3: Test Process Exit Code 144

The bun test process exited with code 144 (signal 16), indicating:
- The test process itself received an unusual signal
- This could be related to timeout handling in bun or process cleanup

---

## Key Findings

### Finding 1: The Termination Was External

The solve.mjs process did not crash or encounter an internal error. It was gracefully terminated by receiving SIGTERM from an external source.

### Finding 2: Work Was In Progress

At termination time:
- The AI was actively fixing the issue
- Tests were being run to verify changes
- A background task was in progress

### Finding 3: Cleanup Executed Successfully

The exit handler worked as designed:
- Cleanup function was called
- "Keeping directory" message was logged
- Exit message "Terminated" was displayed
- Log file path was shown

### Finding 4: Data Was Preserved

Due to `--no-auto-cleanup` flag:
- Working directory `/tmp/gh-issue-solver-1769196616847` was preserved
- Session ID `3ac5805a-e7bf-44c8-bdce-a4ff0de215db` can be used for resume
- Full log was saved

---

## Recommendations

### Recommendation 1: Investigate SIGTERM Source

To prevent future unexpected terminations:
- Check if there's an external timeout configured for solve operations
- Review parent process configuration
- Check system-level process managers (systemd, supervisor, etc.)

### Recommendation 2: Add Signal Source Logging

Enhance the exit handler to log more context when receiving signals:
```javascript
process.on('SIGTERM', async () => {
  await log(`⚠️ SIGTERM received at ${new Date().toISOString()}`);
  await log(`   Process uptime: ${process.uptime()} seconds`);
  await log(`   Parent PID: ${process.ppid}`);
  // ... existing cleanup code
});
```

### Recommendation 3: Implement Graceful Test Interruption

When SIGTERM is received during test execution:
- Attempt to gracefully stop running tests
- Wait for current tool operations to complete (with short timeout)
- Preserve partial test results

### Recommendation 4: Session Resume Capability

The session can potentially be resumed using:
```bash
cd /tmp/gh-issue-solver-1769196616847 && claude --resume 3ac5805a-e7bf-44c8-bdce-a4ff0de215db
```

---

## Appendix A: Signal Reference

| Signal | Number (x86) | Exit Code (128+n) | Meaning |
|--------|--------------|-------------------|---------|
| SIGINT | 2 | 130 | Interrupt (Ctrl+C) |
| SIGKILL | 9 | 137 | Kill (cannot be caught) |
| SIGTERM | 15 | 143 | Termination request |
| SIGSTKFLT | 16 | 144 | Stack fault |

---

## Appendix B: Related Resources

- [Standard Exit Status Codes in Linux](https://www.baeldung.com/linux/status-codes)
- [SIGTERM: Linux Graceful Termination](https://komodor.com/learn/sigterm-signal-15-exit-code-143-linux-graceful-termination/)
- [Exit Codes in Linux Explained](https://itsfoss.com/linux-exit-codes/)
- [Bun signal-exit package issue](https://github.com/oven-sh/bun/issues/12918)

---

## Document Information

- **Created**: 2026-01-23
- **Issue Reference**: https://github.com/link-assistant/hive-mind/issues/1171
- **Author**: AI Issue Solver
