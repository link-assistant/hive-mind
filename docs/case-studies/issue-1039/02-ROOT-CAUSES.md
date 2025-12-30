# Root Causes: Solve Command Stuck on Playwright MCP Tool Call

This document provides an in-depth analysis of the root causes that led to the solve command becoming stuck on a Playwright MCP tool call.

## Summary of Root Causes

| Priority | Root Cause | Impact | Mitigation |
|----------|-----------|--------|------------|
| **Critical** | Playwright MCP timeout not being respected | Session hangs despite 10min timeout config | Investigate MCP timeout behavior |
| **High** | No client-side timeout for MCP tools | solve.mjs waits forever | Implement tool call timeout |
| **Medium** | AI clicked button triggering heavy operation | Browser became unresponsive | AI prompt guidance |
| **Low** | Missing error recovery mechanism | Manual intervention required | Add auto-recovery |

## Detailed Analysis

### 1. Playwright MCP Timeout Not Being Respected

#### The Problem

The Playwright MCP server **is** configured with explicit timeout settings (`--timeout-action=600000` = 10 minutes), but the timeout did not work as expected. When the AI clicked the "Load data" button, the action hung for **1 hour and 34 minutes** without triggering the configured timeout.

#### Evidence

From the installation script (`ubuntu-24-server-install.sh:1352`):
```bash
claude mcp add playwright -s user -- npx -y @playwright/mcp@latest \
  --isolated --headless --no-sandbox \
  --timeout-action=600000 --viewport-size 1920x1080
```

The timeout is configured as 600,000ms (10 minutes), but the operation hung for 94 minutes.

From the log initialization:
```
[2025-12-30T11:20:34.892Z] [INFO] 🎭 Playwright MCP detected - enabling browser automation hints
```

#### Why the Timeout Didn't Work

Possible reasons why `--timeout-action=600000` didn't trigger:

1. **MCP Protocol Layer Issue**: The timeout might apply to the Playwright action, but the MCP protocol layer may not properly propagate the timeout error back to the client.

2. **Browser JavaScript Blocking**: When JavaScript execution blocks the browser's main thread (as with loading 300K+ points), Playwright may not be able to detect the timeout condition.

3. **MCP Connection Not Dropped**: The MCP connection remained active (no disconnect), so the client continued waiting indefinitely.

4. **Action vs Connection Timeout**: The `--timeout-action` may only apply to action completion detection, not to the MCP response waiting.

#### The Workaround

Since the configured timeout doesn't appear to work reliably, additional safeguards are needed:

1. **AI-side caution**: Avoid clicking buttons that trigger heavy operations
2. **Client-side timeout**: Add timeout detection in solve.mjs
3. **Use browser_evaluate**: For potentially long operations, use JavaScript with explicit timeouts instead of browser_click

---

### 2. Heavy JavaScript Operation Blocked the Browser

#### The Problem

The "Load data" button was designed to:
1. Fetch `mrds.geojson` (107MB file)
2. Parse 304,613 GeoJSON features
3. Create Cesium entities for each point
4. Render them on a 3D globe

This is a computationally intensive operation that can make the browser tab unresponsive.

#### Evidence

From the page snapshot before the click:
```yaml
- generic: "Отображено точек: 0" (Points displayed: 0)
- generic: "Всего в базе: 304,613" (Total in database: 304,613)
```

The page was showing 0 points, indicating the data hadn't been loaded yet. The button was supposed to trigger this loading.

#### Why This Matters

When JavaScript executes a heavy operation:
1. The browser's main thread becomes blocked
2. Playwright cannot receive acknowledgment that the click completed
3. The `click()` action appears to hang indefinitely

#### The Pattern

```javascript
// Typical problematic pattern in the target application
button.addEventListener('click', async () => {
  // This blocks the main thread
  const data = await fetch('mrds.geojson');  // 107MB
  const json = await data.json();            // Parse 300K features
  json.features.forEach(feature => {         // Create 300K entities
    viewer.entities.add(createEntity(feature));
  });
});
```

#### The Fix

The target application should use:
- Web Workers for heavy parsing
- RequestAnimationFrame for batched rendering
- Progress indicators to keep UI responsive

For the solve command, the AI should:
- Not click buttons that trigger heavy operations without safeguards
- Use `browser_wait_for` with specific text expectations
- Verify the operation completes with snapshots

---

### 3. Missing Timeout Detection in solve.mjs

#### The Problem

The `solve.mjs` script doesn't implement timeout detection for MCP tool calls. When the Playwright MCP tool hangs, solve.mjs continues waiting indefinitely.

#### Evidence

The log shows no timeout warning or error:
```
[2025-12-30T11:22:53.672Z] [INFO] {...browser_click call...}
[2025-12-30T12:57:10.345Z] [INFO] 📁 Keeping directory...
```

There's a 1h34m gap with no log entries - the system was simply waiting.

#### The Expected Behavior

solve.mjs should:
1. Track the start time of each tool call
2. Implement a configurable timeout (e.g., 10 minutes for browser operations)
3. Log warnings when operations take longer than expected
4. Optionally kill and restart hung operations

#### The Fix

Implement timeout detection in solve.mjs:

```javascript
// Example implementation
const TOOL_TIMEOUT_MS = 600000; // 10 minutes

async function executeToolWithTimeout(tool, timeout = TOOL_TIMEOUT_MS) {
  const startTime = Date.now();

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Tool ${tool.name} timed out after ${timeout}ms`));
    }, timeout);
  });

  const toolPromise = executeTool(tool);

  try {
    return await Promise.race([toolPromise, timeoutPromise]);
  } catch (error) {
    if (error.message.includes('timed out')) {
      log(`⚠️ Tool ${tool.name} timed out, attempting recovery...`);
      // Implement recovery logic
    }
    throw error;
  }
}
```

---

### 4. Known Playwright MCP Issues

#### MCP Ping Timeout (Issue #982)

From [microsoft/playwright-mcp#982](https://github.com/microsoft/playwright-mcp/issues/982):

> "When agents perform time-intensive operations (such as web scraping, form filling, waiting for page loads, or processing large datasets), they may fail to respond to MCP ping requests within the hardcoded 5-second timeout. The server interprets this as a dead connection and terminates the session."

However, in our case, the connection wasn't terminated - it just hung. This suggests a different failure mode.

#### browser_click Download Issues (Issue #355)

From [microsoft/playwright-mcp#355](https://github.com/microsoft/playwright-mcp/issues/355):

> "Users have been facing issues with automating 'click to download' workflows with the playwright-mcp toolset. The browser_click tool is not able to trigger downloads on versions >= 0.0.19."

While not directly applicable (the button wasn't triggering a download), this shows that `browser_click` has known issues with certain click actions.

#### Variable Success Rate (Claude Code Issue #1383)

From [anthropics/claude-code#1383](https://github.com/anthropics/claude-code/issues/1383):

> "Playwright MCP success is... very variable. Sometimes it works great, it takes screenshots, it verifies its own work... then Claude is superbly useful. Other times it just can't seem to use playwright properly and so reverts to Curl."

This indicates that Playwright MCP reliability issues are a known problem.

---

### 5. AI Decision to Click Without Verification

#### The Problem

The AI decided to click the "Load data" button without:
1. Checking if the prerequisite data file existed
2. Understanding the impact of loading 300K+ points
3. Setting up any timeout or verification mechanism

#### Evidence

From the AI's message before the click:
```
"Good! The page loaded. I can see there's a Cesium Ion 401 error (token issue)
and a 404 for favicon. Let me click the 'Load Data' button to test data loading:"
```

The AI acknowledged errors but proceeded anyway.

#### The Better Approach

The AI should have:
1. Verified that `mrds.geojson` existed before clicking
2. Noted that loading 304,613 points could be slow
3. Used `browser_evaluate` to test data loading with a timeout
4. Used `browser_wait_for` with a specific expected outcome

#### The Fix

Add guidance to the AI system prompt:
```markdown
Playwright MCP usage guidelines:
- Before clicking buttons that load large datasets, verify the data source exists
- For operations that may take long, use browser_evaluate with explicit timeouts
- After clicks that trigger data loading, use browser_wait_for with expected text
- Always have a fallback plan if browser operations don't complete in expected time
```

---

## Root Cause Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SOLVE COMMAND STUCK                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │
              ┌─────────────────────┴─────────────────────┐
              │                                           │
              ▼                                           ▼
┌─────────────────────────────┐           ┌─────────────────────────────┐
│   Playwright MCP Config     │           │    solve.mjs Architecture   │
│   (No timeout configured)   │           │    (No timeout detection)   │
└─────────────────────────────┘           └─────────────────────────────┘
              │                                           │
              ▼                                           ▼
┌─────────────────────────────┐           ┌─────────────────────────────┐
│   browser_click hangs on    │           │   solve.mjs waits forever   │
│   heavy JS operation        │           │   for tool response         │
└─────────────────────────────┘           └─────────────────────────────┘
              │                                           │
              └───────────────────┬───────────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────┐
                    │   No error, no timeout,     │
                    │   manual Ctrl+C required    │
                    └─────────────────────────────┘
```

## Conclusion

The root cause is a combination of factors:

1. **Primary**: Missing timeout configuration in Playwright MCP
2. **Secondary**: Heavy JavaScript operation blocking the browser
3. **Tertiary**: No timeout detection in solve.mjs
4. **Contributing**: AI clicking a button without proper verification

All of these issues contributed to the solve command becoming stuck for over 90 minutes with no error message or automatic recovery.
