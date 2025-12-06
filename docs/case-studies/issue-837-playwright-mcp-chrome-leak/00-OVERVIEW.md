# Case Study: Playwright MCP Chrome Process Memory Leak (Issue #837)

## Executive Summary

When using Playwright MCP (Model Context Protocol) server with Claude Code or similar AI tools, Chrome/Chromium browser processes accumulate over time without being properly terminated. This leads to severe memory exhaustion, where the system runs out of available RAM and becomes unstable.

The evidence screenshot shows a server (`147.45.234.122`) that has been running for 7 days with:
- **97% memory utilization** (9925.9 MiB total, only 100.3 MiB free)
- **Load average of 68.51** (extremely high)
- **Multiple orphaned Chrome processes** consuming resources
- **Multiple Claude processes** indicating repeated invocations

## Problem Description

### Observed Symptoms

1. **Memory Exhaustion**: Server memory fills up over time with no release
2. **High Load Average**: System becomes sluggish and unresponsive
3. **Process Accumulation**: Multiple `chrome-headless`, `chrome-sandbox`, and `chromium` processes visible in `top`
4. **Zombie Processes**: 2 zombie processes detected
5. **Service Degradation**: New browser operations may fail with "Browser already in use" errors

### Evidence from Screenshot

From the `top` command output on the affected server:

```
top - 14:01:06 up 7 days, 20:22,  2 users,  load average: 68.51, 63.19, 49.10
Tasks: 974 total,  24 running,  97 sleeping,   0 stopped,   2 zombie
MiB Mem :  9925.9 total,   100.3 free,  5654.3 used,  4170.9 buff/cache
MiB Swap:  4882.4 total,  2947.0 free,  1935.4 used,  4311.4 avail Mem

Notable processes:
- chrome-headless (multiple instances)
- chrome-sandbox (multiple instances)
- claude (multiple instances)
- npm install processes
- chromium-preloader
```

## Root Cause Analysis

### Primary Causes

#### 1. Incomplete Browser Cleanup in Playwright MCP

When `page.close()` is called through the MCP interface, it often only detaches the automation control but doesn't properly close the browser tab or process. From [GitHub Issue #1111](https://github.com/microsoft/playwright-mcp/issues/1111):

> "The AI tries to run `await page.close()` and all it does is to close automation on that tab. The notice informing that it's being controlled disappears, but the tab stays open."

This means each browser operation leaves behind an orphaned tab/process.

#### 2. Context Lifecycle Not Properly Managed

The Playwright MCP server manages browser contexts with different lifecycle modes:
- **Persistent Mode (Default)**: Profile saved to disk, processes may linger
- **Isolated Mode**: Ephemeral contexts, but must be explicitly enabled
- **Extension Mode**: Connects to existing browser, disconnects but browser continues

Without proper configuration, contexts persist and accumulate.

#### 3. Upstream Chromium Memory Leak

The Chromium browser itself has a known memory leak when repeatedly opening and closing connections ([GitHub Issue #21079](https://github.com/microsoft/playwright/issues/21079)):

> "Memory grows in the renderer process, not the browser process itself... This is an upstream Chromium issue."

This is marked as "won't fix" by the Chromium team.

#### 4. Missing Process Recycling

Long-running automation needs periodic process recycling, but:
- No built-in recycling mechanism in Playwright MCP
- Claude Code tools may spawn new browser instances without cleaning old ones
- No maximum lifetime or instance count limits

#### 5. Container/Server Environment Issues

In containerized or long-running server environments:
- Shared memory (`/dev/shm`) limitations cause hangs
- Missing `--init` flag leads to zombie process accumulation
- Insufficient IPC namespace isolation

### Contributing Factors

1. **Long Server Uptime**: 7+ days without restart allows accumulation
2. **Repeated Claude Invocations**: Each invocation may spawn new browser
3. **No Monitoring/Alerting**: Issue grew undetected until critical
4. **Default Configuration**: Persistent mode used instead of isolated

## Impact Assessment

### Resource Impact
- **Memory**: 5654.3 MiB used of 9925.9 MiB total (57% from processes, more in cache)
- **Swap**: 1935.4 MiB used (indicates memory pressure)
- **CPU Load**: 68.51 load average (severe overload for typical server)
- **Process Count**: 974 total processes

### Operational Impact
- System responsiveness degraded
- New automation tasks may fail
- Risk of complete system freeze
- Requires manual intervention to resolve

### Business Impact
- Reduced automation reliability
- Increased operational overhead
- Potential data loss if system crashes
- Service downtime during recovery

## Proposed Solutions

### Immediate Mitigations

#### Solution 1: Periodic Process Cleanup (Cron Job)
```bash
# Add to crontab: clean up orphaned Chrome processes every 30 minutes
*/30 * * * * pkill -f "chrome-headless" 2>/dev/null; sleep 5; pkill -9 -f "chrome-headless" 2>/dev/null
```

#### Solution 2: Switch to Isolated Mode
Configure Playwright MCP to use isolated mode:
```bash
npx @playwright/mcp@latest --isolated
```
This creates ephemeral contexts that are discarded after each session.

#### Solution 3: Add Docker Flags
Run containers with proper process management:
```bash
docker run --init --ipc=host --cap-add=SYS_ADMIN your-image
```

### Long-term Fixes

#### Solution 4: Implement Browser Lifecycle Management
Add explicit browser recycling in automation code:
```javascript
const MAX_BROWSER_LIFETIME_MS = 30 * 60 * 1000; // 30 minutes
const MAX_OPERATIONS_PER_BROWSER = 100;

let operationCount = 0;
let browserStartTime = Date.now();

async function ensureHealthyBrowser() {
  const shouldRecycle =
    operationCount >= MAX_OPERATIONS_PER_BROWSER ||
    (Date.now() - browserStartTime) >= MAX_BROWSER_LIFETIME_MS;

  if (shouldRecycle && browser) {
    await browser.close();
    browser = await playwright.chromium.launch();
    browserStartTime = Date.now();
    operationCount = 0;
  }
  operationCount++;
  return browser;
}
```

#### Solution 5: Add Process Monitoring
Implement monitoring for Chrome process count:
```bash
#!/bin/bash
# monitor-chrome.sh
MAX_CHROME_PROCESSES=10
CHROME_COUNT=$(pgrep -c "chrome|chromium")

if [ "$CHROME_COUNT" -gt "$MAX_CHROME_PROCESSES" ]; then
  echo "WARNING: $CHROME_COUNT Chrome processes detected (max: $MAX_CHROME_PROCESSES)"
  # Send alert or trigger cleanup
fi
```

#### Solution 6: Explicit Context Cleanup in MCP Integration
Ensure proper cleanup sequence:
```javascript
// In MCP tool handlers
async function cleanupBrowserSession() {
  try {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
  } catch (error) {
    console.error('Cleanup error:', error);
    // Force kill as fallback
    execSync('pkill -9 -f "chrome-headless"');
  }
}

// Register cleanup handlers
process.on('exit', cleanupBrowserSession);
process.on('SIGINT', cleanupBrowserSession);
process.on('SIGTERM', cleanupBrowserSession);
```

## Prevention Checklist

- [ ] Configure Playwright MCP with `--isolated` mode for ephemeral sessions
- [ ] Add periodic cleanup cron job on servers running browser automation
- [ ] Use Docker `--init` flag for proper process management
- [ ] Implement browser recycling for long-running automation
- [ ] Add monitoring for Chrome process count and memory usage
- [ ] Set up alerts for memory threshold breaches
- [ ] Document proper shutdown procedures for operators
- [ ] Regular server restarts as maintenance window

## Benchmarks and Metrics (from Industry Research)

Based on [2025 benchmarks](https://markaicode.com/playwright-mcp-memory-leak-fixes-2025/):

| Configuration | Unoptimized | Optimized | Reduction |
|--------------|-------------|-----------|-----------|
| Chrome (5 contexts) | 1,240MB | 780MB | 37.1% |
| Firefox (5 contexts) | 980MB | 615MB | 37.2% |
| WebKit (5 contexts) | 1,150MB | 695MB | 39.6% |
| Multi-browser setup | 2,860MB | 1,620MB | 43.4% |

Key optimizations that achieved these results:
1. Context-per-test pattern
2. Periodic browser recycling
3. Explicit context closure before browser closure
4. Worker isolation in test configuration

## Related Issues

- **[Issue #837](https://github.com/link-assistant/hive-mind/issues/837)** - This issue (Playwright MCP Chrome leak)
- **[PR #838](https://github.com/link-assistant/hive-mind/pull/838)** - Case study documentation PR

## References

### GitHub Issues
- [microsoft/playwright-mcp#1111](https://github.com/microsoft/playwright-mcp/issues/1111) - Close tabs/browser not working
- [microsoft/playwright-mcp#942](https://github.com/microsoft/playwright-mcp/issues/942) - Browser already in use error
- [microsoft/playwright#21079](https://github.com/microsoft/playwright/issues/21079) - Memory leak on repeated open/close
- [microsoft/playwright#15163](https://github.com/microsoft/playwright/issues/15163) - browser.close doesn't close contexts
- [anthropics/claude-code#1383](https://github.com/anthropics/claude-code/issues/1383) - Playwright MCP frequently fails

### Documentation
- [Playwright MCP Repository](https://github.com/microsoft/playwright-mcp)
- [Browser Context Management - DeepWiki](https://deepwiki.com/microsoft/playwright-mcp/4.4-browser-context-management)

### Articles
- [Playwright MCP 2.0 Memory Leak Fixes (2025)](https://markaicode.com/playwright-mcp-memory-leak-fixes-2025/)
- [QA Touch - Playwright MCP Server Guide](https://www.qatouch.com/blog/playwright-mcp-server/)
