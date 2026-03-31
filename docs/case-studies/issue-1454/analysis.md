# Case Study: Issue #1454 — Multiple models display was not selected in completion GitHub comment

## Summary

When Claude Code uses multiple models (e.g., Claude Opus 4.6 as main model + Claude Haiku 4.5 as subagent),
the completion comment on GitHub only displayed the single main model instead of all models used.

## Timeline of Events

1. **2026-03-21T10:33:57Z** — solve.mjs v1.35.1 started for netkeep80/BinDiffSynchronizer issue #168 with `--model opus`
2. **2026-03-21T10:34:11Z** — Branch `issue-168-f211c205dce4` created, Claude Code session started
3. **~10:34–10:43Z** — Claude Code completed 60 turns, using both `claude-opus-4-6` (main) and `claude-haiku-4-5-20251001` (subagent for fast mode)
4. **2026-03-21T10:43:25Z** — Result JSON received with `modelUsage` containing **both** models:
   - `claude-opus-4-6`: $2.245 cost, 16461 output tokens
   - `claude-haiku-4-5-20251001`: $0.488 cost, 17971 output tokens
5. **2026-03-21T10:43:27Z** — `calculateSessionTokens` ran on session JSONL file, found only `claude-opus-4-6`
6. **2026-03-21T10:43:27Z** — Comment generated with single model display instead of multi-model display

## Root Cause

The data flow for extracting actual model IDs for GitHub comments has **two sources**:

### Source 1: Session JSONL (used by code)

`calculateSessionTokens()` in `claude.lib.mjs` reads `~/.claude/projects/<dir>/<session-id>.jsonl` and
extracts model IDs from `entry.message.model` fields. This JSONL file only contains messages from
direct API calls — **subagent models (like Haiku used by Claude Code's fast mode/subagents) are NOT
included** in this file.

### Source 2: Result JSON (was ignored)

The Claude CLI result event (`{type: "result", subtype: "success", modelUsage: {...}}`) contains the
**authoritative** `modelUsage` field with ALL models used during the session, including subagent models.
This field was already being parsed for `total_cost_usd`, `result`, and `num_turns`, but `modelUsage`
was never extracted.

### The Gap

The code in `github.lib.mjs` relied exclusively on Source 1 (session JSONL) to determine `actualModelIds`.
When the JSONL only contained one model, only one model was displayed — even though the result JSON
contained accurate data about all models.

## Fix

1. **claude.lib.mjs**: Extract `data.modelUsage` from the result JSON event and return it as `resultModelUsage`
2. **solve.mjs**: Pass `resultModelUsage` through to `verifyResults` and `attachLogToGitHub`
3. **solve.results.lib.mjs**: Pass `resultModelUsage` through to `attachLogToGitHub`
4. **github.lib.mjs**: When `resultModelUsage` has more models than session JSONL, use it as `actualModelIds`,
   sorted by cost (descending) so the main model appears first

## Evidence

From the solution-draft-log (line 26820-26841):

```json
"modelUsage": {
    "claude-opus-4-6": {
      "inputTokens": 1200,
      "outputTokens": 16461,
      "cacheReadInputTokens": 2717251,
      "cacheCreationInputTokens": 75026,
      "costUSD": 2.2450629999999996,
    },
    "claude-haiku-4-5-20251001": {
      "inputTokens": 231,
      "outputTokens": 17971,
      "cacheReadInputTokens": 2013715,
      "cacheCreationInputTokens": 157421,
      "costUSD": 0.48823375000000013,
    }
  }
```

From the solution-draft-log (line 26933) showing only one model was found:

```
[2026-03-21T10:43:27.898Z] [INFO]   🤖 Actual models used: claude-opus-4-6
```

## Related Issues

- Issue #1225: Original issue for unified model display across all tools
- Issue #1448: Recent formatting improvements for model display section
