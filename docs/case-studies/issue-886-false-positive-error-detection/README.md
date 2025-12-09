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

## Proposed Solutions

### Solution 1: Enhanced JSON Parsing (RECOMMENDED)

**Problem:** The current skip logic parses JSON but the matched pattern still scans the entire line as text.

**Fix:** Ensure that when a tool output is marked as `completed`, the entire JSON line is excluded from pattern matching, not just from the `nonToolOutputLines` array check:

```javascript
const detectOutputErrors = (stdoutOutput, stderrOutput) => {
  const lines = stdoutOutput.split('\n');
  const nonToolOutputLines = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const msg = JSON.parse(line);

      // Check for explicit error message types
      if (msg.type === 'error' || msg.type === 'step_error') {
        return { detected: true, type: 'AgentError', match: line.substring(0, 100) };
      }

      // Check for failed tool execution (status = 'failed' or non-zero exit)
      if (msg.type === 'tool_use' && msg.part?.type === 'tool') {
        const state = msg.part?.state;
        if (state?.status === 'failed') {
          return { detected: true, type: 'ToolError', match: state.error || 'Tool failed' };
        }
        // Skip completed tools entirely - don't add to nonToolOutputLines
        if (state?.status === 'completed') {
          continue; // Completely exclude from scanning
        }
      }

      // Also handle the nested structure
      if (msg.type === 'tool' && msg.state?.status === 'completed') {
        continue;
      }

      nonToolOutputLines.push(line);
    } catch {
      nonToolOutputLines.push(line);
    }
  }

  // Only scan stderr and non-tool JSON lines
  const filteredOutput = nonToolOutputLines.join('\n') + '\n' + stderrOutput;
  // ... pattern matching continues
};
```

### Solution 2: Check Exit Code in Tool Metadata

**Approach:** Before flagging a pattern match from tool output, verify the tool's exit code.

```javascript
// In pattern matching, if pattern found in a tool output line,
// check if that tool had exit code 0
const getToolExitCode = (jsonLine) => {
  try {
    const msg = JSON.parse(jsonLine);
    if (msg.type === 'tool_use' || msg.type === 'tool') {
      return msg.part?.state?.metadata?.exit ?? msg.state?.metadata?.exit;
    }
  } catch { }
  return null;
};

// If exit code is 0, don't flag as error
```

### Solution 3: Distinguish Warning vs Error Text

**Approach:** Add context awareness to error patterns for shell warnings.

The pattern `/permission denied/i` is too broad. A shell "Permission denied" error from trying to execute a file is different from an actual permission error on a critical operation.

**Context-aware pattern:**
```javascript
// Only flag permission denied if it's NOT from shell command execution errors
// Shell errors format: "/bin/sh: N: filename: Permission denied"
{
  pattern: /(?<!\/bin\/sh:\s*\d+:\s*)[^\n]*permission denied[^\n]*/i,
  type: 'PermissionError'
}
```

Or use negative lookahead to exclude shell warning patterns:
```javascript
{
  pattern: /^(?!.*\/bin\/sh:).*permission denied/im,
  type: 'PermissionError'
}
```

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

## Recommended Implementation Plan

### Phase 1: Fix False Positive Detection
1. Update `detectOutputErrors()` in `src/agent.lib.mjs` to properly skip completed tool outputs
2. Handle both `type: "tool_use"` and `type: "tool"` JSON structures
3. Ensure nested `state.output` fields are not scanned

### Phase 2: Add Exit Code Verification
1. When pattern match found, verify if it came from a completed tool with exit code 0
2. If so, do not flag as error

### Phase 3: Add Tests
1. Test case: bash command with warning text but exit code 0 - should NOT flag error
2. Test case: bash command with error text and non-zero exit - SHOULD flag error
3. Test case: agent reads file with "permission denied" string - should NOT flag error

---

## Files to Modify

| File | Change Required |
|------|----------------|
| `src/agent.lib.mjs:473-521` | Update `detectOutputErrors()` to properly skip completed tool JSON |
| `tests/test-agent-error-detection.mjs` | Add test cases for false positive scenarios |

---

## Related Issues

- Issue #873: Phantom error detection for `--tool agent` (similar root cause, different trigger)
- Issue #867: Agent error not treated as error (related to error detection logic)

---

## Conclusion

This issue is a variant of the phantom error detection problem documented in Issue #873. While the fix for #873 added JSON-aware parsing, it didn't fully prevent completed tool outputs from being scanned when they contain error-like text in their output fields.

The key insight from this case study is that **successful tool execution (completed status + exit code 0) should never trigger false positive error detection**, regardless of what text appears in the tool's stdout/stderr output. Many tools produce warning messages or error-like text during normal operation, and these should not cause the entire agent execution to be marked as failed.

**Artifacts:**
- Full log file: `solve-2025-12-09T07-37-32-414Z.log`
- Test PR: https://github.com/konard/test-hello-world-019b020a-a43c-7544-aaa1-220021798428/pull/2
