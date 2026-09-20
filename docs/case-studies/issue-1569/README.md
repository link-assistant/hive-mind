# Case Study: Issue #1569 — Inconsistent User-Facing Messages

## Overview

**Issue**: [#1569 — We should be clear with user in all messages](https://github.com/link-assistant/hive-mind/issues/1569)
**PR**: [#1575](https://github.com/link-assistant/hive-mind/pull/1575)
**Labels**: bug
**Status**: Fixed

## Timeline / Sequence of Events

1. **Root cause identified**: The "Usage Limit Reached" GitHub comment has two separate sections:
   - A "### 🔄 How to Continue" section that correctly distinguishes between auto-resume and manual-resume modes.
   - A footer line that **always** says "You can resume once the limit resets." regardless of mode.

2. **Problem observed**: When `isAutoResumeEnabled` is `true`, the "How to Continue" section says:

   > "The session will automatically resume (with context preserved) when the limit resets."

   But the footer says:

   > "You can resume once the limit resets."

   This is misleading — if auto-resume is on, the user doesn't need to do anything manually.

3. **Secondary issue found**: In lines 494-498 of `github.lib.mjs`, there was a redundant `if/else` block that produced identical output regardless of whether `limitResetTime` was set. This dead code was simplified.

## Root Causes

### Root Cause 1: Static Footer Message

The footer message at lines 531 and 716 of `src/github.lib.mjs` was hardcoded as:

```
*This session was interrupted due to usage limits. You can resume once the limit resets.*
```

This was never updated when auto-resume functionality was added (issue #1152). It always tells the user they can manually resume, even when the system will do it automatically.

### Root Cause 2: Duplicate If/Else Branches

Lines 494-498 had an `if (limitResetTime)` / `else` block that produced identical output for both branches:

```js
if (limitResetTime) {
  logComment += `**Auto-${modeName} is enabled.** ${modeDescription}`;
} else {
  logComment += `**Auto-${modeName} is enabled.** ${modeDescription}`;
}
```

Both branches were identical — dead code that adds complexity without value.

## Requirements

1. Footer message must be consistent with the "How to Continue" section.
2. When `isAutoResumeEnabled` is true (resume mode): footer must say the session will automatically resume.
3. When `isAutoResumeEnabled` is true (restart mode): footer must say the session will automatically restart.
4. When `isAutoResumeEnabled` is false: footer must say the user can resume manually.
5. Remove duplicate if/else branches where both branches produce identical output.

## Affected Files

- `src/github.lib.mjs` — Contains both inline log comment and uploaded log comment generation.

## Solution

Updated the footer in both code paths (inline log and uploaded log) to be conditional based on `isAutoResumeEnabled` and `autoResumeMode`:

```js
const footerNote = isAutoResumeEnabled ? (autoResumeMode === 'restart' ? '*This session was interrupted due to usage limits. The session will automatically restart when the limit resets.*' : '*This session was interrupted due to usage limits. The session will automatically resume when the limit resets.*') : '*This session was interrupted due to usage limits. You can resume once the limit resets.*';
```

Also removed the duplicate `if/else` branches that produced identical output regardless of `limitResetTime`.

## Testing

- No existing tests in the test suite directly test the footer message text.
- The fix was verified by reading `src/github.lib.mjs` and tracing the logic for all three cases:
  1. `isAutoResumeEnabled = false` → "You can resume once the limit resets."
  2. `isAutoResumeEnabled = true`, `autoResumeMode = 'resume'` → "The session will automatically resume when the limit resets."
  3. `isAutoResumeEnabled = true`, `autoResumeMode = 'restart'` → "The session will automatically restart when the limit resets."

## Related Issues

- [#1152](https://github.com/link-assistant/hive-mind/issues/1152) — Auto-resume/restart functionality was added here; the footer was not updated to match.
- [#1567](https://github.com/link-assistant/hive-mind/issues/1567) — Related PR for reducing `telegram-bot.mjs` below 1500-line CI limit.
