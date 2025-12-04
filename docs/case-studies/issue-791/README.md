# Case Study: Issue #791 - Fix `/limits` command in hive-telegram-bot

## Issue Summary

The `/limits` command in the Telegram bot was failing with error code 127 when trying to fetch Claude usage limits.

**GitHub Issue:** https://github.com/link-assistant/hive-mind/issues/791

## Timeline of Events

1. **PR #792 (Merged):** Initial implementation of `/limits` command using `expect` to interact with `claude /usage` CLI
2. **Issue #791 (Reported):** Command failing on production server with error code 127
3. **PR #795 (This Fix):** Replace `expect`-based approach with direct OAuth API call

## Root Cause Analysis

### The Problem

The original implementation used the `expect` command to interact with the Claude CLI:

```javascript
const expectScript = `
expect -c '
  log_user 0
  set timeout 30
  spawn claude /usage
  sleep 5
  send "\\r"
  expect eof
  exit 0
' 2>/dev/null
`;
```

This approach failed because:

1. **Error code 127** indicates "command not found" - the `expect` utility was not installed on the production server
2. The `expect` package is commonly missing in minimal Docker/container environments
3. Even if `expect` was installed, the `claude /usage` command shows interactive prompts that are difficult to automate reliably

### Evidence from Logs

```
Error: Command failed:
expect -c '
  log_user 0
  set timeout 30
  spawn claude /usage
  ...
' 2>/dev/null
{
  code: 127,
  killed: false,
  signal: null,
  ...
}
```

## Solution

### Approach

Instead of parsing CLI output, we discovered that Claude Code uses an OAuth API to fetch usage data:

**Endpoint:** `https://api.anthropic.com/api/oauth/usage`

This API:
- Returns JSON with usage percentages and reset times
- Uses the same credentials stored in `~/.claude/.credentials.json`
- Is more reliable and doesn't require external tools like `expect`

### API Response Format

```json
{
  "five_hour": {
    "utilization": 73,
    "resets_at": "2025-12-03T18:00:00.104199+00:00"
  },
  "seven_day": {
    "utilization": 83,
    "resets_at": "2025-12-04T18:00:00.104220+00:00"
  },
  "seven_day_sonnet": {
    "utilization": 35,
    "resets_at": "2025-12-04T18:00:00.104233+00:00"
  }
}
```

### Mapping to Display Fields

| API Field | Display Label |
|-----------|---------------|
| `five_hour` | Current session |
| `seven_day` | Current week (all models) |
| `seven_day_sonnet` | Current week (Sonnet only) |

## Implementation Changes

### Files Modified

1. **`src/claude-limits.lib.mjs`** - Complete rewrite to use OAuth API:
   - Removed dependency on `expect` command
   - Read credentials from `~/.claude/.credentials.json`
   - Call Anthropic OAuth usage API directly
   - Parse JSON response instead of CLI output

2. **`experiments/test-limits-api.mjs`** - New test script to verify API approach works

## Testing

### Verification Script

```bash
node experiments/test-limits-api.mjs
```

### Expected Output

```
=== Testing Claude Usage Limits API ===

Test 1: Fetching usage limits via OAuth API...
PASS: Successfully fetched usage limits

Test 2: Verifying data structure...
Has currentSession: PASS
Has allModels: PASS
Has sonnetOnly: PASS

Test 3: Verifying percentages...
Current session: 73% - PASS
All models: 83% - PASS
Sonnet only: 35% - PASS

=== All tests passed! ===
```

## Benefits of New Approach

1. **No external dependencies** - Works without `expect` or any other CLI tools
2. **More reliable** - Direct API call vs parsing CLI output
3. **Faster** - Single HTTP request vs spawning processes
4. **Easier to maintain** - JSON parsing vs regex-based text parsing
5. **Better error handling** - Clear error messages for auth failures

## Screenshots

See `docs/case-studies/issue-791/` for original screenshots:
- `screenshot1-expected-format.png` - Expected output format from Claude CLI
- `screenshot2-error.png` - Error shown in Telegram bot

## References

- [Claude Code Usage Limits Statusline Article](https://codelynx.dev/posts/claude-code-usage-limits-statusline)
- [Anthropic Rate Limits Documentation](https://docs.claude.com/en/api/rate-limits)
