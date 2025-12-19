# Case Study: Unrecognized Model Error with Cost Impact (Issue #789)

## Issue Reference
- **Issue**: https://github.com/link-assistant/hive-mind/issues/789
- **Pull Request**: https://github.com/link-assistant/hive-mind/pull/790
- **Date**: 2025-12-03
- **Reporter**: konard

## Problem Statement

When a user specifies an invalid model name (e.g., `--model oups`), the system fails with a 404 API error from Anthropic, but still incurs costs (~$0.027) and does not provide early validation. This results in:

1. **Wasted API costs** - Money is spent even though the model doesn't exist
2. **Poor user experience** - Error only appears after API call, not immediately
3. **Unclear error handling** - System proceeds with invalid model name without validation

### Example Error Observed

From the gist log (https://gist.github.com/konard/cede1c9bb333fb4fff5caf0248b98787):

**Command executed:**
```bash
/solve https://github.com/link-assistant/hive-mind/pull/788 --model oups
```

**Error received:**
```json
{
  "type": "text",
  "text": "API Error: 404 {\"type\":\"error\",\"error\":{\"type\":\"not_found_error\",\"message\":\"model: oups\"},\"request_id\":\"req_011CVk2vdLxynFeaMQaoKZPH\"}"
}
```

**Cost incurred:**
```json
{
  "total_cost_usd": 0.027108,
  "modelUsage": {
    "claude-haiku-4-5-20251001": {
      "inputTokens": 1198,
      "outputTokens": 188,
      "costUSD": 0.002138
    },
    "claude-opus-4-5-20251101": {
      "inputTokens": 1039,
      "outputTokens": 791,
      "costUSD": 0.02497
    }
  }
}
```

## Impact Analysis

### Financial Impact
- Cost per failed attempt: **$0.027** USD
- Models charged: Haiku 4.5 ($0.002138) + Opus 4.5 ($0.02497)
- If this happens frequently (e.g., typos in automation), costs accumulate

### User Experience Impact
- Error discovered **after** API call, not during argument parsing
- No immediate feedback on invalid model name
- Confusing for users who expect early validation

### System Behavior Impact
- Invalid model name is passed through to Anthropic API
- API attempts to process the request before rejecting it
- Multiple model invocations occur (Haiku + Opus) before failure

## Requirements for Solution

Based on the issue description and analysis:

1. **Early validation** - Detect invalid model names before making API calls
2. **Clear error messages** - Help users understand what went wrong and what valid options are
3. **No wasted costs** - Prevent API calls with invalid model names
4. **Maintain flexibility** - Still allow custom model IDs for newer models not yet in alias list
5. **Consistent behavior** - Apply to all tools (claude, codex, opencode)

## Related Documentation

- Full log: `./full-log.json`
- Timeline analysis: `./01-TIMELINE.md`
- Root cause analysis: `./02-ROOT-CAUSES.md`
- Solution proposals: `./03-SOLUTIONS.md`
- Technical implementation: `./04-IMPLEMENTATION.md`
