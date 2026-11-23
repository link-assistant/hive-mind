# Case study: issue #4067 — start every link of a multi-link `/solve` reply

- Issue: https://github.com/link-assistant/hive-mind/issues/4067 ("Support multiple issues execution")
- Pull request: https://github.com/link-assistant/hive-mind/pull/4068
- Raw data: [`raw/`](./raw)
  - [`issue-4067.json`](./raw/issue-4067.json), [`issue-4067-comments.json`](./raw/issue-4067-comments.json): the issue as filed (no comments)
  - [`screenshot-issue-4067.png`](./raw/screenshot-issue-4067.png): the Telegram message from the issue
  - [`pr-4068-comments.json`](./raw/pr-4068-comments.json), [`pr-4068-review-comments.json`](./raw/pr-4068-review-comments.json): PR conversation at the time of the fix
  - [`batch-demo-output.txt`](./raw/batch-demo-output.txt): output of [`experiments/issue-4067-batch-demo.mjs`](../../../experiments/issue-4067-batch-demo.mjs), the screenshot scenario replayed offline

## 1. What happened

The screenshot shows a Telegram message with 25 GitHub links (24 issues in
`link-assistant`, `link-foundation` and `linksplatform` repositories, plus
`linksplatform/doublets-web/pull/35`). The user replied to it with:

```text
/codex —think medium —auto-merge
```

(The em dashes come from the Telegram client's autocorrection of `--`; the
argument parser already turns them back into `--think` and `--auto-merge`.)

The intent: start one `/codex` task per link, as if the command had been sent
25 times, each with `--think medium --auto-merge`.

### Timeline

| When (UTC)       | Event                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| 2026-11-15 19:01 | The user sends the 25-link message and replies to it with `/codex …` (screenshot, 10:01 PM local time) |
| 2026-11-15 19:04 | Issue #4067 filed                                                                                      |
| 2026-11-15 19:11 | PR #4068 opened as a draft                                                                             |
| 2026-11-15 19:12 | First automatic attempt (Formal AI) finishes without a change (`planned_not_executed`)                 |
| 2026-11-15 22:12 | Second attempt (this PR's work) starts                                                                 |

## 2. Root cause

On `main` before this PR, a `/solve`-family command that is a reply and has no
URL of its own extracts the link from the replied message with
`extractGitHubUrl()` (`src/telegram-message-filters.lib.mjs`, added for
issue #1325):

```js
if (foundUrls.length === 0) {
  return { url: null, error: null, linkCount: 0 };
} else if (foundUrls.length === 1) {
  return { url: foundUrls[0], error: null, linkCount: 1 };
} else {
  return {
    url: null,
    error: `Found ${foundUrls.length} GitHub links in the message. Please reply to a message with only one GitHub issue or PR link.`,
    linkCount: foundUrls.length,
  };
}
```

and `handleSolveCommand()` in `src/telegram-bot.mjs` answered that error and
returned:

```js
const extraction = _extractGitHubUrl(replyText, { parseGitHubUrl, cleanNonPrintableChars });
if (extraction.error) {
  // Multiple links found
  await safeReply(ctx, `❌ ${escapeMarkdown(extraction.error)}`, { reply_to_message_id: ctx.message.message_id });
  return;
}
```

So the reply in the screenshot was refused with
"❌ Found 25 GitHub links in the message. Please reply to a message with only one
GitHub issue or PR link." Several links were treated as a mistake, not as a request.
Some smaller gaps sat next to that rule:

- The same link written twice counted as two links, so it was refused too.
- Only `reply_to_message.text` was read. A caption (a photo with links) and
  hidden `text_link` entities were ignored.
- A command listing several links itself (`/solve <url1> <url2>`) was not
  supported either: yargs takes one positional `issue-url`, and the second link
  is rejected with `Unknown argument: https://github.com/o/r/issues/2` (checked
  with [`experiments/issue-4067-inline-two-urls-on-main.mjs`](../../../experiments/issue-4067-inline-two-urls-on-main.mjs)).

## 3. Requirements

| #   | Requirement (from the issue)                                                                     | Where it is met                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| R1  | A `/codex`, `/claude` or `/solve` reply to a message with many links works for every link        | `planSolveTargets()` returns a `batch` plan; `handleSolveCommand()` runs it (all aliases share this handler)            |
| R2  | "work like if we executed them one by one": same options and the same checks as a single command | Each link goes through `launchSolveTarget()`, the unchanged single-link pipeline, with `[url, ...options]`              |
| R3  | Answer with the start of each separate link                                                      | Each started link gets its own "Starting…" / "Queued…" message from the single-link flow                                |
| R4  | One every 10–15 seconds, at random                                                               | `pickSolveBatchDelayMs()` picks uniformly in [10 000, 15 000] ms; the pause is taken only between two successful starts |
| R5  | Start only valid links                                                                           | Malformed, non-issue/PR, not-found, already-running/queued, and queue-rejected links are not started                    |
| R6  | One summary of all invalid links after all valid ones are started                                | `runSolveBatch()` sends `telegram.solve_batch_summary` after the loop (only when something was not started)             |
| R7  | All tasks are replies to the same command                                                        | Every start/queue/summary message is sent with `reply_to_message_id` of the command message                             |
| R8  | Collect data and write a case study in `docs/case-studies/issue-4067`                            | This folder                                                                                                             |
| R9  | Search online for facts; check existing components/libraries                                     | Sections 4 and 5                                                                                                        |
| R10 | List the requirements and propose solutions and plans for each                                   | This table and section 5                                                                                                |

Derived requirements (not in the issue text, needed for R1–R7 to be safe):

- D1: a single link keeps working exactly as before (issue #1325 behavior, including options after the link).
- D2: a mistake in the options is the same for every link. It is answered once, and nothing starts. 25 identical errors would not help.
- D3: `/stop` in the chat during a batch stops the links not started yet; they are listed in the summary.
- D4: duplicated links start once.
- D5: summary and help texts are translated (en, ru, zh, hi), as all bot texts are.

## 4. Facts from outside the repository

- **Telegram flood limits.** The official Bots FAQ says a bot should avoid more
  than one message per second in a single chat, and that "bots are not able to
  send more than 20 messages per minute" in a group; going over leads to
  `429 Too Many Requests` errors. Source: https://core.telegram.org/bots/faq.
  The grammY guide gives the same reading: https://grammy.dev/advanced/flood.
  A 25-link batch with no pause would produce 25+ messages in seconds and hit
  the group limit. With a 10–15 s pause it sends at most ~6 start messages per
  minute, plus the "Starting…" edits that the single-link flow already makes.
- **GitHub secondary rate limits.** GitHub documents secondary limits on
  concurrent and content-creating requests: roughly 80 content-creating
  requests per minute and 500 per hour, and 900 REST points per minute. It also
  warns that continuing to send requests while limited can get an integration
  banned. Source: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api.
  Every started `solve` forks, clones, creates a branch and a draft PR, so
  starting 25 of them in the same second would put a burst on one token. A
  random 10–15 s spread avoids that, and the randomness avoids lock-step
  patterns with other bot instances.
- **Existing libraries.**
  - [`p-queue`](https://github.com/sindresorhus/p-queue) has `concurrency`,
    `interval` and `intervalCap` (fixed or sliding windows). It caps runs per
    window. It has no random jitter, and per its README the project is feature
    complete.
  - [`bottleneck`](https://github.com/SGrondin/bottleneck) has `minTime`,
    reservoirs and Redis clustering. It is useful when several processes share
    one limit.
  - [`@grammyjs/auto-retry`](https://grammy.dev/plugins/auto-retry) and
    [`@grammyjs/transformer-throttler`](https://grammy.dev/plugins/transformer-throttler)
    throttle and retry outgoing Telegram calls, but only for the grammY
    framework. This bot uses Telegraf.
  - Hive Mind already has the parts that matter: the solve queue
    (`src/telegram-solve-queue.lib.mjs`) limits how many sessions _run_, and
    checks duplicates (`launchingUrls`, `hasActiveSessionForUrlAsync`). The batch
    only has to pace the _starts_, and a sequential loop with `sleep()` does that
    without a new dependency.

## 5. Solutions considered, per requirement

**R1, R2, R7: how to run several links.**

1. _Chosen:_ refactor the single-link part of `handleSolveCommand()` into
   `launchSolveTarget(ctx, userArgs, options)` and call it once per link with
   `[url, ...options]`. All validation, the duplicate and queue checks, the
   "Starting…" message and the queue logic stay identical, so "like if we
   executed them one by one" holds by construction. Every message replies to the
   same command message.
2. Re-dispatch synthetic Telegram updates (one fake `/codex <url> …` message per
   link) through Telegraf. Rejected: fake updates confuse the authorization,
   per-user locale and reply-to checks, and they bypass the replied-to message.
3. Pass all links to one `solve` process. Rejected: `solve` handles one issue
   per run, and one failure would affect every link.

**R3, R5, R6: answers and the summary.**

1. _Chosen:_ each failure in the per-link flow goes through a `reject(text,
{ scope, summary })` callback instead of a direct reply. In a batch, the
   first paragraph of the error (without help text or input location) becomes
   the summary line. Outside a batch, the callback is absent and the old reply
   is sent unchanged.
2. Validate all links first, then start. Rejected: a link can become invalid
   between validation and start (a session started by someone else, the queue
   filled up). Collecting the real reason at start time is more accurate.

**R4: the pause.**

1. _Chosen:_ a sequential loop with an injected `sleep(pickSolveBatchDelayMs())`,
   uniform in [10 000, 15 000] ms, taken only after a link started and only when
   more links remain. Rejected links do not add a pause, so the summary is not
   delayed by links that never produced a message.
2. `p-queue` with `interval: 10000, intervalCap: 1`. Workable, but it gives a
   fixed interval (no randomness), adds a dependency, and the waiting is not
   easier to test than an injected `sleep`.
3. Hand the pause to the solve queue. Rejected: the queue's job is execution
   capacity, not message pacing; queued items already wait their turn.

**D2: options errors.** The per-link flow marks failures that do not depend
on the link (malformed flags, invalid or locked isolation, model or branch
errors, unknown options) as `SOLVE_REJECT_SCOPE.OPTIONS`. The batch answers
that error once and stops.

**Repository links in a list.** `/solve <repository-url>` is a valid command
on its own (#2212): it solves every open issue of the repository. A repository
link in a list of issue links is far more likely context than a request for a
repository-wide run, so it is not started. The summary says why and how to
start it on purpose (`describeInvalidBatchLink()`).

**Unexpected errors.** An exception in one link's launch (for example a
GitHub API failure) is caught by `runSolveBatch()`. That link is listed as
"the start failed: …", and the next links still start.

**D3: `/stop`.** `isChatStopped(chatId)` is checked before each link. A
batch takes up to ~6 minutes for 25 links, and `/stop` during it must work.

**Links in the command itself.** `/solve <url1> <url2> --model opus` is planned
as a batch with the same code. Only arguments that are themselves GitHub links
count as links, so option values are never taken for links.

## 6. Implementation summary

- `src/telegram-solve-batch.lib.mjs` (new):
  - `extractGitHubTargetLinks` collects issue/PR links in order, without
    duplicates, and lists other GitHub links as invalid.
  - `getReplyLinkText` reads the text or caption, plus `text_link` targets.
  - `planSolveTargets` returns `single`, `batch` or `no-link`.
  - `pickSolveBatchDelayMs` picks the pause.
  - `runSolveBatch` runs the loop and sends the summary.
  - Telegram and the clock are injected, so the module is tested without a bot.
- `src/telegram-bot.mjs`: `handleSolveCommand()` plans the targets and either
  runs the old single-link path or the batch. The single-link pipeline moved
  into `launchSolveTarget()`, with an optional `reject` callback.
- `locales/*.lino`: `telegram.solve_batch_summary`,
  `telegram.solve_batch_chat_stopped`, `telegram.solve_batch_repository`,
  `telegram.solve_batch_launch_failed`, and an updated `/help` line about
  replies, in en, ru, zh and hi.
- README: the `/solve` section explains multi-link replies.
- Tests: `tests/telegram-solve-batch-4067.test.mjs` covers:
  - the 25-link screenshot reply, with the em-dash options;
  - single, no-link and inline batches;
  - deduplication, invalid links, captions and hidden links;
  - delay bounds and the event order (pauses only between starts, summary
    last);
  - an options error answered once, `/stop` mid-batch, a throwing launch,
    the repository-link reason, and the translated summary.

## 7. Verification

- `node --test tests/telegram-solve-batch-4067.test.mjs`: 16/16 pass.
- Existing related tests still pass: `tests/test-solve-reply-with-options.mjs`,
  `tests/test-telegram-url-extraction.mjs`, `tests/test-i18n.mjs` (locale key
  parity), `tests/test-telegram-ui-i18n.mjs`.
- `node experiments/issue-4067-batch-demo.mjs` replays the screenshot with one
  duplicated link, one repository link, one "already running" and one "not
  found" link. 23 of 26 links start, and the summary lists the 3 others (see
  [`raw/batch-demo-output.txt`](./raw/batch-demo-output.txt)).

## 8. Remaining limits

- The batch lives in the bot process. If the bot restarts mid-batch, the links
  not started yet are not resumed. Links already started or queued are not
  affected. A 25-link batch takes about 4–6 minutes.
- A batch is not cancelled per command, only by `/stop` for the whole chat.
