# Case Study: Issue #1066 - `mcp__playwright__browser_run_code` Tool Stuck for More Than an Hour

## Issue Summary

**Issue URL:** https://github.com/link-assistant/hive-mind/issues/1066
**Date:** 2026-01-04
**Session ID:** 63e7f9a4-b169-41c0-952a-27c8eaeceeb6
**Claude Code Version:** 2.0.76
**Model:** claude-opus-4-5-20251101

### Symptoms

- AI work session started at 15:42:47 UTC
- Claude Code tool (`mcp__playwright__browser_run_code`) became stuck during execution
- No response was received for ~1 hour 49 minutes
- Session was manually aborted with CTRL+C at 17:46:33 UTC

## Timeline of Events

Based on the log file analysis:

| Timestamp (UTC) | Event |
|-----------------|-------|
| 15:42:47.934 | AI work session started |
| 15:42:52.541 | Session ID assigned: 63e7f9a4-b169-41c0-952a-27c8eaeceeb6 |
| 15:42:57.117 | Claude execution began |
| 15:56:50.789 | First `browser_run_code` tool call sent (toolu_013MeiCTQ7qyHmrvszAJ68vm) |
| 15:56:53.271 | **Result received successfully** for first tool call |
| 15:57:00.703 | Second `browser_run_code` tool call sent (toolu_015p7imivaVDJJgYBCk2dKWe) - **No response** |
| 15:57:00.949 | Third `browser_run_code` tool call sent (toolu_01Vtj8zFcgXLphGbjSraPr74) - **No response** |
| 15:57:01.927 | Fourth `browser_run_code` tool call sent (toolu_0162ZwEn7AsvJ1MpzQL6tySN) - **No response** |
| 15:57:02.607 | Fifth `browser_run_code` tool call sent (toolu_01Gb8KivyWvpRRVZgpvgtB7q) - **No response** |
| **GAP** | **1 hour 49 minutes with no log entries** |
| 17:46:33.647 | "Claude command completed" message logged |
| 17:46:33.652 | Process interrupted with CTRL+C |

**Key Observation:** 4 parallel tool calls were sent within 2 seconds (15:57:00-15:57:02), all from the same Claude message (`msg_01GENzY7y5uBjTcR1iLzAmKW`), and none of them ever received a response.

## Tool Calls That Got Stuck

All 4 pending tool calls were simple code executions to read lines from a page:

```javascript
// Tool call 1 (15:57:00.703) - toolu_015p7imivaVDJJgYBCk2dKWe
async (page) => {
  const content = await page.content();
  const lines = content.split('\n');
  return lines.slice(21255, 21320).join('\n');
}

// Tool call 2 (15:57:00.949) - toolu_01Vtj8zFcgXLphGbjSraPr74
async (page) => {
  const content = await page.content();
  const lines = content.split('\n');
  return lines.slice(21380, 21450).join('\n');
}

// Tool call 3 (15:57:01.927) - toolu_0162ZwEn7AsvJ1MpzQL6tySN
async (page) => {
  const content = await page.content();
  const lines = content.split('\n');
  return lines.slice(21490, 21540).join('\n');
}

// Tool call 4 (15:57:02.607) - toolu_01Gb8KivyWvpRRVZgpvgtB7q
async (page) => {
  const content = await page.content();
  const lines = content.split('\n');
  return lines.slice(21525, 21590).join('\n');
}
```

## Root Cause Analysis

### Primary Root Cause: Missing Timeout Configuration at Multiple Levels

The issue stems from a combination of factors:

#### 1. MCP Tool Call Timeout Issues

Based on research of related GitHub issues:

- **[Claude Code Issue #424](https://github.com/anthropics/claude-code/issues/424)**: MCP tool calls over 60 seconds fail with `-32001 timeout` error from the MCP TypeScript SDK
- **[Claude Code Issue #470](https://github.com/anthropics/claude-code/issues/470)**: Request to use `resetTimeoutOnProgress=True` in MCPClient to support long MCP tool calls
- **[Claude Agent SDK Python Issue #145](https://github.com/anthropics/claude-agent-sdk-python/issues/145)**: Claude code hangs after successful MCP tool execution when the MCP server blocks on long-running operations

#### 2. Playwright MCP Server Timeout Behavior

According to [Playwright MCP Issue #982](https://github.com/microsoft/playwright-mcp/issues/982):

- The Playwright MCP server has a **hardcoded 5-second ping timeout**
- When operations take longer than expected, the server may interpret the lack of ping response as a dead connection
- Different MCP client implementations handle timeouts inconsistently

#### 3. Parallel Tool Calls Complication

In this case, Claude requested **4 parallel `browser_run_code` calls** within 2 seconds. The Playwright MCP server may not be designed to handle multiple simultaneous code execution requests efficiently, potentially causing:

- Request queuing or serialization issues
- Resource contention for the browser page object
- Connection state management problems

### Secondary Factors

1. **No Progress Reporting**: The MCP SDK doesn't support progress reporting for timeout extension, meaning long operations can't signal that they're still alive

2. **No Graceful Timeout**: Neither Claude Code nor Playwright MCP implemented a graceful timeout that would:
   - Return an error after a reasonable period
   - Allow the session to continue with other operations
   - Log diagnostic information about the failure

3. **Connection State Loss**: Based on Issue #145, if the MCP server blocks on operations without emitting heartbeats, the connection can become stale without either side detecting it

## Evidence from Logs

### Successful vs. Failed Tool Calls

The first `browser_run_code` call at 15:56:50.789 received a successful response at 15:56:53.271 (2.5 seconds). This proves:
- The Playwright MCP server was functional
- The browser session was active
- The `page.content()` operation worked

However, when 4 parallel calls were issued immediately after, none received responses.

### No Error Messages

The log shows no error messages between 15:57:02.607 (last tool call) and 17:46:33.647 (manual interruption). This indicates:
- No timeout errors were raised
- No connection failure was detected
- The system simply hung indefinitely

## Proposed Solutions

### Solution 1: Configure MCP Timeout (Workaround)

Set the `MCP_TIMEOUT` environment variable before running Claude Code:

```bash
# For long operations (20 minutes)
MCP_TIMEOUT=1200000 claude

# Or in settings.json
{
  "env": {
    "MCP_TIMEOUT": "120000",
    "MCP_TOOL_TIMEOUT": "120000"
  }
}
```

### Solution 2: Implement Graceful Timeout in Claude Code

Claude Code should implement a maximum timeout for any MCP tool call that:
- Returns a timeout error after the configured period
- Allows the session to continue
- Logs diagnostic information

### Solution 3: Fix Playwright MCP Parallel Call Handling

The Playwright MCP server should be enhanced to:
- Handle multiple parallel `browser_run_code` calls gracefully
- Implement proper request queuing
- Emit heartbeats during long operations (as suggested in Issue #145)

### Solution 4: Implement Progress Reporting (MCP SDK Enhancement)

As proposed in [Issue #470](https://github.com/anthropics/claude-code/issues/470):
- Use `resetTimeoutOnProgress=True` in MCPClient
- Allow long-running operations to reset the timeout by reporting progress

### Solution 5: Add Timeout Configuration to Playwright MCP

As proposed in [Issue #982](https://github.com/microsoft/playwright-mcp/issues/982):
- Make the 5-second ping timeout configurable via environment variable (`MCP_PING_TIMEOUT`)
- Allow users to set longer timeouts for time-intensive operations

## Files Related to This Issue

### Upstream Repositories

1. **Claude Code CLI**: https://github.com/anthropics/claude-code
   - Issue #424: MCP Timeout configuration
   - Issue #470: resetTimeoutOnProgress support
   - Issue #3033: MCP Server Timeout Configuration Ignored

2. **Playwright MCP**: https://github.com/microsoft/playwright-mcp
   - Issue #982: Make MCP ping timeout configurable

3. **Claude Agent SDK Python**: https://github.com/anthropics/claude-agent-sdk-python
   - Issue #145: Hanging after successful MCP tool execution

## Recommendations

### For Immediate Mitigation

1. **Avoid parallel `browser_run_code` calls** - Use sequential calls instead when possible
2. **Set explicit timeouts** - Configure `MCP_TIMEOUT` environment variable
3. **Monitor for hangs** - Implement external watchdog to detect stuck sessions

### For Long-term Fix

1. **File issues** with both:
   - Anthropic (Claude Code): Request graceful timeout handling
   - Microsoft (Playwright MCP): Request better parallel call handling

2. **Implement session watchdog** in hive-mind that:
   - Monitors Claude Code sessions for activity
   - Terminates sessions that appear stuck (no log activity for > N minutes)
   - Notifies users of forced termination

## Attachments

- `logs/full-session-log.txt` - Complete session log (8852 lines)
- `screenshot-stuck-tool.png` - Screenshot showing the stuck session

## Related Issues

- [Claude Code #424](https://github.com/anthropics/claude-code/issues/424) - MCP Timeout needs to be configurable
- [Claude Code #470](https://github.com/anthropics/claude-code/issues/470) - resetTimeoutOnProgress support
- [Playwright MCP #982](https://github.com/microsoft/playwright-mcp/issues/982) - Make MCP ping timeout configurable
- [Claude Agent SDK Python #145](https://github.com/anthropics/claude-agent-sdk-python/issues/145) - Hanging after MCP tool execution
