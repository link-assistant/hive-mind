# Issue 1783 Case Study: /stop Command Fixes and Improvements

## Summary

Issue #1783 reports two defects in the existing `/stop` command (delivered in PRs #1737 for `/stop <UUID>`, #1781 for `/stop <url>`, and #1551 for the chat-level `/stop`):

1. **Queue card not refreshed on cancel.** When a user replied to a queue card with `/stop`, the matching item was removed from the in-memory `SolveQueue` but the original "⏳ Waiting (claude queue #N)" Telegram message was never edited, leaving stale state visible to all chat members.
2. **Task requesters cannot stop their own tasks.** `/stop <UUID>` and `/stop <url>` were locked to the chat creator. PR #1779 (issue #1778) had already established the pattern of also authorizing the original task requester for `/terminal_watch` and `/watch`; that pattern was missing here.

The issue additionally asks for a deep case study under `docs/case-studies/issue-1783/`, with all source data and reproducible examples preserved in the repository.

- Issue: <https://github.com/link-assistant/hive-mind/issues/1783>
- Fix PR: <https://github.com/link-assistant/hive-mind/pull/1784>

## Collected Data

- `data/issue.json`: issue metadata, body, timestamps, labels, comments.
- `data/issue-1780-stop-by-url.json`: upstream issue that introduced `/stop <url>` — context for the queue-card behavior.
- `data/pr-1779-watch-requester.json`: the PR that authorized task requesters for `/terminal_watch`; the model we mirror here.
- `data/pr-1781-stop-by-url.json`: PR that landed `/stop <url>` (where the queue card update was forgotten).
- `data/pr-1784.json`: the active fix PR for this issue.
- `data/main-recent-commits.txt`: recent commits on `main` for chronological context.
- `assets/stop-task-message.png`: screenshot from the issue body — user replies `/stop` to a queue card.
- `assets/queue-status-not-updated.png`: screenshot showing the queue card was NOT updated after the cancel.
- `assets/owner-only-restriction.png`: screenshot showing the previous "only available to the chat owner" rejection for a non-owner requester.

## Timeline of Events

1. **2026-04-19** — Issue #1080 lands `/stop` as a chat-level pause for new tasks (PR #1081). No per-task targeting yet.
2. **2026-05-04** — Issue #524 lands `/stop <UUID>` so the chat owner can interrupt an isolated solve session via `start-command --stop`. Authorization is chat-owner-only (`getChatMember().status === 'creator'`).
3. **2026-05-09** — Issue #1780 lands `/stop <url>` so the chat owner can cancel a queued task or interrupt a running isolated task by replying to the queue card with `/stop` (PR #1781). `SolveQueue.cancel(id)` removes the item but the queue card on Telegram is never edited.
4. **2026-05-10** — Issue #1778 lands authorization-by-requester for `/terminal_watch` and `/watch` (PR #1779, commit `c2c51faa`). Introduces `isTerminalWatchSessionRequester({ sessionInfo, userId })` as the reference pattern.
5. **2026-05-11** — Issue #1783 filed with screenshots showing (a) the stale queue card and (b) the owner-only rejection for a task requester. Resolution work begins on branch `issue-1783-da3ec60ac57c` / PR #1784.

## Requirements

1. **Queue card update on cancel.** When `/stop` cancels a queued item via the URL or reply path, the original "⏳ Waiting (… queue #N)" Telegram message must be updated immediately to reflect the cancellation. Source: screenshot 1 + 2 in the issue body.
2. **Requester-authorized /stop.** The user who originally ran `/solve` or `/hive` for the task must be able to `/stop` that task (by UUID or by URL), without being the chat creator, in the same way `/terminal_watch` and `/watch` allow it. Source: screenshot 3 in the issue body referencing `/terminal_watch` and `/watch`.
3. **Deep case study.** Download issue data, reconstruct the timeline, list requirements, identify root causes, propose solution options, and write the analysis under `docs/case-studies/issue-1783/`. Source: trailing paragraph of the issue body.
4. **Reproducible examples.** Each requirement must have a reproducible example (or test) showing the bug before the fix and the desired behavior after.
5. **Single PR.** All work in one pull request (PR #1784 on branch `issue-1783-da3ec60ac57c`).

## Root Causes

### Requirement 1 — Stale queue card

`SolveQueueItem` stores the coordinates of the Telegram queue card in `item.messageInfo = { chatId, messageId }` (see `src/telegram-solve-queue.lib.mjs:64`). The queue consumer uses `updateItemMessage()` to edit that message as the item transitions through `WAITING → STARTING → STARTED`. After `STARTED` the queue clears `messageInfo` so nothing else edits the card.

`SolveQueue.cancel(id)` (`src/telegram-solve-queue.lib.mjs:292`) removes the item from the per-tool queue and calls `item.setCancelled()`, but it does NOT call `updateItemMessage()` for it. The `/stop` dispatcher (`src/telegram-start-stop-command.lib.mjs`, `cancel-queued` branch) then sends a fresh ack reply (`🗑 Removed queued task for …`) but also forgets to edit the original card.

Net effect: the queue card on Telegram is left showing `⏳ Waiting (claude queue #N)` indefinitely even though the item has been removed from the queue and will never start.

### Requirement 2 — Owner-only restriction

`authorizeTargetedStop()` (`src/telegram-start-stop-command.lib.mjs:265` before the fix) required `member.status === 'creator'` for both the UUID and URL flows. There was no fallback to the original task requester even though:

- `SolveQueueItem.requesterUserId` is already populated from `options.ctx?.from?.id` (`src/telegram-solve-queue.lib.mjs:51`).
- `session-monitor.lib.mjs` already records `requesterUserId` inside `sessionInfo` (`src/telegram-command-execution.lib.mjs:111-112`).
- `isTerminalWatchSessionRequester({ sessionInfo, userId })` already implements the comparison for `/terminal_watch` (`src/telegram-terminal-watch-command.lib.mjs:174-178`).

The pattern was simply not applied to `/stop`.

## Related Local Components

- `src/telegram-start-stop-command.lib.mjs`: `/stop` dispatcher and authorization (the file we modify).
- `src/telegram-solve-queue.lib.mjs`: `SolveQueueItem.messageInfo`, `SolveQueueItem.requesterUserId`, `SolveQueue.cancel`, `SolveQueue.updateItemMessage`.
- `src/telegram-terminal-watch-command.lib.mjs`: reference pattern `isTerminalWatchSessionRequester` and the dual-path authorization for `/terminal_watch`.
- `src/session-monitor.lib.mjs`: `getTrackedSessionInfo(sessionName)` exposes `requesterUserId` for UUID-targeted `/stop`.
- `src/telegram-command-execution.lib.mjs`: wires `requesterUserId` into the tracked session info at session start.
- `src/telegram-bot.mjs`: sets `queueItem.messageInfo = { chatId, messageId }` on the queue card right after posting it.

## Online Research

- Telegram Bot API: `editMessageText` documents that editing a message also accepts `chat_id` and `message_id`, which is exactly the pair stored in `SolveQueueItem.messageInfo`. See <https://core.telegram.org/bots/api#editmessagetext>.
- Telegram Bot API: `chatmemberowner` confirms `'creator'` is the correct status value for the chat owner. See <https://core.telegram.org/bots/api#chatmemberowner>.
- The Telegram Bot API docs note that edits to a message older than 48 hours are not allowed (the `can_edit_messages` window). Our `/stop` flow operates on messages that the bot just posted; this is well within the 48 h window, so the edit cannot fail for that reason in practice. See <https://core.telegram.org/bots/api>.

## Solution Options

### Requirement 1 — Queue card update

**Option A (selected)** — In the `/stop` dispatcher, edit the original queue card via `item.ctx.telegram.editMessageText(...)` using `item.messageInfo` right after the cancel succeeds. Best-effort: log and swallow errors (the card may already have been cleared by the consumer); always send the regular ack reply on top.

- Pros: minimal blast radius; localized to `/stop` where the user already expects feedback; matches the cancel path used by `SolveQueue.updateItemMessage`.
- Cons: duplicates a small slice of `updateItemMessage`. We accept this so `SolveQueue.cancel(id)` stays a pure mutation.

**Option B** — Make `SolveQueue.cancel(id)` itself edit the card. Pros: any future caller would benefit. Cons: `cancel(id)` would acquire side effects on Telegram, which would be surprising for batch test code; widens the testing surface of the queue.

**Option C** — Return the item from `cancel(id)` and let the caller decide whether to edit. Pros: composable. Cons: changes the API used by other callers.

Option A is the smallest change that satisfies the requirement.

### Requirement 2 — Requester authorization

**Option A (selected)** — Mirror `isTerminalWatchSessionRequester`: add `isStopTargetRequester({ userId, queueItem, sessionInfo })`, and in `authorizeTargetedStop` allow the user through when they match the requester of the queue item (URL flow) or of the tracked session (UUID flow). Fall back to the existing chat-owner check otherwise.

- Pros: mirrors `/terminal_watch` (already shipped, well understood); reuses fields the codebase already populates; preserves owner access to all tasks.
- Cons: the URL flow now needs to look the queue item up BEFORE authorization rather than as part of cancellation. We refactor `resolveQueueLookupForUrl` into a non-mutating `findQueueCandidateForUrl` plus an unchanged resolver.

**Option B** — Drop owner-only entirely and let any group member `/stop` any task. Pros: simplest. Cons: too broad; not what the issue asks for; allows trolling.

**Option C** — Add a separate command (e.g., `/stop_mine`) for requesters. Pros: leaves `/stop` semantics intact. Cons: doesn't match the issue's explicit ask of making `/stop` behave like `/terminal_watch`.

Option A is the smallest change that satisfies the requirement.

## Implemented Solution

In `src/telegram-start-stop-command.lib.mjs`:

- Exported `updateQueueCardForCancellation(item, url, tool, stopperName)` — best-effort edit of the queue card using `item.messageInfo` and `item.ctx.telegram.editMessageText`. Clears `item.messageInfo` after success so nothing else tries to edit a terminal card.
- Exported `isStopTargetRequester({ userId, queueItem, sessionInfo })` — string-compares `userId` against `queueItem.requesterUserId` and `sessionInfo.requesterUserId`. Mirrors `isTerminalWatchSessionRequester`.
- Refactored `resolveQueueLookupForUrl` into `findQueueCandidateForUrl` (no mutation) + `resolveQueueLookupForUrl` (cancellation). The dispatcher now calls `findQueueCandidateForUrl` BEFORE authorization so the requester check has access to `queueItem.requesterUserId`.
- Updated `authorizeTargetedStop(ctx, label, { queueItem, sessionInfo })`:
  - Private DM → allowed (unchanged).
  - Group chat → allowed when the user is the task requester (`isStopTargetRequester`) OR the chat creator.
  - Rejection message now reads "only available to the chat owner or the user who started this task" to communicate the new behavior.
- UUID dispatcher: looks `sessionInfo` up via `getTrackedSessionInfo(sessionId)` before auth (test-injectable via `options.getTrackedSessionInfo`). Lookup failures fall back to the chat-owner check.
- URL dispatcher: looks `queueItem` up via `findQueueCandidateForUrl(url)` before auth; after auth, `resolveQueueLookupForUrl(url)` performs the actual cancel as before.
- On `cancel-queued`, the dispatcher calls `updateQueueCardForCancellation(...)` BEFORE sending the regular ack reply.

In `tests/`:

- Added `tests/test-issue-1783-stop-improvements.mjs` with 40 unit assertions:
  - `isStopTargetRequester` correctness (7 assertions).
  - `updateQueueCardForCancellation` happy path and failure modes (12 assertions).
  - `/stop <url>` cancel-queued path edits the queue card and still posts the ack (9 assertions).
  - `/stop <url>` requester-vs-owner-vs-stranger in groups (6 assertions).
  - `/stop <UUID>` requester-vs-owner-vs-stranger in groups + tolerates `getTrackedSessionInfo` errors (6 assertions).

The existing tests (`test-issue-1780-stop-by-url.mjs` 29/29, `test-issue-524-stop-uuid.mjs` 25/25) still pass without modification because the new error message "only available to the chat owner or the user who started this task" still contains the substring "only available to the chat owner" that the old assertions check for.

## Reproducible Examples

### Bug 1 — stale queue card

Before this fix, executing `/stop` as a reply to a "⏳ Waiting (claude queue #3)" card would:

1. Remove the matching item from the in-memory `SolveQueue` (correct).
2. Reply with `🗑 Removed queued task for <url>.` (correct).
3. Leave the original card unchanged (bug).

After this fix, step 3 also edits the original card to `🗑 *Cancelled*\n\n<url>\n\nRemoved from \`claude\` queue by @user via /stop.`.

The dispatcher-level test that exercises this is in `tests/test-issue-1783-stop-improvements.mjs` under `--- /stop <url> updates the queue card on cancel-queued ---`. Without the fix, the `queueCardEdits` array stays empty.

### Bug 2 — requester rejected

Before this fix, in a group chat where `@alice` was the chat creator and `@bob` had run `/solve <url>`:

- `@alice` running `/stop <url>` → allowed.
- `@bob` running `/stop <url>` → rejected with "❌ /stop <URL> is only available to the chat owner."

After this fix:

- `@alice` running `/stop <url>` → still allowed (chat owner fallback unchanged).
- `@bob` running `/stop <url>` → allowed because `queueItem.requesterUserId === @bob.id`.

The dispatcher-level test that exercises this is in `tests/test-issue-1783-stop-improvements.mjs` under `--- /stop <url>: requester can stop their own task in a group ---`. Without the fix, `queue.cancelCalls` stays empty and the rejection reply is sent.

## Verification

- `node tests/test-issue-1783-stop-improvements.mjs`: 40 passed, 0 failed.
- `node tests/test-issue-1780-stop-by-url.mjs`: 29 passed, 0 failed (no change).
- `node tests/test-issue-524-stop-uuid.mjs`: 25 passed, 0 failed (no change).

## Upstream Reporting

No external project requires a bug report for this issue; both root causes are local to this repository (`src/telegram-start-stop-command.lib.mjs` and the SolveQueue ↔ /stop interaction).
