# Case Study — Issue #1922: Forwarded `/task` (and other commands) re-executed by the Telegram bot

- **Issue:** [#1922](https://github.com/link-assistant/hive-mind/issues/1922) — _"When /task command is forwarded, it should not be executed again by our telegram bot, double check the same for all other commands"_
- **Type:** Bug
- **Pull request:** [#1923](https://github.com/link-assistant/hive-mind/pull/1923)
- **Author:** @konard
- **Status at analysis:** Open

Raw issue data and the original screenshot are archived under [`data/`](./data/).

---

## 1. Summary

When a Telegram message whose text **starts with a bot command** is _forwarded_
into a chat where the bot is active, the bot executed the command again. The
issue screenshot shows `/task https://github.com/link-assistant/formal-ai`
messages being forwarded and the bot reacting to each one by **creating a new
GitHub issue** ("Created GitHub issue: …/issues/454", "…/issues/463"). The user
never intended to launch those tasks — they were just forwarding the bot's
earlier replies around.

The reporter asked us to (a) stop `/task` from being re-executed when forwarded,
and (b) **double-check the same for all other commands**.

---

## 2. Timeline / sequence of events (reconstructed from the screenshot)

1. A user runs `/task https://github.com/link-assistant/formal-ai` (legitimately).
2. The bot creates a GitHub issue and replies with a message that itself begins
   with the forwarded `/task <url>` text and a "Created GitHub issue: … Reply to
   this message with /solve to start a solution." footer.
3. That message (or the original `/task …` message) is **forwarded** within the
   chat — visible in the screenshot as repeated, identical `/task` blocks.
4. For **each forwarded copy**, the bot's `/task` handler ran again and created a
   _new_ GitHub issue (issues #454, #463, …), because the handler had no guard
   against forwarded messages.

---

## 3. Requirements extracted from the issue

| #   | Requirement                                                                                            | Addressed                                                                             |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| R1  | A forwarded `/task` command must **not** be executed again                                             | ✅                                                                                    |
| R2  | Double-check & fix the same problem for **all other commands**                                         | ✅ (full audit below)                                                                 |
| R3  | If there isn't enough data to find the root cause, add debug output / verbose mode                     | ✅ verbose logging exists and was extended (`isForwarded` logs each forwarding field) |
| R4  | Compile issue logs/data into `docs/case-studies/issue-1922`                                            | ✅ ([`data/`](./data/))                                                               |
| R5  | Reconstruct timeline, list requirements, find root cause, propose solutions, check existing components | ✅ (this document)                                                                    |
| R6  | Apply the fix across the **entire** codebase (all affected places)                                     | ✅ (5 command modules + 1 refactor)                                                   |
| R7  | If related to another repository, file reproducible issues there                                       | ⚪ N/A — the defect is entirely inside this repo's Telegram bot                       |

---

## 4. Root-cause analysis

### 4.1 The mechanism

Telegram delivers forwarded messages with the **same `text`** as the original,
plus metadata identifying the forward:

- **New Bot API (≥ 7.0):** `message.forward_origin` (an object with a `.type` of
  `user` / `hidden_user` / `chat` / `channel`).
- **Legacy fields:** `forward_from`, `forward_from_chat`, `forward_from_message_id`,
  `forward_signature`, `forward_sender_name`, `forward_date`.

Because the text is identical, Telegraf's entity-based `bot.command()` (and the
text-based fallback from #1207) match the forwarded copy exactly like a freshly
typed command — so the handler runs unless it explicitly checks the forward
metadata.

### 4.2 Why `/task` specifically was vulnerable

The repo already had a filter, `isForwardedOrReply(ctx)`
(`src/telegram-message-filters.lib.mjs`), and most commands used it
(`/help`, `/limits`, `/version`, `/hive`, `/merge`, `/top`, `/language`,
`/subscribe`, `/accept-invites`, `/auth`, `/solve_queue`, `/start`).

But `isForwardedOrReply` returns `true` for **both** forwards **and** replies.
Several commands deliberately rely on the **reply** feature:

- `/task` — reply to a message containing repo/issue text to create an issue (#1916).
- `/solve` — reply to a message containing a GitHub URL to extract it (#1325).
- `/stop` — reply to a queue card to target a session (#524, #1780).

Those commands therefore _could not_ call `isForwardedOrReply` without breaking
replies. The consequence:

- `/solve` grew an **ad-hoc inline** forwarded-only check.
- `/task` / `/split` had **no forwarded check at all** → the reported bug.
- `/tokens`, `/log`, `/terminal_watch` / `/watch` also had **no forwarded check**
  (only `isOldMessage`).
- Targeted `/stop <uuid>` / `/stop <url>` ran _before_ the forwarded/reply
  rejection, so a forwarded targeted `/stop` could also execute.

**Root cause:** the absence of a _forwarded-only_ filter forced a false choice
between "block replies too" and "block nothing", and `/task` (plus a few others)
ended up in the "block nothing" bucket.

---

## 5. The fix

### 5.1 New dedicated filter — `isForwarded(ctx)`

Added to `src/telegram-message-filters.lib.mjs`. It detects **only** forwarded
messages (both the new `forward_origin.type` API and all legacy `forward_*`
fields) and **ignores replies**, so the reply feature keeps working.
`isForwardedOrReply` was refactored to delegate its forwarding detection to
`isForwarded`, keeping the logic in exactly one place.

### 5.2 Applied everywhere a forwarded command could execute

| Command(s)                     | File                                      | Before                              | After                                         |
| ------------------------------ | ----------------------------------------- | ----------------------------------- | --------------------------------------------- |
| `/task`, `/split`              | `telegram-task-command.lib.mjs`           | no forward guard                    | `isForwarded` guard (replies preserved)       |
| `/solve`, `/agent`, …          | `telegram-bot.mjs`                        | inline ad-hoc forward check         | reuse `isForwarded`                           |
| `/stop` (incl. `/stop <uuid>`) | `telegram-start-stop-command.lib.mjs`     | targeted modes ran before the guard | early `isForwarded` guard (replies preserved) |
| `/tokens`                      | `telegram-tokens-command.lib.mjs`         | only `isOldMessage`                 | + `isForwarded` guard                         |
| `/log`                         | `telegram-log-command.lib.mjs`            | only `isOldMessage`                 | + `isForwarded` guard                         |
| `/terminal_watch`, `/watch`    | `telegram-terminal-watch-command.lib.mjs` | only `isOldMessage`                 | + `isForwarded` guard                         |

`isForwarded` is threaded through the shared `sharedCommandOpts` object in
`telegram-bot.mjs`, so every command module receives it.

### 5.3 Full command audit (R2 / R6)

| Command                        | Forwarded-protected? | Via                                               |
| ------------------------------ | -------------------- | ------------------------------------------------- |
| `/help`, `/limits`, `/version` | ✅ (already)         | `isForwardedOrReply`                              |
| `/hive`                        | ✅ (already)         | `isForwardedOrReply`                              |
| `/merge`                       | ✅ (already)         | `isForwardedOrReply`                              |
| `/top`                         | ✅ (already)         | `isForwardedOrReply`                              |
| `/language`                    | ✅ (already)         | `isForwardedOrReply`                              |
| `/subscribe`, `/unsubscribe`   | ✅ (already)         | `isForwardedOrReply`                              |
| `/accept-invites`              | ✅ (already)         | `isForwardedOrReply`                              |
| `/auth`                        | ✅ (already)         | `isForwardedOrReply`                              |
| `/solve_queue`, `/queue`       | ✅ (already)         | `isForwardedOrReply`                              |
| `/start`                       | ✅ (already)         | `isForwardedOrReply` (via `validateOwnerCommand`) |
| `/solve`, `/agent`, …          | ✅ (refactored)      | `isForwarded`                                     |
| `/task`, `/split`              | ✅ **(fixed)**       | `isForwarded`                                     |
| `/stop`                        | ✅ **(fixed)**       | `isForwarded`                                     |
| `/tokens`                      | ✅ **(fixed)**       | `isForwarded`                                     |
| `/log`                         | ✅ **(fixed)**       | `isForwarded`                                     |
| `/terminal_watch`, `/watch`    | ✅ **(fixed)**       | `isForwarded`                                     |

The text-based command fallback (`bot.on('message', …)`, #1207) routes to the
same handlers, so it inherits the guards automatically.

---

## 6. Reproduction

**Manual (real bot):**

1. In a group with the bot, send `/task https://github.com/owner/repo` and let it
   create an issue.
2. Forward that message (or any message starting with `/task <repo-url>`) back
   into the same chat.
3. **Before the fix:** the bot creates a _second_ GitHub issue.
   **After the fix:** the forwarded message is silently ignored.

**Automated:** see Section 7.

---

## 7. Tests

- `tests/test-telegram-message-filters.mjs` — new `isForwarded()` suite: true for
  new/legacy forward fields, **false for genuine replies** (the regression guard
  that keeps the reply feature alive) and for empty `forward_origin: {}` (#493).
- `tests/test-telegram-task-command.mjs` — `handleTaskCommand` ignores forwarded
  `/task` and `/split` (no issue created, no execution) while a non-forwarded
  `/task` still creates an issue.

All telegram suites pass; `eslint` and `prettier` are clean.

---

## 8. Existing components reused (R5)

No new library was needed. The fix reuses the project's own filtering module
(`telegram-message-filters.lib.mjs`) and the established `sharedCommandOpts`
dependency-injection pattern, matching how `isOldMessage` / `isForwardedOrReply`
are already wired into every command handler. This keeps a single source of truth
for forwarding detection and avoids the ad-hoc inline check that `/solve`
previously carried.

---

## 9. Files changed

- `src/telegram-message-filters.lib.mjs` — add `isForwarded`, refactor `isForwardedOrReply`.
- `src/telegram-bot.mjs` — import/wire `isForwarded`, add to `sharedCommandOpts`, refactor `/solve`.
- `src/telegram-task-command.lib.mjs` — guard `/task` and `/split`.
- `src/telegram-start-stop-command.lib.mjs` — guard `/stop` (incl. targeted modes).
- `src/telegram-tokens-command.lib.mjs` — guard `/tokens`.
- `src/telegram-log-command.lib.mjs` — guard `/log`.
- `src/telegram-terminal-watch-command.lib.mjs` — guard `/terminal_watch` / `/watch`.
- `tests/test-telegram-message-filters.mjs`, `tests/test-telegram-task-command.mjs` — new tests.
