# Case Study: Solve Command Stuck on Playwright MCP Tool Call

## Issue Summary

**Issue**: [#1039](https://github.com/link-assistant/hive-mind/issues/1039)
**Title**: Solve command stuck on Playwright MCP tool call
**Date**: 2025-12-30
**Status**: Analysis Complete

## Problem Description

The `solve` command becomes stuck indefinitely when the AI assistant calls a Playwright MCP browser automation tool. In this specific case, the command was stuck for approximately **1 hour and 34 minutes** after calling `mcp__playwright__browser_click` to click a button on a web page.

### Key Evidence

From the log file `af1463d6-30a8-4119-92ff-d25a89bd948a.txt`:

- **11:22:53.672Z**: AI calls `mcp__playwright__browser_click` on "Load data" button (ref=e76)
- **12:57:10.345Z**: Session interrupted by Ctrl+C (user intervention required)
- **Gap**: ~1 hour 34 minutes with no response from Playwright MCP

## Root Cause Analysis

The issue is related to the Playwright MCP tool not responding after a browser interaction. Based on research:

### Primary Causes

1. **Playwright MCP Timeout Not Being Respected**
   - The Playwright MCP is configured with `--timeout-action=600000` (10 minutes)
   - Despite this configuration, the action hung for 1 hour 34 minutes
   - The timeout mechanism failed to trigger for unknown reasons

2. **Click Action Triggering Long-Running Operation**
   - The "Load data" button was loading 304,613 GeoJSON records
   - This could trigger network requests, file loading, or JavaScript processing
   - If the button triggered a file download or large data load, it may have caused Playwright to wait indefinitely

3. **Known browser_click Issues** ([microsoft/playwright-mcp#355](https://github.com/microsoft/playwright-mcp/issues/355))
   - Issues with `browser_click` triggering downloads on versions >= 0.0.19
   - Click actions may not complete properly if they trigger asynchronous operations

4. **MCP Protocol Layer Issue** ([microsoft/playwright-mcp#982](https://github.com/microsoft/playwright-mcp/issues/982))
   - The timeout may apply to Playwright actions but not propagate through MCP protocol layer
   - MCP connection remained active but no response was returned

### Context from the Log

The page was a Cesium.js 3D globe application with:

- Error: 401 on Cesium Ion API (token issue)
- Error: 404 on mrds.geojson file
- The "Load data" button was supposed to load mineral resource data points

## Timeline of Events

| Timestamp (UTC) | Event                                                    |
| --------------- | -------------------------------------------------------- |
| 11:20:03.703    | Session starts, solve.mjs v0.51.18                       |
| 11:20:34.892    | Playwright MCP detected - browser hints enabled          |
| 11:20:37.889    | Claude session initialized, Playwright MCP connected     |
| 11:22:47.292    | AI navigates to http://localhost:8000 successfully       |
| 11:22:48.878    | Page snapshot shows UI with "Load data" button           |
| 11:22:53.672    | AI calls `browser_click` on "Load data" button (ref=e76) |
| 12:57:10.345    | **Session interrupted (Ctrl+C)** - No response for 1h34m |

## Files in This Case Study

- `af1463d6-30a8-4119-92ff-d25a89bd948a.txt` - Full log file from the stuck session ([original gist](https://gist.githubusercontent.com/konard/26d78dc935a9aa857ea119f20f46bb0a/raw/7d62f1bda8f8b233b6ef60bb892c8e28e14aefe3/af1463d6-30a8-4119-92ff-d25a89bd948a.txt))
- `solution-draft-log-pr-1767100846598.txt` - AI solution draft execution log ([original gist](https://gist.githubusercontent.com/konard/219e151d58f0e1e9750cb3160df8eb2f/raw/8c1c0e19570de199e18066b7d72659124590a875/solution-draft-log-pr-1767100846598.txt))
- `README.md` - This overview document
- `01-TIMELINE.md` - Detailed timeline reconstruction
- `02-ROOT-CAUSES.md` - In-depth root cause analysis
- `03-PROPOSED-SOLUTIONS.md` - Proposed solutions and mitigations

## Proposed Solutions

### 1. Enhance AI System Prompt with Safety Guidelines (Implemented)

Added safety guidelines to the AI system prompt to help prevent clicking buttons that trigger long operations:

- Before clicking buttons that may trigger large data operations, verify the operation is safe
- Address authentication or missing resource issues before testing UI functionality
- After clicking buttons that trigger data loading, use browser_wait_for to verify completion
- For potentially long-running operations, prefer browser_evaluate with explicit JavaScript timeouts

### 2. Implement Click-with-Timeout Pattern

Instead of using `browser_click` for buttons that trigger long operations:

- Use `browser_snapshot` to verify the current state
- Use `browser_evaluate` to execute JavaScript with explicit timeouts
- Use `browser_wait_for` with specific text expectations

### 3. Add Monitoring and Recovery

- Implement timeout detection in solve.mjs for MCP tool calls
- Add automatic recovery mechanism when tools don't respond
- Log warning when MCP tools exceed expected duration

### 4. AI Prompt Enhancement

Add guidance to the system prompt:

- Avoid clicking buttons that trigger large data downloads without first verifying the download target
- Use `browser_wait_for` after clicks that trigger data loading
- Always close the browser when done to free resources

## Related Issues and Resources

### Playwright MCP Issues

- [microsoft/playwright-mcp#982](https://github.com/microsoft/playwright-mcp/issues/982) - MCP ping timeout configuration
- [microsoft/playwright-mcp#355](https://github.com/microsoft/playwright-mcp/issues/355) - browser_click download issues
- [microsoft/playwright-mcp#1082](https://github.com/microsoft/playwright-mcp/issues/1082) - MCP client timeout issues

### Claude Code Issues

- [anthropics/claude-code#1383](https://github.com/anthropics/claude-code/issues/1383) - Playwright MCP frequently fails

### Previous Case Studies

- [issue-837-playwright-mcp-chrome-leak](../issue-837-playwright-mcp-chrome-leak/) - Playwright MCP memory leak and configuration

## Conclusion

The issue appears to be caused by the Playwright MCP tool hanging after a `browser_click` action that triggered a long-running operation (loading 300K+ data points). The click action never returned a response, leaving the solve command stuck until manual intervention.

The recommended fix is to:

1. Configure Playwright MCP with proper timeout settings
2. Enhance the AI system prompt with guidance on handling potentially long-running browser operations
3. Consider implementing timeout detection at the solve.mjs level for MCP tool calls
