# Case Study: Issue #944 - Token Budget Statistics Feature

## Overview

This case study documents the implementation of the `--tokens-budget-stats` feature for the `hive-mind` project, which provides detailed token usage statistics when using the Claude AI tool.

**Issue:** [#944 - For `--tool claude` please add option `--tokens-budget-stats`](https://github.com/link-assistant/hive-mind/issues/944)
**Pull Request:** [#945](https://github.com/link-assistant/hive-mind/pull/945)
**Created:** 2025-12-20T20:31:29Z
**Author:** @konard (Konstantin Diachenko)
**Labels:** enhancement

## Problem Statement

The hive-mind project needed an experimental option that provides users with detailed statistics about token budget usage when using the Claude AI tool (`--tool claude`). The requirements were:

1. Show context window usage in absolute values and ratios
2. Display how much of the maximum input and output token limits were used
3. Fetch maximum token limits from models.dev API
4. Make this option disabled by default (experimental feature)
5. Work only with `--tool claude`

## Requirements Analysis

### Explicit Requirements

From the issue description:

> "That should be experimental option, that in addition to cost estimation also gives stats about how much of context of was used to solve the task (in absolute values and in ratio)."

> "Also we need to get from model.dev maximum input and output in tokens, and how much we used out of it in a working session."

> "But default this option should be disabled."

### Implicit Requirements

1. The option should integrate seamlessly with the existing token tracking system
2. Should not affect performance when disabled
3. Should display information in a clear, readable format
4. Should handle cases where model limits are unavailable

## Background Research

### Claude Model Context Windows (2025)

Based on research from official sources:

**Context Window Limits:**

- **Claude Opus 4.5:** 200K tokens (standard)
- **Claude Sonnet 4.5:** 200K tokens (standard), 1M tokens (beta with context-1m-2025-08-07 header)
- **Claude Haiku 4.5:** 200K tokens

**Output Token Limits:**

- All Claude 4.5 models support up to **64,000 output tokens**

**Enterprise Plans:**

- Claude Sonnet 4.5 on Enterprise: 500K token context window

**Sources:**

- [Claude Sonnet 4 Model Gets a 1M Token Context Window - The New Stack](https://thenewstack.io/anthropics-claude-sonnet-4-model-gets-a-1m-token-context-window/)
- [What's new in Claude 4.5 - Claude Docs](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-5)
- [Models overview - Claude Docs](https://docs.claude.com/en/docs/about-claude/models/overview)

### Existing Infrastructure

The hive-mind project already had:

1. **Token tracking system** in `src/claude.lib.mjs` via `calculateSessionTokens()` function
2. **Model information fetching** from `https://models.dev/api.json` via `fetchModelInfo()` function
3. **Cost calculation** infrastructure using public pricing data
4. **Token display** functionality in the session summary

This meant we could build on existing infrastructure rather than creating new systems.

## Implementation

### 1. CLI Option Addition

Added `--tokens-budget-stats` option to two configuration files:

**File: `src/solve.config.lib.mjs`**

```javascript
.option('tokens-budget-stats', {
  type: 'boolean',
  description: '[EXPERIMENTAL] Show detailed token budget statistics including context window usage and ratios. Only supported for --tool claude.',
  default: false
})
```

**File: `src/hive.config.lib.mjs`**

```javascript
.option('tokens-budget-stats', {
  type: 'boolean',
  description: '[EXPERIMENTAL] Show detailed token budget statistics including context window usage and ratios. Only supported for --tool claude.',
  default: false
})
```

Both files were updated to ensure the option works in both `solve` and `hive` commands.

### 2. Budget Statistics Display Function

Created new `displayBudgetStats()` function in `src/claude.lib.mjs`:

**Key Features:**

- Calculates context window usage (input + cache creation + cache read tokens)
- Shows usage ratio and percentage for context window
- Shows output token usage against maximum output limit
- Displays total session tokens
- Handles missing model limit data gracefully

**Code snippet:**

```javascript
const displayBudgetStats = async (usage, log) => {
  const modelInfo = usage.modelInfo;
  if (!modelInfo?.limit) {
    await log('\n      ⚠️  Budget stats not available (no model limits found)');
    return;
  }

  await log('\n      📊 Token Budget Statistics:');

  // Context window usage
  if (modelInfo.limit.context) {
    const contextLimit = modelInfo.limit.context;
    const totalInputUsed = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
    const contextUsageRatio = totalInputUsed / contextLimit;
    const contextUsagePercent = (contextUsageRatio * 100).toFixed(2);

    await log(`        Context window:`);
    await log(`          Used: ${formatNumber(totalInputUsed)} tokens`);
    await log(`          Limit: ${formatNumber(contextLimit)} tokens`);
    await log(`          Ratio: ${contextUsageRatio.toFixed(4)} (${contextUsagePercent}%)`);
  }

  // Output tokens usage
  if (modelInfo.limit.output) {
    const outputLimit = modelInfo.limit.output;
    const outputUsageRatio = usage.outputTokens / outputLimit;
    const outputUsagePercent = (outputUsageRatio * 100).toFixed(2);

    await log(`        Output tokens:`);
    await log(`          Used: ${formatNumber(usage.outputTokens)} tokens`);
    await log(`          Limit: ${formatNumber(outputLimit)} tokens`);
    await log(`          Ratio: ${outputUsageRatio.toFixed(4)} (${outputUsagePercent}%)`);
  }

  // Total session tokens
  const totalSessionTokens = usage.inputTokens + usage.cacheCreationTokens + usage.outputTokens;
  await log(`        Total session tokens: ${formatNumber(totalSessionTokens)}`);
};
```

### 3. Integration with Existing Code

Modified the `executeClaudeCommand()` function to call `displayBudgetStats()` when the flag is enabled:

```javascript
if (argv.tokensBudgetStats && usage.modelInfo?.limit) {
  await displayBudgetStats(usage, log);
}
```

This ensures:

- Budget stats only display when the flag is enabled
- Only displays when model limit information is available
- Integrates seamlessly with existing per-model usage display

## Technical Design Decisions

### 1. Why Not Add to calculateSessionTokens()?

**Decision:** Add budget stats display to the output phase, not the calculation phase.

**Rationale:**

- `calculateSessionTokens()` already returns all necessary data
- Model limit information is already fetched and stored in `modelInfo`
- Separation of concerns: calculation vs. presentation
- Avoids re-fetching data or recalculating
- Makes the feature zero-cost when disabled

### 2. Context Window Calculation

**Decision:** Include all input-related tokens (input + cache creation + cache read).

**Rationale:**

- All these tokens count toward the context window
- Cache read tokens still occupy context space
- Provides accurate picture of context utilization
- Matches how Claude API counts context usage

### 3. Experimental Flag

**Decision:** Mark as `[EXPERIMENTAL]` in the option description.

**Rationale:**

- New feature, may need refinement based on user feedback
- Signals to users that behavior may change
- Allows for iteration without breaking changes
- Follows existing patterns in the codebase (e.g., `--interactive-mode`)

### 4. Default Disabled

**Decision:** Set `default: false` for the option.

**Rationale:**

- Explicit requirement from issue
- Keeps output clean for users who don't need detailed stats
- Opt-in approach for experimental features
- Allows gradual rollout and feedback collection

## Testing Considerations

Since this is an output-only feature, testing should focus on:

1. **Option parsing:** Verify the flag is correctly parsed
2. **Display logic:** Test with models that have/don't have limit data
3. **Calculation accuracy:** Verify ratios and percentages are correct
4. **Integration:** Ensure it doesn't break existing token display

**Test scenarios:**

- With flag enabled and model limits available
- With flag enabled but model limits unavailable
- With flag disabled (should not show budget stats)
- Multiple models in one session
- Edge case: zero tokens used

## Expected Output Format

When `--tokens-budget-stats` is enabled, users will see additional output like:

```
📊 Token Budget Statistics:
  Context window:
    Used: 125 432 tokens
    Limit: 200 000 tokens
    Ratio: 0.6272 (62.72%)
  Output tokens:
    Used: 8 543 tokens
    Limit: 64 000 tokens
    Ratio: 0.1335 (13.35%)
  Total session tokens: 133 975
```

This provides clear visibility into:

- How much of the context window was used
- How close to the output limit the session came
- Overall session token consumption

## Files Modified

1. `src/solve.config.lib.mjs` - Added CLI option for solve command
2. `src/hive.config.lib.mjs` - Added CLI option for hive command
3. `src/claude.lib.mjs` - Added `displayBudgetStats()` function and integration

**Total changes:** 3 files, ~60 lines added

## Integration Points

The feature integrates with:

1. **Token tracking system** (`calculateSessionTokens`)
2. **Model info fetching** (`fetchModelInfo` from models.dev API)
3. **Output display** (session summary in `executeClaudeCommand`)
4. **CLI argument parsing** (yargs configuration)

## Future Enhancements

Potential improvements for future iterations:

1. **Historical tracking:** Track budget usage across multiple sessions
2. **Warnings:** Alert when approaching context limits (e.g., >90%)
3. **Model comparison:** Show budget efficiency across different models
4. **Export format:** JSON output option for programmatic analysis
5. **Cache efficiency:** Show cache hit ratio and savings
6. **Time-based analysis:** Correlate token usage with execution time

## Lessons Learned

1. **Leverage existing infrastructure:** The project already had token tracking and model info fetching, which made implementation straightforward
2. **Separation of concerns:** Keeping calculation and display separate made the feature easy to add without modifying core logic
3. **Documentation-first:** The issue requested case study documentation, which helps with knowledge transfer
4. **Experimental flags:** Using `[EXPERIMENTAL]` tag sets proper expectations

## Related Issues and Pull Requests

- Issue #944: Original feature request
- PR #945: Implementation pull request

## Conclusion

The `--tokens-budget-stats` feature provides valuable insights into Claude API usage without affecting the default user experience. By building on existing infrastructure and following the project's patterns, the implementation is clean, maintainable, and easy to extend in the future.

The feature addresses all stated requirements:

- ✅ Shows context usage in absolute values and ratios
- ✅ Displays usage against maximum input/output limits
- ✅ Uses models.dev API for limit data (already integrated)
- ✅ Disabled by default
- ✅ Works only with `--tool claude`

---

**Document Version:** 1.0
**Last Updated:** 2025-12-20
**Status:** Implementation Complete
