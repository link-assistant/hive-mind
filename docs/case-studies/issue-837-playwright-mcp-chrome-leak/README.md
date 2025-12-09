# Case Study: Playwright MCP Chrome Process Memory Leak (Issue #837)

## Summary

The Playwright MCP server used with Claude Code tools exhibits a significant resource leak where Chrome/Chromium processes accumulate over time without being properly terminated. This leads to severe memory exhaustion and system instability on servers running long-term automated tasks.

**Root Causes**:
1. Browser tabs not closing properly when `page.close()` is called
2. Browser contexts not being properly disposed when sessions end
3. Orphaned Chrome processes persisting after MCP session termination
4. Upstream Chromium memory leak on repeated browser open/close cycles
5. No automatic cleanup mechanism for accumulated browser instances

**Impact**:
- Server memory exhaustion (97% utilization observed)
- High system load (load average 68.51 observed)
- Multiple zombie Chrome and Chrome-headless processes
- Requires manual intervention and server restarts

## Documents

### [00-OVERVIEW.md](./00-OVERVIEW.md)
**Executive summary with proposed solutions**
- Problem description and impact
- Root cause analysis
- 6 proposed solutions with implementation details
- Prevention checklist

### [01-TIMELINE.md](./01-TIMELINE.md)
**Timeline and sequence of events**
- How the leak manifests over time
- Process accumulation patterns
- Observed system metrics

### [02-ROOT-CAUSES.md](./02-ROOT-CAUSES.md)
**Deep technical analysis**
- Playwright MCP architecture
- Browser context lifecycle
- Known upstream issues
- Resource management gaps

### [03-SOLUTIONS.md](./03-SOLUTIONS.md)
**Proposed solutions and mitigations**
- Immediate mitigations
- Long-term fixes
- Configuration recommendations
- Monitoring strategies

### [04-CLAUDE-PLAYWRIGHT-MCP-CONFIGURATION.md](./04-CLAUDE-PLAYWRIGHT-MCP-CONFIGURATION.md)
**Claude Code specific Playwright MCP configuration guide**
- Installation methods (`claude mcp add`)
- Configuration options and flags
- Recommended configurations for memory leak prevention
- Version management and pinning
- Troubleshooting common issues
- Complete configuration examples

### [screenshot-resource-usage.png](./screenshot-resource-usage.png)
**Evidence screenshot from the issue**
- System `top` output showing Chrome process accumulation
- Memory utilization metrics
- Process listing

## Quick Reference

### Key Statistics (from screenshot)
- **Server Uptime**: 7 days, 20:22
- **Load Average**: 68.51, 63.19, 49.10
- **Memory Usage**: ~97% (9925.9 total, 100.3 free MiB)
- **Running Processes**: 974 total, 24 running
- **Zombie Processes**: 2

### Observed Processes
- Multiple `chrome-headless` processes
- Multiple `chrome-sandbox` processes
- Multiple `claude` processes
- `chromium-preloader` processes

### Related GitHub Issues

#### Playwright MCP Issues
- [microsoft/playwright-mcp#1111](https://github.com/microsoft/playwright-mcp/issues/1111) - Close tabs or browser not working
- [microsoft/playwright-mcp#942](https://github.com/microsoft/playwright-mcp/issues/942) - Browser already in use error
- [microsoft/playwright-mcp#891](https://github.com/microsoft/playwright-mcp/issues/891) - Browser lock error
- [microsoft/playwright-mcp#1194](https://github.com/microsoft/playwright-mcp/issues/1194) - Browser install hangs

#### Playwright Core Issues
- [microsoft/playwright#21079](https://github.com/microsoft/playwright/issues/21079) - Memory leak on repeated browser open/close
- [microsoft/playwright#15400](https://github.com/microsoft/playwright/issues/15400) - Playwright memory leak
- [microsoft/playwright#15163](https://github.com/microsoft/playwright/issues/15163) - browser.close doesn't close contexts properly
- [microsoft/playwright#16630](https://github.com/microsoft/playwright/issues/16630) - Browser context not closing properly
- [microsoft/playwright-python#984](https://github.com/microsoft/playwright-python/issues/984) - Too many chrome processes left

#### Claude Code Issues
- [anthropics/claude-code#1383](https://github.com/anthropics/claude-code/issues/1383) - Playwright MCP frequently fails

## Proposed Solutions

### 0. Configure Claude Code with Isolated Mode (HIGHEST PRIORITY)
**For Claude Code users**, reconfigure Playwright MCP with memory-safe settings:
```bash
# Remove existing configuration
claude mcp remove playwright

# Add with isolated mode and pinned version
claude mcp add playwright -- npx @playwright/mcp@0.0.49 --isolated --headless
```
See [04-CLAUDE-PLAYWRIGHT-MCP-CONFIGURATION.md](./04-CLAUDE-PLAYWRIGHT-MCP-CONFIGURATION.md) for detailed configuration options.

### 1. Use Isolated Mode (IMMEDIATE)
Run Playwright MCP with `--isolated` flag to create ephemeral browser contexts:
```bash
npx @playwright/mcp@latest --isolated
```

### 2. Implement Periodic Browser Recycling (HIGH PRIORITY)
Restart browser processes periodically to prevent memory accumulation:
```javascript
const MAX_BROWSER_LIFETIME = 30 * 60 * 1000; // 30 minutes
setInterval(async () => {
  await browser.close();
  browser = await playwright.chromium.launch();
}, MAX_BROWSER_LIFETIME);
```

### 3. Add Cron Job for Cleanup (MEDIUM PRIORITY)
Schedule periodic cleanup of orphaned Chrome processes:
```bash
# Add to crontab
*/30 * * * * pkill -f "chrome-headless" && sleep 5 && pkill -9 -f "chrome-headless"
```

### 4. Use Docker with --init Flag (MEDIUM PRIORITY)
Run containers with proper process management:
```bash
docker run --init --ipc=host --cap-add=SYS_ADMIN your-image
```

### 5. Implement Process Monitoring (HIGH PRIORITY)
Add monitoring to detect and alert on Chrome process accumulation.

### 6. Explicit Context Cleanup (HIGH PRIORITY)
Always close context before browser:
```javascript
await context.close();
await browser.close();
```

## External Resources

### Documentation
- [Playwright MCP GitHub Repository](https://github.com/microsoft/playwright-mcp)
- [Browser Context Management - DeepWiki](https://deepwiki.com/microsoft/playwright-mcp/4.4-browser-context-management)
- [Playwright MCP 2.0 Memory Leak Fixes (2025)](https://markaicode.com/playwright-mcp-memory-leak-fixes-2025/)

### Community Discussions
- [Playwright MCP Server Guide - QA Touch](https://www.qatouch.com/blog/playwright-mcp-server/)
- [Stack Overflow - Python Playwright memory overload](https://stackoverflow.com/questions/72954376/python-playwright-memory-overlad)

## Next Steps

1. **Implement process monitoring** on affected servers
2. **Switch to isolated mode** for MCP server instances
3. **Add periodic cleanup cron job** as immediate mitigation
4. **Update Docker configurations** with proper flags
5. **Consider process recycling** in long-running automation
6. **Report findings** to microsoft/playwright-mcp repository

## Authors

- Investigation: AI Assistant (Claude)
- Issue Reporter: @konard
- Date: 2025-12-05

## License

This case study is part of the Hive Mind project documentation.
