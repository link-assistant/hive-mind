# Error Pattern Analysis

## Observed Error Messages

### Pattern 1: Usage Limit Error (from issue #719)
```json
{"type":"error","message":"You've hit your usage limit. To get more access now, send a request to your admin or try again at 12:16 PM."}
{"type":"turn.failed","error":{"message":"You've hit your usage limit. To get more access now, send a request to your admin or try again at 12:16 PM."}}
```

**Characteristics:**
- Contains: `You've hit your usage limit`
- Contains: `try again at [TIME]`
- Format: JSON with type "error" or type "turn.failed"
- Provides reset time

### Pattern 2: Rate Limit Error (existing)
```
rate_limit_exceeded
```
or
```
You have exceeded your rate limit
```

**Characteristics:**
- Contains: `rate_limit_exceeded` or `rate limit`
- May not provide reset time

## Detection Strategy

### 1. Primary Detection Keywords
All three patterns should be detected:
1. `You've hit your usage limit` (case-insensitive)
2. `hit your usage limit` (case-insensitive)
3. `rate_limit_exceeded`
4. `rate limit` (existing, but less specific)

### 2. Time Extraction Regex
Extract reset time from messages like:
- "try again at 12:16 PM"
- "try again at 2:30 PM"
- "available at 14:00"

Regex pattern: `try again at ([0-9]{1,2}:[0-9]{2}\s*[AP]M)`

### 3. Tool-Specific Considerations

#### Claude (claude.lib.mjs)
- Receives output as JSON lines
- Already has rate limit detection at lines 1111-1120
- Needs enhancement to detect "usage limit" pattern
- Already supports session resume with `--auto-continue`

#### Codex (codex.lib.mjs)
- Receives output as JSON lines
- Has basic rate limit detection at lines 394-396
- Needs enhancement to detect "usage limit" pattern
- Need to extract session ID for resume

#### OpenCode (opencode.lib.mjs)
- Receives output as plain text
- Has basic rate limit detection at lines 330-332
- Needs enhancement to detect "usage limit" pattern
- Need to extract session ID for resume

## Implementation Code Snippets

### Enhanced Detection Function

```javascript
/**
 * Detect usage limit errors and extract reset time
 * @param {string} message - Error message to analyze
 * @returns {Object} - { isUsageLimit: boolean, resetTime: string|null }
 */
function detectUsageLimit(message) {
  const isUsageLimit =
    message.includes("You've hit your usage limit") ||
    message.includes("hit your usage limit") ||
    message.includes("You have exceeded your rate limit") ||
    message.includes("rate_limit_exceeded") ||
    (message.includes("rate_limit") && !message.includes("rate_limit_error")) ||
    (message.includes("rate limit") && !message.includes("error"));

  let resetTime = null;
  if (isUsageLimit) {
    // Try to extract reset time
    const timeMatch = message.match(/try again at ([0-9]{1,2}:[0-9]{2}\s*[AP]M)/i);
    if (timeMatch) {
      resetTime = timeMatch[1];
    }
  }

  return { isUsageLimit, resetTime };
}
```

### Usage in Tools

```javascript
// In claude.lib.mjs, codex.lib.mjs, opencode.lib.mjs
if (exitCode !== 0) {
  const limitInfo = detectUsageLimit(lastMessage);

  if (limitInfo.isUsageLimit) {
    limitReached = true;
    await log('\n\n⏳ Usage Limit Reached!', { level: 'warning' });
    await log('   Your AI tool usage limit has been reached.', { level: 'warning' });

    if (limitInfo.resetTime) {
      await log(`   The limit will reset at: ${limitInfo.resetTime}`, { level: 'warning' });
    }

    if (sessionId) {
      await log(`\n📌 Session ID: ${sessionId}`);
      await log('   To continue when the limit resets, run:');
      await log(`   [tool-specific resume command]`);
    }

    return {
      success: false,
      sessionId,
      limitReached: true,
      limitResetTime: limitInfo.resetTime
    };
  }
  // ... handle other errors
}
```

## Testing Patterns

### Test Case 1: Usage Limit with Reset Time
```javascript
const message = '{"type":"error","message":"You\'ve hit your usage limit. To get more access now, send a request to your admin or try again at 12:16 PM."}';
const result = detectUsageLimit(message);
assert(result.isUsageLimit === true);
assert(result.resetTime === "12:16 PM");
```

### Test Case 2: Rate Limit Without Reset Time
```javascript
const message = '{"type":"error","message":"rate_limit_exceeded"}';
const result = detectUsageLimit(message);
assert(result.isUsageLimit === true);
assert(result.resetTime === null);
```

### Test Case 3: Regular Error
```javascript
const message = '{"type":"error","message":"Connection timeout"}';
const result = detectUsageLimit(message);
assert(result.isUsageLimit === false);
assert(result.resetTime === null);
```

## References

- Issue #719: https://github.com/deep-assistant/hive-mind/issues/719
- Example log: https://github.com/link-foundation/ideav-local-associative-js/pull/2#issuecomment-3521528245
