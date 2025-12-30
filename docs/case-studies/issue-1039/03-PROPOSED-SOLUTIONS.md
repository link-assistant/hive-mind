# Proposed Solutions: Solve Command Stuck on Playwright MCP Tool Call

This document outlines proposed solutions to prevent the solve command from becoming stuck on Playwright MCP tool calls.

## Solution Overview

| Solution                              | Complexity | Impact | Priority      | Status          |
| ------------------------------------- | ---------- | ------ | ------------- | --------------- |
| 1. Enhance AI system prompt           | Low        | Medium | P0 - Critical | **IMPLEMENTED** |
| 2. Add timeout detection in solve.mjs | Medium     | High   | P1 - High     | Pending         |
| 3. Report issue to Playwright MCP     | Low        | High   | P2 - Medium   | Pending         |
| 4. Implement auto-recovery mechanism  | High       | Medium | P3 - Low      | Pending         |

## Solution 1: Enhance AI System Prompt (P0) - IMPLEMENTED

### The Change

Added safety guidelines to the Playwright MCP section of the AI system prompt to help prevent clicking buttons that trigger long operations.

### Implementation Details

Updated `src/claude.prompts.lib.mjs` to add the following guidelines:

```markdown
- IMPORTANT: Before clicking buttons that may trigger large data operations (loading thousands of records, heavy computations), verify the operation is safe by checking if data sources exist and considering the operation time.
- IMPORTANT: If console errors show 401/403/404 errors, address authentication or missing resource issues before testing UI functionality.
- IMPORTANT: After clicking buttons that trigger data loading, use browser_wait_for with specific expected text to verify completion, or use browser_snapshot periodically to check progress.
- IMPORTANT: For potentially long-running operations, prefer browser_evaluate with explicit JavaScript timeouts over browser_click to maintain control.
```

### Why This Is P0

The timeout configuration already exists (`--timeout-action=600000`) but is not being respected. The most immediate and practical fix is to give the AI better guidance to avoid triggering operations that may cause hangs.

---

## Note on Playwright MCP Timeout Configuration

### Current Configuration (ubuntu-24-server-install.sh)

```bash
claude mcp add playwright -s user -- npx -y @playwright/mcp@latest \
  --isolated --headless --no-sandbox \
  --timeout-action=600000 \
  --viewport-size 1920x1080
```

### The Problem

The current configuration already includes `--timeout-action=600000` (10 minutes). However, in the issue case, the operation hung for **1 hour 34 minutes** without triggering the timeout. This suggests:

1. The timeout may not apply to all browser actions
2. The MCP protocol layer may not properly propagate timeout errors
3. When browser JavaScript blocks the main thread, the timeout detection may fail

### Recommendation

Consider opening an issue on [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) to investigate why the timeout is not being respected.

---

## Solution 2: Add Timeout Detection in solve.mjs (P1)

### The Problem

solve.mjs currently has no mechanism to detect or handle hung MCP tool calls.

### Proposed Implementation

Add a wrapper function that tracks tool execution time and implements timeout logic:

```javascript
// In solve.mjs or a new module

const TOOL_TIMEOUTS = {
  mcp__playwright__browser_navigate: 120000, // 2 minutes for navigation
  mcp__playwright__browser_click: 60000, // 1 minute for clicks
  mcp__playwright__browser_type: 60000, // 1 minute for typing
  mcp__playwright__browser_snapshot: 30000, // 30 seconds for snapshots
  mcp__playwright__browser_evaluate: 300000, // 5 minutes for JS execution
  default: 120000, // 2 minutes default
};

const WARNING_THRESHOLD = 30000; // Warn after 30 seconds

async function trackToolExecution(toolName, toolPromise) {
  const startTime = Date.now();
  const timeout = TOOL_TIMEOUTS[toolName] || TOOL_TIMEOUTS.default;

  const warningInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    if (elapsed > WARNING_THRESHOLD) {
      log(`⚠️ Tool ${toolName} running for ${Math.round(elapsed / 1000)}s...`);
    }
  }, 10000); // Log every 10 seconds

  try {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Tool ${toolName} timed out after ${timeout}ms`));
      }, timeout);
    });

    return await Promise.race([toolPromise, timeoutPromise]);
  } finally {
    clearInterval(warningInterval);
    const duration = Date.now() - startTime;
    log(`📊 Tool ${toolName} completed in ${Math.round(duration / 1000)}s`);
  }
}
```

### Integration Points

1. Wrap Claude API tool call handling with timeout tracking
2. Log warnings for slow-running tools
3. Implement graceful error handling for timeouts

---

## Solution 3: Report Issue to Playwright MCP (P2)

### The Issue

The `--timeout-action=600000` configuration is not being respected. When a `browser_click` action triggers a long-running JavaScript operation, the timeout fails to trigger, leaving the MCP connection hanging indefinitely.

### Recommended Action

Open an issue on [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp/issues) with the following details:

**Title:** `--timeout-action not respected for browser_click on long-running JavaScript operations`

**Body:**

```markdown
## Description

When using `browser_click` on a button that triggers a long-running JavaScript operation (e.g., loading 300K+ data points), the `--timeout-action` configuration does not trigger. The MCP connection hangs indefinitely instead of returning a timeout error.

## Configuration

npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080

## Steps to Reproduce

1. Navigate to a page with a button that loads large amounts of data
2. Click the button using `browser_click`
3. The click action hangs indefinitely (tested for 1h 34m with no response)

## Expected Behavior

After 600,000ms (10 minutes), the action should timeout and return an error.

## Actual Behavior

The action hangs indefinitely without triggering the timeout.

## Hypothesis

The timeout may not be properly detected when:

- Browser JavaScript blocks the main thread
- The click action technically completes but the page becomes unresponsive
- The MCP protocol layer doesn't propagate the timeout error
```

### Related Issues

- [microsoft/playwright-mcp#982](https://github.com/microsoft/playwright-mcp/issues/982) - MCP ping timeout configuration
- [microsoft/playwright-mcp#355](https://github.com/microsoft/playwright-mcp/issues/355) - browser_click download issues

---

## Solution 4: Implement Auto-Recovery Mechanism (P3)

### Overview

Implement an auto-recovery mechanism that can detect and recover from hung browser operations.

### Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   solve.mjs      │────▶│  Tool Executor   │────▶│  Playwright MCP  │
│                  │     │  (with timeout)  │     │                  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
                               │    ▲
                               ▼    │
                         ┌──────────────────┐
                         │  Recovery Agent  │
                         │  - Kill browser  │
                         │  - Restart MCP   │
                         │  - Retry action  │
                         └──────────────────┘
```

### Implementation Sketch

```javascript
class BrowserRecoveryAgent {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 5000;
  }

  async executeWithRecovery(toolCall) {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.executeWithTimeout(toolCall);
      } catch (error) {
        if (error.message.includes('timed out') && attempt < this.maxRetries) {
          log(`⚠️ Attempt ${attempt} failed, recovering...`);
          await this.recover();
          await this.delay(this.retryDelay);
        } else {
          throw error;
        }
      }
    }
  }

  async recover() {
    // 1. Try to close the browser gracefully
    try {
      await this.callTool('mcp__playwright__browser_close');
    } catch (e) {
      log('Browser close failed, forcing...');
    }

    // 2. Kill any orphaned browser processes
    await this.killOrphanedBrowsers();

    // 3. Restart MCP connection if needed
    await this.restartMcpConnection();
  }

  async killOrphanedBrowsers() {
    // Find and kill orphaned Chromium processes
    const { exec } = require('child_process');
    exec('pkill -f chromium --signal KILL', err => {
      if (err) log('No orphaned browsers to kill');
    });
  }
}
```

### Considerations

- This is a more complex solution that requires careful testing
- May not be needed if Solutions 1-3 are implemented properly
- Could be useful for long-running automated sessions

---

## Implementation Priority

### Phase 1: Immediate (P0) - DONE

- [x] Verify Playwright MCP configuration has proper timeouts (confirmed: 10min timeout exists)
- [x] Add safety guidelines to AI system prompt (implemented in `src/claude.prompts.lib.mjs`)
- [ ] Test that the new guidelines help prevent stuck operations

### Phase 2: Short-term (P1)

- [ ] Add timeout tracking to solve.mjs tool execution
- [ ] Implement warning logs for slow operations
- [ ] Add graceful error handling for timeout errors

### Phase 3: Medium-term (P2)

- [ ] Report timeout issue to microsoft/playwright-mcp
- [ ] Add comprehensive case study documentation
- [ ] Create documentation for Playwright MCP best practices

### Phase 4: Long-term (P3)

- [ ] Design auto-recovery mechanism
- [ ] Implement browser process management
- [ ] Add comprehensive logging and monitoring

## Testing Plan

### Test Case 1: AI Prompt Effectiveness (Manual)

1. Present AI with a scenario involving large data load
2. Check if AI takes precautions before clicking
3. **Expected**: AI should verify data source exists and consider operation time

### Test Case 2: Timeout Verification

1. Configure Playwright MCP with `--timeout-action=10000` (10 seconds)
2. Navigate to a page with a button that triggers a 30-second operation
3. Click the button
4. **Expected**: Error after 10 seconds, not a hang

### Test Case 3: solve.mjs Timeout Detection (Future)

1. Enable timeout tracking in solve.mjs
2. Create a mock MCP server that delays responses
3. **Expected**: Warning logs after 30 seconds, error after timeout

## Conclusion

The immediate fix implemented in this PR:

1. **Enhanced AI system prompt** with safety guidelines to help prevent clicking buttons that trigger long operations

Remaining work for future PRs:

2. **Add client-side timeout detection** in solve.mjs to catch and handle hung operations
3. **Report issue to microsoft/playwright-mcp** to investigate why the timeout configuration is not being respected
4. **Implement auto-recovery mechanism** for long-running automated sessions
