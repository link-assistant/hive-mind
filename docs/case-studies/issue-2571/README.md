# Telegram API limits: detection, restraint after 429, and a big queue

Issue: [#2571](https://github.com/link-assistant/hive-mind/issues/2571). Implementation: [PR #2572](https://github.com/link-assistant/hive-mind/pull/2572).

The issue showed this `/limits` block:

```
Telegram Bot API
▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░ 19% used (messages per group, 1m)
4/21 requests (observed limit), peak 23
429 responses since startup: 47
Last 429: editMessageText
```

That is a false negative. Telegram had just refused the bot, yet the bar read 19%. The "observed limit" of 21 had been learned from bursts that Telegram tolerated for a while, and nothing in the bot slowed down after a refusal.

The production log was 64 MB and covered 2026-10-04 11:45 to 2026-10-06 20:59 UTC. It is kept outside the repository because it is private, so only redacted excerpts are stored in [`raw/`](raw).

## Timeline (UTC)

| Time                     | Evidence                                                                                                                                                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-04 11:45         | Bot starts. The agentic CLI updater logs `⬆️ Updating claude-profiles 0.40.7 → 1.2.3`, `⬆️ Updating gh-setup-git-identity 0.1.0 → 0.8.0`, then `0 updated, 11 current, 2 failed` with no reason ([raw](raw/agentic-cli-updater.log)).                                                        |
| 2026-10-04 … 10-06       | The `/limits` usage APIs fail continuously: 564 Codex `401 token_invalidated`, 131 Claude `429 rate_limit_error` (often two requests 2 s apart), and 43 Claude `401` ([raw](raw/usage-api-429.log), [raw](raw/codex-usage-401.log)).                                                         |
| 2026-10-06 (line 946054) | `/stop` on a queued item. The "Cancelled" card is rejected by Telegram: `Can't find end of the entity starting at byte offset 113`, at `@anton_poroshin` ([raw](raw/cancel-card-markdown.log)).                                                                                              |
| 2026-10-06 19:44         | `gh` returns `unexpected end of JSON input` while posting the log-link comment, and the comment is reported as not posted ([raw](raw/gh-comment-truncated-json.log)).                                                                                                                        |
| 2026-10-06 20:39:46      | First Telegram 429 (`retry after 34`) in group `-1002975819706`. More than 20 queue cards wait in that group ([raw](raw/first-telegram-429.log)).                                                                                                                                            |
| 20:39 – 20:59            | 86 Telegram 429s: 70 `editMessageText` and 16 `sendMessage`. Each burst is refused around the 21st edit ([sequence](raw/group-window-429-sequence.txt)). Six times `bot.catch` answers a 429 with an error reply into the same chat, and that reply is refused too, three times per cascade. |
| 2026-10-06 20:59         | Issue #2571 is opened.                                                                                                                                                                                                                                                                       |

The [error summary](raw/error-summary.txt) is a normalized count of every warning and error class in the log. It was used as the checklist for "fix all errors, warnings, false positives and false negatives".

## Requirements

| #   | Requirement (from the issue)                                                    | Where it is addressed                                                                           |
| --- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| R1  | Better Telegram API limit detection, without false positives or false negatives | Governor in `src/telegram-rate-limit.lib.mjs`; display in `src/telegram-limits-section.lib.mjs` |
| R2  | Actually restrain after a 429                                                   | `retry_after` holds per chat/group, window pacing, priorities                                   |
| R3  | Send fewer requests, so a big queue works                                       | `src/telegram-solve-queue.lib.mjs`, `/top`, `/merge`                                            |
| R4  | Use the log to fix all errors, warnings, false positives and false negatives    | Sections 3–8 below                                                                              |
| R5  | Check online best practices                                                     | [Best practices and libraries](#best-practices-and-existing-libraries)                          |
| R6  | Collect data and write a case study                                             | This folder                                                                                     |
| R7  | Add debug or verbose output wherever the data is insufficient                   | Section 8 and the new `/limits` lines                                                           |
| R8  | Report upstream issues where relevant                                           | [Upstream](#upstream-reports)                                                                   |

## Root causes and solutions

### 1. The limit tracker only counted 429s (R1, R2)

**Root cause.** `telegram-rate-limit.lib.mjs` recorded successes and refusals but never delayed a request. When a group burst succeeded beyond 20 per minute, the "observed limit" grew to 21 and then 23. The refusal that followed did not lower it, so the bar showed 19% right after a 429.

**Solution** (b5279e05). The tracker is now a governor:

- Every chat or group refused with `retry_after` is held until that time passes.
- Requests are paced to the per-chat (1/s), per-group (20/min) and broadcast (30/s) windows. These are the limits from the [Telegram Bots FAQ](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this).
- A refusal outranks contradicting successes for 30 minutes. After that the documented limit returns, so "observed limit 21, peak 23" can no longer hide a refusal.
- Priorities are carried through `AsyncLocalStorage`:
  - Low priority (periodic refreshes) may use only 75% of a window. It is never delayed or retried; it is simply skipped this cycle.
  - Normal priority (replies to people) waits within a 75 s budget and is retried once after a 429.
- The decision and the bookkeeping happen in one synchronous step, so concurrent callers cannot both take the last slot.

Tests: `tests/telegram-rate-limit-governor.test.mjs`. Experiment: `experiments/issue-2571-429-sequence.mjs` reconstructs the request/429 sequence from a bot log (it produced [`raw/group-window-429-sequence.txt`](raw/group-window-429-sequence.txt)).

### 2. Waiting cards were edited every cycle (R3)

**Root cause.** Each waiting reason contains CPU %, process counts and countdowns, and these change every minute. With 25 cards in one group, every consumer cycle produced 25 edits, and the 21st was refused. 38% of all edits re-sent text the message already showed. Telegram still counts those edits, and answers them with "message is not modified".

**Solution** (ec7f6fd7):

- Skip an edit whose text equals the message's current text.
- Show a new kind of reason, or a new queue position, immediately.
- Let changes that differ only in numbers wait for the periodic refresh, which now defaults to 5 minutes.
- Send all card edits at low priority.
- After one refusal, stop editing that chat for the rest of the cycle and retry the remaining cards next cycle, without error logs.

Tests: `tests/issue-2571-queue-telegram-edits.test.mjs`. It replays 25 cards with the production reasons.

### 3. Error replies into a throttled chat, and other refresh loops (R3, R4)

**Root cause.**

- `bot.catch` replied "An error occurred…" to a 429. That reply went to the same chat and was refused, and so was its plain-text fallback.
- The `/top` and `/merge` progress edits ran at normal priority and re-sent unchanged text.

**Solution** (92945856). `bot.catch` does not reply into a chat that Telegram has just rate limited. `/top` and `/merge` refreshes run at low priority and skip unchanged text.

### 4. Markdown entity error on the /stop "Cancelled" card (R4)

**Root cause.** `updateQueueCardForCancellation` put the user name `@anton_poroshin` into legacy Markdown unescaped. The `_` opened an italic entity that was never closed.

**Solution** (92945856). The name and the URL are passed through `escapeMarkdown`. `requestedBy` in `work-session-formatting.lib.mjs` sits inside a bold entity, where `_` is literal, and it was verified with `validateTelegramText`.

Test: `tests/issue-2571-cancel-card-markdown.test.mjs`.

### 5. Usage-API 429s and 401s were never cached (R4)

**Root cause.** The Claude cache only skipped caching when an error message contained `Rate limited`, but the message our code produced says "has reached rate limit". As a result, 429s were never cached and every `/limits` render or queue check asked again. That gave 131 refusals, often two requests 2 s apart from concurrent callers. Auth failures were never cached either: 564 Codex 401s, about one per minute while a Codex task waited.

**Solution** (d08b33ae):

- Failures carry `failureKind` (`auth` or `rate_limited`).
- A 429 is cached for `max(cache TTL, Retry-After)`. `Retry-After` is accepted both as seconds and as an HTTP date.
- An auth failure is cached until the TTL ends, or earlier if the credentials file's mtime changes, so a re-login is noticed at once.
- Concurrent callers share one in-flight request.
- 5xx and network errors are not cached.

Test: `tests/issue-2571-usage-limits-cache.test.mjs`.

### 6. `/limits` did not say when the bot held back (R1, R7)

**Solution** (7d0d100d). The Telegram section now shows:

- the last refusal with its age and `retry_after`, for example `Last 429: sendMessage, 1s ago, retry_after 8s`;
- when nonzero, how much the bot restrained itself, for example `Held back by the bot: 2 delayed, 50 skipped, 1 retried`.

Both lines are translated in en, ru, zh and hi.

### 7. `unexpected end of JSON input` from `gh` lost the log-link comment (R4)

**Root cause.** GitHub cut the response to the comment POST short, and `gh` failed while parsing it. The comment may or may not have been created, and the solver treated it as not posted.

**Solution** (ceb717b9). On this specific error, `postTrackedComment` lists comments created since the request started. If the comment exists, its id is used. If it does not, the POST is sent once more. If the lookup itself fails, the original error is reported. This avoids both a lost link and a duplicate comment.

Test: `tests/issue-2571-truncated-comment-response.test.mjs`.

### 8. The agentic CLI updater failed without a reason (R4, R7)

**Root cause (of the missing data).** `bun install -g` exited 0, so the failure came from the post-install version check. That check, and the "registry unreachable" branch, only pushed into `failed`, and the summary printed counts only.

**Solution** (a828f71f). Both branches now log their reason, for example `⚠️ Could not update claude-profiles: after install the binary reports 0.40.7 (expected 1.2.3)`. The verbose summary lists `id: reason` for every failure.

The actual cause is not yet known. One likely candidate is that the binary on `PATH` is not the one bun replaced. The next production log will show it.

Test: `tests/issue-2571-agentic-cli-update-failure-reason.test.mjs`.

## Best practices and existing libraries

| Source                                                                                                                | What it does or recommends                                                                                                                                                                    | Used here                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Telegram Bots FAQ](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this)                  | At most 1 message/s per chat, 20 messages/min per group, about 30 messages/s for bulk sends (up to 1000/s with paid broadcasts).                                                              | These are the documented windows the governor paces to.                                                                                                                                      |
| [grammY: Flood limits](https://grammy.dev/advanced/flood)                                                             | 429s are unavoidable: wait for `retry_after`, then retry. Warns that throttling to assumed limits is "useless and harmful", because the real limits are undocumented and change.              | `retry_after` holds are authoritative. Pacing applies only to the documented windows, and a refusal overrides any learned headroom.                                                          |
| [grammY auto-retry](https://grammy.dev/plugins/auto-retry)                                                            | Sleeps for `retry_after` and retries. Has `maxRetryAttempts` and `maxDelaySeconds` (fail at once when the wait is longer).                                                                    | The same semantics for normal priority: one retry within a 75 s budget. Low priority is never retried.                                                                                       |
| [grammY transformer-throttler](https://grammy.dev/plugins/transformer-throttler)                                      | Bottleneck reservoirs: global 30/s, group 20/min with 1 s spacing, private 1/s. Its docs now say "Consider using the auto-retry plugin instead", because undocumented limits are not covered. | Same windows, but it would queue low-value refreshes behind replies. Our priorities drop them instead.                                                                                       |
| [telegraf-throttler](https://npmjs.com/package/telegraf-throttler)                                                    | Bottleneck-based throttler for Telegraf, with group reservoir 20 per 60 000 ms and out 1/s.                                                                                                   | The bot uses Telegraf, but the throttler has no priorities and no `retry_after` holds. Adding it would also add a dependency for logic that is already in `src/telegram-rate-limit.lib.mjs`. |
| [python-telegram-bot AIORateLimiter](https://docs.python-telegram-bot.org/en/stable/telegram.ext.aioratelimiter.html) | 30/s overall, 20/min per group. A `RetryAfter` halts _all_ requests for `retry_after` + 0.1 s. `max_retries` defaults to 0.                                                                   | We hold only the refused chat or group, so other chats keep working. That is the main difference.                                                                                            |
| Community reports ([Habr](https://habr.com/ru/amp/publications/799565))                                               | `editMessageText` counts toward the same flood control. Frequent edits of one message produce minute-long `retry_after` values.                                                               | This is why unchanged and numbers-only edits are skipped.                                                                                                                                    |

**Conclusion.** None of these libraries combines priorities, per-chat holds and a display of the learned state. That is why the governor stays in-house, while it follows grammY's guidance: obey `retry_after`, don't parallelize bursts, and drop rather than queue low-value updates.

## Upstream reports

- **gh CLI, `unexpected end of JSON input`.** We have one occurrence, without the HTTP status, headers or body, so we cannot build a reproducible example yet. The workaround is in our code (section 7). If it recurs, the GitHub CLI's `GH_DEBUG=api` output would give the data an upstream report needs.
- **bun global install leaving the old version on PATH.** This is not confirmed. Section 8 adds the logging needed to decide whether it is a bun issue or a host `PATH` issue.
- **Telegram.** The limits behave as documented: refusals start around the 21st message per minute in a group. There is nothing to report.

No upstream issue was filed, because each candidate still lacks a reproducible example. The issue asks for reports that include one.
