# Case Study: Issue #1526 — Usage Stats Improvements for Agent CLI and Claude Code CLI

## Timeline

- **2026-04-04**: Issue filed after observing incorrect usage stats in PR comments
- **Reference logs**: `agent-cli-log.txt` (Agent CLI with minimax-m2.5-free), `claude-cli-log.txt` (Claude Code with Opus + Haiku)

## Root Causes Identified

### 1. Claude Haiku Context Window 288% Bug

**Symptom**: `Context window: 575.3K / 200K tokens (288%)`

**Root Cause**: When `peakContextUsage` is 0 (common for models sourced from result JSON, e.g., Haiku used as a sub-agent), the fallback calculation used:

```
totalInput = inputTokens + cacheCreationTokens + cacheReadTokens
```

This sums **all tokens across the entire session** (cumulative), but the context window limit is a **per-request** constraint. Cache read tokens represent tokens reused from cache across many requests, not tokens that simultaneously fill the context window.

For Haiku: `75 + 47,259 + 527,935 = 575,269` vs context limit `200,000` = 288%.

**Fix**: When `peakContextUsage` is 0 (model only from result JSON, not in JSONL), fall back to cumulative total tokens (`inputTokens + cacheCreationTokens + cacheReadTokens`) as the context value. This shows all available data — nothing is skipped or hidden. For models in the JSONL (the common case), `peakContextUsage` is tracked correctly per-request and gives accurate context window percentages.

### 2. Agent CLI Missing "Context and tokens usage" Section

**Symptom**: Agent CLI PR comments only showed "Cost estimation" and "Models used" but no "Context and tokens usage" section.

**Root Cause**: `buildBudgetStatsString` was only called when a Claude Code JSONL session file existed (`sessionId && tempDir`). Agent CLI doesn't produce JSONL files, so budget stats were never generated.

**Fix**: Added `buildAgentBudgetStats()` function that converts Agent CLI's `parseAgentTokenUsage` output into the same format used by `calculateSessionTokens`, enabling reuse of `buildBudgetStatsString`. The Agent CLI step_finish events already contain all needed data: `tokens`, `model.requestedModelID`, `model.respondedModelID`, `context.contextLimit`, `context.outputLimit`.

### 3. Agent CLI Token Data Available but Not Fully Utilized

**Symptom**: Token data showed in verbose logs but wasn't fully utilized in PR comments.

**Root Cause**: `parseAgentTokenUsage` and the streaming accumulator only extracted `tokens.*` and `cost` from step_finish events, ignoring `model.*` and `context.*` fields that were already present in the Agent CLI output.

**Fix**: Extended both `parseAgentTokenUsage` and the streaming accumulator to also capture `model.requestedModelID`, `model.respondedModelID`, `context.contextLimit`, `context.outputLimit`, and track `peakContextUsage` as `max(input + cache.read)` across all steps.

## Output Format Changes (Issue #1526)

### Before (old format)

```
- Max context window: 90.8K / 1M input tokens (9%)
- Max output tokens: 27.8K / 128K output tokens (22%)

Total input tokens: 88.7K + 4.7M cached
Total output tokens: 27.8K output
Cost: $3.576269
```

### After (new format)

```
- Context window: 90.8K / 1M input tokens (9%), 27.8K / 128K output tokens (22%)

Total: 88.7K + 4.7M cached input tokens, 27.8K output tokens, $3.576269 cost
```

### Sub-sessions format change

Before: Had "Sub sessions (between compact events):" header with numbered entries.
After: Numbered entries with "Context window:" prefix directly, no header line.

## Data Sources

- `agent-cli-log.txt`: Full verbose log from Agent CLI (minimax-m2.5-free via OpenCode Zen)
  - Shows step_finish events with `tokens`, `model`, and `context` fields
  - 6 steps, 15,218 input tokens, 1,064 output tokens, 56,544 cache read tokens
- `claude-cli-log.txt`: Full verbose log from Claude Code CLI (Opus + Haiku)
  - Shows Opus with peakContextUsage 90,814 (correct)
  - Shows Haiku with peakContextUsage 0 when from result JSON only; falls back to cumulative total
  - When Haiku IS in JSONL (common case), peakContextUsage is tracked correctly (peak ~42.3K / 200K = 21%)

## Files Changed

- `src/claude.budget-stats.lib.mjs`: Core changes — new format, context fix, `buildAgentBudgetStats()`
- `src/agent.lib.mjs`: Extended `parseAgentTokenUsage` and streaming accumulator
- `src/solve.results.lib.mjs`: Added Agent CLI budget stats path in `verifyResults`
- `tests/test-budget-stats.mjs`: Updated for new format
- `tests/test-budget-stats-issue-1501.mjs`: Updated for new format
- `tests/test-budget-stats-issue-1508.mjs`: Updated for new format
- `tests/test-agent-budget-stats-1526.mjs`: New test file for Issue #1526
