# Issue 2070: Telegram Bot API telemetry looked inactive

Issue: [link-assistant/hive-mind#2070](https://github.com/link-assistant/hive-mind/issues/2070)

Prepared PR: [link-assistant/hive-mind#2071](https://github.com/link-assistant/hive-mind/pull/2071)

Reported: 2026-07-16

## Executive summary

The `/limits` command displayed two local Telegram Bot API rolling windows. In normal low traffic, the one-second global window had usually expired before `/limits` finished collecting the other provider and system data, while the one-minute group window also commonly contained zero or one message. Two nearly empty bars made the section look broken even though the tracker was accurately reporting a quiet instant.

The issue asks for a smaller, GitHub-like presentation: a plain `Telegram Bot API` heading, one progress bar, a request count, a parenthetical label identifying which of the available rolling limits is closest to exhaustion, and the existing observed-429 count.

The implementation keeps both local counters but selects the higher utilization for display. A tie prefers the longer one-minute group window so an idle snapshot does not fall back to the short-lived one-second window that prompted the report. Actual Telegram 429 responses remain separate because they are authoritative evidence of throttling; local counters are estimates, not a server quota response.

## Preserved evidence

| Artifact                                                         | Description                                                                       |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`raw-data/issue.json`](raw-data/issue.json)                     | Full GitHub issue API export, including the complete report and its pasted output |
| [`raw-data/issue-comments.json`](raw-data/issue-comments.json)   | Complete paginated issue comment export; empty at investigation time              |
| [`raw-data/issue-screenshot.png`](raw-data/issue-screenshot.png) | Original GitHub attachment, validated by successful PNG decoding, 832×276         |
| [`after-output.png`](after-output.png)                           | Deterministic browser render of the new Telegram block for visual review          |

No separate runtime log file was attached to issue #2070. The reported output is preserved verbatim inside `issue.json`.

## Requirements inventory

| ID  | Requirement                                                                                 | Resolution                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Make the Telegram section useful for determining whether Telegram is rate limiting the bot. | Retain current rolling pressure and the actual observed-429 count/last response details.                                                       |
| R2  | Remove `(local rolling telemetry)` from the title.                                          | The heading is now simply `Telegram Bot API` in every locale.                                                                                  |
| R3  | Use one GitHub-like progress bar and request count.                                         | Render one bar followed by `used/limit requests`.                                                                                              |
| R4  | When multiple limits exist, show the most constraining one.                                 | Compare global and busiest-group utilization percentages on every render.                                                                      |
| R5  | Identify the displayed limit in parentheses.                                                | Show `(global, 1s)` or `(busiest group, 1m)`, localized in English, Russian, Chinese, and Hindi.                                               |
| R6  | Keep `429 responses since startup`.                                                         | The count and optional last-429 method/retry countdown are unchanged.                                                                          |
| R7  | Double-check that 429 observation works.                                                    | The test uses Telegraf's current `TelegramError` response shape, verifies `retry_after`, method, chat, countdown, and unchanged error rethrow. |
| R8  | Preserve issue data and conduct a deep case study with online research.                     | Raw issue/comments/screenshot, timeline, root causes, alternatives, sources, tests, and visual evidence are stored here.                       |
| R9  | Apply the requirement across the codebase.                                                  | The shared `/limits` formatter and all four locale catalogs are updated; there is only one Telegram telemetry renderer.                        |
| R10 | Add a reproducing automated test.                                                           | The existing default-suite Telegram test now asserts the compact group/global selection and tie behavior.                                      |

## Timeline

| Time                 | Event                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-14           | Issue [#2060](https://github.com/link-assistant/hive-mind/issues/2060) requested Telegram limit visibility because operators suspected long message queues could encounter flood control. |
| 2026-07-14           | PR [#2063](https://github.com/link-assistant/hive-mind/pull/2063) added process-local one-second global and one-minute busiest-group counters plus central 429 capture.                   |
| 2026-07-16 06:14 UTC | Issue #2070 reported that both counters usually displayed zero and that the two-bar section looked nonfunctional. The attached screenshot shows both bars at 0%.                          |
| 2026-07-16           | Investigation traced the output through `telegram-bot.mjs`, `getAllCachedLimits()`, `TelegramRateLimitTracker.getSnapshot()`, and `formatUsageMessage()`.                                 |
| 2026-07-16           | A formatter regression test first failed against the two-bar output, then passed after compact selection, localization, and deterministic tie handling were implemented.                  |

## How the telemetry works

Hive Mind installs one wrapper around Telegraf's central `Telegram.callApi` method. For every outbound Bot API request it:

1. increments the all-method request total;
2. records message-producing methods in local rolling windows;
3. delegates to the original Telegraf method without delaying, dropping, retrying, or reordering the request;
4. if the request throws a Telegram 429 response, stores its method, chat ID, observation time, and optional `retry_after` value;
5. rethrows the exact original error.

The tracker deliberately stores no message text and no bot token. Its state is process-local and resets at bot restart, which is why the UI says that the 429 count is "since startup."

## Root-cause analysis

### The zeroes were a snapshot of short rolling windows

Telegram does not expose a GitHub-style endpoint containing current `used`, `remaining`, `limit`, and `reset` fields. Hive Mind therefore derives pressure from its own recent outbound calls.

The global value counts matching message calls strictly newer than `now - 1000ms`. `/limits` sends a temporary "fetching" response and then gathers Claude, Codex, GitHub, CPU, memory, disk, and queue information before formatting the final result. If that work takes more than one second, the temporary response has already left the global window. With no concurrent Telegram traffic, `0/30` is correct.

The group value retains calls for one minute. It is more likely to show recent activity, but a quiet bot can correctly show `0/20`, and one recent group call appears as only 5%. The attached screenshot therefore does not prove missed instrumentation or historical throttling.

### Two equally prominent bars implied two authoritative quotas

The previous display gave the local global and group estimates equal visual weight. That was noisier than the GitHub block and forced an operator to compare percentages manually. It also made two low values look like duplicate non-results.

The requested compact display preserves both counters internally and performs the comparison at render time. The higher `usedPercentage` wins. When percentages tie, the group window wins because its minute-long history is more informative than an already expired one-second snapshot.

### The title described an implementation caveat, not the resource

`Telegram Bot API (local rolling telemetry)` was technically cautious but visually heavy. The caveat belongs in documentation and analysis, while the runtime section title should identify the resource consistently with `GitHub API`, `CPU`, and `RAM`.

### The 429 interception matches Telegraf's actual error contract

Current Telegraf constructs `TelegramError` with a `response` object containing `error_code`, `description`, and optional `parameters`. Its `callApi` implementation throws that error when a Bot API JSON response has `ok: false`. Hive Mind reads `error.response.error_code` and `error.response.parameters.retry_after`, which matches the upstream contract.

The automated test supplies exactly that structure and verifies:

- the response count increments once;
- method and chat metadata are retained;
- `retry_after: 12` produces a 12-second countdown, then 7 seconds after advancing time by five seconds;
- the wrapper rejects with the same error object, proving monitoring does not swallow or replace the failure.

## Result

Before:

```text
Telegram Bot API (local rolling telemetry)
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0% used
0/30 messages in 1s
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0% used
0/20 messages in busiest group over 1m
429 responses since startup: 0
```

After, when the group window is the most constrained:

```text
Telegram Bot API
▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░ 35% used (busiest group, 1m)
7/20 requests
429 responses since startup: 2
Last 429: sendMessage, retry in 8s
```

When global pressure is higher, the same two usage lines become:

```text
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░ 60% used (global, 1s)
18/30 requests
```

## Alternatives considered

### Show only the 429 counter

This is authoritative but reactive: it says nothing until Telegram has already rejected a request. Keeping a compact local pressure estimate helps an operator see a burst developing.

### Keep both bars

This preserves all raw values but directly conflicts with the simplification request and repeats the presentation that looked broken.

### Aggregate all requests since startup into a progress bar

There is no meaningful denominator for lifetime requests. A bar would grow forever even though Telegram's documented guidance concerns short rolling intervals, producing a false impression of an approaching permanent quota.

### Query Telegram for remaining quota

No Bot API method provides it. Unlike GitHub's rate-limit endpoint, Telegram supplies actual flood-control state only when a request fails with 429 and may include `retry_after`.

### Add a queueing/rate-limiter library

Libraries such as Bottleneck can schedule requests, but issue #2070 asks to fix monitoring presentation, not alter delivery semantics. Adding a scheduler here would introduce ordering and latency behavior outside the issue's scope. The current central Telegraf boundary remains the correct observability point.

## Online research

- Telegram's official [Bots FAQ](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this) documents approximate sending guidance: avoid more than one message per second in a chat, no more than 20 per minute in a group, and about 30 broadcasts per second by default. It also warns that short bursts may be allowed before 429 responses begin.
- The official [Bot API response format](https://core.telegram.org/bots/api#making-requests) states that unsuccessful responses contain `error_code` and may contain `ResponseParameters`; [`retry_after`](https://core.telegram.org/bots/api#responseparameters) is the server-provided number of seconds to wait after flood control.
- Telegraf's current [`TelegramError`](https://github.com/telegraf/telegraf/blob/v4/src/core/network/error.ts) exposes the response fields Hive Mind reads.
- Telegraf's current [`callApi`](https://github.com/telegraf/telegraf/blob/v4/src/core/network/client.ts) is the common HTTP request boundary and throws `TelegramError` for unsuccessful Bot API JSON responses.
- GitHub's official [REST rate-limit documentation](https://docs.github.com/en/rest/rate-limit/rate-limit) describes the explicit resource status endpoint that makes GitHub's block authoritative; Telegram has no equivalent endpoint.

## Verification plan

The focused default-suite test covers:

- global and busiest-group rolling-window expiry;
- Telegraf-shaped 429 capture, retry countdown, and unchanged rethrow;
- group selection when group utilization is higher;
- global selection when global utilization is higher;
- the one-minute group tie-break for an idle snapshot;
- one progress bar, request wording, simplified title, and localized Russian, Chinese, and Hindi output.

Repository lint, formatting, default tests, documentation validation, changeset validation, file limits, and diff checks are run before PR finalization. Fresh GitHub Actions are then matched to the exact pushed commit SHA.

## External issue assessment

No upstream issue is warranted. Telegram's absence of a quota-status endpoint is documented platform behavior, Telegraf exposes the required 429 fields correctly, and the defect was entirely in Hive Mind's choice of presentation.
