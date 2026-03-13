# Case Study: Issue #1339 - `/merge` MarkdownV2 Parsing Error & PRs Skipped

## Overview

**Issue:** [#1339](https://github.com/link-assistant/hive-mind/issues/1339)
**Status:** Bug
**Reporter:** Konstantin Dyachenko
**Date:** 2026-02-20
**Components Affected:** `src/telegram-merge-queue.lib.mjs`, `src/github-merge.lib.mjs`

## Incident Summary

When running `/merge https://github.com/link-assistant/hive-mind`, the Telegram bot repeatedly failed to update its status message with the error:

```
[VERBOSE] /merge: Error updating message: 400: Bad Request: can't parse entities: Character '.' is reserved and must be escaped with the preceding '\'
```

After the merge queue completed (34m 13s), the result was:

- ✅ Merged: 0
- ❌ Failed: 0
- ⏭️ Skipped: 2
- Total: 2

Both PRs were **skipped** rather than merged, with reason `Merge state: UNKNOWN`.

## Timeline Reconstruction

```
2026-02-20 (approximate times based on issue logs)
│
├── User runs /merge https://github.com/link-assistant/hive-mind
│
├── Bot initializes merge queue
│   └── 2 PRs found: #1298 (Issue #1296), #1303 (Issue #1302)
│
├── Bot starts waitForTargetBranchCI()
│   └── Finds 1 active CI run: Run #22243192736 "Checks and release" (in_progress)
│
├── [LOOP - every 30s poll interval]
│   ├── onStatusUpdate callback fires
│   ├── formatProgressMessage() is called
│   │   └── Message contains unescaped '...' (ellipsis from PR title truncation)
│   │       or '...' from 'more issues' section
│   └── Telegram API returns 400 "Character '.' is reserved"
│       [VERBOSE] Error updating message: 400: Bad Request...
│
├── [93s elapsed] First poll logged
├── [123s elapsed] Second poll logged
├── ... (approximately 34 minutes)
│
├── Target branch CI completes
│   └── Bot proceeds to process PRs
│
├── PR #1298 checked for mergeability
│   └── GitHub returns mergeable: null / mergeStateStatus: 'UNKNOWN'
│       (GitHub computes mergeability asynchronously - returns UNKNOWN briefly)
│   └── checkPRMergeable() returns { mergeable: false, reason: 'Merge state: UNKNOWN' }
│   └── PR #1298 SKIPPED
│
├── PR #1303 checked for mergeability
│   └── Same UNKNOWN state
│   └── PR #1303 SKIPPED
│
└── Merge Queue "Completed": 0 merged, 2 skipped
```

## Root Cause Analysis

### Root Cause 1: Unescaped Ellipsis (`...`) in MarkdownV2 Messages

**File:** `src/telegram-merge-queue.lib.mjs`

**Location:** `formatProgressMessage()` method

Telegram's MarkdownV2 mode requires ALL special characters to be escaped with a preceding `\`. The period `.` is one of these reserved characters.

The code in `formatProgressMessage()` correctly escapes owner/repo names, PR numbers, and error messages via `this.escapeMarkdown()`, but **fails to escape the literal ellipsis `...` appended after truncated text**:

```javascript
// Line 541 - truncated error text (BUGGY):
message += `  ${statusEmoji} \\#${item.prNumber}: ${this.escapeMarkdown(item.error.substring(0, 50))}${item.error.length > 50 ? '...' : ''}\n`;
//                                                                                                      ^^^
//                                                     '...' is unescaped! Telegram returns 400 error.

// Line 552 - truncated PR title (BUGGY):
message += `${item.emoji} \\#${item.prNumber}: ${this.escapeMarkdown(item.title.substring(0, 35))}${item.title.length > 35 ? '...' : ''}\n`;
//                                                                                                   ^^^
//                                                     Same issue!
```

Additionally:

- **Line 544:** `_...and ${problemItems.length - 5} more issues_` contains unescaped `...`
- **Line 556:** `_...and ${update.items.length - 10} more_` contains unescaped `...`
- **Line 523:** `\\n\\n` at the end of the CI wait message produces literal `\n\n` (backslash-n) in the Telegram message instead of actual newlines. In MarkdownV2, backslash is only valid before specific reserved characters, not before `n`.

**Why it triggered here:** The merge queue had 2 PRs. When `formatProgressMessage()` was called with PR items showing a pending status during the target branch CI wait, the PR titles (if longer than 35 chars) would trigger the truncated `...` path.

**Telegram MarkdownV2 Reference:** https://core.telegram.org/bots/api#markdownv2-style

> In all other places characters '\_', '\*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!' must be escaped with the preceding character '\'.

### Root Cause 2: `UNKNOWN` Merge State Causes PRs to be Skipped

**File:** `src/github-merge.lib.mjs`

**Location:** `checkPRMergeable()` function

GitHub computes mergeability **asynchronously**. When you first query a PR's merge state, GitHub may return `mergeable: null` and `mergeStateStatus: 'UNKNOWN'` while it's still computing in the background. A subsequent request (usually within seconds) will return the correct state.

The current implementation does NOT retry when the state is `UNKNOWN`:

```javascript
export async function checkPRMergeable(owner, repo, prNumber, verbose = false) {
  const pr = JSON.parse(stdout.trim());

  const mergeable = pr.mergeable === 'MERGEABLE';  // null or 'UNKNOWN' -> false

  if (!mergeable) {
    switch (pr.mergeStateStatus) {
      case 'BLOCKED': ...
      case 'BEHIND': ...
      case 'DIRTY': ...
      case 'UNSTABLE': ...
      case 'DRAFT': ...
      default:
        reason = `Merge state: ${pr.mergeStateStatus || 'unknown'}`;  // 'UNKNOWN' falls here!
    }
  }

  return { mergeable, reason };  // Returns { mergeable: false, reason: 'Merge state: UNKNOWN' }
}
```

In `processItem()` in `telegram-merge-queue.lib.mjs`:

```javascript
const mergeableCheck = await checkPRMergeable(this.owner, this.repo, item.pr.number, this.verbose);

if (!mergeableCheck.mergeable) {
  item.status = MergeItemStatus.SKIPPED; // PR is immediately skipped!
  item.error = mergeableCheck.reason; // Reason: 'Merge state: UNKNOWN'
  this.stats.skipped++;
  return;
}
```

**GitHub API Documentation:** GitHub's REST API documentation states that the `mergeable` field uses a "lazy evaluation" approach - the first request triggers the computation, and the value may be `null` until the computation completes. See: https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#get-a-pull-request

**Specific GitHub behavior:** When `mergeStateStatus` is `'UNKNOWN'`, it means GitHub hasn't calculated the merge state yet. The correct behavior is to wait briefly and retry.

## Impact

1. **Message update failures**: The bot silently fails to update the status message (only logs to verbose output), so users have no visibility into the merge queue progress during target branch CI waiting.

2. **PRs incorrectly skipped**: When GitHub returns `UNKNOWN` merge state (which is expected during the initial check), PRs are permanently skipped instead of being retried after a brief wait.

3. **Combined effect**: The 34-minute wait for target branch CI meant the bot had plenty of time to encounter the message update error repeatedly. When CI finally finished and the bot tried to merge PRs, GitHub's mergeability check happened to return `UNKNOWN` (possible due to fresh state after the long wait), causing both PRs to be skipped.

## Similar Issues / References

### Telegram MarkdownV2 Escaping

Similar issues have been reported in the Telegram Bot API community:

- GitHub issue tracker: Multiple projects hit this issue when using MarkdownV2 with dynamic content containing periods, exclamation marks, or other reserved characters
- The `.` character is particularly common in CI run names, version numbers, and PR titles
- **Known workaround**: Use the `escapeMarkdownV2()` function from `src/telegram-markdown.lib.mjs` which already exists in this codebase

### GitHub Mergeability UNKNOWN State

- GitHub's REST API documentation explicitly mentions this lazy evaluation
- This is a known issue in GitHub integrations: https://docs.github.com/en/rest/guides/using-the-rest-api-for-your-integrations#dealing-with-rate-limiting
- Stack Overflow discussion: Multiple questions about `mergeable: null` with recommendations to retry after 1-5 seconds
- The GitHub GraphQL API has the same behavior with `mergeable: UNKNOWN`

### GitHub Issue: Telegram Bots and MarkdownV2

The Telegram Bot API documentation for MarkdownV2 is clear that ALL reserved characters must be escaped, including in pure text content (not just in formatting syntax). Projects that dynamically generate messages often miss escaping literal `...` (ellipsis) appended for truncation.

**Existing library solutions:**

- [`telegram-escape`](https://www.npmjs.com/package/telegram-escape) - npm package for escaping Telegram markdown
- The codebase already has `src/telegram-markdown.lib.mjs` with `escapeMarkdownV2()` - it should be used consistently

## Proposed Solutions

### Fix 1: Escape Ellipsis in MarkdownV2 Messages

Replace unescaped `'...'` with `'\\.\\.\\.''` (three escaped periods) in `formatProgressMessage()`:

```javascript
// Line 541 - BEFORE:
${item.error.length > 50 ? '...' : ''}
// AFTER:
${item.error.length > 50 ? '\\.\\.\\.' : ''}

// Line 552 - BEFORE:
${item.title.length > 35 ? '...' : ''}
// AFTER:
${item.title.length > 35 ? '\\.\\.\\.' : ''}

// Line 544 - BEFORE:
`  _...and ${problemItems.length - 5} more issues_\n`
// AFTER:
`  _\\.\\.\\.and ${problemItems.length - 5} more issues_\n`

// Line 556 - BEFORE:
`_...and ${update.items.length - 10} more_\n`
// AFTER:
`_\\.\\.\\.and ${update.items.length - 10} more_\n`

// Line 523 - BEFORE (\\n\\n = literal backslash-n):
`...\\n\\n`
// AFTER (actual newlines):
`...\n\n`
```

### Fix 2: Retry When Merge State is UNKNOWN

Add retry logic to `checkPRMergeable()`:

```javascript
export async function checkPRMergeable(owner, repo, prNumber, verbose = false, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const pr = JSON.parse(stdout.trim());

    if (pr.mergeable === null || pr.mergeStateStatus === 'UNKNOWN') {
      if (attempt < maxRetries - 1) {
        // GitHub is still computing mergeability, wait and retry
        await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
        continue;
      }
    }
    // ... rest of logic
  }
}
```

## Data and Logs

The `screenshot.png` in this directory shows the actual Telegram conversation where the incident occurred.

- `screenshot.png` - Screenshot of the failed merge queue showing "Merged: 0, Skipped: 2"
