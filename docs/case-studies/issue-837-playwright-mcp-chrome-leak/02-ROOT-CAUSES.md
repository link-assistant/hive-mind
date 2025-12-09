# Root Causes Analysis

## Overview

This document provides a deep technical analysis of why Chrome processes leak when using Playwright MCP with Claude Code tools.

## Architecture Context

### Playwright MCP Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude Code / AI Tool                     │
├─────────────────────────────────────────────────────────────┤
│                      MCP Protocol Layer                       │
├─────────────────────────────────────────────────────────────┤
│                    Playwright MCP Server                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │   Context   │  │   Context   │  │   Context   │  ...     │
│  │  Manager    │  │  Manager    │  │  Manager    │          │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘          │
├─────────┼─────────────────┼─────────────────┼────────────────┤
│         v                 v                 v                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  Browser    │  │  Browser    │  │  Browser    │  ...     │
│  │  Process    │  │  Process    │  │  Process    │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
                              │
                              v
                    ┌─────────────────┐
                    │   OS Process    │
                    │    Management   │
                    └─────────────────┘
```

### Browser Process Lifecycle (Expected)

```
1. Tool Invocation
   └─> MCP Server receives request
       └─> Browser Context created
           └─> Page created
               └─> Operations executed
               └─> Page closed ✓
           └─> Context closed ✓
       └─> Browser closed ✓
   └─> Response returned

Expected: All browser processes terminated
```

### Browser Process Lifecycle (Actual - with leak)

```
1. Tool Invocation
   └─> MCP Server receives request
       └─> Browser Context created
           └─> Page created
               └─> Operations executed
               └─> Page closed ✓ (but tab may remain)
           └─> Context NOT explicitly closed ✗
       └─> Browser NOT explicitly closed ✗
   └─> Response returned

Result: Browser process remains running
```

## Root Cause #1: page.close() Incomplete Cleanup

### Description

When `page.close()` is called through the MCP interface, it detaches automation control but doesn't properly terminate the browser tab or underlying process.

### Evidence

From [GitHub Issue #1111](https://github.com/microsoft/playwright-mcp/issues/1111):

> "The AI tries to run `await page.close()` and all it does is to close automation on that tab. The notice informing that it's being controlled disappears, but the tab stays open."

### Technical Explanation

```javascript
// MCP tool handler (simplified)
async function browser_close_page(params) {
  const page = this.currentPage;
  await page.close();  // Only closes the page object
  // Browser context and browser remain open
  return { success: true };
}
```

The issue is that `page.close()` only:
1. Closes the Playwright page object
2. Sends close command to the tab
3. Detaches automation hooks

It does NOT:
1. Close the browser context
2. Close the browser process
3. Kill child processes

### Fix Required

```javascript
async function browser_close_page(params) {
  const page = this.currentPage;
  const context = page.context();
  const browser = context.browser();

  await page.close();

  // If this is the last page in the context, close context
  if (context.pages().length === 0) {
    await context.close();
  }

  // If this is the last context in the browser, close browser
  if (browser.contexts().length === 0) {
    await browser.close();
  }

  return { success: true };
}
```

## Root Cause #2: Context Lifecycle Not Managed

### Description

Browser contexts created during MCP sessions are not properly tracked and cleaned up when the session ends.

### Session Modes Comparison

| Mode | Context Lifecycle | Cleanup Behavior | Leak Risk |
|------|------------------|------------------|-----------|
| Persistent (default) | Persists on disk | Manual only | HIGH |
| Isolated | In-memory | Auto on disconnect | LOW |
| Extension | External browser | Browser continues | MEDIUM |

### Technical Explanation

**Persistent Mode (Default)**:
```javascript
// Profile stored at:
// Linux: ~/.cache/ms-playwright/mcp-{channel}-profile
// macOS: ~/Library/Caches/ms-playwright/mcp-{channel}-profile
// Windows: %USERPROFILE%\AppData\Local\ms-playwright\mcp-{channel}-profile

// Browser launched with persistent profile
const browser = await chromium.launchPersistentContext(profilePath, {
  headless: true
});

// On session end - profile persists, process may linger
```

**Isolated Mode**:
```javascript
// Browser launched with ephemeral profile
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();

// On session end - context discarded, browser should close
// But if browser.close() not called, process remains
```

### Evidence

From browser context management documentation:

> "When `browser_close` executes or connections terminate, cleanup follows the session mode: **Persistent**: Browser process terminates; profile directory persists on disk."

However, if `browser_close` is never explicitly called (e.g., on error, timeout, or incomplete tool sequence), the browser remains running.

## Root Cause #3: Upstream Chromium Memory Leak

### Description

The Chromium browser itself has a known memory leak when repeatedly opening and closing browser connections. This is independent of Playwright.

### Evidence

From [GitHub Issue #21079](https://github.com/microsoft/playwright/issues/21079):

> "Memory grows in the renderer process, not the browser process itself... A memory leak occurs in Chrome's renderer process when repeatedly opening and closing browser connections through Playwright."

And:

> "This is an upstream Chromium issue... A bug was filed with the Chromium team (Issue #1418465) but was closed as 'wont-fix'."

### Technical Explanation

```
Each open/close cycle:
┌───────────────────────────────────────────────────┐
│ Cycle 1: Browser open -> close                     │
│ Memory: 100MB -> 105MB (5MB leaked)               │
├───────────────────────────────────────────────────┤
│ Cycle 2: Browser open -> close                     │
│ Memory: 105MB -> 112MB (7MB leaked)               │
├───────────────────────────────────────────────────┤
│ Cycle N: Browser open -> close                     │
│ Memory: Xmb -> X+Ymb (Y*N total leaked)           │
└───────────────────────────────────────────────────┘
```

### Workaround

The only effective workaround is periodic process recycling:

```javascript
// Periodically restart the entire Node process
if (memoryUsage > threshold || cycleCount > maxCycles) {
  process.exit(0);
  // External supervisor (pm2, systemd, k8s) restarts
}
```

## Root Cause #4: Missing Error Handling Cleanup

### Description

When errors occur during browser operations, cleanup code is often skipped, leaving browsers running.

### Example Problematic Pattern

```javascript
// MCP tool handler without proper error handling
async function execute_browser_task() {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(url);
    await page.click('#button');
    // If click fails, we jump to catch
    await page.waitForSelector('#result');
  } catch (error) {
    // Error logged but browser NOT closed
    console.error('Task failed:', error);
    throw error;  // Re-throw without cleanup
  }
  // Only reached on success
  await browser.close();
}
```

### Fixed Pattern

```javascript
async function execute_browser_task() {
  const browser = await playwright.chromium.launch();

  try {
    const page = await browser.newPage();
    await page.goto(url);
    await page.click('#button');
    await page.waitForSelector('#result');
  } finally {
    // Always close browser, even on error
    await browser.close().catch(e => {
      console.error('Failed to close browser:', e);
      // Force kill as last resort
      try {
        browser.process()?.kill('SIGKILL');
      } catch {}
    });
  }
}
```

## Root Cause #5: Container/Process Management Issues

### Description

When running in containers or server environments, improper process management leads to zombie processes and resource leaks.

### Missing Docker Flags

Common issues when running Playwright in Docker without proper configuration:

| Flag Missing | Impact |
|-------------|--------|
| `--init` | Zombie processes accumulate (no init to reap them) |
| `--ipc=host` | Shared memory issues cause crashes/hangs |
| `--cap-add=SYS_ADMIN` | Sandbox may not work properly |

### Evidence

From [GitHub Issue #942](https://github.com/microsoft/playwright-mcp/issues/942):

> "Chrome requires the `--no-sandbox` flag when running as root, but this flag causes the MCP server to hang indefinitely in containers."

And from community discussions:

> "Using `--ipc=host`, `--cap-add=SYS_ADMIN`, and `--init` Docker flags can resolve the issue, which turns out to be related to zombie processes."

### Proper Docker Configuration

```dockerfile
# Dockerfile
FROM mcr.microsoft.com/playwright:latest

# Ensure proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
```

```bash
# docker run command
docker run \
  --init \
  --ipc=host \
  --cap-add=SYS_ADMIN \
  --shm-size=2gb \
  your-image
```

## Root Cause #6: Signal Handling Gaps

### Description

When the MCP server or Claude process receives termination signals (SIGTERM, SIGINT), browser processes are not properly cleaned up.

### Problematic Behavior

```
Parent Process (Claude/MCP)
     │
     ├── Browser Process (Chrome)
     │       └── Renderer Process
     │       └── GPU Process
     │       └── Utility Process
     │
     └── [SIGTERM received]
             │
             └── Parent exits immediately
                 │
                 └── Child processes become orphans
                     (adopted by init, continue running)
```

### Required Signal Handlers

```javascript
// MCP server should register cleanup handlers
const browsers = new Set();

function registerBrowser(browser) {
  browsers.add(browser);
}

async function cleanupAllBrowsers() {
  const closePromises = Array.from(browsers).map(async (browser) => {
    try {
      await browser.close();
    } catch (e) {
      browser.process()?.kill('SIGKILL');
    }
  });
  await Promise.all(closePromises);
  browsers.clear();
}

process.on('SIGTERM', async () => {
  await cleanupAllBrowsers();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await cleanupAllBrowsers();
  process.exit(0);
});

process.on('exit', () => {
  // Synchronous cleanup - force kill any remaining
  for (const browser of browsers) {
    browser.process()?.kill('SIGKILL');
  }
});
```

## Summary of Root Causes

| # | Root Cause | Severity | Fix Complexity |
|---|------------|----------|----------------|
| 1 | page.close() incomplete | High | Medium |
| 2 | Context lifecycle not managed | High | Medium |
| 3 | Upstream Chromium leak | Medium | High (workaround only) |
| 4 | Missing error cleanup | High | Low |
| 5 | Container misconfig | Medium | Low |
| 6 | Signal handling gaps | High | Medium |

## Recommendations Priority

1. **Immediate**: Add error handling with finally blocks
2. **Immediate**: Use `--isolated` mode for ephemeral sessions
3. **Short-term**: Add proper signal handlers
4. **Short-term**: Fix Docker configuration
5. **Medium-term**: Implement browser recycling
6. **Long-term**: Upstream fixes to Playwright MCP

## Related Code Paths

In Playwright MCP repository:
- `src/server.ts` - MCP server initialization
- `src/browser.ts` - Browser management
- `src/context.ts` - Context lifecycle
- `src/tools/*.ts` - Individual tool handlers

Key functions to audit:
- `createBrowser()`
- `closeBrowser()`
- `createContext()`
- `closeContext()`
- Signal handlers in main entry point
