# Case Study: Issue #1072 - User Confusion with --base-branch Option

## Overview

**Issue:** [#1072](https://github.com/link-assistant/hive-mind/issues/1072)
**Title:** Add --base-branch option as frequently used in /help, and also in all places in docs
**Date:** 2026-01-05
**Reporter:** @konard
**Labels:** documentation, enhancement
**Status:** Open

## Executive Summary

A user attempted to use the Telegram bot's `/solve` command with the `--branch` option, but received an error stating "Unknown argument: branch". The issue reveals two interconnected problems:

1. **Usability Issue**: The option name is `--base-branch` (or `-b`), not `--branch`, but this wasn't clear from the `/help` command output
2. **Missing Feature**: When users mistype or use incorrect option names, the system doesn't suggest the closest matching valid options

## Timeline of Events

### 2026-01-05 13:09:10Z - Initial Issue Report

User @konard attempted to solve an issue using the Telegram bot with the following command:

```
/solve https://github.com/uselessgoddess/license/issues/24 --branch dev --model opus
```

The bot responded with:

```
❌ Invalid options: Unknown argument: branch

Use /help to see available options
```

### User Expectation vs Reality

**User Input:**
- `--branch dev` (intuitive but incorrect)

**Actual Option:**
- `--base-branch dev` (correct full form)
- `-b dev` (correct short alias)

## Root Cause Analysis

### Primary Root Cause: Incomplete Help Documentation

The `/help` command in the Telegram bot (`src/telegram-bot.mjs:738-820`) only displays a subset of available options:

```javascript
message += '🔧 *Available Options:*\n';
message += '• `--model <model>` - Specify AI model (sonnet, opus, haiku, haiku-3-5, haiku-3)\n';
message += '• `--think <level>` - Thinking level (low/medium/high/max)\n';
message += '• `--verbose` - Verbose output\n';
message += '• `--attach-logs` - Attach logs to PR\n';
```

**Missing from help:** `--base-branch` / `-b` option, despite being a frequently used option.

### Secondary Root Cause: Discoverability Gap

The option **is defined** in the code (`src/solve.config.lib.mjs:213-217`):

```javascript
.option('base-branch', {
  type: 'string',
  description: 'Target branch for the pull request (defaults to repository default branch)',
  alias: 'b',
})
```

And **is documented** in:
- `README.md:294` - Example usage
- `docs/CONFIGURATION.md:274` - Full option table

However, users interacting with the Telegram bot typically use `/help` rather than reading the documentation files.

### Tertiary Root Cause: No Typo Suggestion System

The error handling uses yargs' `.strict()` mode which detects unknown arguments but doesn't provide suggestions. From the code (`src/solve.config.lib.mjs:299`):

```javascript
.strict()  // Enable strict validation
```

And error handling (`src/telegram-bot.mjs:1074`):

```javascript
await ctx.reply(`❌ Invalid options: ${error.message || String(error)}\n\nUse /help to see available options`, {
```

### Research Finding: Yargs Limitation

Based on web research, yargs has a `recommendCommands()` feature for suggesting similar command names when typos are detected, but **no equivalent feature exists for option names**. The library uses Damerau-Levenshtein distance algorithm for command suggestions but this functionality is not available for options.

## Evidence

### 1. Screenshot Analysis

The screenshot from the issue shows:
- Telegram chat interface with the Hive Mind bot
- User command: `/solve https://github.com/uselessgoddess/license/issues/24 --branch dev --model opus`
- Bot response: Error message with no helpful suggestions
- Bot suggests: "Use /help to see available options" (which doesn't list `--base-branch`)

### 2. Code Evidence

**File: `src/solve.config.lib.mjs`**
- Line 213-217: `--base-branch` option definition (exists in code)
- Line 299: `.strict()` mode enabled (causes unknown argument rejection)

**File: `src/telegram-bot.mjs`**
- Line 800-803: Limited options shown in `/help` (doesn't include `--base-branch`)
- Line 1074: Generic error message without suggestions

**File: `docs/CONFIGURATION.md`**
- Line 274: Full documentation of `--base-branch` option (exists but not discoverable via bot)

### 3. External Evidence

Research on yargs library functionality:
- [yargs/yargs #580](https://github.com/yargs/yargs/pull/580) - `recommendCommands()` feature (commands only)
- [yargs/yargs #1973](https://github.com/yargs/yargs/pull/1973) - Damerau-Levenshtein distance implementation
- No built-in option name suggestion feature found

## Impact Analysis

### User Impact

1. **Confusion**: Users with intuitive but incorrect option names face rejection without guidance
2. **Friction**: Users must search external documentation instead of getting inline help
3. **Support Load**: Increases support questions for common option name mistakes

### Frequency Assessment

The `--base-branch` option is described as "frequently used" in the issue title, and similar issues exist:
- Issue #681 documented problems with `--base-branch` usage
- Multiple case studies reference the option (found in 19 files via grep)

## Proposed Solutions

### Solution 1: Add --base-branch to /help Command (Immediate Fix)

**Priority:** High
**Effort:** Low
**Impact:** Medium

Update the help message in `src/telegram-bot.mjs:799-803` to include:

```javascript
message += '• `--base-branch <branch>` or `-b` - Target branch for PR\n';
```

**Pros:**
- Quick fix
- Low risk
- Addresses immediate discoverability issue

**Cons:**
- Doesn't solve the typo suggestion problem
- Help message becomes longer (already noted as "too many options")

### Solution 2: Implement Custom Option Suggestion System (Complete Fix)

**Priority:** High
**Effort:** Medium
**Impact:** High

Implement a Levenshtein distance-based suggestion system for option names:

1. When yargs throws "Unknown argument" error, capture the unknown option name
2. Calculate Levenshtein distance against all valid option names (including aliases)
3. Return top 3 closest matches with distance threshold (e.g., ≤ 3 edits)
4. Display suggestions: "Did you mean: --base-branch, --verbose, --model?"

**Implementation Location:** `src/solve.config.lib.mjs` parseArguments function

**Algorithm:** Use Damerau-Levenshtein distance (same as yargs uses for commands)

**Pros:**
- Solves the root cause
- Improves UX for all option typos, not just `--branch`
- Follows industry best practice (git, npm, etc.)
- Handles aliases automatically

**Cons:**
- Requires implementing custom distance calculation
- More testing required
- Slightly increased error handling complexity

### Solution 3: Enhanced /help with Dynamic Option Listing (Long-term Fix)

**Priority:** Medium
**Effort:** High
**Impact:** High

Create a smart help system that:

1. Shows "common options" by default (current behavior + `--base-branch`)
2. Provides `/help full` or `/help options` for complete list
3. Allows `/help <option-name>` for specific option details
4. Uses dynamic generation from yargs config instead of hardcoded strings

**Pros:**
- Scalable solution for "too many options" problem
- Maintains discoverability without overwhelming users
- Single source of truth (yargs config)

**Cons:**
- Significant refactoring required
- Changes user interaction model
- Requires documentation updates

### Solution 4: Interactive Help with Examples (Enhancement)

**Priority:** Low
**Effort:** Medium
**Impact:** Medium

Add inline examples and common use cases to error messages:

```
❌ Invalid options: Unknown argument: branch

Did you mean --base-branch?

Common examples:
• /solve <url> --base-branch develop
• /solve <url> -b dev
```

**Pros:**
- Educational for users
- Reduces support burden
- Low risk addition

**Cons:**
- Makes error messages longer
- Doesn't prevent the error, just explains better

## Recommended Implementation Plan

### Phase 1: Quick Win (Week 1)
1. ✅ Add `--base-branch` to `/help` command output
2. ✅ Add brief mention that `/help` shows common options only
3. ✅ Add link to full documentation

### Phase 2: Core Fix (Week 2-3)
1. ✅ Implement Levenshtein distance calculation utility
2. ✅ Add option name suggestion logic to error handler
3. ✅ Test with common typos (`--branch`, `--model-name`, `--fork-mode`, etc.)
4. ✅ Update error messages to show top 3 suggestions

### Phase 3: Enhanced Documentation (Week 4)
1. ✅ Audit all options in yargs config
2. ✅ Update README.md with more examples using `--base-branch`
3. ✅ Add troubleshooting section for common option name mistakes

### Phase 4: Future Enhancement (Backlog)
1. Implement enhanced help system (Solution 3)
2. Add interactive examples (Solution 4)
3. Consider command builder interface for complex commands

## Related Issues & PRs

- **Issue #681:** "base-branch not used" - Previous issue with `--base-branch` functionality
- **PR #177:** "Fix --help option not working" - Historical help command fixes
- **PR #614:** "Add support for /solve reply to message" - Related bot UX improvements

## Technical Specifications

### File Changes Required

1. **src/telegram-bot.mjs** (Line 799-803)
   - Add `--base-branch` to help output

2. **src/solve.config.lib.mjs** (New function)
   - Add `calculateLevenshteinDistance()`
   - Add `findSimilarOptions()`
   - Update error handler to use suggestions

3. **Tests** (New file)
   - `test/option-suggestions.test.mjs`
   - Unit tests for distance calculation
   - Integration tests for error messages

### Acceptance Criteria

- [ ] `/help` command shows `--base-branch` option
- [ ] Unknown option `--branch` suggests `--base-branch`
- [ ] Suggestions show maximum 3 closest matches
- [ ] Distance threshold prevents irrelevant suggestions
- [ ] Aliases (like `-b`) are included in matching
- [ ] Error messages are user-friendly and actionable
- [ ] No performance regression in error handling
- [ ] Documentation updated with new behavior

## Lessons Learned

1. **Help Documentation Paradox**: Having "too many options" leads to selective help documentation, which then causes discoverability issues for excluded options

2. **Error Message Design**: Generic "use /help" messages are unhelpful when help doesn't contain the needed information

3. **Library Limitations**: Third-party libraries (yargs) may have command-level features (recommendations) that aren't available at the option level

4. **Documentation Disconnect**: Documentation in files (README, CONFIGURATION.md) doesn't help users interacting through chat interfaces

## References

### Internal Documentation
- [README.md:289-299](../../README.md) - Usage examples
- [docs/CONFIGURATION.md:269-279](../CONFIGURATION.md) - Options table
- [docs/case-studies/issue-681-base-branch-not-used/](../issue-681-base-branch-not-used/) - Related base-branch issue

### External Research
- [yargs Strict Mode Issues](https://github.com/yargs/yargs/issues/1325) - Unknown arguments handling
- [yargs Command Recommendations](https://github.com/yargs/yargs/pull/580) - Command suggestion implementation
- [Damerau-Levenshtein Distance](https://github.com/yargs/yargs/pull/1973) - String similarity algorithm

### Code Locations
- `src/solve.config.lib.mjs:213-217` - Option definition
- `src/telegram-bot.mjs:738-820` - Help command
- `src/telegram-bot.mjs:918-1099` - /solve command handler

## Appendix

### A. All Available Options (from yargs config)

<details>
<summary>Click to expand complete option list</summary>

- `--model` / `-m` - AI model selection
- `--base-branch` / `-b` - Target branch for PR ⚠️ **Missing from /help**
- `--think` - Thinking level
- `--resume` / `-r` - Resume session ID
- `--fork` / `-f` - Fork repository
- `--auto-fork` - Auto-fork without write access
- `--verbose` / `-v` - Verbose logging
- `--dry-run` / `-n` - Prepare only
- `--watch` / `-w` - Monitor for feedback
- `--attach-logs` - Upload logs to PR
- `--tool` - AI tool selection
- `--only-prepare-command` - Print command only
- `--skip-tool-connection-check` - Skip tool check
- `--auto-pull-request-creation` - Auto-create PR
- `--claude-file` - Create CLAUDE.md
- `--gitkeep-file` - Create .gitkeep instead
- `--auto-close-pull-request-on-fail` - Close PR on failure
- `--auto-continue` - Continue with existing PR
- `--auto-continue-on-limit-reset` - Wait for limit reset
- `--auto-resume-on-errors` - Auto-resume on network errors
- `--auto-continue-only-on-new-comments` - Require new comments
- `--auto-commit-uncommitted-changes` - Auto-commit changes
- `--auto-restart-on-uncommitted-changes` - Auto-restart on changes
- `--auto-restart-max-iterations` - Max restart iterations
- `--continue-only-on-feedback` - Require feedback
- `--watch-interval` - Feedback check interval
- `--min-disk-space` - Minimum disk space required
- `--log-dir` / `-l` - Log file directory
- `--prompt-plan-sub-agent` - Encourage Plan agent
- `--sentry` - Enable Sentry tracking
- `--auto-cleanup` - Delete temp directory
- `--auto-merge-default-branch-to-pull-request-branch` - Merge default branch
- `--allow-fork-divergence-resolution-using-force-push-with-lease` - Allow force push
- `--allow-to-push-to-contributors-pull-requests-as-maintainer` - Push to contributor fork
- `--prefix-fork-name-with-owner-name` - Prefix fork name

**Total:** 38 options (only 4 shown in /help)

</details>

### B. Common Option Name Mistakes

Based on intuitive naming patterns, users might try:

| User Input | Correct Option | Levenshtein Distance |
|------------|----------------|---------------------|
| `--branch` | `--base-branch` | 5 (insert "base-") |
| `--target-branch` | `--base-branch` | 7 |
| `--pr-branch` | `--base-branch` | 6 |
| `--model-name` | `--model` | 5 |
| `--ai-model` | `--model` | 3 |
| `--resume-session` | `--resume` | 8 |
| `--session` | `--resume` | 5 |

### C. Screenshot Documentation

Original screenshot saved to: `./screenshot.png`

Dimensions: 1290 x 2796 pixels
Format: PNG
Context: Telegram chat with Hive Mind bot showing the error

---

**Document Version:** 1.0
**Last Updated:** 2026-01-05
**Author:** AI Issue Solver
**Status:** Ready for Review
