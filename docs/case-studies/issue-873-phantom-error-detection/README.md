# Case Study: Issue #873 - Phantom Error Detection for `--tool agent`

## Executive Summary

**Issue:** [#873 - Phantom error detection for `--tool agent`](https://github.com/link-assistant/hive-mind/issues/873)

**Root Cause:** The error detection logic in `src/agent.lib.mjs` scans **all stdout output** from the Claude agent for error patterns. When the agent reads source code files containing error-related text (like "permission denied" in error handling code), these strings trigger false positive error detection despite successful execution (exit code 0).

**Impact:** Valid agent executions are incorrectly flagged as failures, causing workflow interruptions and reporting false errors to users.

**Fix Status:** Solution identified and documented.

---

## Timeline / Sequence of Events

### Event 1: Agent Execution Starts
- **Time:** 2025-12-09T01:36:28.882Z
- **Action:** Agent starts working on issue #692
- **File:** PR #711 context
- **Status:** Normal execution

### Event 2: Agent Reads Source File
- **Time:** ~2025-12-09T01:37:18Z
- **Action:** Agent uses "read" tool to read `src/solve.auto-pr.lib.mjs`
- **Log Location:** Line 1290-1301 in full-agent-log.txt
- **Content:** File contains error handling code with strings like:
  - Line 375: `if (errorOutput.includes('Permission to') && errorOutput.includes('denied'))`
  - Line 404: `await log(\`\\n\${formatAligned('❌', 'PERMISSION DENIED:', 'Cannot push to repository')}\`, { level: 'error' });`
  - Line 691: `// User doesn't have permission, but that's okay - we just won't assign`

### Event 3: Agent Tool Output Captured
- **Time:** During execution
- **Action:** The entire file content is part of the JSON tool output and sent to stdout
- **Data Structure:**
  ```json
  {
    "type": "tool",
    "callID": "call_48792570",
    "tool": "read",
    "state": {
      "status": "completed",
      "input": {
        "filePath": "src/solve.auto-pr.lib.mjs"
      },
      "output": "<file>\n00001| /**\n... [entire file content including error handling code] ..."
    }
  }
  ```

### Event 4: Agent Completes Successfully
- **Time:** 2025-12-09T01:37:53.619Z
- **Action:** Agent completes with step_finish
- **Exit Code:** 0 (success)
- **Log:** Shows successful summary message

### Event 5: Error Detection Runs (BUG TRIGGERED)
- **Time:** 2025-12-09T01:37:53.673Z
- **Location:** `src/agent.lib.mjs:454-484`
- **Action:** Error detection scans `combinedOutput = fullOutput + allStderr`
- **Pattern Matched:** `/permission denied/i` at line 462
- **Match Found:** "permission denied" text from source code in tool output
- **Result:** False positive error detected

### Event 6: Error Reported
- **Time:** 2025-12-09T01:37:53.673Z
- **Log Output:**
  ```
  ❌ Agent command failed: PermissionError detected in output despite exit code 0
     Error pattern matched: permission denied
     Last output context (truncated): ... solution reduces timeline noise ...
  ```

### Event 7: Structured Error JSON Logged
- **Time:** 2025-12-09T01:37:53.674Z
- **Error Details:**
  ```json
  {
    "type": "error",
    "exitCode": 0,
    "errorDetectedInOutput": true,
    "errorType": "PermissionError",
    "errorMatch": "permission denied",
    "message": "Agent command failed: PermissionError detected in output despite exit code 0",
    "sessionId": null,
    "limitReached": false,
    "limitResetTime": null
  }
  ```

---

## Root Cause Analysis

### Primary Cause

The error detection logic in `src/agent.lib.mjs:454-484` uses regex patterns to scan for errors in combined stdout+stderr output. The critical flaw is at **line 471**:

```javascript
// Check both stdout and stderr for error patterns
const combinedOutput = fullOutput + allStderr;
```

This `fullOutput` includes **all JSON-formatted tool outputs** from the agent, including the complete content of files read by the agent. When source code contains error-related strings (as normal error handling code does), these trigger false positives.

### Why This Design Exists

The error detection was implemented to catch cases where:
1. The Node.js process exits with code 0 despite throwing uncaught exceptions
2. Actual errors are reported in agent output but don't cause non-zero exit codes
3. Reference: Line 455 comment: "Agent may exit with code 0 despite throwing errors (Node.js uncaught exception behavior)"

### The Fundamental Conflict

- **Need:** Detect real errors that don't produce non-zero exit codes
- **Problem:** Can't distinguish between:
  - Actual error messages in agent output
  - Error-related text in source code being read/processed by agent
  - Error-related text in agent's analysis/summary of code

### Examples of Problematic Patterns (src/agent.lib.mjs:456-468)

```javascript
const errorPatterns = [
  { pattern: /ProviderModelNotFoundError/i, type: 'ProviderModelNotFoundError' },
  { pattern: /ModelNotFoundError/i, type: 'ModelNotFoundError' },
  { pattern: /\s+at\s+\S+\s+\([^)]+:\d+:\d+\)/m, type: 'StackTrace' },
  { pattern: /throw new \w+Error/i, type: 'ThrowError' },           // ⚠️ Matches source code
  { pattern: /authentication failed/i, type: 'AuthenticationError' },// ⚠️ Matches strings
  { pattern: /permission denied/i, type: 'PermissionError' },        // ⚠️ THIS ONE!
  { pattern: /ENOENT|EACCES|EPERM/i, type: 'FileSystemError' },
  { pattern: /TypeError:|ReferenceError:|SyntaxError:/i, type: 'JavaScriptError' },
  { pattern: /Cannot read propert(y|ies) of (undefined|null)/i, type: 'NullReferenceError' },
  { pattern: /Uncaught Exception:/i, type: 'UncaughtException' },
  { pattern: /Unhandled Rejection/i, type: 'UnhandledRejection' },
];
```

**High-risk patterns** (likely to match source code):
- `/permission denied/i` - Common in error handling code
- `/throw new \w+Error/i` - Appears in any code with error throwing
- `/authentication failed/i` - Common in auth-related code

---

## Research Findings: Best Practices for Error Detection (2025)

Based on web research, industry best practices for avoiding false positives in stdout/stderr error detection include:

### 1. **Exit Codes are Primary Source of Truth**
- Logging output is not the primary output of a program
- Stderr exists specifically to separate core program output from error/logging
- **Source:** [How to use stdout and stderr](https://julienharbulot.com/python-cli-streams.html)

### 2. **Context-Aware Parsing**
- Pattern matching should validate context, not just presence of text
- Distinguish between keywords in the right place vs. wrong place
- **Source:** [Regex Log Parser | Panther Docs](https://docs.panther.com/data-onboarding/custom-log-types/regex-parser)

### 3. **Structured Format Validation**
- Validate that extracted data matches expected structure (e.g., starts with `{` or `[`)
- Use structured formats over plain text when possible
- **Source:** [AI Agent structured output parser · Issue #21174](https://github.com/n8n-io/n8n/issues/21174)

### 4. **Stream Separation**
- Separating stderr from stdout allows distinguishing expected output from errors
- Mixing streams makes debugging harder
- **Source:** [What Are stdin, stdout, and stderr on Linux?](https://www.howtogeek.com/435903/what-are-stdin-stdout-and-stderr-on-linux/)

### 5. **Multi-layered Validation**
- Combine exit codes, structured formats, and pattern matching
- Regular testing against diverse log samples
- **Source:** [How to avoid False Positives in Testing | BrowserStack](https://www.browserstack.com/guide/false-positives-and-false-negatives-in-testing)

---

## Proposed Solutions

### Solution 1: Parse JSON Structure (RECOMMENDED)

**Approach:** Parse agent output as structured JSON and only check specific fields for errors, not tool output content.

**Implementation:**
```javascript
// Instead of scanning all output, parse JSON messages and check specific fields
const detectOutputErrors = (output) => {
  const lines = output.split('\n');

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    try {
      const msg = JSON.parse(line);

      // Only check error-specific message types
      if (msg.type === 'error' || msg.type === 'step_error') {
        return { detected: true, type: 'AgentError', match: line };
      }

      // Check for error state in tool messages
      if (msg.type === 'tool' && msg.state?.status === 'failed') {
        return { detected: true, type: 'ToolError', match: msg.state.error };
      }
    } catch (e) {
      // Not JSON or malformed - could be actual error output
      // Only check non-JSON lines for error patterns
      for (const { pattern, type } of errorPatterns) {
        const match = line.match(pattern);
        if (match) {
          return { detected: true, type, match: match[0] };
        }
      }
    }
  }

  return { detected: false };
};
```

**Pros:**
- ✅ Eliminates false positives from tool output content
- ✅ Leverages structured data format
- ✅ More maintainable and precise
- ✅ Can still catch non-JSON error output

**Cons:**
- ⚠️ Requires understanding agent's JSON message structure
- ⚠️ May miss errors if agent changes output format

### Solution 2: Enhanced Pattern Specificity

**Approach:** Make regex patterns more specific to avoid matching common code patterns.

**Implementation:**
```javascript
const errorPatterns = [
  { pattern: /ProviderModelNotFoundError/i, type: 'ProviderModelNotFoundError' },
  { pattern: /ModelNotFoundError/i, type: 'ModelNotFoundError' },
  { pattern: /\s+at\s+\S+\s+\([^)]+:\d+:\d+\)/m, type: 'StackTrace' },

  // More specific patterns with context
  { pattern: /^Error:.*permission denied/im, type: 'PermissionError' },  // Line must start with "Error:"
  { pattern: /^throw new \w+Error/im, type: 'ThrowError' },  // Only if at start of line (unlikely in JSON)
  { pattern: /^.*?authentication failed.*?$/im, type: 'AuthenticationError' },

  { pattern: /ENOENT|EACCES|EPERM/i, type: 'FileSystemError' },
  { pattern: /TypeError:|ReferenceError:|SyntaxError:/i, type: 'JavaScriptError' },
  { pattern: /Cannot read propert(y|ies) of (undefined|null)/i, type: 'NullReferenceError' },
  { pattern: /Uncaught Exception:/i, type: 'UncaughtException' },
  { pattern: /Unhandled Rejection/i, type: 'UnhandledRejection' },
];
```

**Pros:**
- ✅ Smaller code change
- ✅ Backward compatible

**Cons:**
- ❌ Still prone to false positives
- ❌ Harder to maintain
- ❌ Doesn't address fundamental issue

### Solution 3: Exclude Tool Output Content

**Approach:** Filter out JSON tool messages with `type: "tool"` before scanning for errors.

**Implementation:**
```javascript
const detectOutputErrors = (output) => {
  // Remove tool output content from error scanning
  const lines = output.split('\n');
  const filteredLines = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const msg = JSON.parse(line);
      // Skip tool output but keep error/warning messages
      if (msg.type === 'tool' && msg.state?.status === 'completed') {
        continue; // Don't scan successful tool outputs
      }
    } catch (e) {
      // Not JSON, keep for scanning
    }

    filteredLines.push(line);
  }

  const filteredOutput = filteredLines.join('\n');

  // Now scan the filtered output
  for (const { pattern, type } of errorPatterns) {
    const match = filteredOutput.match(pattern);
    if (match) {
      return { detected: true, type, match: match[0] };
    }
  }

  return { detected: false };
};
```

**Pros:**
- ✅ Directly addresses the root cause
- ✅ Simple logic
- ✅ Maintains existing error patterns

**Cons:**
- ⚠️ Requires parsing every line
- ⚠️ May miss errors in tool outputs (but that's probably okay)

### Solution 4: Stderr-Only Scanning

**Approach:** Only scan stderr for error patterns, trust stdout is structured data.

**Implementation:**
```javascript
// Only check stderr for error patterns, not stdout
const outputError = detectOutputErrors(allStderr);  // Remove fullOutput
```

**Pros:**
- ✅ Simplest change
- ✅ Aligns with Unix conventions (stderr = errors)
- ✅ Completely eliminates tool output false positives

**Cons:**
- ❌ May miss errors that only appear in stdout
- ❌ Depends on agent properly using stderr for errors

---

## Recommendation

**Implement Solution 1 (Parse JSON Structure)** as the primary fix, with **Solution 4 (Stderr-Only)** as a fallback.

### Rationale:
1. **Solution 1** addresses the root cause by understanding the structured nature of agent output
2. It's the most robust long-term solution
3. It aligns with 2025 best practices for error detection
4. **Solution 4** can be used as an additional filter to further reduce false positives

### Implementation Plan:
1. Implement JSON-aware error detection (Solution 1)
2. Add stderr-priority checking (Solution 4 as supplement)
3. Keep existing patterns but apply them only to non-JSON lines
4. Add tests for common false positive scenarios
5. Monitor for any missed real errors

---

## Testing Strategy

### Test Case 1: Current Bug Scenario
- **Input:** Agent reads file containing "permission denied" in source code
- **Expected:** No error detected (exit code 0, successful execution)
- **Current Result:** ❌ False positive error
- **After Fix:** ✅ No error detected

### Test Case 2: Real Permission Error
- **Input:** Actual permission denied error from git push
- **Expected:** Error detected
- **Current Result:** ✅ Correctly detected
- **After Fix:** ✅ Still detected (in stderr or error message type)

### Test Case 3: Tool Read Error
- **Input:** File read fails with ENOENT
- **Expected:** Error detected
- **Current Result:** ✅ Correctly detected
- **After Fix:** ✅ Still detected (tool status = failed)

### Test Case 4: Uncaught Exception
- **Input:** JavaScript throws unhandled exception
- **Expected:** Error detected from stack trace
- **Current Result:** ✅ Correctly detected
- **After Fix:** ✅ Still detected (in stderr or non-JSON output)

---

## Related Issues

- Issue #867: Agent error not treated as error (related to error detection)
- PR #711: Don't mention issue in first commit (the PR that triggered this bug)

---

## Files Involved

### Primary
- `src/agent.lib.mjs:454-558` - Error detection logic
- `src/solve.auto-pr.lib.mjs:375,404,691` - Contains false-positive-triggering text

### Supporting
- Full agent log: `full-agent-log.txt` (2,727 lines)
- PR context: `pr-711-context.txt`

---

## Conclusion

This phantom error detection is a classic false positive issue caused by overly broad pattern matching on unstructured data. The fix requires understanding the structured nature of agent output and applying error detection only to appropriate contexts (error message types, stderr, or non-JSON lines).

The industry best practices from 2025 emphasize:
- Exit codes as primary truth
- Structured parsing over text pattern matching
- Context-aware validation
- Proper stream separation

Implementing Solution 1 (JSON-aware parsing) aligns with all these principles and provides the most robust long-term fix.
