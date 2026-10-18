# Case study: issue #3505, "CI/CD was not waited as a separate status, instead `Starting` and `Executing` were shown"

- Issue: https://github.com/link-assistant/hive-mind/issues/3505
- Pull request: https://github.com/link-assistant/hive-mind/pull/3507
- Trigger: `/fix --ci-cd https://github.com/konard/voice-simulator --think high` in Telegram, 2026-10-18 11:30 (UTC+7) = 04:30 UTC

## Collected data

| File                                                                                                                                                     | What it is                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`screenshots/shot1.png`](screenshots/shot1.png)                                                                                                         | GitHub commits page of `konard/voice-simulator`: CI/CD of `829bf09` on `main` still running (4 checks in progress)                                                                                                                  |
| [`screenshots/shot2.png`](screenshots/shot2.png)                                                                                                         | The bot's reply right after the command: `⏳ Executing...`, though `/fix` had not started the task yet                                                                                                                              |
| [`screenshots/shot3.png`](screenshots/shot3.png)                                                                                                         | The same reply "after some time": `⚠️ Formatting error detected. Showing plain text fallback.`, the CI wait with a pending list and a timer, the `📝 Issue:` line above the session details                                         |
| [`data/voice-simulator-issue-7.json`](data/voice-simulator-issue-7.json)                                                                                 | The issue `/fix` created (body with the CI/CD table, and its "CI/CD on `main` finished before work started" comment)                                                                                                                |
| [`data/voice-simulator-pr-8.json`](data/voice-simulator-pr-8.json), [`data/voice-simulator-pr-8-comments.json`](data/voice-simulator-pr-8-comments.json) | The pull request `/solve` opened afterwards                                                                                                                                                                                         |
| [`data/voice-simulator-ci-runs.jsonl`](data/voice-simulator-ci-runs.jsonl)                                                                               | The not-passing CI/CD runs of `829bf09` the wait was about                                                                                                                                                                          |
| [`data/reproduce-before-fix.log`](data/reproduce-before-fix.log)                                                                                         | [`experiments/issue-3505-reproduce-fix-progress.mjs`](../../../experiments/issue-3505-reproduce-fix-progress.mjs) on the code before the fix: every `/fix` status, validated with Telegram's parser rules                           |
| [`data/reproduce-after-fix.log`](data/reproduce-after-fix.log)                                                                                           | The same reproduction after the fix, including the Telegram edits sent by the monitor                                                                                                                                               |
| [`data/all-statuses-after-fix.log`](data/all-statuses-after-fix.log)                                                                                     | [`experiments/issue-3505-render-all-statuses.mjs`](../../../experiments/issue-3505-render-all-statuses.mjs): every status a reply can show (queued, starting, every `/fix` phase, failed launch, all completion outcomes, recovery) |
| [`data/eslint-rule-on-pre-pr-src.log`](data/eslint-rule-on-pre-pr-src.log)                                                                               | The new ESLint rule run over `src/` as it was before this PR: 38 hits (0 after)                                                                                                                                                     |
| [`data/eslint-rule-on-pre-fix-fix-progress.log`](data/eslint-rule-on-pre-fix-fix-progress.log)                                                           | The rule on the pre-fix `fix-progress.lib.mjs` alone: it reports exactly the two values behind this issue                                                                                                                           |
| [`data/formatters-fuzz-before-fix.log`](data/formatters-fuzz-before-fix.log)                                                                             | [`tests/telegram-markdown-formatters-fuzz-3505.test.mjs`](../../../tests/telegram-markdown-formatters-fuzz-3505.test.mjs) on the pre-fix formatters: 9 of 36 cases rejected by the Markdown parser                                  |

## Timeline (UTC, 2026-10-18)

| Time      | Event                                                                                                                                                                                                                                                                                 | Source                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 04:28:22  | Push of `829bf09` (merge of PR #6) to `voice-simulator/main` starts CI/CD: `Checks and release`, `Example app`, `Security`, `Workflows`, `Broken Link Checker`                                                                                                                        | `voice-simulator-ci-runs.jsonl`, shot1                  |
| 04:30:00  | `Example app` fails                                                                                                                                                                                                                                                                   | `voice-simulator-ci-runs.jsonl`                         |
| 04:30:18  | `Security` fails                                                                                                                                                                                                                                                                      | `voice-simulator-ci-runs.jsonl`                         |
| ~04:30    | The user sends `/fix --ci-cd …`; the bot replies, and after the launch edits the reply to `⏳ Executing...`                                                                                                                                                                           | shot2 (11:30 local)                                     |
| 04:30:46  | `/fix` creates voice-simulator#7 with the CI/CD table (`Checks and release` still `in_progress`) and prints the `issue-created` marker                                                                                                                                                | `voice-simulator-issue-7.json`                          |
| ~04:30:49 | `/fix` starts waiting for CI/CD on `main` and prints `waiting-for-ci` markers with the pending runs. The monitor's edit contains `(in_progress)` outside a code span; Telegram rejects it ("can't parse entities"), and `safeEditMessageText` falls back to plain text with a warning | shot3, `reproduce-before-fix.log`                       |
| 04:31:25  | `Checks and release` finishes (failure)                                                                                                                                                                                                                                               | `voice-simulator-ci-runs.jsonl`                         |
| 04:31:49  | The user opens hive-mind#3505                                                                                                                                                                                                                                                         | issue                                                   |
| 04:31:52  | `/fix` comments "CI/CD on `main` finished before work started" on #7 after waiting 1m 3s, prints `ci-finished` (shown as `✅ CI/CD on main finished (1m 3s)`) and then `solving`                                                                                                      | `voice-simulator-issue-7.json`                          |
| 04:32:33  | `/solve` opens voice-simulator#8; the reply shows `⏳ Executing...` **and** the `✅ CI/CD on main finished (1m 3s)` line, which stays for the rest of the session                                                                                                                     | `voice-simulator-pr-8.json`, `reproduce-before-fix.log` |

The status the user saw therefore went **Executing → (plain-text) Waiting for CI/CD → CI/CD finished → Executing + CI/CD finished**, instead of **Starting → Waiting for CI/CD → Executing**.

## Requirements

| #   | Requirement (from the issue)                                                                                                                                  | Status         | Where                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | The CI wait is a simple `Waiting for CI/CD on ... branch to finish...` status, without much detail                                                            | Done           | `formatFixProgressStatus` in `src/fix-progress.lib.mjs`, locale key `telegram.fix.waiting_for_ci` (en/ru/hi/zh)                                                                                                   |
| R2  | The Issue line does not change places and is shown after `Requested by...` (under `Repository:`)                                                              | Done           | `addFixIssueToInfoBlock`, applied with the first marker that names the issue                                                                                                                                      |
| R3  | `✅ CI/CD on main finished (1m 3s)` must not be a permanent line                                                                                              | Done           | No CI outcome line in any status; the results are commented on the issue by `/fix`                                                                                                                                |
| R4  | First `Starting`, then `Waiting for CI/CD`, only then `Executing`                                                                                             | Done           | `formatLaunchedFixMessage` (launch reply), `reportFixProgress` (monitor)                                                                                                                                          |
| R5  | Double check that all other statuses display logically                                                                                                        | Done           | See [Other statuses](#r5-other-statuses); one more bug found and fixed (`stopped by user by @name`)                                                                                                               |
| R6  | Fix Telegram formatting issues across the codebase and detect them with ESLint rules so they never repeat                                                     | Done           | `eslint-rules/no-unescaped-telegram-markdown.mjs` (error level), 25 escapes, 11 reasoned markers, fuzz test                                                                                                       |
| R7  | Collect logs/data in `docs/case-studies/issue-3505`, reconstruct the timeline, list requirements, root causes, solutions, existing libraries, online research | Done           | This document                                                                                                                                                                                                     |
| R8  | Add debug output / verbose mode if data is insufficient                                                                                                       | Done           | `[VERBOSE] [fix-progress]` lines in `reportFixProgress`; every Telegram send already logs under `--verbose` (`[telegram-send] …`, see `reproduce-after-fix.log`). The data was sufficient to find each root cause |
| R9  | Report issues to other repositories if relevant                                                                                                               | Not applicable | All causes are in hive-mind code. Telegram's behaviour is documented (see [Research](#research)), so there is nothing to report upstream                                                                          |
| R10 | Apply the fixes to the entire codebase                                                                                                                        | Done           | The rule runs over all of `src/` with no baseline: 38 hits before, 0 after                                                                                                                                        |

## Root causes

### 1. The waiting status was not valid Telegram Markdown (shot3)

`describePending` in `src/fix-progress.lib.mjs` rendered each pending run as `` `Checks and release` (in_progress) ``. The status text was outside the code span, so the `_` of `in_progress` opened an italic entity that never closed. Telegram's legacy Markdown parser (TDLib `parse_markdown`) then rejects the whole message:

```
Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 108
context: "unning: `Checks and release` (in_progress)\n⏱ Waited 1s of 1h 0"
```

`safeEditMessageText` caught that and resent the message as plain text with `⚠️ Formatting error detected. Showing plain text fallback.`, which also turned the code spans and the `[@drakonard](https://t.me/drakonard)` link into raw text (shot3). The same function printed `📝 Issue: ${event.issueUrl}` unescaped, so any repository with `_` in its name would have broken every status. `escapeMarkdown` only escaped `_` and `*`, not the other two legacy openers `` ` `` and `[`.

### 2. Too much, and permanent, CI/CD detail

`formatFixProgressStatus` produced several lines per phase: the wait line, `🔄 Running: …`, `⏱ Waited X of Y`, and `📝 Issue: …`. For `ci-finished` and `solving` it added `formatCiOutcomeLine`, so `✅ CI/CD on main finished (1m 3s)` stayed under `⏳ Executing...` until the session ended. Each poll with a new pending list or a new minute also caused another Telegram edit.

### 3. The issue line moved

While CI/CD was awaited, the issue link was a status line above the session block. Only at `solving` was it moved into the info block (`insertInfoBlockUrlLine`), so it jumped from the top of the message to below `Repository:`.

### 4. `Executing` was shown before the task started (shot2)

`buildExecuteAndUpdateMessage` in `src/telegram-command-execution.lib.mjs` edits the reply to `formatExecutingWorkSessionMessage` as soon as the screen/isolation session is launched. That is correct for `/solve`, `/hive` and `/task`, whose task starts at once. `/fix`, however, first creates an issue and waits for CI/CD, so `Executing` came before `Waiting for CI/CD`.

### 5. No guard against unescaped Markdown

The existing `telegram-safety/no-unsafe-telegram-send` rule ensures that messages go through the safe send helpers (which have the plain-text fallback). Nothing checked what was interpolated into the Markdown text, so this class of bug was only found at runtime, one message at a time.

## Solutions

### `/fix` status (R1–R4)

- `formatFixProgressStatus` returns one line per phase:
  - `issue-created` and `ci-finished`: `🔄 Starting...`
  - `waiting-for-ci`: ``⏳ Waiting for CI/CD on `main` branch to finish...``
  - `solving`: `⏳ Executing...`
- `describePending`, the timer and `formatCiOutcomeLine` are gone. The CI/CD results remain in the comment `/fix` posts on the issue.
- `addFixIssueToInfoBlock` puts `Issue: <escaped url>` right under `Repository:` with the first marker that has the issue URL. It stays there in every later status and in the completion message.
- `formatLaunchedFixMessage` keeps a just-launched `/fix` on `🔄 Starting...` (with the session and execution ids). A launch that returns after the monitor already showed a later phase keeps that phase.
- `reportFixProgress` edits only on a phase change (the key is `[phase, issueUrl]`). If the markers scrolled out of the log tail before `solving` was seen, it shows `Executing` once, so the reply cannot stay on "Waiting for CI/CD" for the whole task.
- `escapeMarkdown` escapes all four legacy openers: `_ * ` [`.
- `escapeMarkdownKeepingCodeSpans` is for the four "❌ Invalid options" replies (`/solve`, `/hive`, `/task`, `/fix`). Their yargs error is user input plus intentional code spans from `option-suggestions.lib.mjs` ("Did you mean `` `--model` `` option?"). Paired single-line code spans stay code; everything else is escaped, including an unpaired backtick. Every other `escapeMarkdown` caller was checked; their producers use plain quotes, so they need no code spans.

Before and after, from `reproduce-before-fix.log` and `reproduce-after-fix.log`:

```
before: ⏳ Executing...                              (launch)
        ⚠️ Formatting error detected. Showing plain text fallback.
        ⏳ Waiting for CI/CD on main to finish before starting the task...
        🔄 Running: Checks and release (in_progress)
        ⏱ Waited 1s of 1h 0m
        📝 Issue: https://github.com/konard/voice-simulator/issues/7
        ✅ CI/CD on `main` finished (1m 3s)
        ⏳ Executing...
        ✅ CI/CD on `main` finished (1m 3s)        (until the end)

after:  🔄 Starting...
        ⏳ Waiting for CI/CD on `main` branch to finish...
        🔄 Starting...
        ⏳ Executing...
        ✅ *Work session finished successfully*
        (Issue: … always under Repository:)
```

### R5: other statuses

`experiments/issue-3505-render-all-statuses.mjs` renders every status a reply can have and checks that each one is valid Markdown and that `Issue:` stays right under the URL line. The checked statuses are: queued, starting before the launch, starting for a launched `/fix`, the four `/fix` phases including the CI timeout, failed launch, completion (success, failure, stopped by user, killed, recovering, unknown, with a pull request) and the recovery lifecycle. The result is in `data/all-statuses-after-fix.log`.

- `/solve`, `/hive` and `/task` go Queued → Starting → Executing → completion. Their task starts at launch, so `Executing` right after the launch is correct for them.
- `--no-wait-for-ci`, a CI timeout and "could not check CI" all go Starting → Executing without a permanent outcome line. The wait outcome is still in the `/fix` log and the issue comment.
- One illogical status was found and fixed. The "stopped by user" completion read `Work session stopped by user by @name`, and it inserted an English "by" into the ru/hi/zh texts too. It now reads `Work session stopped by user (@name)`. That text is inside `*bold*`, where Telegram cannot escape a `*` (a first name may contain one), so `*` is removed from the name. This is covered by the fuzz test.

### R6/R10: the ESLint rule `telegram-safety/no-unescaped-telegram-markdown`

`eslint-rules/no-unescaped-telegram-markdown.mjs` is enabled as an error for `src/`.

**Sinks.** It follows the text argument of:

- `safeReply`, `safeSendMessage`, `safeEditMessageText`, `ctx.reply` and `telegram.sendMessage`/`editMessageText`;
- same-file wrappers such as `const edit = text => safeEditMessageText(…)`;
- exported `format*`/`build*` functions of `src/telegram-*` modules;
- functions annotated `@telegram-markdown`.

A message whose `parse_mode` is not legacy Markdown is not checked.

**Tracing.** It traces the text back through variables, `+=`, `+`, template literals, `.join()`/`.map()` callbacks, same-file helpers and `t(key, vars)` translation variables.

**Context.** For every interpolation it computes the Markdown context from the literal text before it:

- inside a code span, a code block or a link URL, the text is verbatim, so any value is fine;
- at the top level or inside bold/italic, the value must be escaped (`escapeMarkdown`), formatted (numbers, durations, `codeSpan`…), a literal, or marked with `// telegram-markdown-ok: <reason>`.

A marker without a reason does not count.

**Error text.** `error.message`, `stderr` and similar values are always reported, even when the property name looks formatted.

**Results.** On the pre-PR `src/` it reports 38 hits (`data/eslint-rule-on-pre-pr-src.log`), including both values behind this issue (`fix-progress.lib.mjs:68 item.status`, `:97 event.issueUrl`). They were resolved as follows:

| Resolution                         | Count | Where                                                                                                                                                                                                                           |
| ---------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Removed by the `/fix` redesign     | 2     | `fix-progress.lib.mjs`                                                                                                                                                                                                          |
| Escaped (real bugs)                | 23    | Recovery lifecycle (8), `/tokens` (2), leak notifier (2), `/organize` (3), queue warning and errors (3), command execution warning (1), `/start`/`/stop` reasons and URL (4)                                                    |
| Made safe at the source (real bug) | 2     | The "💡 Did you mean `…`?" suggestion is shown in a code span, where a backtick cannot be escaped. `validateTelegramGitHubUrl` now percent-encodes it (`%60`), reproduced with `experiments/issue-3505-suggestion-backtick.mjs` |
| Marked with a reason               | 11    | Values that are already Markdown (`buildTelegramInfoBlock`, `validation.error`), fixed enum or command labels, fixed titles, a session name shown in a code span                                                                |

**Tests.**

- `tests/no-unescaped-telegram-markdown-rule-3505.test.mjs` is a RuleTester suite. It includes this issue's two patterns as invalid cases.
- `tests/telegram-markdown-formatters-fuzz-3505.test.mjs` is the runtime companion. It feeds `in_progress`, `a*b`, ``x`y``, `[label`, `snake_case_name`, a URL with `_`, and a mix of all four openers into every fixed formatter. It then checks the output with `validateTelegramText`, which implements Telegram's legacy parser rules. It fails on the pre-fix formatters (`data/formatters-fuzz-before-fix.log`). It also covers `escapeMarkdownKeepingCodeSpans` with option suggestions and unpaired or multi-line backticks.
- `tests/test-fix-status-order-3505.mjs` checks the status order, the single line per phase, the fixed issue line, the absence of a CI outcome line, the launch reply and the localized texts.

## Research

- **Telegram Bot API, "Markdown style"** (https://core.telegram.org/bots/api#formatting-options):
  - "To escape characters '\_', '\*', '\`', '\[' outside of an entity, prepend the character '\\' before them."
  - "Escaping inside entities is not allowed, so entity must be closed first and reopened again."
  - "Entities must not be nested, use parse mode MarkdownV2 instead."

  This is why the rule treats code spans and URLs as verbatim, requires escaping only at the top level, and why a `*` inside the bold completion status cannot be escaped.

- **TDLib `parse_markdown`** (https://github.com/tdlib/td/blob/master/td/telegram/MessageEntity.cpp), the server-compatible parser:
  - It accepts a backslash escape only for `_ * ` [` in the main loop.
  - After an opener it scans only for the matching closer.
  - Its single error is `Can't find end of the entity starting at byte offset N`, the exact error in this issue.

  `src/telegram-markdown-validator.lib.mjs` mirrors this algorithm, so tests can validate messages offline.

- **Community reports** show the same failure mode, usually from `_` in URLs or identifiers:
  - Node-RED forum, "Encoding string to Telegram": https://discourse.nodered.org/t/encoding-string-to-telegram/24692
  - "Send message as a Telegram bot: what may go wrong": https://dev.to/mbelsky/send-message-as-a-telegram-bot-what-may-go-wrong-1adf

  python-telegram-bot's `escape_markdown(version=1)` escapes the same four characters as `escapeMarkdown` now does.

### Existing libraries and alternatives

| Option                                                                                                                                      | What it offers                                                   | Why not adopted here                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@telegraf/entity` (https://github.com/telegraf/entity)                                                                                     | `escapers.MarkdownV2/HTML` and entity → Markdown/HTML conversion | Built for MarkdownV2/HTML. The bot's ~100 messages and 4 locales use legacy Markdown, and its escaper does not match legacy rules                                                                     |
| `teleform` (https://cdn.jsdelivr.net/npm/teleform@1.2.7/README.md), `telegramify-markdown` (https://pypi.org/project/telegramify-markdown/) | Markdown → MarkdownV2 conversion and escaping                    | Same: they target MarkdownV2                                                                                                                                                                          |
| `telegram-escape` (https://github.com/utterstep/telegram-escape)                                                                            | MarkdownV2 escaping with code-block rules (Rust)                 | Rust, MarkdownV2                                                                                                                                                                                      |
| Switch to `parse_mode: 'HTML'`                                                                                                              | Only `<`, `>`, `&` need escaping, and entities can nest          | It is the most robust long-term option. It would rewrite every message and locale string, which is far beyond this issue. The rule skips non-Markdown messages, so a gradual migration stays possible |
| Send text + `entities` instead of a parse mode                                                                                              | No escaping at all                                               | Same scale of rewrite                                                                                                                                                                                 |

None of these libraries detect missing escaping statically. A lint rule that knows the project's send helpers and formatters is what prevents a repeat, while a runtime fallback such as `safeEditMessageText`'s plain text only hides the problem. Hence the custom rule, combined with the existing validator for runtime tests.
