# Case Study: Default Thinking Budget Should Be Zero

## Issue Reference

- **Issue**: https://github.com/link-assistant/hive-mind/issues/1238
- **Title**: Make sure by default thinking budget is zero (thinking is turned off), and also that Opus 4.6 uses the same max thinking budget as Opus 4.5
- **Author**: konard
- **Labels**: documentation, enhancement

## Executive Summary

This case study documents the analysis and implementation of two changes to hive-mind's thinking budget configuration:

1. **Default thinking budget should be zero** - When no `--think` or `--thinking-budget` option is provided, thinking should be turned off (budget = 0) instead of relying on Claude Code's default of 31,999 tokens.
2. **Opus 4.6 max thinking budget should match Opus 4.5** - The `DEFAULT_MAX_THINKING_BUDGET_OPUS_46` should be 31,999 (same as standard models), not 64,000.

## Problem Analysis

### Current Behavior (Before Fix)

1. **No default thinking budget enforcement**: When neither `--think` nor `--thinking-budget` is specified:
   - `thinkingBudget` remains `undefined`
   - `MAX_THINKING_TOKENS` environment variable is NOT set
   - Claude Code uses its own default: 31,999 tokens (thinking enabled)
   - Result: **Thinking is ON by default**, consuming tokens for extended reasoning

2. **Opus 4.6 has higher max thinking budget than Opus 4.5**:
   - `DEFAULT_MAX_THINKING_BUDGET = 31999` (standard models)
   - `DEFAULT_MAX_THINKING_BUDGET_OPUS_46 = 64000` (Opus 4.6)
   - This creates an inconsistency between model configurations

### Desired Behavior (After Fix)

1. **Default thinking budget = 0**: When no thinking options are provided, `MAX_THINKING_TOKENS=0` should be set, effectively disabling extended thinking by default. Users can explicitly enable it with `--think` or `--thinking-budget`.

2. **Opus 4.6 max thinking budget = 31999**: Same as other models, ensuring consistent behavior across all Claude models.

## Research: Claude Code CLI Defaults

### Official Claude Code Documentation

From [Claude Code Settings](https://code.claude.com/docs/en/settings):

> `MAX_THINKING_TOKENS` - Override the extended thinking token budget. Thinking is enabled at max budget (31,999 tokens) by default. Use this to limit the budget (for example, `MAX_THINKING_TOKENS=10000`) or disable thinking entirely (`MAX_THINKING_TOKENS=0`).

> For Opus 4.6, thinking depth is controlled by effort level instead, and this variable is ignored unless set to `0` to disable thinking.

### Key Facts

| Setting                      | Claude Code Default     | Hive-Mind Before Fix | Hive-Mind After Fix |
| ---------------------------- | ----------------------- | -------------------- | ------------------- |
| Thinking enabled by default? | Yes (31,999 tokens)     | Yes (passthrough)    | **No (0 tokens)**   |
| MAX_THINKING_TOKENS default  | 31,999                  | Not set (undefined)  | **0**               |
| Opus 4.6 max thinking budget | N/A (uses effort level) | 64,000               | **31,999**          |
| Standard model max budget    | 31,999                  | 31,999               | 31,999 (unchanged)  |

### Opus 4.6 Thinking Behavior

For Opus 4.6, Claude Code uses `CLAUDE_CODE_EFFORT_LEVEL` (default: `high`) instead of `MAX_THINKING_TOKENS`. The `MAX_THINKING_TOKENS` variable is **ignored** for Opus 4.6 unless set to `0` to disable thinking entirely. This means having a separate higher max budget for Opus 4.6 is unnecessary and misleading.

## Implementation Details

### Files Modified

1. **`src/config.lib.mjs`**:
   - Changed `DEFAULT_MAX_THINKING_BUDGET_OPUS_46` from 64000 to 31999 (same as standard models)
   - Updated `getClaudeEnv()` to set `MAX_THINKING_TOKENS=0` by default when no thinking budget is explicitly provided

2. **`src/solve.config.lib.mjs`**:
   - Updated `--thinking-budget` option description to reflect that default is now 0
   - Updated `--max-thinking-budget` option description

3. **`experiments/thinking-budget-test.mjs`**:
   - Updated test expectations for the new Opus 4.6 max budget (31999)

### Code Changes

#### Default Thinking Budget = 0

In `getClaudeEnv()`:

```javascript
// Before: only set MAX_THINKING_TOKENS when thinkingBudget is explicitly provided
if (options.thinkingBudget !== undefined) {
  env.MAX_THINKING_TOKENS = String(options.thinkingBudget);
}

// After: always set MAX_THINKING_TOKENS, default to 0 (thinking off)
env.MAX_THINKING_TOKENS = String(options.thinkingBudget ?? 0);
```

#### Opus 4.6 Max Budget Alignment

```javascript
// Before
export const DEFAULT_MAX_THINKING_BUDGET_OPUS_46 = parseIntWithDefault('HIVE_MIND_MAX_THINKING_BUDGET_OPUS_46', 64000);

// After
export const DEFAULT_MAX_THINKING_BUDGET_OPUS_46 = parseIntWithDefault('HIVE_MIND_MAX_THINKING_BUDGET_OPUS_46', 31999);
```

## Impact Assessment

### Benefits

1. **Cost reduction**: Thinking tokens are not consumed by default, reducing API costs
2. **Consistency**: All models now use the same max thinking budget (31,999)
3. **Explicit opt-in**: Users must explicitly request thinking with `--think` or `--thinking-budget`
4. **Aligns with project intent**: The issue owner explicitly requested thinking off by default

### Risks

- **Performance impact**: Tasks that previously benefited from automatic thinking will now require explicit `--think` option
- **Mitigation**: Users can add `--think max` or `--thinking-budget 31999` to restore previous behavior

## External References

- [Claude Code Settings Documentation](https://code.claude.com/docs/en/settings)
- [Claude Code Cost Management](https://code.claude.com/docs/en/costs)
- [Claude Code Model Configuration](https://code.claude.com/docs/en/model-config)
- [Extended Thinking Documentation](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Issue #1146 - Ultrathink Deprecation](https://github.com/link-assistant/hive-mind/issues/1146) (related)
- [Issue #1221 - Opus 4.6 Support](https://github.com/link-assistant/hive-mind/issues/1221) (related)

## Related Case Studies

- [Issue #1146 - Ultrathink Deprecation](../issue-1146/README.md): Documents the transition from thinking keywords to MAX_THINKING_TOKENS
- [Issue #1221 - Opus 4.6 Support](../issue-1221/README.md): Documents initial Opus 4.6 model support
