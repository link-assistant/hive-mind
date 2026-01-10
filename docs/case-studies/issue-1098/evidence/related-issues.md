# Related Issues: Socket Connection Closed Unexpectedly

This document compiles all related issues across various projects that experience the same "socket connection was closed unexpectedly" error with Bun's `fetch()` API.

## Bun (oven-sh/bun)

### Issue #14439 - ConnectionClosed when fetch > 10s
- **Status**: CLOSED
- **URL**: https://github.com/oven-sh/bun/issues/14439
- **Summary**: Trying to fetch some endpoint for more than 10s results in a `ConnectionClosed` error.
- **Root Cause**: Default `idleTimeout` in `Bun.serve()` is 10 seconds
- **Workaround**: Set `idleTimeout: 120` or use `server.timeout(req, seconds)` for specific connections
- **Key Quote from maintainer**: "the default idleTimeout is 10s you can change it using `idleTimeout: 120` for 120s"

### Issue #16719 - bun dev server fails after 10+ minutes
- **Status**: OPEN
- **URL**: https://github.com/oven-sh/bun/issues/16719
- **Summary**: Using Astro with DevCycle feature flags, everything works until 10+ minutes when bun closes the connection unexpectedly.
- **Key Quote**: "DevCycle support told me this a known bug of bun"

### Issue #9881 - ConnectionClosed with various URLs
- **Status**: OPEN
- **URL**: https://github.com/oven-sh/bun/issues/9881
- **Summary**: Fetch to external URLs results in socket closed error
- **Tags**: bug, needs repro, deploy-firebase

### Issue #12730 - Fetch to wrangler dev server crashes
- **Status**: OPEN
- **URL**: https://github.com/oven-sh/bun/issues/12730
- **Summary**: bun fetch to wrangler dev server crashes server and fails with "socket connection was closed unexpectedly"
- **Confirmed broken**: versions 1.1.20 and 1.1.13
- **Working version**: 1.1.11

### Issue #17434 - Fetch not working with proxy
- **Status**: OPEN
- **URL**: https://github.com/oven-sh/bun/issues/17434
- **Summary**: When PUTting large data and using a proxy, bun crashes with socket closed error

## OpenCode (sst/opencode, anomalyco/opencode)

### Issue #1692 - Same socket error
- **Status**: OPEN
- **URL**: https://github.com/sst/opencode/issues/1692
- **Summary**: Same error during OpenCode usage

### Issue #3511 - Socket error from MCP server
- **Status**: OPEN
- **URL**: https://github.com/anomalyco/opencode/issues/3511
- **Summary**: "socket connection was closed unexpectedly. From more information, pass verbose: true in the second argument to fetch"
- **Maintainer Response**: "As for the error that happens when the upstream provider is dropping your connection (p sure)"

### Issue #2304 - Error with .git folder (CLOSED)
- **Status**: CLOSED
- **URL**: https://github.com/sst/opencode/issues/2304
- **Summary**: OpenCode encounters a fatal socket connection error when running in a directory that contains a .git folder. The error manifests as a 30-second hang followed by "The socket connection was closed unexpectedly."
- **Workaround**: Renaming the .git folder (e.g., to .gitx) resolves the issue
- **Fix**: Delete snapshots: `rm -rf ~/.local/share/opencode/project/<project-name>/snapshots/` or set `"snapshot": false` in config
- **Resolution**: "Works on new versions"

### Issue #555 - Hit and miss chats
- **Status**: CLOSED
- **URL**: https://github.com/sst/opencode/issues/555
- **Summary**: "Hit and miss chats" - intermittent socket closed errors making chat unusable

### Issue #2519 - Tool calling frequently fails
- **Status**: OPEN
- **URL**: https://github.com/anomalyco/opencode/issues/2519
- **Summary**: Certain tool calling frequently fails and disconnects the chat with socket errors

### Issue #4284 - Socket error with ProxyChains
- **Status**: OPEN
- **URL**: https://github.com/anomalyco/opencode/issues/4284
- **Summary**: Socket connection error when using OpenCode with ProxyChains from v1.0.0

## Other Projects

### Factory-AI/factory#570
- **Status**: OPEN
- **URL**: https://github.com/Factory-AI/factory/issues/570
- **Summary**: "started getting a lot of connection issues all of a sudden" - renders chat completely unusable

### onlook-dev/onlook#3030
- **Status**: OPEN
- **URL**: https://github.com/onlook-dev/onlook/issues/3030
- **Summary**: Self-hosted Onlook web client fails to publish with socket error

### anthropics/claude-code#5674
- **Status**: OPEN
- **URL**: https://github.com/anthropics/claude-code/issues/5674
- **Summary**: Persistent ECONNRESET Errors on macOS Network Connections
- **Note**: Related network connection issues, possibly same underlying cause

## Common Patterns

1. **Timeout-related**: Many issues occur around the 10-second mark, suggesting Bun's default `idleTimeout`
2. **Streaming connections**: Affects SSE, EventStream, and long-polling connections
3. **Intermittent**: Often described as "hit and miss" - works sometimes, fails other times
4. **Proxy issues**: More likely to occur when using proxies
5. **Large git repos**: More likely in directories with .git folders (possible snapshot/caching issues)

## Recommended Debugging Steps

1. Enable `verbose: true` in fetch calls:
   ```typescript
   const response = await fetch(url, { verbose: true });
   ```

2. Check Bun version - some versions are more affected than others

3. Try clearing OpenCode cache/snapshots if using OpenCode:
   ```bash
   rm -rf ~/.local/share/opencode/project/<project-name>/snapshots/
   ```

4. Set explicit timeout values > 10 seconds

5. Implement retry logic for transient failures
