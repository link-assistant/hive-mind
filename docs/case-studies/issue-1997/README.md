# Issue 1997 Case Study: Prefer Short Telegram Queue Commands

## Source Data

- Issue: https://github.com/link-assistant/hive-mind/issues/1997
- Pull request: https://github.com/link-assistant/hive-mind/pull/1998
- Screenshot: `raw-data/issue-screenshot.png`
- Raw GitHub data: `raw-data/issue.json`, `raw-data/issue-comments.json`, `raw-data/pr-1998.json`, `raw-data/pr-1998-comments.json`, `raw-data/pr-1998-review-comments.json`, `raw-data/pr-1998-reviews.json`
- Related PR searches: `raw-data/related-prs-solve-queue.json`, `raw-data/related-prs-1837.json`, `raw-data/related-prs-1497.json`

## Timeline

- 2026-06-29 14:36 UTC: Issue #1997 opened with a screenshot showing a duplicate working-session response recommending `/solve_stop`.
- 2026-06-29 14:38 UTC: Draft PR #1998 opened from branch `issue-1997-75be8d03d04d`.
- Investigation found no issue comments and no PR comments or reviews at the time raw data was collected.
- The screenshot showed a user running `/codex ...`; the bot responded that the URL already had a working session and recommended `/solve_stop` even though the implemented stop command is `/stop`.

## Requirements

- Recommend `/stop` instead of `/solve_stop`.
- Recommend `/queue` instead of `/solve_queue`.
- Remove commands with the `/solve_` prefix.
- Apply the change throughout the codebase, including localized help and duplicate-task messages.
- Preserve data and analysis for this issue under `docs/case-studies/issue-1997`.

## External Facts

The Telegram Bot API `BotCommand` type allows command names made from lowercase English letters, digits, and underscores, with a 1-32 character length limit. This means `solve_queue` is technically valid, but the issue requirement is product-level UX: use the shorter existing alias as the canonical command and stop accepting the older prefixed command.

Reference: https://core.telegram.org/bots/api#botcommand

## Root Causes

1. Canonical help lagged behind alias design.
   `/queue` already existed as a shorter alias, but the help text and duplicate URL hints still advertised `/solve_queue`.

2. The old queue aliases were still registered.
   `registerSolveQueueCommand()` accepted `solve_queue`, `solvequeue`, `solve-queue`, and `queue`; the text fallback in `telegram-bot.mjs` also routed `solve_queue` and `solvequeue`.

3. Duplicate running-session text referenced a non-canonical stop command.
   The `telegram.url_session_running` locale string recommended `/solve_stop`; the active stop implementation is `/stop`.

4. Localized group-note help had a stale escaped queue command.
   The rendered help still listed `/solve\_queue` in the group-only command note.

## Solution

- Register only `/queue` for queue status.
- Route only `queue` through the text fallback dispatcher.
- Update English, Russian, Chinese, and Hindi locale strings to recommend `/queue` and `/stop`.
- Update command-level verbose logs and comments to refer to `/queue`.
- Add regression coverage that verifies legacy queue command forms are not accepted, help text recommends `/queue`, duplicate URL messages recommend `/queue` and `/stop`, and locale files do not contain user-facing legacy solve-prefixed commands.

## Verification

- `node tests/test-solve-queue-command.mjs`
- `node tests/test-telegram-safe-reply-issue-1497.mjs`
- `node tests/test-i18n.mjs`
- `node --check src/telegram-solve-queue-command.lib.mjs`
- `node --check src/telegram-bot.mjs`
- `node --check src/telegram-solve-queue.lib.mjs`
- `node --check src/telegram-solve-queue.helpers.lib.mjs`
- `npm run lint`
- `npm run format:check`
- `npm test`
- Grep checks confirmed no `/solve_queue`, `/solve\_queue`, `/solve\_stop`, or `/solve_` slash command forms remain in active source, tests, README, or active docs outside historical case-study data.
