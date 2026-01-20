# Case Study: Issue #1146 - Ultrathink Deprecation and Thinking Budget Changes

## Issue Summary

**Issue:** [#1146](https://github.com/link-assistant/hive-mind/issues/1146) - `Ultrathink no longer does anything. Thinking budget is now max by default.`

**Type:** Bug / Enhancement
**Date Reported:** January 2026
**Status:** Analysis Complete

## Problem Statement

Claude Code CLI now displays the message "Ultrathink no longer does anything. Thinking budget is now max by default." when users type the "Ultrathink" keyword in prompts. This affects the hive-mind project which uses thinking keywords (`Think.`, `Think hard.`, `Think harder.`, `Ultrathink.`) to configure AI reasoning depth through the `--think` command-line option.

Since hive-mind uses fully autonomous mode (not TUI), the team needs to understand:

1. How thinking configuration works in autonomous mode with Claude Code CLI >= 2.1.12
2. Whether to drop support for thinking keywords
3. What alternatives exist for configuring thinking levels

## Timeline of Events

| Date             | Version | Event                                                                                                            | Impact                                                      |
| ---------------- | ------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Pre-Nov 2025     | 1.x     | Thinking keywords (`think` < `think hard` < `think harder` < `ultrathink`) mapped to increasing thinking budgets | Users could explicitly control reasoning depth via keywords |
| Nov 2025         | 2.0.0   | Tab toggles thinking mode (sticky), thinking levels deprecated                                                   | Lost granular keyword control                               |
| Nov 2025         | 2.0.x   | "Thinking mode now enabled by default for Opus 4.5"                                                              | Automatic thinking allocation begins                        |
| Dec 2025         | 2.0.67  | Tab toggle broken, `/config` required                                                                            | Usability regression                                        |
| Jan 7, 2026      | 2.1.0   | "3x memory improvements", "optimizations"                                                                        | Quality degradation reports begin                           |
| Jan 9, 2026      | 2.1.x   | GitHub #17097: "Claude Does Not Follow Prompts Through Completion"                                               | Critical instruction-following failures                     |
| Jan 12, 2026     | 2.1.x   | GitHub #17900: "Significant quality degradation"                                                                 | Widespread user reports                                     |
| Jan 14, 2026     | 2.1.7   | GitHub #18123: ultrathink default not documented                                                                 | Confirmation of silent changes                              |
| **Jan 16, 2026** | 2.1.x   | **Anthropic officially deprecates ultrathink**                                                                   | Keywords no longer allocate thinking tokens                 |
| Jan 2026         | 2.1.11  | Fixed MCP connection issues                                                                                      | Current stable version                                      |
| Jan 2026         | 2.1.12  | Fixed message rendering bug                                                                                      | Latest version                                              |

## Root Cause Analysis

### The Core Change

Anthropic made extended thinking **enabled by default** in Claude Code, with a default budget of **31,999 tokens** (the same as the old ultrathink maximum). This means:

1. **Keywords are ignored**: Phrases like "think", "think hard", "ultrathink", and "think more" are now interpreted as **regular prompt instructions** and don't allocate thinking tokens
2. **Automatic allocation**: All API calls receive thinking budget automatically
3. **Configuration via environment**: The only programmatic control is through the `MAX_THINKING_TOKENS` environment variable

### Why Keywords No Longer Work

From the [official Claude Code documentation](https://code.claude.com/docs/en/common-workflows):

> "Phrases like 'think', 'think hard', 'ultrathink', and 'think more' are interpreted as regular prompt instructions and don't allocate thinking tokens."

The thinking budget is now controlled exclusively by:

1. `MAX_THINKING_TOKENS` environment variable
2. `alwaysThinkingEnabled` setting in `~/.claude/settings.json`
3. Toggle shortcuts (`Option+T` / `Alt+T`) - TUI only
4. `/config` command - TUI only

### Impact on Autonomous Mode

Since hive-mind runs Claude Code in autonomous mode (not TUI):

- Toggle shortcuts are not available
- `/config` command is not available
- Only environment variable `MAX_THINKING_TOKENS` can be used programmatically
- Thinking is ON by default with 31,999 tokens

## Technical Analysis of Affected Code

### Files Using Thinking Keywords

1. **`src/solve.config.lib.mjs`** (lines 217-222):

   ```javascript
   .option('think', {
     type: 'string',
     description: 'Thinking level: low (Think.), medium (Think hard.), high (Think harder.), max (Ultrathink.)',
     choices: ['low', 'medium', 'high', 'max'],
     default: undefined,
   })
   ```

2. **`src/opencode.prompts.lib.mjs`** (lines 60-68, 86-96):

   ```javascript
   // User prompt thinking keywords
   const thinkMessages = {
     low: 'Think.',
     medium: 'Think hard.',
     high: 'Think harder.',
     max: 'Ultrathink.',
   };

   // System prompt thinking instructions
   const thinkMessages = {
     low: 'You always think on every step.',
     medium: 'You always think hard on every step.',
     high: 'You always think harder on every step.',
     max: 'You always ultrathink on every step.',
   };
   ```

3. **`src/codex.prompts.lib.mjs`** (lines 60-68, 86-96):
   - Same structure as opencode.prompts.lib.mjs

4. **`src/telegram-bot.mjs`** (line 770):
   ```javascript
   message += '• `--think <level>` - Thinking level (low/medium/high/max)\n';
   ```

## Proposed Solutions

### Solution 1: Environment Variable Approach (Recommended)

Replace the `--think` option with `--thinking-budget` that maps to `MAX_THINKING_TOKENS`:

```javascript
.option('thinking-budget', {
  type: 'number',
  description: 'Thinking token budget (1024-63999). Set to 0 to disable thinking.',
  default: undefined, // Use Claude Code's default of 31999
})
```

**Mapping from old levels:**
| Old Level | New Budget | Notes |
|-----------|------------|-------|
| `low` | 8000 | Minimal reasoning |
| `medium` | 16000 | Moderate reasoning |
| `high` | 24000 | Deep reasoning |
| `max` | 31999 | Maximum (default) |
| `extended` | 63999 | Double budget (64K output models only) |

**Implementation:**

```javascript
// In claude.lib.mjs or solve.mjs
if (argv.thinkingBudget !== undefined) {
  process.env.MAX_THINKING_TOKENS = String(argv.thinkingBudget);
}
```

### Solution 2: Deprecate `--think` with Backward Compatibility

Keep `--think` option but:

1. Add deprecation warning when used
2. Map old levels to environment variable values
3. Document the change in CHANGELOG

```javascript
if (argv.think) {
  const budgetMap = {
    low: 8000,
    medium: 16000,
    high: 24000,
    max: 31999,
  };
  console.warn(`⚠️  Warning: --think is deprecated for Claude Code >= 2.1.12. Thinking is now on by default.`);
  console.warn(`   The '${argv.think}' level has no effect. Consider using --thinking-budget ${budgetMap[argv.think]} instead.`);
}
```

### Solution 3: Version-Aware Configuration

Detect Claude Code version and behave differently:

```javascript
// Detect Claude Code version
const claudeVersion = await getClaudeCodeVersion();
const [major, minor] = claudeVersion.split('.').map(Number);

if (major >= 2 && minor >= 12) {
  // Use environment variable for newer versions
  if (argv.thinkingBudget) {
    process.env.MAX_THINKING_TOKENS = String(argv.thinkingBudget);
  }
  // Note: Keywords have no effect, thinking is on by default
} else {
  // Use keywords for older versions (pre-2.1.12)
  // Keep existing behavior with Think., Think hard., etc.
}
```

## Implemented Solution (v1.8.0)

Based on feedback from konard, we implemented **bidirectional translation** between `--think` and `--thinking-budget` options to support all Claude Code versions:

### New Features

1. **Added `off` option** to `--think`: values are now `['off', 'low', 'medium', 'high', 'max']`
2. **Added `--thinking-budget-claude-minimum-version`** option (default: `2.1.12`)
3. **Bidirectional translation** based on detected Claude Code version:
   - **For Claude Code >= 2.1.12**: `--think` is translated to `--thinking-budget`
   - **For Claude Code < 2.1.12**: `--thinking-budget` is translated back to `--think` keywords

### Translation Mapping

| --think  | --thinking-budget | Notes              |
| -------- | ----------------- | ------------------ |
| `off`    | 0                 | Disable thinking   |
| `low`    | ~8000 (7999)      | Minimal reasoning  |
| `medium` | ~16000 (15999)    | Moderate reasoning |
| `high`   | ~24000 (23999)    | Deep reasoning     |
| `max`    | 31999             | Maximum (default)  |

### Implementation Details

```javascript
// In src/config.lib.mjs
export const thinkingLevelToTokens = {
  off: 0,
  low: 7999, // 31999/4
  medium: 15999, // 31999/2
  high: 23999, // 31999*3/4
  max: 31999, // Claude Code default max
};

// Reverse mapping uses midpoint ranges
export const tokensToThinkingLevel = tokens => {
  if (tokens === 0) return 'off';
  if (tokens <= 11999) return 'low';
  if (tokens <= 19999) return 'medium';
  if (tokens <= 27999) return 'high';
  return 'max';
};
```

### Usage Examples

```bash
# Use named level (works with all versions)
solve issue-url --think medium

# Use explicit budget (translated for older versions)
solve issue-url --thinking-budget 16000

# Disable thinking
solve issue-url --think off
# or
solve issue-url --thinking-budget 0

# Override minimum version threshold
solve issue-url --thinking-budget-claude-minimum-version 2.2.0
```

## Future Actions

### Long-term (v2.0.0)

1. **Consider removing translation** once Claude Code < 2.1.12 is no longer in use
2. **Standardize on `--thinking-budget`** across all tools

## Alternative Approaches for Power Users

### Double Thinking Budget (63,999 tokens)

For Opus 4.5, Sonnet 4, Sonnet 4.5, and Haiku 4.5 models with 64K output:

```bash
export MAX_THINKING_TOKENS=63999
```

### Disable Thinking Entirely

```bash
export MAX_THINKING_TOKENS=0
```

Or in settings:

```json
{
  "alwaysThinkingEnabled": false
}
```

## Evidence and Sources

### Primary Sources

1. [Claude Code Documentation - Common Workflows](https://code.claude.com/docs/en/common-workflows)
2. [GitHub Issue #19098 - Restore explicit ultrathink keyword](https://github.com/anthropics/claude-code/issues/19098)
3. [Claude Code CHANGELOG.md](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
4. [GitHub Issue #18072 - Logic conflict between MAX_THINKING_TOKENS and ultrathink](https://github.com/anthropics/claude-code/issues/18072)

### Secondary Sources

5. [Decode Claude - UltraThink is Dead](https://decodeclaude.com/ultrathink-deprecated/)
6. [Building with Extended Thinking - Claude Docs](https://docs.claude.com/en/docs/build-with-claude/extended-thinking)

### Related GitHub Issues

- **#17097**: Claude Does Not Follow Prompts Through Completion since 2.1.x
- **#17900**: Significant quality degradation and inconsistent behavior
- **#18123**: ultrathink now enabled by default (not in CHANGELOG)
- **#8380**: Inline thinking output with MAX_THINKING_TOKENS no longer appears automatically
- **#8780**: Doc Missing for alwaysThinkingEnabled Setting

## Conclusion

The deprecation of ultrathink keywords in Claude Code CLI >= 2.1.12 is a deliberate design decision by Anthropic to simplify the thinking configuration model. Extended thinking is now:

1. **On by default** with 31,999 tokens
2. **Controlled via `MAX_THINKING_TOKENS`** environment variable
3. **Not affected by prompt keywords** like "ultrathink"

The hive-mind project should adapt by:

1. Deprecating the `--think` option for Claude tool
2. Introducing `--thinking-budget` for direct control via environment variable
3. Updating documentation to reflect the new paradigm

This change affects only `--tool claude`. Other tools (opencode, codex, agent) may still benefit from thinking keywords as they use different underlying systems.
