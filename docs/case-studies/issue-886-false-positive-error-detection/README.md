# Case Study: Issue #886 - False Positive Error Detection for `--agent tool`

## Executive Summary

**Issue:** [#886 - False positive check for error in `--agent tool` and no logs in the comments](https://github.com/link-assistant/hive-mind/issues/886)

**Root Cause:** The error detection logic in `src/agent.lib.mjs` scans ALL tool outputs including successful (completed status) bash command outputs. When a bash command produces warnings or error-like text in its output BUT still completes successfully (exit code 0), the error detection incorrectly flags it as a failure.

**Specific Trigger:** The agent ran `gh pr edit` with a multi-line body containing backtick-escaped code snippets. The shell interpreted some backticks as command substitution, attempting to execute file paths like `src/main.rs` as commands. These produced "Permission denied" messages, but the `gh pr edit` command itself **succeeded** (returned the PR URL and exit code 0). The false positive error detection blocked the log attachment feature from running.

**Impact:**
1. Valid agent executions are incorrectly flagged as failures
2. Log attachment to PRs is blocked when false positive errors occur
3. Users see misleading error messages despite successful task completion

**Fix Status:** Solution identified and implementation ready.

---

## Timeline / Sequence of Events

### Event 1: Agent Execution Starts
- **Time:** 2025-12-09T07:37:32.414Z
- **Action:** solve.mjs invoked with `--tool agent --attach-logs`
- **Repository:** `konard/test-hello-world-019b020a-a43c-7544-aaa1-220021798428`
- **Issue:** #1 "Implement Hello World in Rust"

### Event 2: Agent Successfully Implements Solution
- **Time:** 2025-12-09T07:37:55 - 2025-12-09T07:39:34
- **Actions:**
  - Created Rust project with `cargo init`
  - Implemented `src/main.rs` with "Hello, World!" output
  - Created GitHub Actions workflow `.github/workflows/test-hello-world.yml`
  - Committed and pushed changes
  - All operations successful with exit code 0

### Event 3: PR Description Update (Trigger Point)
- **Time:** 2025-12-09T07:39:05.141Z
- **Tool:** bash
- **Command:** `gh pr edit 2 ... --body "## 🤖 AI-Powered Solution ... - \`Cargo.toml\`: Rust project manifest - \`src/main.rs\`: Hello World implementation ..."`
- **Problem:** The command body contained backtick-escaped file paths which the shell misinterpreted

### Event 4: Shell Misinterpretation
- **Time:** 2025-12-09T07:39:05.141Z
- **What Happened:** The shell attempted to execute backtick content as commands
- **Output Captured:**
```
/bin/sh: 1: src/main.rs: Permission denied
/bin/sh: 1: .github/workflows/test-hello-world.yml: Permission denied
/bin/sh: 1: Cargo.toml: not found
/bin/sh: 1: src/main.rs: Permission denied
/bin/sh: 1: .github/workflows/test-hello-world.yml: Permission denied
https://github.com/konard/test-hello-world-019b020a-a43c-7544-aaa1-220021798428/pull/2
```

**Critical Observation:**
- Tool state: `"status": "completed"`
- Metadata exit code: `"exit": 0`
- The PR URL was returned, indicating `gh pr edit` **succeeded**

### Event 5: Agent Completes Successfully
- **Time:** 2025-12-09T07:39:45.332Z
- **Step:** `step_finish` with reason `stop`
- **Agent Summary:** Reported successful completion of all tasks

### Event 6: False Positive Error Detection (BUG)
- **Time:** 2025-12-09T07:39:45.395Z
- **Location:** `src/agent.lib.mjs` - `detectOutputErrors()` function
- **Pattern Matched:** `/permission denied/i`
- **Match Source:** Line 1840 in the tool output from Event 3
- **Error Generated:**
```json
{
  "type": "error",
  "exitCode": 0,
  "errorDetectedInOutput": true,
  "errorType": "PermissionError",
  "errorMatch": "Permission denied",
  "message": "Agent command failed: PermissionError detected in output despite exit code 0"
}
```

### Event 7: Log Attachment Skipped
- **Time:** After 2025-12-09T07:39:45.503Z
- **Result:** Because the agent was marked as "failed", the `--attach-logs` feature was not triggered
- **Impact:** PR #2 has no solution log comment

---

## Root Cause Analysis

### Primary Issue: Scanning Completed Tool Outputs

The error detection code at `src/agent.lib.mjs:473-521` contains logic to filter out completed tool outputs:

```javascript
// Skip completed tool outputs (they contain source code/data)
if (msg.type === 'tool' && msg.state?.status === 'completed') {
  continue; // Don't scan successful tool output content
}
```

However, this filtering **only applies to JSON-parsed lines inside the `try` block**. The issue is that when the full output is scanned, completed bash tool outputs containing warning/error text SHOULD be skipped but are being caught by the pattern matching.

### Secondary Issue: Bash Escaping in Agent Commands

The agent constructed a command with backtick-escaped markdown:

```
--body "... - \`Cargo.toml\`: Rust project manifest ..."
```

The shell interpreted the content between backticks (e.g., `` `Cargo.toml` ``) as command substitution, attempting to run file paths as commands.

### Why Current Fix in Issue #873 Didn't Work

Issue #873's fix added JSON-aware parsing to skip completed tool outputs. However:

1. The tool output in this case has `state.status === 'completed'` - it SHOULD be skipped
2. But the error text appears in `state.output` and `metadata.output` fields
3. The current implementation doesn't fully prevent scanning of these nested output fields

Looking at the actual log structure:
```json
{
  "type": "tool",
  "state": {
    "status": "completed",  // This marks it as successful
    "output": "/bin/sh: 1: src/main.rs: Permission denied\n...",  // But contains "error" text
    "metadata": {
      "exit": 0  // Exit code confirms success
    }
  }
}
```

### The Fundamental Problem

The `detectOutputErrors()` function correctly identifies completed tools to skip, but the error patterns are still being matched against the combined output that includes all JSON lines. The issue is in how the filtering interacts with the final pattern matching:

```javascript
// Line 509-510: Combines filtered stdout with stderr
const filteredOutput = nonToolOutputLines.join('\n') + '\n' + stderrOutput;

// Line 513-517: Scans the filtered output
for (const { pattern, type } of errorPatterns) {
  const match = filteredOutput.match(pattern);
  if (match) {
    return { detected: true, type, match: match[0] };
  }
}
```

The bug occurs because the JSON lines are being added to `nonToolOutputLines` array even when they should be fully skipped. The tool output JSON line contains the "Permission denied" text as a string value, which gets matched.

---

## Evidence from Logs

### Tool Output (lines 1838-1851 in log)
```json
{
  "type": "tool_use",
  "part": {
    "type": "tool",
    "callID": "call_40598996",
    "tool": "bash",
    "state": {
      "status": "completed",
      "input": {
        "command": "gh pr edit 2 ... --body \"...`src/main.rs`...\""
      },
      "output": "/bin/sh: 1: src/main.rs: Permission denied\n...https://...pull/2\n",
      "metadata": {
        "exit": 0
      }
    }
  }
}
```

### Error Detection Output (lines 2463-2489 in log)
```
[2025-12-09T07:39:45.395Z] [ERROR]

❌ Agent command failed: PermissionError detected in output despite exit code 0
[2025-12-09T07:39:45.396Z] [ERROR]    Error pattern matched: Permission denied
...
{
  "type": "error",
  "exitCode": 0,
  "errorDetectedInOutput": true,
  "errorType": "PermissionError",
  "errorMatch": "Permission denied"
}
```

---

## Implemented Solution: Trust Exit Code

### Key Insight

The `@link-assistant/agent` package now properly handles errors:
- Returns exit code 1 on errors (not exit code 0)
- Outputs explicit JSON error messages (`type: "error"` or `type: "step_error"`)

This means we can **trust the exit code** and should not scan output for error patterns.

### Why Pattern Matching Was Removed

Pattern matching in agent output causes false positives because:
1. AI agents execute bash commands that produce warnings like "Permission denied"
2. AI agents read source code that contains error-related strings
3. AI agents may encounter and report error messages as part of their normal workflow

All these scenarios involve error-like text appearing in output but **do not indicate failure**.

### Final Implementation

The solution was simplified to only detect explicit JSON error messages:

```javascript
// Simplified error detection for agent tool
// Issue #886: Trust exit code - agent now properly returns code 1 on errors
const detectAgentErrors = (stdoutOutput) => {
  const lines = stdoutOutput.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const msg = JSON.parse(line);

      // Check for explicit error message types from agent
      if (msg.type === 'error' || msg.type === 'step_error') {
        return { detected: true, type: 'AgentError', match: msg.message || line.substring(0, 100) };
      }
    } catch {
      // Not JSON - ignore for error detection
      continue;
    }
  }

  return { detected: false };
};
```

### Error Detection Now Based On

1. **Exit code** (non-zero = error) - Primary error signal
2. **Explicit JSON error messages** (`type: "error"` or `type: "step_error"`)
3. **Usage limit detection** (handled separately)

### What Was Removed

- All error pattern matching (permission denied, ENOENT, stack traces, etc.)
- Complex JSON parsing to filter tool outputs
- Pattern scanning in stderr

---

## Impact of "No Logs in Comments"

The second part of issue #886 - "no logs in the comments" - is a **direct consequence** of the false positive error detection.

### Flow Analysis:

1. `solve.mjs` calls agent with `--attach-logs` flag
2. Agent completes and returns
3. `agent.lib.mjs` checks for errors in output
4. FALSE POSITIVE: Error detected despite exit code 0
5. Agent execution marked as FAILED
6. Log attachment code path is skipped (only runs on success)
7. PR #2 has no logs attached

### Code Path (src/solve.results.lib.mjs):

```javascript
// Line ~503-514
if (shouldAttachLogs && getLogFile()) {
  // Only called on success path, NOT on error path
}
```

### Fix Implication:

Fixing the false positive error detection will automatically restore the log attachment functionality, as the agent will correctly be marked as successful.

---

## Implementation Summary

### Files Modified

| File | Change |
|------|--------|
| `src/agent.lib.mjs` | Replaced `detectOutputErrors()` with simplified `detectAgentErrors()` |
| `tests/test-agent-error-detection.mjs` | Updated tests to match new simplified logic |
| `experiments/test-agent-error-detection.mjs` | Updated experiment to demonstrate fix |

### Test Results

All 10 test cases pass:
- Issue #886 scenario (bash with shell warnings) - No false positive ✅
- Issue #873 scenario (source code with error strings) - No false positive ✅
- Explicit JSON error messages - Detected correctly ✅
- Clean output - No false detection ✅

---

## Related Issues

- Issue #873: Phantom error detection for `--tool agent` (similar root cause, different trigger)
- Issue #867: Agent error not treated as error (related to error detection logic)

---

## Conclusion

This issue highlighted that pattern matching for error detection in agent output is fundamentally flawed. The previous approach attempted to identify errors by scanning output text for patterns like "permission denied", "ENOENT", or stack traces. However, this approach causes false positives because:

1. AI agents execute bash commands that may produce warnings
2. AI agents read/process source code containing error-related text
3. AI agents report errors they encounter as part of their normal workflow

**The solution**: Trust the exit code. The `@link-assistant/agent` package now properly returns:
- Exit code 1 on actual errors
- JSON error messages (`type: "error"`) for structured error reporting

This simple approach eliminates false positives while still detecting real failures.

**Artifacts:**
- Full log file: `solve-2025-12-09T07-37-32-414Z.log`
- Test PR: https://github.com/konard/test-hello-world-019b020a-a43c-7544-aaa1-220021798428/pull/2
