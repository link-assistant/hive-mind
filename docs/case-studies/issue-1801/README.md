# Case Study: Issue #1801 — Telegram completion message rejected with "byte offset 318"

- Issue: https://github.com/link-assistant/hive-mind/issues/1801
- PR: https://github.com/link-assistant/hive-mind/pull/1802
- Date reported: 2026-05-14 (commit `bd23bc45`)
- Reporter: @konard
- Related prior fixes: [#1460](https://github.com/link-assistant/hive-mind/issues/1460), [#1497](https://github.com/link-assistant/hive-mind/issues/1497), [#1684](https://github.com/link-assistant/hive-mind/issues/1684), [#1688](https://github.com/link-assistant/hive-mind/issues/1688), [#1788](https://github.com/link-assistant/hive-mind/issues/1788)

## Summary

The Telegram bot tried to edit a work-session completion message and got back:

```
Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 318
```

The bot fell back to plain text (the existing safe-reply path was working as
designed) so users saw a "Formatting error detected. Showing plain text fallback."
banner instead of the formatted message. Most other completions work fine —
this case was special because the upstream repository's slug contained an
underscore (`save_visiogetbb`).

**Root cause:** `appendPullRequestLine()` in `src/work-session-formatting.lib.mjs`
inserted the raw `pullRequestUrl` without running it through `escapeMarkdown()`.
The surrounding `Issue:` line was already escaped (because `telegram-bot.mjs`
escapes the URL when building the info block), so the resulting message had
a single unbalanced `_` at byte offset 318 (the underscore inside
`save_visiogetbb/pull/8`). Telegram's Markdown parser opened an italic entity
that never closed, returning the 400 above.

**Fix:** Escape `pullRequestUrl` through `escapeMarkdown()` before inserting it,
matching what `buildTelegramInfoBlock()` does for the issue URL. Also escape
the URL in the idempotency check so re-calls with the same raw URL still
short-circuit. As a follow-on, the verbose-mode logger now also dumps the
fallback text and a window of bytes around the offset reported by Telegram,
so the next iteration of any similar parse failure can be pinpointed
immediately from the logs.

## Reported observations

From the issue text (verbatim, condensed):

> `formatted Telegram message failed: Bad Request: can't parse entities: Can't
find end of the entity starting at byte offset 318`
>
> Telegram bot log: gist `3d95e92cea56a9b9282f3b441afe4db1` (preserved in
> [`data/hive-telegram-bot.log`](data/hive-telegram-bot.log)).
>
> Trigger:
>
> ```
> /claude https://github.com/Surrogate-TM/save_visiogetbb/issues/7
> ```
>
> Observed Telegram message:
>
> ```
> ⚠️ Formatting error detected. Showing plain text fallback.
>
> ✅ Work session finished successfully
>
> ⏱️ Duration: 9m 21s
> 📊 Session: 58f142b8-344f-44bf-9054-7a648e7212b8
> 🔒 Isolation: screen
>
> Requested by: @surrogatetm (https://t.me/surrogatetm)
> Issue: https://github.com/Surrogate-TM/save_visiogetbb/issues/7
> Pull request: https://github.com/Surrogate-TM/save_visiogetbb/pull/8
>
> 🛠 Options: --tool claude
> 🔒 Locked options: --attach-logs --verbose --no-tool-check --disable-report-issue
> ```

Screenshot preserved at [`data/screenshot.png`](data/screenshot.png).

## Timeline (reconstructed from the log)

All times shown are line offsets in `data/hive-telegram-bot.log`.

| Line          | Event                                                                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–35          | Bot start-up. `Bot start time (ISO): 2026-05-14T20:43:15.000Z`. Solve overrides locked to `--attach-logs --verbose --no-tool-check --disable-report-issue`.                   |
| 98030–98035   | `/claude` command received for `https://github.com/Surrogate-TM/save_visiogetbb/issues/7`; preflight passes.                                                                  |
| 98142         | Bot starts the isolation runner: `$ --isolated screen --detached --session 58f142b8-... -- solve https://github.com/Surrogate-TM/save_visiogetbb/issues/7 --tool claude ...`. |
| 100232–100233 | After 9m 21s the session finishes (exit code 0). Bot logs "Sending notification to chat -1002975819706".                                                                      |
| 100234        | `[VERBOSE] Found linked PR https://github.com/Surrogate-TM/save_visiogetbb/pull/8 for issue Surrogate-TM/save_visiogetbb#7` — `appendPullRequestLine()` will fire next.       |
| 100235        | `[telegram-bot] editMessageText: formatted Telegram message failed: Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 318`.             |
| 100236–100247 | Verbose log dumps the 449-byte failing message. The `Issue:` line is escaped (`save\_visiogetbb`); the `Pull request:` line below it is NOT (`save_visiogetbb`).              |

## Requirements (extracted from the issue)

1. **Find the exact root cause** of the formatting error.
2. **Improve logging if it is insufficient** so the original payload and the
   plain-text fallback we send instead are both fully recorded.
3. **Compile case-study data** into `./docs/case-studies/issue-1801/` and run a
   "deep case study analysis" with timeline, requirement list, root causes,
   and proposed solutions.
4. **Search for known components/libraries** that solve a similar problem.
5. If insufficient data, **add debug output / verbose mode** to help on the next
   iteration.
6. **If the issue relates to another repository, open an upstream issue** with
   reproducible examples, workarounds, and code suggestions.
7. **Execute everything in this single pull request (#1802)**.

## Root-cause analysis

### What Telegram saw

Telegram's "legacy Markdown" parser walks the message looking for `_`, `*`,
`` ` ``, and `[…](…)` entities. Each unescaped `_` toggles an italic entity.
If the parser reaches end-of-text with an entity still open, it returns
`can't parse entities: Can't find end of the entity starting at byte offset N`,
where `N` is the byte offset of the opening character.

### What the bot sent

Verbose log line 100236 quotes the exact payload. Decoding the 449-byte body
character-by-character (Node's `Buffer.from(msg, 'utf-8')`) gives the
underscores at the following byte offsets:

| Byte offset | Char    | Context                                                                                                                                  |
| ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 170         | `\`     | `[@surrogate\_tm](http…`                                                                                                                 |
| 171         | `_`     | …followed-up the backslash (escaped) — paired & fine                                                                                     |
| 198         | `_`     | Inside the `(https://t.me/surrogate_tm)` URL — Telegram treats `(...)` content of a link as opaque, so this does **not** open an entity. |
| 246         | `\`     | `…/save\_visiogetbb/issues/7` — escaped — fine                                                                                           |
| 247         | `_`     | …the underscore that the `\` escapes                                                                                                     |
| **318**     | **`_`** | **`…/save_visiogetbb/pull/8` — UNESCAPED**                                                                                               |

Byte 318 opens an italic entity. There is no second unescaped `_` after it
(the rest of the message is `\n\n🛠 Options: --tool claude\n🔒 Locked options:
--attach-logs --verbose --no-tool-check --disable-report-issue`). The parser
reports `byte offset 318` and rejects the message.

### Why the underscores were inconsistent

The `Issue:` line is built by `buildTelegramInfoBlock()`
(`src/telegram-ui-messages.lib.mjs:11`). Its caller in
`src/telegram-bot.mjs:835` passes `url: escapeMarkdown(normalizedUrl)`, so the
URL has its underscores backslash-escaped before it ever lands in the info
block.

The `Pull request:` line is **not** built there. It is inserted later by
`appendPullRequestLine()` in `src/work-session-formatting.lib.mjs:75`, after
`session-monitor.lib.mjs` resolves the linked PR via
`resolvePullRequestUrlForSession()`. Pre-fix code:

```js
const prLine = `${text(locale, 'telegram.info_pull_request_label', 'Pull request')}: ${pullRequestUrl}`;
```

There is no escape step. So the issue and PR lines have asymmetric encoding,
and any PR URL containing one of the legacy-Markdown special characters (`_`
or `*`) breaks the message.

### Why most messages "just work"

Three properties protected most prior runs:

1. **The active scope is just `_` and `*`** in legacy Markdown — most repo
   slugs do not contain either.
2. **An even number of unescaped underscores** would still parse (they form
   a matched italic pair, even if a chunk of URL gets rendered italic).
3. **The hot path didn't exist until #1688** (`appendPullRequestLine` was
   added on 2026-04-25). Repos that don't auto-link an issue→PR never hit it.

`save_visiogetbb` is the first reported slug to combine "issue→PR link
resolved", "underscore in slug", and "no second underscore later in the
message" — exactly the conditions to expose the asymmetric escaping bug.

## Fix

### Code changes

1. `src/work-session-formatting.lib.mjs`: import `escapeMarkdown` and apply it
   to `pullRequestUrl` when building the `Pull request:` line. Make the
   idempotency check tolerant of both raw and pre-escaped URLs.
2. `src/telegram-safe-reply.lib.mjs`: `logFormattingFailure()` now also logs
   the fallback message and, when Telegram's error message includes a `byte
offset N`, prints a 64-byte window of the original payload around that
   offset so the offending character is obvious in the log.

### Why those, not more

- The `Issue:` line is already escaped at construction time — no change
  needed there.
- A wholesale switch to `MarkdownV2` would force escaping ~18 punctuation
  characters across every existing template and locale (`.`, `-`, `!`, etc.).
  The legacy parser is sufficient if we escape at the right boundary.
- `stripTelegramMarkdown()` (used by the plain-text fallback) already converts
  `\_` back to `_`, so the user-visible plain text is unchanged.

### Tests

`tests/test-issue-1801-pr-url-markdown-escape.mjs` contains 19 assertions
that:

- Reproduce the pre-fix payload and confirm a lightweight legacy-Markdown
  simulator reports `byte offset 318` — the exact wording from Telegram.
- Confirm the post-fix payload from `formatSessionCompletionMessage()` parses
  cleanly.
- Verify `appendPullRequestLine()` is still idempotent when the same URL is
  appended twice (raw or pre-escaped).
- Verify the new verbose log output contains the failing message, the byte
  offset context window, and the fallback message.
- Verify `stripTelegramMarkdown()` unescapes the new `\_` so the plain-text
  fallback still presents the readable URL.

## Solution plan — requirement-by-requirement

| #   | Requirement                                                  | Status                                                                                        |
| --- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 1   | Find the exact root cause                                    | **Done** — see "Root-cause analysis".                                                         |
| 2   | Improve logging of original + fallback                       | **Done** — `logFormattingFailure()` enhanced; tests added.                                    |
| 3   | Compile case-study data under `docs/case-studies/issue-1801` | **Done** — this directory; raw log and screenshot preserved in `data/`.                       |
| 4   | Check existing components/libraries                          | **Done** — see "Library survey" below.                                                        |
| 5   | Add verbose / debug output for next iteration                | **Done** — byte-offset context window now prints in verbose mode.                             |
| 6   | Upstream issue (if related to another repo)                  | **N/A** — this is an internal `appendPullRequestLine()` bug; no upstream library is at fault. |
| 7   | Single PR                                                    | **Done** — PR #1802.                                                                          |

## Library survey (Requirement 4)

The existing internal helpers were the right primitives — we were just
forgetting to call one of them.

- **`escapeMarkdown()` (`src/telegram-markdown.lib.mjs:12`)** — already the
  project-wide escape for legacy Markdown (`_` and `*`). Used by
  `buildTelegramInfoBlock()` for the issue URL. We extend its use to
  `appendPullRequestLine()`.
- **`escapeMarkdownV2()`** — would force escaping ~18 punctuation characters
  across every existing template/locale. Out of scope for a targeted fix.
- **`installTelegramFormattingFallback()`** — already wraps the bot's `sendMessage`
  / `editMessageText`. It worked perfectly here; the only thing missing was
  more diagnostic detail in verbose mode, which we added.
- **Upstream `telegraf`** does not auto-escape user content for `parse_mode:
'Markdown'`; this is the user's responsibility, matching the broader Telegram
  Bot API convention. No upstream defect to file.
- **`telegram-format` / `@grammyjs/parse-mode` / `markdown-escape`** were
  considered. Each adds a dependency without solving anything `escapeMarkdown`
  doesn't already solve. Rejected.

## Reproduction

1. From a clean checkout, run only the regression test:
   ```sh
   node tests/test-issue-1801-pr-url-markdown-escape.mjs
   ```
2. To replay the exact production payload, see the assertions in
   `Reproducing the exact production payload` and `Simulator reproduces and
then resolves the production error` in that test. The simulator returns
   `byte offset 318` for the pre-fix payload — the same wording Telegram
   produced in production line 100235 of `data/hive-telegram-bot.log`.

## References

- Telegram Bot API · formatting options (legacy Markdown): https://core.telegram.org/bots/api#markdown-style
- Telegram Bot API · MarkdownV2 (for reference): https://core.telegram.org/bots/api#markdownv2-style
- Existing parse-mode tests:
  - `tests/test-telegram-safe-reply-issue-1497.mjs`
  - `tests/test-issue-1684-message-formatting.mjs`
  - `tests/test-issue-1688-subscribe-and-pr-link.mjs`
