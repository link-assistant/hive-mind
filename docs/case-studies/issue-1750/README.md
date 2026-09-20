# Issue 1750 Case Study: Terminal Watch Change Detection

## Summary

Issue 1750 reported a live `/terminal_watch` message that stayed visually stuck while its `Updates:` counter kept increasing. The root cause was local to `src/telegram-terminal-watch-command.lib.mjs`: the watch loop incremented `updateCount` before rendering every poll, and the rendered message included `Updates: N`. That made every polling tick produce a different message even when the terminal log snapshot was identical, so the bot kept calling Telegram `editMessageText`.

The fix makes the watcher compare the rendered terminal snapshot separately from the message counter. It increments `Updates:` only when the displayed terminal snapshot changes, skips Telegram edits for unchanged snapshots, and still sends the final completion edit when the session reaches a terminal state.

## Raw Data

- `data/issue-1750.json`: issue metadata and body.
- `data/issue-1750-comments.json`: issue comments; empty at investigation time.
- `data/pr-1751.json`: prepared PR metadata before implementation.
- `data/pr-1751-conversation-comments.json`, `data/pr-1751-review-comments.json`, `data/pr-1751-reviews.json`: PR discussion channels; empty at investigation time.
- `data/pr-1751-initial.diff`: initial prepared PR diff, containing only the generated task scaffold.
- `data/related-prs-terminal-watch.json`: recent merged PRs related to terminal watch behavior.
- `data/github-code-search-terminal-watch.json`, `data/github-code-search-watchTerminalLogSession.json`: GitHub code search results used to locate related code.
- `data/research-sources.json`: external and related-project references checked during analysis.
- `data/test-issue-467-after-fix.txt`, `data/test-issue-1720-regression.txt`: focused regression test outputs.
- `data/npm-ci.txt`, `data/npm-run-lint.txt`, `data/npm-run-format-check.txt`, `data/npm-test-summary.txt`: local verification evidence. The full `npm test` log was not committed because existing token-sanitization tests print token-shaped fixture values.

## Timeline

- 2026-05-04 12:10 UTC: Issue 1750 was opened with a terminal watch message showing `Updates: 1609` while the visible log content repeated.
- 2026-05-04: The prepared PR 1751 existed as a draft with no substantive implementation.
- 2026-05-04: Investigation found `watchTerminalLogSession()` formatting `updateCount: ++updateCount` before comparing the rendered message with the previous render.
- 2026-05-04: A regression test was added to reproduce the unnecessary edits: unchanged snapshots still caused repeated Telegram edits, and a single real snapshot change caused multiple edits.
- 2026-05-04: The watcher was changed to keep an initial snapshot baseline, count only changed terminal snapshots, and edit only on changed snapshots or final completion.

## Requirements

- Reduce Telegram API calls from `/terminal_watch`.
- Only send live Telegram updates when the displayed terminal log snapshot changes.
- Make `Updates:` count real terminal snapshot changes instead of polling iterations.
- Preserve final completion visibility when the session reaches a terminal status.
- Preserve the earlier issue 1720 behavior: `/terminal_watch` must not upload the full log file.
- Save issue and PR evidence under `docs/case-studies/issue-1750`.
- Review related prior work and external Telegram API facts.

## Root Cause

`watchTerminalLogSession()` stored the full rendered Telegram message as `lastMessage`, then built each new message with `updateCount: ++updateCount`. Since `Updates:` is part of the message text, the comparison `message !== lastMessage` was always true while the watch remained active. The terminal content could be unchanged, but the counter changed, so the bot performed another `editMessageText` call.

The actual `/terminal_watch` path also sent an initial message before starting the loop, but the loop did not receive that initial rendered state as a baseline. That caused an immediate duplicate edit even before any terminal output changed.

## Solution

- Added a displayed-snapshot helper based on `tailTextForTerminal()` and the same code-fence sanitization used in message formatting.
- Added optional initial state inputs to `watchTerminalLogSession()` so the watcher can start from the message already sent by `/terminal_watch`.
- Changed the loop to increment `updateCount` only when the displayed terminal snapshot changes.
- Changed the edit gate to skip unchanged snapshots while still allowing the final terminal-status message to be sent.
- Passed the initial log text, status result, and message from `startWatchFromResolvedSession()` into the watcher.

## Related Work

- PR 551 introduced `/terminal_watch`, terminal-sized snapshots, and `editMessageText` based live updates.
- PR 1701 fixed screen/tmux/docker session recognition for `/log` and `/terminal_watch`.
- PR 1721 removed automatic full-log uploads from `/terminal_watch`; this fix keeps that behavior unchanged.

No upstream issue was filed. The bug is in Hive Mind's watcher loop; Telegram and Telegraf are behaving as expected.

## Verification

- Before the fix, the new regression section in `tests/test-issue-467-terminal-watch.mjs` failed with repeated edits for unchanged snapshots.
- After the fix: `node tests/test-issue-467-terminal-watch.mjs` passed with 22/22 assertions.
- `node tests/test-issue-1720-terminal-watch-no-log.mjs` passed with 7/7 assertions, confirming the previous no-log-upload behavior was preserved.
- `npm run lint` passed.
- `npm run format:check` passed.
- `npm test` passed all 90 selected default test files under Node v20.20.2. `npm ci` warned that the package declares Node >=24.0.0, but the suite completed successfully in the available local environment.
