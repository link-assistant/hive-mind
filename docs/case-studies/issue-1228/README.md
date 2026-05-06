# Case Study: Issue #1228 - Make Options Communication Clear from Duplication in /solve Command Responses

## Summary

When users execute `/solve` or `/hive` commands in the Telegram bot, the response message duplicates option information. The "Options:" line shows both user-provided options AND locked system overrides, while the "Locked options:" line shows the overrides again. This creates visual noise and makes it harder to quickly understand which options the user specifically requested.

## Problem Description

### Current Behavior

When a user sends:

```
/solve https://github.com/owner/repo/issues/123 --model opus
```

With locked overrides: `--attach-logs --verbose --no-tool-check --auto-resume-on-limit-reset --tokens-budget-stats`

The response shows:

```
Requested by: @username
URL: https://github.com/owner/repo/issues/123
Options: --model opus --attach-logs --verbose --no-tool-check --auto-resume-on-limit-reset --tokens-budget-stats
🔒 Locked options: --attach-logs --verbose --no-tool-check --auto-resume-on-limit-reset --tokens-budget-stats
```

**Issues:**

1. Options line includes locked options (duplication)
2. Hard to quickly identify which options the user chose
3. No empty line between URL and Options for visual separation

### Desired Behavior

```
Requested by: @username
URL: https://github.com/owner/repo/issues/123

🛠 Options: --model opus
🔒 Locked options: --attach-logs --verbose --no-tool-check --auto-resume-on-limit-reset --tokens-budget-stats
```

**Improvements:**

1. Options line shows ONLY user-provided options (no duplication)
2. Emoji prefix for user options for visual distinction
3. Empty line between URL and options for readability

## Root Cause Analysis

### Technical Root Cause

In `src/telegram-bot.mjs`, the `args` variable is created by merging user args with overrides:

```javascript
// Line 964 (solve) / Line 1131 (hive)
const args = mergeArgsWithOverrides(userArgs, solveOverrides);
```

The `mergeArgsWithOverrides()` function (line 479) returns `[...filteredArgs, ...overrides]`, combining both user args and locked overrides into a single array.

Then the info block is built using all merged args:

```javascript
// Line 1016-1018 (solve)
const optionsText = args.slice(1).join(' ') || 'none';
let infoBlock = `Requested by: ${requester}\nURL: ${escapeMarkdown(normalizedUrl)}\nOptions: ${optionsText}`;
if (solveOverrides.length > 0) infoBlock += `\n🔒 Locked options: ${solveOverrides.join(' ')}`;
```

Since `args` already contains the overrides (merged in), `args.slice(1).join(' ')` includes both user options and override options. Then the "Locked options" line shows the overrides again.

### Affected Locations

1. **`/solve` command** (lines 1015-1018): Info block construction
2. **`/hive` command** (lines 1173-1179): Info block construction (same pattern)
3. **`/help` command** (lines 666-667, 678-679): Locked options display (no duplication issue here)

## UX Research

### Best Practices Applied

1. **Information Deduplication**: Avoid repeating the same data in the same response (distributed systems principle)
2. **Visual Hierarchy**: Use icons/emoji to differentiate categories (37% more effective per NN/g research)
3. **Layered Settings**: Separate user-controlled from system-enforced settings visually
4. **Telegram Formatting**: Keep it simple - use basic formatting for clarity

### References

- [Visual Indicators to Differentiate Items - NN/g](https://www.nngroup.com/articles/visual-indicators-differentiators/)
- [Command Line Interface Guidelines](https://clig.dev/)
- [Telegram formatting best practices](https://gramio.dev/formatting)

## Solution

### Approach

Use `userArgs` (pre-merge) instead of `args` (post-merge) to build the options text, and add an empty line separator:

```javascript
// Before (duplicated):
const optionsText = args.slice(1).join(' ') || 'none';
let infoBlock = `...URL: ...\nOptions: ${optionsText}`;

// After (deduplicated):
const userOptionsText = userArgs.slice(1).join(' ') || 'none';
let infoBlock = `...URL: ...\n\n🛠 Options: ${userOptionsText}`;
```

### Files Changed

1. `src/telegram-bot.mjs` - Modified info block construction for both `/solve` and `/hive` commands
2. `tests/test-issue-1228-options-deduplication.mjs` - New test file for verifying deduplication

## Issue Reference

- Issue: https://github.com/link-assistant/hive-mind/issues/1228
- PR: https://github.com/link-assistant/hive-mind/pull/1229
