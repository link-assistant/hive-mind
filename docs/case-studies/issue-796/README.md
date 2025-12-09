# Case Study: Issue #796 - Show current time in the same timezone

## Issue Reference
https://github.com/link-assistant/hive-mind/issues/796

## Timeline of Events

### Initial State
The `/limits` command in the Telegram bot was displaying Claude usage limits with several issues:
1. Progress bars were not aligned (not using monospace fonts)
2. Time format was truncating minutes (showing "10pm" instead of "10:59pm")
3. No current time displayed in the same timezone
4. No relative time display (e.g., "Resets in 1h 34m")
5. Multiple messages were sent instead of updating a single message

### Analysis

#### Root Causes

1. **Progress Bar Alignment Issue**
   - Location: `src/claude-limits.lib.mjs:202-246` (formatUsageMessage function)
   - The message was using Telegram's Markdown mode but not using code blocks
   - Without monospace font, Unicode block characters have varying widths

2. **Time Format Bug**
   - Location: `src/claude-limits.lib.mjs:52-69` (formatResetTime function)
   - The function was only showing hour without minutes
   - Line 66: `return `${month} ${day}, ${hour12}${ampm} (UTC)`;`
   - Missing minutes component from the date object

3. **Missing Current Time**
   - The formatUsageMessage function didn't include current time
   - Users couldn't easily calculate time differences

4. **Missing Relative Time**
   - No calculation of time difference between now and reset time
   - Users had to manually calculate "how long until reset"

5. **Multiple Messages**
   - Location: `src/telegram-bot.mjs:843-855`
   - Sending separate "fetching" message (line 843)
   - Then sending result message (line 855)
   - Should use Telegram's message editing feature instead

#### Affected Files
- `src/claude-limits.lib.mjs` - Main library for formatting usage limits
- `src/telegram-bot.mjs` - Telegram bot command handler
- `package.json` - Version needs to be bumped for release

## Proposed Solution

### 1. Add Minutes to Time Format
Update `formatResetTime` function to include minutes:
```javascript
const minutes = date.getUTCMinutes();
return `${month} ${day}, ${hour12}:${minutes.toString().padStart(2, '0')}${ampm} (UTC)`;
```

### 2. Add Relative Time Calculation
Create new function to calculate relative time:
```javascript
function formatRelativeTime(isoDate) {
  const now = new Date();
  const target = new Date(isoDate);
  const diffMs = target - now;

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  return `${hours}h ${minutes}m`;
}
```

### 3. Update Message Format
Modify `formatUsageMessage` to:
- Wrap entire message in Telegram code block (```text ... ```)
- Show current time at the top
- Show both relative and absolute time for resets

### 4. Use Message Editing
Update telegram-bot.mjs to:
- Send initial "fetching" message
- Edit the same message with results instead of sending new message

### 5. Bump Version
Update package.json version from 0.36.7 to 0.36.8 (patch release for bug fixes)

## Implementation Status
- [x] Root cause analysis completed
- [x] Solution designed
- [ ] Code changes implemented
- [ ] Tests added/updated
- [ ] Version bumped
- [ ] CI passing
- [ ] PR updated

## Expected Outcome
After implementation, the `/limits` command will:
1. Display aligned progress bars using monospace font
2. Show correct time with minutes (e.g., "10:59pm")
3. Display current time in UTC
4. Show relative time (e.g., "Resets in 1h 34m (Dec 3, 10:59pm UTC)")
5. Update the fetching message instead of sending multiple messages
