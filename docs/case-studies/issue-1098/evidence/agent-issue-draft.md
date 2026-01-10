# Draft Issue for link-assistant/agent

## Title

Socket connection closed unexpectedly during streaming API responses with Bun

## Labels

bug, bun, network

## Body

### Description

When using the agent CLI with streaming API providers (e.g., `opencode/grok-code`), the connection frequently fails after approximately 10-12 seconds with the error:

```
Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()
```

### Environment

- Agent version: As called from solve v0.54.4
- Bun version: (bundled with agent)
- OS: Linux (Ubuntu)
- Model: opencode/grok-code (Grok Code Fast 1)

### Steps to Reproduce

1. Use the agent CLI via stdin with a streaming model:

   ```bash
   echo '{"message": "Hello, please analyze this code..."}' | agent --model opencode/grok-code
   ```

2. Or via solve.mjs with --tool agent:

   ```bash
   node solve.mjs https://github.com/example/repo/issues/1 --tool agent
   ```

3. Wait approximately 10-12 seconds

4. Observe the socket connection error

### Expected Behavior

The agent should successfully complete the streaming API request and return a response.

### Actual Behavior

The connection fails with:

```json
{
  "type": "error",
  "timestamp": 1768080034712,
  "sessionID": "ses_45637e0dcffeqxaDRRDyQRd69N",
  "error": {
    "name": "UnknownError",
    "data": {
      "message": "Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()"
    }
  }
}
```

### Root Cause Analysis

This is a **known issue with Bun's `fetch()` implementation**:

1. **Bun's default `idleTimeout` is 10 seconds** in `Bun.serve()` contexts (see [oven-sh/bun#14439](https://github.com/oven-sh/bun/issues/14439))
2. Long-running streaming connections exceed this timeout
3. The upstream provider connection gets dropped unexpectedly

### Related Issues

- [oven-sh/bun#14439](https://github.com/oven-sh/bun/issues/14439) - ConnectionClosed when fetch > 10s (CLOSED - workaround documented)
- [oven-sh/bun#16719](https://github.com/oven-sh/bun/issues/16719) - Dev server fails after 10+ minutes
- [sst/opencode#2304](https://github.com/sst/opencode/issues/2304) - Error with .git folder
- [sst/opencode#3511](https://github.com/sst/opencode/issues/3511) - Socket error from MCP server
- [link-assistant/hive-mind#1098](https://github.com/link-assistant/hive-mind/issues/1098) - Original report with full case study

### Workarounds

1. **Retry the operation** - The error is often transient and succeeds on retry
2. **Use a different tool** - Claude Code (`--tool claude`) doesn't have this issue
3. **Use Node.js** - Node's fetch doesn't have this timeout issue

### Suggested Fix

1. **Add retry logic for socket errors** in the provider/session code:

   ```typescript
   async function fetchWithRetry(url, options, maxRetries = 3) {
     for (let attempt = 1; attempt <= maxRetries; attempt++) {
       try {
         return await fetch(url, options);
       } catch (e) {
         if (e.message.includes('socket connection was closed') && attempt < maxRetries) {
           await delay(1000 * attempt); // Exponential backoff
           continue;
         }
         throw e;
       }
     }
   }
   ```

2. **Set explicit timeout > 10 seconds** for streaming operations:

   ```typescript
   options['fetch'] = async (input, init) => {
     return fetch(input, {
       ...init,
       signal: AbortSignal.timeout(120000), // 2 minutes
       verbose: true, // For debugging
     });
   };
   ```

3. **Add verbose mode** to capture more diagnostic information when errors occur

4. **Consider using Node.js** for critical streaming operations instead of Bun

### Logs

Full execution log available at: https://github.com/link-assistant/hive-mind/issues/1098

Case study with detailed analysis: `docs/case-studies/issue-1098/README.md`
