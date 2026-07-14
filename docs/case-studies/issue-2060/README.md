# Issue 2060: weekly-only Codex limits and Telegram Bot API telemetry

Issue: [link-assistant/hive-mind#2060](https://github.com/link-assistant/hive-mind/issues/2060)  
Prepared PR: [link-assistant/hive-mind#2063](https://github.com/link-assistant/hive-mind/pull/2063)  
Observed and reported: 2026-07-14

## Executive summary

The report contains two related `/limits` problems and one evidence-preservation requirement:

1. A ChatGPT/Codex account began returning only a weekly usage window. Hive Mind assumed that `primary_window` always meant five hours and `secondary_window` always meant one week. The remaining weekly value was therefore displayed as a five-hour value, followed by `Current week / N/A`.
2. Operators suspected that long Telegram queues might be approaching Telegram Bot API flood limits, but Hive Mind had no central outbound API telemetry. Unlike GitHub, Telegram does not publish a quota-status endpoint. Its documented limits are approximate and actual throttling arrives as error 429 with `parameters.retry_after`.
3. The issue asked for the report, screenshot, timeline, requirements, root-cause analysis, online research, alternatives, and verification data to be archived in this repository.

The implementation classifies Codex windows by their duration metadata, omits genuinely absent optional windows, and automatically restores the five-hour display if that window returns. It also instruments Telegraf's central `callApi` boundary with in-memory rolling counters and 429 capture. `/limits` now presents those counters as local telemetry—not as authoritative server quota—and reports actual 429 observations separately.

No evidence attached to the issue proves that Telegram throttling has occurred. The Telegram portion is therefore an observability fix for a stated operational suspicion, not a claim that a historical 429 was confirmed.

## Preserved evidence

| Artifact                                                         | Description                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`raw-data/issue.json`](raw-data/issue.json)                     | Full issue export, including the reported verbose log                     |
| [`raw-data/issue-comments.json`](raw-data/issue-comments.json)   | Complete paginated issue comment export; empty at investigation time      |
| [`raw-data/issue-screenshot.png`](raw-data/issue-screenshot.png) | Downloaded GitHub attachment, validated by image decoding as PNG, 934×416 |

The screenshot shows a `ChatGPT Pro subscription` block where `5 hour session` contains `44% used` and `Current week` contains `N/A`. The reported verbose excerpt does not include the Codex response body, although current code already logs that body when verbose mode is enabled.

## Requirements inventory

| ID  | Requirement                                                                                                                 | Resolution                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Support the Codex response when the five-hour limit disappears and only weekly usage remains.                               | Classify returned windows by `limit_window_seconds`, not their primary/secondary position.                                                                  |
| R2  | Show only `Current week` for weekly-only Codex accounts.                                                                    | Optional absent windows are omitted.                                                                                                                        |
| R3  | Do not show `N/A` for the absent five-hour Codex session.                                                                   | Main and additional Codex limit formatters omit absent windows.                                                                                             |
| R4  | Switch back if the previous response format/window returns.                                                                 | Duration classification is dynamic on every response; a returned sub-day window is displayed automatically.                                                 |
| R5  | Add Telegram API limits to `/limits` alongside GitHub API information.                                                      | `/limits` shows local rolling global/group message pressure and observed 429 count/state.                                                                   |
| R6  | Help diagnose suspected Telegram throttling in long queues.                                                                 | A central wrapper records all outbound message calls, 429 method/chat metadata, and `retry_after`; verbose mode logs snapshots and sanitized 429 responses. |
| R7  | Preserve all issue logs/data under `docs/case-studies/issue-2060`.                                                          | Issue JSON, comments, screenshot, and this analysis are archived here.                                                                                      |
| R8  | Reconstruct the timeline, enumerate requirements, find root causes, and evaluate solutions/libraries using online research. | Covered below.                                                                                                                                              |
| R9  | Add tracing if evidence is insufficient for a root cause.                                                                   | Codex already logs full response bodies in verbose mode. Telegram now logs local pressure plus actual 429 responses.                                        |
| R10 | Apply the fix across all affected code paths.                                                                               | Shared Codex mapping is used for base and additional limits; Telegraf `callApi` interception covers the bot's centralized outbound API path.                |
| R11 | Add reproducing automated tests.                                                                                            | Focused formatter/parser tests and a dedicated Telegram telemetry suite reproduce and guard the behavior.                                                   |

## Timeline

| Time                 | Event                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2025-12-03           | PR [#792](https://github.com/link-assistant/hive-mind/pull/792) introduced Telegram `/limits`.                                                                               |
| 2025-12-26           | PR [#1001](https://github.com/link-assistant/hive-mind/pull/1001) added GitHub core API rate-limit data from GitHub's explicit `rate_limit` endpoint.                        |
| 2026-05-12           | PR [#1794](https://github.com/link-assistant/hive-mind/pull/1794) expanded Codex subscription metadata.                                                                      |
| 2026-07-03           | PR [#2012](https://github.com/link-assistant/hive-mind/pull/2012) simplified limit output and hid several unused rows, but both base Codex windows were still unconditional. |
| 2026-07-14 14:53 UTC | The attached production excerpt records `/limits`; the screenshot shows a weekly value under the five-hour label and a weekly `N/A`.                                         |
| 2026-07-14 14:57 UTC | Issue #2060 was opened. It notes that the upstream change may be temporary and asks for automatic compatibility with either shape.                                           |
| 2026-07-14           | Investigation reproduced the unconditional five-hour block with a failing automated test and traced the mislabeling to positional primary/secondary mapping.                 |
| 2026-07-14           | Parser, formatter, Telegram telemetry, localization, tests, and this case study were implemented in PR #2063.                                                                |

## Root-cause analysis

### Codex: positional meaning was treated as stable

`getCodexUsageLimits()` previously performed this fixed mapping:

```text
rate_limit.primary_window   -> currentSession (five hours)
rate_limit.secondary_window -> allModels (one week)
```

That mapping works only while both upstream positions retain those meanings. The screenshot is consistent with a response whose only populated window is a seven-day `primary_window`: its `44%` appears under `5 hour session`, while the absent secondary value becomes weekly `N/A`.

The API objects already carry the stable semantic needed for classification: `limit_window_seconds`. Five hours is a sub-day window; seven days is a multi-day window. The fix maps sub-day windows to the session and day-or-longer windows to the weekly slot. If duration metadata is absent, the legacy primary/secondary fallback remains for backward compatibility.

### Codex: the renderer treated optional windows as required

Even with correctly normalized data, `formatCodexLimitsSection()` formatted both rows unconditionally. Its generic window helper intentionally renders `N/A` for missing data, which is useful for required Claude windows but noisy and misleading for an upstream-removed optional Codex window.

The Codex formatter now includes only windows with a numeric percentage. Additional metered Codex limits use the same rule, so a weekly-only additional limit becomes `week 12%` rather than `session N/A, week 12%`.

### Telegram: no GitHub-equivalent quota endpoint exists

GitHub's `/rate_limit` endpoint returns an authoritative limit, used, remaining, and reset timestamp. Telegram's Bot API does not offer an equivalent current-quota response. Telegram's official FAQ instead documents approximate sending guidance:

- avoid more than one message per second in a single chat;
- groups cannot receive more than 20 bot messages per minute;
- free bulk broadcasts are limited to about 30 messages per second.

Telegram's Bot API error model supplies an optional `ResponseParameters` object; for flood control, `retry_after` tells the client how many seconds to wait. Therefore an honest monitor must distinguish:

1. **local estimates** from observed outbound calls in rolling time windows; and
2. **server evidence** from actual 429 responses.

Before this change, outbound messages were issued through many `ctx.reply`, `sendMessage`, and edit helpers. Some launch retry code recognized 429, but `/limits` had no centralized counters or retained flood-control state. Telegraf routes arbitrary Bot API requests through `Telegram.callApi`, making it the narrow central instrumentation point.

## Implemented design

### Dynamic Codex window normalization

`mapCodexRateLimitWindows()`:

1. inspects both primary and secondary windows;
2. classifies positive durations below one day as a session window;
3. classifies durations of one day or longer as the weekly window;
4. preserves positional fallback when upstream omits all duration metadata;
5. is shared by the account limit and every additional metered limit.

This is deliberately capability-driven rather than version-driven. No feature flag or upstream-format date needs maintenance.

### Telegram rolling telemetry

`TelegramRateLimitTracker` records:

- every Bot API call count since process startup;
- rate-limited outbound message methods in a one-second global rolling window (reference limit 30);
- the busiest negative-ID group/channel in a one-minute rolling window (reference limit 20);
- total observed 429 responses since startup;
- last 429 method, chat identifier, observation time, server `retry_after`, and remaining retry time.

The tracker wraps `bot.telegram.callApi` once and rethrows every error unchanged. It is monitoring only: it does not delay, drop, retry, or reorder messages. Payload text and bot tokens are not stored. State is intentionally process-local and resets when the bot restarts.

The `/limits` label explicitly says `local rolling telemetry`. This avoids presenting approximations as Telegram-provided remaining quota.

### Diagnostics

With verbose mode enabled:

- existing Codex diagnostics log request status, response headers, and the full parsed response body;
- Telegram message calls log the global and busiest-group rolling counts;
- `/limits` logs the complete telemetry snapshot;
- actual Telegram 429 responses log their response object and always emit a concise method/chat/`retry_after` warning.

This is enough to distinguish a queue-volume hypothesis from observed flood control on the next incident.

## Alternatives considered

| Option                                                           | Assessment                                                                                                                                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hide the five-hour row whenever it is null                       | Fixes the `N/A`, but does not fix the screenshot's deeper weekly-as-primary mislabeling. Insufficient alone.                                                                                                       |
| Treat a missing secondary window as proof that primary is weekly | Works for the reported shape but relies on another positional heuristic and could mislabel a session-only response. Rejected.                                                                                      |
| Classify by `limit_window_seconds`                               | Uses semantic response metadata, supports either old or new layout, and naturally switches back. Chosen.                                                                                                           |
| Poll a Telegram quota endpoint like GitHub                       | No such Bot API endpoint is documented. Impossible without fabricating state.                                                                                                                                      |
| Count calls at every reply/edit site                             | Easy to miss paths and duplicates concerns throughout the codebase. Rejected in favor of `callApi` interception.                                                                                                   |
| Add proactive throttling immediately                             | Could prevent 429s, but changes latency and ordering and exceeds the issue's monitoring requirement without evidence of actual throttling. Deferred until telemetry demonstrates a need.                           |
| Use Bottleneck or a Telegraf throttler plugin                    | Reasonable future enforcement choices; they provide scheduling/reservoir primitives. They are not required for lightweight observation, and an extra runtime dependency would not improve the requested telemetry. |
| Persist counters across restarts                                 | Useful for long-term analytics, but local quota windows are only one second and one minute. Historical 429 persistence may later belong in the existing metrics/Sentry pipeline.                                   |

## Existing components and research

- [Telegram Bots FAQ: avoiding limits](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this) is the primary source for the one-per-chat/second, 20-per-group/minute, and approximately 30 broadcasts/second guidance.
- [Telegram Bot API: making requests and errors](https://core.telegram.org/bots/api#making-requests) documents error 429 and optional `ResponseParameters` used for automatic handling.
- [Telegram Bot API: ResponseParameters](https://core.telegram.org/bots/api#responseparameters) defines `retry_after` as the number of seconds to wait after flood control.
- [Telegraf](https://github.com/telegraf/telegraf) is the existing framework. Its `Telegram.callApi` path is the common boundary for arbitrary Bot API calls, so no additional framework is needed for instrumentation.
- [Bottleneck](https://github.com/SGrondin/bottleneck) is a mature scheduler/rate-limiter candidate if future evidence justifies proactive outbound throttling.
- PR [#1001](https://github.com/link-assistant/hive-mind/pull/1001) provides the repository's existing GitHub `/limits` display pattern.
- PR [#2012](https://github.com/link-assistant/hive-mind/pull/2012) provides the current optional-section and localized subscription formatting conventions.

No upstream issue was filed. The Codex endpoint involved is not a public OpenAI API contract, and the requirement is compatibility with either valid observed shape rather than an actionable upstream defect. Telegram likewise documents its limits and 429 mechanism; Hive Mind's missing observation was local.

## Reproduction and verification

### Codex regression

Input normalization case:

```json
{
  "primary_window": {
    "used_percent": 44,
    "limit_window_seconds": 604800
  },
  "secondary_window": null
}
```

Before:

```text
5 hour session
44% used

Current week
N/A
```

After:

```text
Current week
44% used
```

The tests cover weekly-only primary classification, omission of the main five-hour placeholder, omission of additional-limit `session N/A`, and retention of legacy/full-window behavior.

### Telegram telemetry

The dedicated test uses a deterministic clock to verify:

- six sends appear in both relevant windows;
- the one-second global window expires independently of the one-minute group window;
- non-message methods are counted as API calls but not message pressure;
- an injected Telegraf-shaped 429 preserves/rethrows the original error;
- `retry_after` counts down correctly;
- `/limits` includes rolling counts, total 429s, and last retry state.

## Limitations and follow-up decision points

- The Bot API guidance is approximate and Telegram may allow bursts. Local bars are diagnostic pressure indicators, not guarantees of acceptance.
- Negative chat IDs identify groups, supergroups, and channels; without additional chat metadata the one-minute counter is labeled as the busiest group operationally but may include a channel.
- Multiple bot processes do not share in-memory counters. A distributed deployment would need shared storage or metrics aggregation.
- Monitoring does not itself reduce queues or prevent flood control. If production captures 429s, the next step should add per-chat and global outbound scheduling that honors `retry_after`, with ordering and shutdown tests.
- Edits are counted because they are outbound message mutations and can participate in flood control, although Telegram's public FAQ phrases its broad limits in terms of sent messages.

## Result

All reported requirements are addressed without hard-coding the temporary upstream shape and without claiming unavailable Telegram server quota. The code now adapts when Codex windows appear or disappear and supplies the evidence needed to decide whether Telegram throttling is actually contributing to queue behavior.
