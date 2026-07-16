# Case Study — Issue #1891

**Title:** We have too much duplication in `/queue` display

**Issue:** https://github.com/link-assistant/hive-mind/issues/1891
**Pull Request:** https://github.com/link-assistant/hive-mind/pull/1892
**Status:** Implemented

This folder is the deep case study for issue #1891, compiled as required by the
issue itself ("make sure we compile that data to `./docs/case-studies/issue-{id}`
folder, and use it to do deep case study analysis"). It contains:

| File                                                           | Purpose                                                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [`README.md`](./README.md)                                     | Overview, the verbatim problem, before/after, and the shipped solution at a glance                                 |
| [`requirements.md`](./requirements.md)                         | The exhaustive, numbered list of every requirement extracted from the issue, each mapped to where it is satisfied  |
| [`analysis.md`](./analysis.md)                                 | Timeline, root-cause framing for each problem, design decisions, and trade-offs                                    |
| [`existing-components.md`](./existing-components.md)           | Survey of existing in-repo components reused, plus external prior art / libraries evaluated (with online research) |
| [`issue.json`](./issue.json)                                   | Raw issue payload downloaded via `gh issue view --json` (timeline source data)                                     |
| [`assets/queue-screenshot.png`](./assets/queue-screenshot.png) | The screenshot attached to the issue showing the duplicated old display                                            |

---

## The problem (verbatim from the issue)

> We have too much duplication in `/queue` display.
>
> For example we can just have links to issues like we have
>
> ```
> ▶️ uselessgoddess/ryzr#3 (processing, 2h 14m 16s)
>   ▶️ link-foundation/box#99 (processing, 53m 52s)
>   ▶️ link-assistant/hive-mind#1886 (processing, 51m 50s)
>   ▶️ link-assistant/hive-mind#1885 (processing, 50m 30s)
> ```
>
> But if we split processing and pending, that will help us make it more compact (with links as now):
>
> ```
> • uselessgoddess/ryzr#3 (▶️ 2h 14m 16s)
> • link-foundation/box#99 (▶️ 53m 52s)
> • link-assistant/hive-mind#1886 (▶️ 51m 50s)
> • link-assistant/hive-mind#1885 (▶️ 50m 30s)
> ```
>
> Waiting/pending does not need to show waiting reason, it usually all the same for all of them.
> [...] We should also try to fit more data (it will be fine if it does not fit in one message, we can
> split it by our universal message sending method, split should be done by lines, without breaking the
> markdown (especially code blocks) [...] add lots of tests for that). And we don't need to show empty queues.

## The problem in one sentence

The `/queue` (alias `/solve_queue`) Telegram command rendered **the same words over
and over** — every executing line said `(processing, …)`, every waiting line said
`(waiting, …)`, and the (almost always identical) waiting reason was repeated once
per item — which wasted vertical space, pushed real data off the screen, and risked
hitting Telegram's 4096-character limit without a markdown-safe way to split.

## Before → After

**Before** (duplicated, verbose; reason repeated per item):

```
*claude* (pending: 2, processing: 4)
  ▶️ uselessgoddess/ryzr#3 (processing, 2h 14m 16s)
  ▶️ link-foundation/box#99 (processing, 53m 52s)
  ⏳ link-assistant/hive-mind#1900 (waiting, 5m 2s) — Claude 5 hour session limit is 95% (threshold: 90%)
  ⏳ link-assistant/hive-mind#1901 (waiting, 4m 1s) — Claude 5 hour session limit is 95% (threshold: 90%)
*agent* (pending: 0, processing: 0)
*codex* (pending: 0, processing: 0)
*gemini* (pending: 0, processing: 0)
```

**After** (compact; split lists; shared reason once; empty queues hidden):

```
*claude*
  *Processing* (2):
    • uselessgoddess/ryzr#3 (▶️ 2h 14m 16s)
    • link-foundation/box#99 (▶️ 53m 52s)
  *Pending* (2):
    • link-assistant/hive-mind#1900 (⏳ 5m 2s)
    • link-assistant/hive-mind#1901 (⏳ 4m 1s)
    ⏳ Claude 5 hour session limit is 95% (threshold: 90%)
```

## The shipped solution at a glance

Two independent changes, both required by the issue:

1. **Compact, de-duplicated `/queue` display** (`formatDetailedStatus`):
   - executing rows render as `• owner/repo#number (▶️ <dur>)`,
   - pending rows render as `• owner/repo#number (⏳ <dur>)`,
   - each tool renders as separate labeled lists (`*Processing* (n):`,
     `*Pending* (n):`, `*Completed* (n):`, `*Failed* (n):`) with no duplicated
     `(pending: n, processing: n)` tool-header summary,
   - the shared waiting reason is printed **once per tool** (only when all pending
     items agree on it) instead of once per item,
   - **empty queues are skipped entirely**,
   - all queued items are listed (no per-queue truncation) — the universal sender
     splits the message if it grows past Telegram's limit.

2. **A markdown-safe, line-based universal message splitter**
   (`splitTelegramMessageText` in `src/telegram-safe-reply.lib.mjs`):
   - splits only on line boundaries so inline entities (bold/italic/links — none of
     which may span a newline in Telegram Markdown) are never cut in half,
   - keeps **fenced code blocks balanced per chunk**: a split inside a code block
     closes the fence (` ``` `) at the end of one chunk and **reopens it,
     repeating the language**, at the start of the next,
   - preserves the original fence marker (` ``` ` vs `~~~`) and indentation,
   - hard-splits pathologically long single lines as a fallback.

Both behaviours are covered by extensive new tests
(`tests/test-telegram-message-split-1891.mjs`,
`tests/test-queue-compact-display-1891.mjs`) and by updates to the existing queue
display tests.
