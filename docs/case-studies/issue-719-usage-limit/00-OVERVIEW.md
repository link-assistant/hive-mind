# Case Study: Usage Limit Error Handling (Issue #719)

## Issue Reference
- **Issue**: https://github.com/deep-assistant/hive-mind/issues/719
- **Pull Request**: https://github.com/deep-assistant/hive-mind/pull/722
- **Date**: 2025-11-12
- **Reporter**: User konard

## Problem Statement

The current implementation of AI tools (claude, codex, opencode) does not handle usage limit errors properly. When a tool hits a usage limit, the error message is buried in logs and the command is shown as successful instead of failed, making it difficult for users to quickly identify the problem.

### Example Error Observed

From https://github.com/link-foundation/ideav-local-associative-js/pull/2#issuecomment-3521528245:

```
[2025-11-12T11:47:04.135Z] [INFO] 📌 Session ID: 019a77e4-0716-7152-8396-b642e26c3e20
[2025-11-12T11:47:04.163Z] [INFO] {"type":"turn.started"}

[2025-11-12T11:47:04.639Z] [INFO] {"type":"error","message":"You've hit your usage limit. To get more access now, send a request to your admin or try again at 12:16 PM."}
{"type":"turn.failed","error":{"message":"You've hit your usage limit. To get more access now, send a request to your admin or try again at 12:16 PM."}}
```

## Requirements

Based on the issue description, the solution must:

1. **Show command as failed** - When a usage limit is reached, the command should be marked as failed, not successful
2. **Separate handling** - Usage limit errors should be handled separately from other failures with a distinct format
3. **User-friendly messages** - Display clear information about:
   - What happened (usage limit reached)
   - When the limit will reset
   - How to proceed once the limit resets
4. **Include logs when --attach-logs is used** - Full logs should still be available
5. **Apply to all tools** - claude, codex, and opencode must all handle this consistently
6. **Easy to read format** - Similar to failed format but specifically tailored for limit errors

## Affected Tools

1. **Claude** (`src/claude.lib.mjs`)
   - Current: Has rate_limit detection but only sets `limitReached` flag
   - Lines: 1111-1120

2. **Codex** (`src/codex.lib.mjs`)
   - Current: Has basic rate_limit detection
   - Lines: 394-396

3. **OpenCode** (`src/opencode.lib.mjs`)
   - Current: Has basic rate_limit detection
   - Lines: 330-332

## Current Implementation Analysis

### Detection Patterns

All three tools currently detect rate limits by searching for keywords in error messages:
- `rate_limit_exceeded`
- `rate_limit`
- `limit`

However, they don't detect the specific pattern: "You've hit your usage limit"

### Current Behavior

When a limit is reached:
1. Tool sets `limitReached: true` in the result
2. Shows a warning message in logs
3. Returns `success: false`
4. **Problem**: Comment format doesn't distinguish this from other failures

### Comment Format

Currently handled in `src/github.lib.mjs` (lines 491-536):
- Success format: Shows cost info and log
- Failure format: Shows generic error message
- **Missing**: Special format for usage limit errors

## Proposed Solution

### 1. Enhanced Detection

Update all three tools to detect:
- Existing patterns: `rate_limit_exceeded`, `rate_limit`, `limit`
- New pattern: `You've hit your usage limit`
- Extract reset time when available (e.g., "try again at 12:16 PM")

### 2. Usage Limit Result Flag

All tools should return:
```javascript
{
  success: false,
  limitReached: true,
  limitResetTime: "12:16 PM" // extracted from error message
}
```

### 3. New Comment Format

Add a third comment format in `github.lib.mjs`:

```markdown
## ⏳ Usage Limit Reached

The automated solution draft was interrupted because the AI tool hit its usage limit.

### 📊 Limit Information
- **Tool**: Claude/Codex/OpenCode
- **Limit Type**: Usage limit
- **Reset Time**: 12:16 PM (if available)

### 🔄 Next Steps
To continue when the limit resets, run:
```
[command to resume]
```

<details>
<summary>Click to expand execution log</summary>
```
[full log here if --attach-logs]
```
</details>

---
*This session was interrupted due to usage limits. You can resume once the limit resets.*
```

### 4. Console Output

When limit is detected, show prominent message:
```
⏳ Usage Limit Reached!

Your AI tool usage limit has been reached.
The limit will reset at: 12:16 PM

To resume this session after the limit resets, run:
   [resume command]

Session ID: [session-id]
```

## Files to Modify

1. `src/claude.lib.mjs` - Enhanced limit detection (lines 1111-1120)
2. `src/codex.lib.mjs` - Enhanced limit detection (lines 394-396)
3. `src/opencode.lib.mjs` - Enhanced limit detection (lines 330-332)
4. `src/github.lib.mjs` - New comment format (after line 505)
5. `src/solve.mjs` or result handler - Pass limit info to comment formatter

## Testing Strategy

1. Create test scripts that simulate usage limit errors
2. Verify detection works for all patterns
3. Verify comment format is correct
4. Verify logs are attached when --attach-logs is used
5. Test with all three tools (claude, codex, opencode)

## Success Criteria

- ✅ Usage limit errors are detected reliably
- ✅ Command is marked as failed (success: false)
- ✅ Special comment format is used for usage limits
- ✅ Reset time is extracted and displayed when available
- ✅ Clear instructions for resuming are provided
- ✅ Works consistently across all three tools
- ✅ Logs are included when --attach-logs is used
