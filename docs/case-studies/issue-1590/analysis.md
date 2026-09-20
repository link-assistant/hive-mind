# Case Study: Issue #1590 — Split sub-agent usage stats per call

## Summary

When a working session uses multiple sub-agent calls (Agent tool invocations), the token usage
statistics in PR comments showed a single aggregated line per model. For example, when the main
agent (Claude Opus 4.6) spawned 12 sub-agent calls to Claude Sonnet 4.6, the output showed:

```
Claude Sonnet 4.6:

Total: (681.4K + 3.9M cached) input tokens, 338.9K / 64K (530%) output tokens, $8.806153 cost
```

The 530% output token percentage was misleading because it represented the sum of 12 separate
sub-agent calls, not a single call exceeding its limit.

## Timeline of Events

1. **2026-04-11T02:51:02Z** — solve.mjs v1.49.2 started for issue #1580 ("Add translation to Chinese, Hindi, and Russian") with `--model opus`
2. **2026-04-11T02:51:11Z** — Session started with Claude Opus 4.6 as main agent
3. **During session** — The main agent spawned 12 sub-agent calls to Claude Sonnet 4.6 for parallel translation tasks:
   - 3 README translations (Chinese, Hindi, Russian)
   - 9 documentation file translations (3 languages × batch translations)
4. **Session completed** — Result JSON showed `modelUsage` with aggregated totals per model
5. **PR comment posted** — Budget stats showed single aggregated Sonnet line with 530% output percentage

## Requirements from Issue

1. **R1**: When there are multiple sub-agent calls, each one should be calculated separately
2. **R2**: After per-call breakdown, show the total
3. **R3**: Compile case study data to `./docs/case-studies/issue-1590`
4. **R4**: If root cause requires upstream changes, report issues to the relevant repository
5. **R5**: Add debug output / verbose mode for sub-agent tracking

## Root Cause Analysis

### Data Flow for Sub-Agent Token Usage

The token usage data flows through two sources:

1. **JSONL session file** (`~/.claude/projects/<dir>/<session>.jsonl`): Contains only the main agent's (Opus) API responses. Sub-agent messages are NOT recorded here — they happen within Claude Code's internal Agent tool execution.

2. **Result JSON event** (`data.modelUsage` in the `result` success event): Contains per-model aggregated totals across the entire session. This is the **only** source for sub-agent model usage data.

### The Gap

Neither source provides **per-sub-agent-call** token breakdown. The `modelUsage` from Claude Code's result event aggregates all calls to the same model into a single entry:

```json
{
  "claude-sonnet-4-6": {
    "inputTokens": 681400,
    "outputTokens": 338900,
    "cacheReadInputTokens": 3900000,
    "cacheCreationInputTokens": 0,
    "costUSD": 8.806153
  }
}
```

This is a **limitation of Claude Code's API** — it doesn't provide per-tool-call token breakdown.

### Available Data

However, the Agent tool_use events ARE visible in the streaming output:

```json
{
  "type": "tool_use",
  "name": "Agent",
  "input": {
    "description": "Translate README.md to Chinese",
    "model": "sonnet"
  }
}
```

These events appear inside `assistant` type stream events, in the `message.content` array.

## Solution

### Approach: Track Sub-Agent Calls + Show Per-Call Averages

Since per-call token data isn't available from Claude Code, we:

1. **Track Agent tool_use events** during streaming to count sub-agent calls per model
2. **Show call count** alongside the model name: `**Claude Sonnet 4.6:** (12 sub-agent calls)`
3. **Calculate and show per-call averages**: `Per call avg: ~381.8K input, ~28.2K output, ~$0.733846`
4. **Suppress misleading percentages**: The Total line no longer shows `530%` for aggregated sub-agent output
5. **Show per-call output percentage**: The average line shows `~44% of 64K output limit per call`

### Output Format (Before → After)

**Before (misleading):**

```
**Claude Sonnet 4.6:**

Total: (681.4K + 3.9M cached) input tokens, 338.9K / 64K (530%) output tokens, $8.806153 cost
```

**After (informative):**

```
**Claude Sonnet 4.6:** (12 sub-agent calls)

Total: (681.4K + 3.9M cached) input tokens, 338.9K output tokens, $8.806153 cost
Per call avg: ~381.8K input, ~28.2K output, ~$0.733846 (~44% of 64K output limit per call)
```

### Files Changed

1. **`src/claude.lib.mjs`**: Added sub-agent call tracking in the streaming event handler. When `assistant` events contain `tool_use` items with `name === "Agent"`, the call's id, description, and model are recorded. Also returns `subAgentCalls` in the result.

2. **`src/claude.budget-stats.lib.mjs`**: Updated `buildBudgetStatsString` to accept and use `subAgentCalls` data. Added helper functions `buildSubAgentCallCounts` and `getSubAgentCallCount` for matching short model names (e.g., "sonnet") to full model IDs (e.g., "claude-sonnet-4-6").

3. **`src/solve.mjs`**, **`src/solve.results.lib.mjs`**, **`src/solve.auto-merge.lib.mjs`**, **`src/solve.watch.lib.mjs`**, **`src/github.lib.mjs`**: Pass `subAgentCalls` through the data flow from `executeClaudeCommand` result to `buildBudgetStatsString`.

4. **`tests/test-budget-stats-issue-1590.mjs`**: 12 regression tests covering all scenarios: backward compatibility, call count display, per-call averages, misleading percentage suppression, mixed models, single calls, null/empty inputs.

## Upstream Limitation

**Claude Code does not provide per-tool-call token usage data.** The `modelUsage` in the result event is aggregated per-model across the entire session. This means we cannot show exact per-sub-agent-call token counts, only averages based on total / count.

An upstream issue should be filed at `anthropics/claude-code` requesting per-Agent-tool-call token usage data in the result event. This would enable exact per-call breakdown instead of averages.

## Evidence

### From the solution-draft-log (gist aa77a0641dd4bfb341aba260a175f0e1):

12 Agent tool_use events found in the stream, including:

- "Translate README.md to Chinese" (model: sonnet)
- "Translate README.md to Hindi" (model: sonnet)
- "Translate README.md to Russian" (model: sonnet)
- "Translate batch 1 docs to Chinese" (model: sonnet)
- ... and 8 more batch translation tasks

### Aggregated stats in the PR comment:

- Claude Sonnet 4.6: 681.4K + 3.9M cached input tokens, 338.9K output tokens (530% of 64K limit)
- This represents 12 separate sub-agent calls, averaging ~28.2K output tokens per call (~44% of limit)

## Related Issues

- Issue #1454: Multi-model display from `resultModelUsage`
- Issue #1491: Sub-session tracking between compactification events
- Issue #1508: Multi-model token/cost splitting in budget stats
- Issue #1526: Agent CLI budget stats integration
- Issue #1539: Peak context per-request tracking
- Issue #1547: Budget stats output format improvements
