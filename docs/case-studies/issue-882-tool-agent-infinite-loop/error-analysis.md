# Error Analysis - Issue #882

## API Error Details

### Error Response Structure

Each failed API call returned this exact error:

```json
{
  "type": "error",
  "error": {
    "type": "not_found_error",
    "message": "model: grok-code"
  },
  "request_id": "req_011CVvcr..." // unique per request
}
```

### HTTP Status Code

- **404 Not Found** - The model identifier does not exist in Anthropic's model registry

### Request IDs Captured

| Attempt | Request ID | Timestamp |
|---------|------------|-----------|
| 1 | req_011CVvcrXhXBbhFqpvm6JfEK | 06:12:29 |
| 2 | req_011CVvcs9hUHxZN4QVDZuEmG | 06:12:34 |
| 3 | req_011CVvcsoRr7RjGuFzxWX1kw | 06:12:43 |
| 4 | req_011CVvctRcDFKmXaeGuJk7Tu | 06:12:52 |
| 5 | req_011CVvcu3C7M37VWkN49QttT | 06:13:00 |
| 6 | req_011CVvcuggrHa7ScKZWcb14M | 06:13:09 |
| 7 | req_011CVvcvHuAzPAjUDxBCZxdE | 06:13:17 |
| 8 | req_011CVvcvrRm4gm84jgPW9vQs | 06:13:25 |

## Root Cause: Model Name Confusion

### Valid Model Names by Tool

| Tool | Valid Models | Provider |
|------|--------------|----------|
| Claude CLI | sonnet, haiku, opus, claude-3-5-sonnet, claude-3-opus, etc. | Anthropic |
| Agent CLI | grok-code, grok-code-fast-1, big-pickle, etc. | OpenCode/Zen |
| OpenCode CLI | Various models via their ecosystem | Multiple |

### Model Mapping Table (from agent.lib.mjs)

```javascript
const modelMap = {
  'grok': 'opencode/grok-code',
  'grok-code': 'opencode/grok-code',
  'grok-code-fast-1': 'opencode/grok-code',
  'big-pickle': 'opencode/big-pickle',
  'gpt-5-nano': 'openai/gpt-5-nano',
  'sonnet': 'anthropic/claude-3-5-sonnet',
  'haiku': 'anthropic/claude-3-5-haiku',
  'opus': 'anthropic/claude-3-opus',
  'gemini-3-pro': 'google/gemini-3-pro',
};
```

### What Happened

1. User specified: `--tool agent --model grok-code`
2. Agent CLI internally maps this to: `opencode/grok-code` (correct for Agent)
3. Watch mode dispatched to Claude CLI with raw: `grok-code` (incorrect)
4. Claude CLI sent to Anthropic API: `grok-code` (unknown model)
5. Anthropic returned: 404 Not Found

## Code Path Analysis

### Correct Path (Initial Execution)

```
solve.mjs
  -> executeAgent() [agent.lib.mjs]
    -> mapModelToId('grok-code')
    -> Returns 'opencode/grok-code'
    -> Agent CLI called with correct model
    -> SUCCESS
```

### Incorrect Path (Watch Mode Retry)

```
solve.watch.lib.mjs
  -> watchForFeedback()
    -> argv.tool === 'agent' falls through to else branch
    -> executeClaude() [claude.lib.mjs]
    -> Claude CLI called with raw 'grok-code'
    -> Anthropic API 404
    -> FAILURE (loops)
```

### The Bug Location

**File**: `solve.watch.lib.mjs`
**Lines**: 297-383

```javascript
// Missing case for agent tool!
if (argv.tool === 'opencode') {
  // Uses OpenCode - correct
} else if (argv.tool === 'codex') {
  // Uses Codex - correct
} else {
  // Falls through to Claude - INCORRECT for agent tool
  const { executeClaude } = await import('./claude.lib.mjs');
  toolResult = await executeClaude({ ... });
}
```

## Error Handling Analysis

### Current Behavior

When the API returns 404:

1. Error logged: "API Error: 404 ..."
2. Result marked as failed
3. `success: false` returned
4. Watch loop logs: "Will retry in next check"
5. **No retry counter incremented**
6. **No backoff applied**
7. Loop continues indefinitely

### Expected Behavior

1. Detect that this is a permanent error (model doesn't exist)
2. Distinguish from transient errors (rate limit, network timeout)
3. For permanent errors: fail fast, don't retry
4. For transient errors: implement exponential backoff

### Error Classification Needed

| Error Type | HTTP Code | Should Retry? | Notes |
|------------|-----------|---------------|-------|
| Model not found | 404 | No | Model doesn't exist |
| Authentication failed | 401 | No | Credentials invalid |
| Rate limited | 429 | Yes | With exponential backoff |
| Server error | 500/502/503 | Yes | With backoff, limited retries |
| Network timeout | - | Yes | With backoff, limited retries |
| Invalid request | 400 | No | Request malformed |

## Impact Assessment

### Resource Consumption

- **API Calls**: 8+ failed calls to Anthropic API
- **Time**: ~67 seconds of continuous retry attempts
- **Compute**: CPU cycles wasted on retry logic
- **Network**: Repeated HTTP requests to API

### Potential Costs (If Not Free Tier)

- Each API call, even if failed, may count against quotas
- Repeated failures can trigger rate limiting
- API costs if error response is counted

### User Experience

- Confusing output with repeated errors
- No clear indication of permanent vs transient failure
- No guidance on how to resolve the issue
- Process appears stuck/hung

## Recommendations

### Immediate Fix

Add agent tool handling to watch mode:

```javascript
if (argv.tool === 'agent') {
  const { executeAgent } = await import('./agent.lib.mjs');
  toolResult = await executeAgent({ ... });
}
```

### Long-term Improvements

1. **Error Classification**: Implement a utility to classify API errors
2. **Retry Policy**: Different policies for different error types
3. **Circuit Breaker**: Stop retrying after N consecutive failures
4. **User Feedback**: Clear messages about permanent vs transient errors
5. **Model Validation**: Validate model compatibility with tool at startup
