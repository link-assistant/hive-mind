# Case study — issue #2166

> "It was not possible to stop the task on `/codex` queue as well as it was not possible to see telegram message"
> — [link-assistant/hive-mind#2166](https://github.com/link-assistant/hive-mind/issues/2166), opened 2026-08-21T16:37:20Z

Two `/stop` commands issued by the chat owner did nothing visible: the queued task
_was_ cancelled server-side, but every message the bot tried to send about it was
rejected by Telegram, so from the chat's point of view the stop simply failed.
This document reconstructs what happened byte by byte, lists every requirement the
issue raises, gives the root cause of each, and records the solution that shipped
in [PR #2167](https://github.com/link-assistant/hive-mind/pull/2167).

## Contents

| Path                                    | What it holds                                                       |
| --------------------------------------- | ------------------------------------------------------------------- |
| `README.md`                             | This analysis.                                                      |
| `logs/excerpt-first-failure.log`        | Verbatim production log around update `957727704` (first `/stop`).  |
| `logs/excerpt-second-failure.log`       | Verbatim production log around update `957727705` (second `/stop`). |
| `data/issue-2166.json`                  | Issue body/metadata as returned by `gh issue view`.                 |
| `data/issue-2166-comments.json`         | Issue comments (empty — the report is a single body).               |
| `screenshots/*.png`                     | The three screenshots attached to the issue.                        |
| `experiments/reproduce-byte-offset.mjs` | Minimal reproduction of the exact 400, offline.                     |
| `upstream-telegraf-2096.md`             | Text of the upstream bug report filed against telegraf.             |

## 1. Timeline

All timestamps are from the bot's production log (`[VERBOSE]` lines quoted verbatim
from `logs/`); the surrounding session entries are stamped `2026-08-21T16:24:37Z`.

| #   | Event                                                                                                                                                                                                                                                                                                      | Evidence                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | `@surrogate-tm` posts `/codex https://github.com/Surrogate-TM/save_visiogetbb/pull/18#issuecomment-5370631063`.                                                                                                                                                                                            | `screenshots/cb22d23e-….png`      |
| 2   | The bot queues it and echoes a card: `Pull request: https://…/pull/18#issuecomment-5370631063`, `Requested by: @surrogate\_tm`. The echoed URL keeps the comment anchor the bot did **not** interpret, and the mention shows a literal backslash.                                                          | same screenshot                   |
| 3   | The chat owner replies `/stop` to that card. Update `957727704`.                                                                                                                                                                                                                                           | `screenshots/8ece675e-….png`      |
| 4   | `/stop` resolves the URL, finds no live session, finds the queued item and **cancels it successfully**: `/stop: cancelled queued item solve-1787323853066-0ps1eet`.                                                                                                                                        | `logs/excerpt-first-failure.log`  |
| 5   | Editing the queue card fails: `[ERROR] /stop: failed to update queue card for cancellation: 400: Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 54`. Logged, swallowed.                                                                                           | same                              |
| 6   | The confirmation `🗑 Removed queued task for https://…` fails the same way at **byte offset 65** and escapes as an unhandled rejection — Telegraf's global error handler answers with the generic _"Telegram rejected a formatted bot message, and the fallback handler could not recover automatically."_ | same                              |
| 7   | The owner replies `/stop` again. Update `957727705`. The item is already gone, so the lookup returns `not-found`.                                                                                                                                                                                          | `logs/excerpt-second-failure.log` |
| 8   | The "no task found" message fails at **byte offset 79**; same generic error card. The owner concludes the stop never worked.                                                                                                                                                                               | same                              |
| 9   | Separately, `/fix --ci-de <repo> --think medium` is accepted despite `--ci-de` not existing; the bot's own echo prints `Options: --ci-de --think medium --ci-cd`.                                                                                                                                          | `screenshots/2ad4e94a-….png`      |

The task **was** stopped at step 4. Every symptom the issue reports downstream of
that is a _reporting_ failure, not a control failure.

## 2. Root causes

### 2.1 The 400 itself — one unpaired `_` in a GitHub URL

The payloads are in the log verbatim. Reproduced offline in
`experiments/reproduce-byte-offset.mjs`:

```
'🗑 Removed queued task for https://github.com/Surrogate-TM/save_visiogetbb/pull/18#issuecomment-5370631063 from `codex` queue.'
                                                                  ↑ byte 65
'ℹ️ No queued or running task found for https://github.com/Surrogate-TM/save_visiogetbb/pull/18#issuecomment-5370631063.'
                                                                          ↑ byte 79
```

`Buffer.indexOf('_')` on those two strings returns exactly **65** and **79** — the
offsets Telegram reported. The repository name `save_visiogetbb` contains a single
`_`; under `parse_mode: 'Markdown'` that opens an italic entity which is never
closed, and TDLib answers `Can't find end of the entity starting at byte offset N`
(offsets are _byte_ offsets, not code points — the emoji prefixes account for the
difference between the two messages).

So: **any repository, branch or user name containing an odd number of underscores
turned an ordinary status message into an invisible one.** This is not exotic — it
is the default naming style on GitHub.

### 2.2 Why the fallback did not save it

A plain-text fallback already existed (`installTelegramFormattingFallback`), but it
was installed on `bot.telegram` only. Telegraf 4.16.3 constructs a **new** `Telegram`
instance for every update:

```js
// telegraf/lib/telegraf.js:228
const tg = new telegram_1.default(this.token, this.telegram.options, webhookResponse);
const ctx = new TelegrafContext(update, tg, this.botInfo);
```

`ctx.telegram !== bot.telegram`, so patching the bot instance protected exactly
nothing inside a command handler. That is the single reason the user saw
_"the fallback handler could not recover automatically"_ instead of a plain-text
message. Reported upstream — see §5.

### 2.3 Why the failure was invisible in the logs too

The only trace was a generic `[ERROR] … failed to update queue card`. There was no
record of _what_ was sent, with which `parse_mode`, to which chat, or whether a
retry happened — so a maintainer reading the log could not tell a formatting bug
from a network blip without reconstructing the payload by hand (which is what this
case study had to do).

### 2.4 Over-escaping (`@surrogate\_tm`)

`buildUserMention` backslash-escaped `_` and `*` inside the _label_ of a
`[label](url)` entity. TDLib's `parse_markdown()` only unescapes `\_ \* \` \[` at
the **top level**; once inside an entity it copies bytes verbatim until the closing
delimiter:

```cpp
// tdlib/td/telegram/MessageEntity.cpp — parse_markdown()
while (i < size && text[i] != end_character) { … text[result_size++] = text[i++]; }
```

Hence the backslash rendered literally. The escaping was cargo-culted from the
top-level case; it was never needed inside the entity, and it is what makes the
output look unpolished. Only `[` and `]` are genuinely dangerous there (they
terminate the entity early).

### 2.5 Echoed URL ≠ interpreted URL

The bot echoed the raw text it received, including `#issuecomment-5370631063`,
while it actually operated on the pull request. Showing input the bot did not
interpret is what made the owner unsure whether `/stop` had even matched the right
target.

### 2.6 `/fix` accepted `--ci-de`

`/fix` built its argv and spawned a work session without ever validating the
option vocabulary; unknown flags were forwarded and ignored. A one-character typo
therefore produced a full, expensive, silently-wrong run.

## 3. Requirements → root cause → shipped solution

| #   | Requirement (issue wording, condensed)                                                      | Root cause                                     | Solution in PR #2167                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | All sends through one function; fallback to plain text on any issue; log every sent message | §2.2, §2.3                                     | `src/telegram-safe-reply.lib.mjs` is the single funnel: pre-send validation, `[telegram-send] s<N> <scope>` audit log for attempt/success/rejection, chunking at 4096, plain-text retry on any `400`. `installTelegramContextSafety` re-installs it on **every per-update `ctx.telegram`**. |
| R2  | Verify early/statically so unsendable text cannot be produced                               | §2.1                                           | `src/telegram-markdown-validator.lib.mjs` ports TDLib's `parse_markdown()` so a bad entity is caught _before_ the API call, plus the custom ESLint rule `eslint-rules/no-unsafe-telegram-send.mjs` (scoped to `src/**`) which makes a raw `parse_mode` send a **build error**.              |
| R3  | Echo only the input actually interpreted                                                    | §2.5                                           | Canonical URL rebuilt from the parsed target (`src/github-url-parser.lib.mjs`); the `#issuecomment-…` anchor is dropped from the echo.                                                                                                                                                      |
| R4  | Stop over-escaping `_`                                                                      | §2.4                                           | `escapeMarkdownEntityLabel` now strips only `[`/`]` and leaves `_`/`*` alone (`src/buildUserMention.lib.mjs`).                                                                                                                                                                              |
| R5  | The chat owner must be able to fully stop any task                                          | §2.1–2.2 (the stop worked; the report did not) | Every `/stop` reply and queue-card edit goes through the funnel, so the outcome is always visible; `updateQueueCardForCancellation` lost its raw-send fallback branch.                                                                                                                      |
| R6  | `/fix` must fail immediately on any unsupported option                                      | §2.6                                           | `validateFixCommandOptions` runs before any session is spawned: malformed-flag detection, Levenshtein suggestions over `FIX_OWN_OPTIONS`, and a strict `solve` yargs probe.                                                                                                                 |
| R7  | Use the common logic in _all_ Telegram commands                                             | §2.2                                           | 52 raw send sites across 14 modules migrated to the funnel; the ESLint rule prevents regression.                                                                                                                                                                                            |
| R8  | Compile logs/data and do a deep case study                                                  | —                                              | This directory.                                                                                                                                                                                                                                                                             |
| R9  | Add debug output / verbose mode where data was missing                                      | §2.3                                           | The send audit log (with `verbose` payload previews and byte-offset/context on validation failure) is on by default for attempt/reject lines.                                                                                                                                               |
| R10 | File issues upstream with repro + workaround + fix suggestion                               | §2.2                                           | See §5.                                                                                                                                                                                                                                                                                     |
| R11 | Apply the fix across the whole codebase                                                     | §2.2                                           | Covered by R7 + the lint rule; captions (`replyWithDocument`) were the last uncovered path and now go through `buildSafeCaptionOptions`/`safeReplyWithDocument`/`safeSendDocument`.                                                                                                         |

## 4. Existing components and libraries considered

| Option                                                                                                              | Verdict                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `parse_mode: 'MarkdownV2'` everywhere                                                                               | Does not help by itself: MarkdownV2 escaping requirements are _stricter_ (`_*[]()~`>#+-=                                                                                                                        | {}.!`), so an unescaped URL fails there too. Used only where the message is fully constructed by us. |
| `entities` / `caption_entities` instead of `parse_mode`                                                             | The structurally correct long-term answer — offsets are computed, nothing is parsed — but it is a rewrite of every message template. Recorded as a follow-up, not done here.                                    |
| `telegramify-markdown`, `node-telegram-bot-api`'s escape helpers, Telegraf's `Format` (`fmt`/`bold`/`code`) helpers | All _produce_ safe text; none of them _verify_ arbitrary already-built text before sending, which is what R2 asks for. Telegraf's `Format` is the closest and is worth adopting incrementally for new messages. |
| TDLib `parse_markdown()` (`td/telegram/MessageEntity.cpp`)                                                          | Adopted as the specification: our validator is a direct port of its rules, so "valid for us" means "valid for the same parser the server runs".                                                                 |
| Generic retry middlewares (`telegraf-throttler` etc.)                                                               | Handle 429/network, not 400 formatting errors. A 400 is never a partial delivery, which is precisely why our plain-text retry is safe.                                                                          |

## 5. Upstream report

Telegraf's per-update `new Telegram(...)` (`lib/telegraf.js:228`) means any
instrumentation applied to `bot.telegram` — logging, retry, rate limiting,
formatting fallback — is silently absent inside handlers, where `ctx.telegram` is a
different object. Filed against `telegraf/telegraf` with the reproduction above,
the middleware workaround we ship in `src/telegram-context-safety.lib.mjs`, and a
suggested fix (reuse the bot's `Telegram` instance unless a `webhookResponse` is
present, derive it from `this.telegram` so wrappers survive, or expose a documented
`onTelegramCreated` hook):

**[telegraf/telegraf#2096](https://github.com/telegraf/telegraf/issues/2096)** —
_"ctx.telegram is a different Telegram instance than bot.telegram, so instrumentation
applied at startup silently never runs"_. The filed text is archived here as
`upstream-telegraf-2096.md`; the runnable reproduction is
`experiments/telegraf-per-update-telegram-instance.mjs` in the repository root.
A 2021 request to reuse the instance ([#1358](https://github.com/telegraf/telegraf/issues/1358))
was closed without discussion.

## 6. Regression tests

| Test                                                | Guards                                                                                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/test-telegram-context-safety-issue-2166.mjs` | The funnel is installed on every per-update context; the exact `save_visiogetbb` payload falls back to plain text instead of throwing. |
| `tests/test-issue-2166-command-hardening.mjs`       | Canonical URL echo (R3), unescaped mention labels (R4), strict `/fix` options (R6).                                                    |
| `tests/test-telegram-send-funnel-issue-2166.mjs`    | `safeSendMessage` fallback, caption validation/truncation, and the ESLint rule itself (R1, R2, R11).                                   |
