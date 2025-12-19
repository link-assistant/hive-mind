# Case Study: Issue #871 - Pricing Estimation for `--tool agent` and `opencode/grok-code`

## Summary

This case study analyzes the issue where pricing estimates show "unknown" when using `--tool agent` with the `opencode/grok-code` model instead of showing the correct pricing.

## Timeline of Events

1. **2025-12-08 22:33:21 UTC** - PR #864 merged with changes for issue #863 (Merge releases into one)
2. **2025-12-08 23:34:48 UTC** - AI solution draft started for issue #863 using `--tool agent`
3. **2025-12-08 23:39:17 UTC** - AI solution draft completed successfully
4. **2025-12-08 23:39:23 UTC** - Log comment posted to PR #864 showing "unknown" pricing

## Observed Behavior

From the PR #864 comment (https://github.com/link-assistant/hive-mind/pull/864#issuecomment-3629505903):

```
💰 **Cost estimation:**
- Public pricing estimate: unknown
- Calculated by Anthropic: unknown
- Difference: unknown
```

## Expected Behavior

For `opencode/grok-code` (Grok Code Fast 1), the pricing should be:

```
💰 **Cost estimation:**
- Provider: OpenCode Zen
- Model: Grok Code Fast 1
- Public pricing estimate: $0.00 (Free)
- Token usage: X input, Y output, Z cache read/write
- Note: This model is free ($0 per token for input, output, and cache)
```

## Root Cause Analysis

### Finding 1: Agent tool JSON output contains cost and token data

The agent tool outputs JSON `step_finish` events with cost and token information:

```json
{
  "type": "step_finish",
  "timestamp": 1765236922272,
  "sessionID": "ses_4ffae5350ffel9Uelq2VYSx4CA",
  "part": {
    "type": "step-finish",
    "reason": "tool-calls",
    "cost": 0,
    "tokens": {
      "input": 10625,
      "output": 215,
      "reasoning": 677,
      "cache": {
        "read": 832,
        "write": 0
      }
    }
  }
}
```

### Finding 2: models.dev API has correct pricing for grok-code

The OpenCode Zen provider (`https://models.dev/api.json`) includes `grok-code` with $0 pricing:

```json
{
  "opencode": {
    "name": "OpenCode Zen",
    "models": {
      "grok-code": {
        "id": "grok-code",
        "name": "Grok Code Fast 1",
        "cost": {
          "input": 0,
          "output": 0,
          "cache_read": 0,
          "cache_write": 0
        }
      }
    }
  }
}
```

### Finding 3: Pricing calculation uses Claude-specific session files

The `calculateSessionTokens` function in `claude.lib.mjs` looks for session data in:
```
~/.claude/projects/<project-dir>/<session-id>.jsonl
```

This is Claude-specific and doesn't work for the agent tool, which doesn't create session files in this location.

### Finding 4: Agent tool doesn't return pricing data to solve.mjs

Looking at `agent.lib.mjs`, the `executeAgentCommand` function returns:
```javascript
return {
  success: true,
  sessionId,
  limitReached,
  limitResetTime
  // Missing: anthropicTotalCostUSD, token usage data
};
```

Compared to `claude.lib.mjs` which returns:
```javascript
return {
  success: true,
  sessionId,
  limitReached,
  limitResetTime,
  anthropicTotalCostUSD  // Captured from Claude's output
};
```

### Finding 5: github.lib.mjs expects Claude-style data

The `attachLogToGitHub` function calls `calculateSessionTokens` which is designed for Claude session files, not agent tool JSON output.

## Root Cause Summary

The pricing estimation fails because:

1. **Agent tool outputs cost/token data in JSON format** during execution (in stdout)
2. **This data is NOT captured or parsed** by `agent.lib.mjs`
3. **The pricing calculation relies on Claude session files** which don't exist for agent tool
4. **No fallback mechanism exists** to use models.dev API directly for pricing

## Proposed Solutions

### Solution A: Parse agent tool JSON output for pricing (Recommended)

1. Modify `agent.lib.mjs` to parse `step_finish` JSON events from stdout
2. Accumulate token usage from all `step_finish` events
3. Return token usage data to `solve.mjs`
4. Use models.dev API to calculate cost based on model ID and token counts

### Solution B: Calculate pricing from log file

1. After agent execution, parse the log file for `step_finish` events
2. Extract token usage and cost data
3. Aggregate totals and display in the final comment

### Solution C: Use agent tool's built-in cost reporting

1. Check if agent tool has a stats command like `agent stats --last`
2. Use this to get session cost if available

## Implementation Recommendations

1. **Add JSON parsing to agent.lib.mjs** - Parse stdout for `step_finish` events
2. **Create agent-specific pricing function** - Similar to `calculateSessionTokens` but for agent output
3. **Fetch model pricing from models.dev** - Already available via `fetchModelInfo` in `claude.lib.mjs`
4. **Show $0 explicitly for free models** - Instead of showing "unknown", show "$0.00 (Free)"
5. **Include provider name** - Display "OpenCode Zen" instead of just "Anthropic"

## Data Files

- Log file: `./solution-draft-log-pr-864.txt` (4402 lines)
- Contains 50+ `step_finish` events with token usage data

## Token Usage Summary (from log)

Total tokens from log analysis:
- Input tokens: ~150,000+
- Output tokens: ~5,000+
- Reasoning tokens: ~1,500+
- Cache read: ~56,000+

Total cost at grok-code pricing ($0/token): **$0.00 (Free)**

## References

- Issue: https://github.com/link-assistant/hive-mind/issues/871
- PR #864 comment: https://github.com/link-assistant/hive-mind/pull/864#issuecomment-3629505903
- Agent tool repo: https://github.com/link-assistant/agent
- Models.dev API: https://models.dev/api.json
