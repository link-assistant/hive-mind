# Issue 1684 Case Study: Better UI/UX for /solve commands in Telegram bot

## Source Artifacts

- Issue metadata: `raw-data/issue-1684.json`
- Issue comments (empty at the time of solving): `raw-data/issue-1684-comments.json`
- Reporter screenshot of the regression: `raw-data/issue-screenshot.png`
- Solution PR snapshot: `raw-data/pr-1685.json`
- Cross-referenced PR (`#1681`) introducing the centralized formatter: `raw-data/pr-1681.json`
- Cross-referenced issues (`#1670`, `#1680`) covering recent changes to the work-session UI: `raw-data/issue-1670.json`, `raw-data/issue-1680.json`

## External Research

- Telegram Bot API allows up to 4096 UTF-8 characters per message and edits via `editMessageText`. Message edits in Bot API: <https://core.telegram.org/bots/api#editmessagetext>.
- Telegram Markdown V1 / V2 parse modes still apply to edited messages, so the same escaping rules used for the initial reply must be honoured for completion edits: <https://core.telegram.org/bots/api#formatting-options>.
- Audit-trail expectations for Telegram-driven automation are summarised in the OWASP "Logging Cheat Sheet": <https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html>. The reporter explicitly relies on the bot message itself as the only audit record because Telegram allows users to delete their original `/solve` message.

These sources support the local conclusion that the bot must keep the `Requested by: …` and `URL: …` lines (and ideally the options block) on every status transition, including the terminal completion message — otherwise the only authoritative record of who triggered the run is lost when a user deletes their command.

## Timeline

1. PR #1671 (issue #1670) introduced `formatExecutingWorkSessionMessage` and `formatSessionCompletionMessage` to centralize Telegram work-session message formatting.
2. PR #1681 (issue #1680) wired session monitoring so that screen-isolated sessions reliably edit the original message when `$ --status` reports a terminal state.
3. After both fixes shipped, the reporter ran `/claude https://github.com/link-assistant/agent/pull/267` and observed:
   - `🚀 Starting solve command...` followed by
   - `⏳ Solve command executing...` and finally
   - `✅ Work Session Completed` with only `Session`, `Duration`, `URL`, `Isolation` and a generic footer.
4. The reporter compared this against the desired security-aware layout where the requester, URL, options and locked options remain visible after completion (so admins still know who triggered the run if the user deletes their command).
5. Issue #1684 was filed on 2026-04-25 with screenshots and a clear target layout.

## Requirements Extracted from the Issue

The issue lists six concrete UI/UX requirements for the Telegram bot:

1. The completion headline should change from `✅ Work Session Completed` to `✅ Work session finished successfully`.
2. The completion message should show `⏱️ Duration` _before_ `📊 Session`.
3. The completion message must keep the `Requested by:` line, the `URL:` line, the `🛠 Options:` block and the `🔒 Locked options:` block — i.e. the same `infoBlock` shown during `Starting…` / `Executing…` — because users can delete their `/solve` message and the bot is the only audit record.
4. The standalone `🔗 URL:` line and the trailing `The work session has finished. You can now review the results.` footer must be removed (the URL is already in the audit infoBlock and the footer is noise).
5. The starting and executing phases should become two visually distinct events — `🔄 Starting...` (the moment the user's command is accepted) and `⏳ Executing...` (after the underlying isolation/screen launch succeeds) — so that "command launch failed before execution" and "command launched but failed during execution" are distinguishable.
6. Failure tracking and display must remain correct (the reporter explicitly asked us to "double-check we correctly track/monitor and display fail of working session").

## Root Cause Analysis

| Requirement                               | Root cause                                                                                                                                                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title change                              | `formatSessionCompletionMessage` in `src/work-session-formatting.lib.mjs` produced `Work Session Completed/Failed`.                                                                                                                                                   |
| Field ordering                            | The same formatter wrote `Session` before `Duration`.                                                                                                                                                                                                                 |
| Missing audit info on completion          | Neither `formatSessionCompletionMessage` nor `monitorSessions` carried the `infoBlock` from the original Telegram reply. The infoBlock was only attached to the `Starting`/`Executing` edits, so the completion edit always overwrote it.                             |
| Stray `🔗 URL:` line and footer           | Built into the formatter.                                                                                                                                                                                                                                             |
| Single `🚀 Starting solve command…` event | Both the queue happy path (`telegram-solve-queue.lib.mjs`) and the immediate path (`telegram-bot.mjs:executeAndUpdateMessage`) used the same single label. The transition `Starting → Executing` already exists internally, but the user-facing label did not change. |
| Failure display                           | The pieces are present (`getSessionCompletionExitCode`, `❌ Work Session Failed`), but the failure paths in `telegram-bot.mjs` and `telegram-solve-queue.lib.mjs` did not include the `infoBlock`, so a failed run lost the audit record.                             |

The deepest root cause is that the centralized formatter in `work-session-formatting.lib.mjs` did not accept the audit `infoBlock`, and `trackSession()` did not persist it on the in-memory record, so the session monitor could not include it in the final edit even if it wanted to.

## Implemented Solution

1. **`src/work-session-formatting.lib.mjs`**
   - Added `formatStartingWorkSessionMessage({ infoBlock })` returning `🔄 Starting...\n\n<infoBlock>` so we have a single source of truth for the launch label.
   - Removed the `commandName` parameter from `formatExecutingWorkSessionMessage`; the executing label is now the requested `⏳ Executing...` regardless of whether the command was `/solve`, `/claude`, `/codex`, etc.
   - Updated `formatSessionCompletionMessage`:
     - Headline: `✅ *Work session finished successfully*` / `❌ *Work session failed (exit code: N)*`.
     - Order: Duration → Session → Isolation → audit infoBlock.
     - Removed the `🔗 URL:` line and the trailing `The work session has finished…` footer.
     - Accepts an `infoBlock` parameter and falls back to `sessionInfo.infoBlock` so the session monitor can keep using the value persisted at `trackSession()` time.

2. **`src/telegram-bot.mjs`** and **`src/telegram-solve-queue.lib.mjs`**
   - Replaced the literal `🚀 Starting solve command…` / `🚀 Starting hive command…` strings with `formatStartingWorkSessionMessage({ infoBlock })`.
   - Updated the executing edit to use the no-`commandName` form.
   - Failure paths (`Error executing …`, `Error: …`, queue error handler) now append `\n\n${infoBlock}` so the audit record survives a failure.
   - `trackSession()` calls in `telegram-bot.mjs`, `telegram-isolation.lib.mjs` and `telegram-solve-queue.lib.mjs` now persist `infoBlock`.

3. **`src/session-monitor.lib.mjs`**
   - Forwards `sessionInfo.infoBlock` into `formatSessionCompletionMessage` so completion edits include the audit block.

4. **Tests**
   - `tests/test-issue-1684-message-formatting.mjs`: 29 new assertions covering the new headlines, field order, `🔄 Starting...` / `⏳ Executing...` transitions, failure exit codes, audit preservation, and graceful behaviour with no infoBlock.
   - `tests/test-issue-1670-screen-status-monitoring.mjs` and `tests/test-issue-1680-session-monitoring.mjs`: assertions updated to the new headline strings.
   - `tests/test-telegram-message-edit-error-handling.mjs`: assertion updated from `'command executing'` to `'Executing...'`.
   - `package.json` test script wired up to run the new test in CI.

## Existing Components Considered

- We deliberately reused the existing `formatSessionDurationSeconds`, `getSessionCompletionExitCode`, and `formatSessionCompletionMessage` infrastructure introduced in PR #1671 instead of forking another formatter. Centralising the message in a single library keeps `monitorSessions()` and the queue happy path consistent.
- We considered adopting `MarkdownV2`, but the rest of the bot still ships with classic Markdown (`parse_mode: 'Markdown'`) and switching parse modes would invalidate every escape helper called in `escapeMarkdown`. That work is orthogonal to issue #1684 and out of scope.

## Failure Tracking Verification

- `getSessionCompletionExitCode()` already promotes `failed`, `cancelled`, `canceled`, `error` statuses to a non-zero exit code, and it accepts both `statusResult.exitCode` and an explicit `exitCode`.
- The new test asserts both successful (`exitCode: 0`) and failure (`exitCode: 2`) paths produce the new headlines.
- The queue and direct execution paths now propagate the `infoBlock` into:
  - `⚠️ ${result.warning}` (warning),
  - `❌ Error executing solve command:` (synchronous failure of `executeStartScreen`/isolation),
  - `❌ Error: ${error.message}` (queue execution exception),
  - `❌ Work session failed (exit code: N)` (terminal failure detected by the session monitor).

## Residual Notes

- This change does not migrate the bot to MarkdownV2; that is a separate hardening project.
- Long-running session restart-across-process-restart was deliberately not added; the existing in-memory tracking remains the contract from PR #1681.
- Per issue request, this case study is accompanied by a directly-runnable regression (`tests/test-issue-1684-message-formatting.mjs`) so future formatter changes have to maintain the documented audit guarantees.
