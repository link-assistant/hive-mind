# Case Study: Issue #1837 — `/queue` (alias of `/solve_queue`) improvements

## Overview

This case study documents the analysis and implementation for issue
[#1837](https://github.com/link-assistant/hive-mind/issues/1837), an
**enhancement** (not a bug) to the Telegram bot's solve-queue status command.

The `/solve_queue` command reports the state of the per-tool work queues
(`claude`, `agent`, `codex`, `qwen`, `gemini`). Before this change it printed
**only counts** — per-tool `pending`/`processing` numbers plus a final
`Completed: N, Failed: M` line. It never listed _which_ issues or pull requests
were running, queued, completed, or failed. When something is stuck or
executing, an operator could see _that_ one item was processing but had no way to
jump to it.

This PR makes three changes:

1. **Clickable lists of the actual executed items.** The detailed status now
   lists each processing item (`▶️`), each pending item (`•`), and the recent
   `Completed` (`✅`) and `Failed` (`❌`, with the error reason) items, each as a
   clickable Markdown link `[owner/repo#number](url)` to the issue/PR.
2. **`/queue` alias.** `/queue` is now a synonym for `/solve_queue`, so checking
   the queue is faster to type.
3. **This deep case study** with the requirement breakdown, solution options,
   and a review of existing components.

## Issue Details

- **Issue**: [#1837](https://github.com/link-assistant/hive-mind/issues/1837)
- **Title**: `/queue` (alias of `/solve_queue`) improvements
- **Labels**: `documentation`, `enhancement`
- **Author**: @konard
- **Reported**: 2026-05-29
- **Pull Request**: [#1840](https://github.com/link-assistant/hive-mind/pull/1840) on branch `issue-1837-3c7f512ce3b5`
- **Data files**:
  - [`issue-1837.json`](./issue-1837.json) — the raw issue payload (title, body, labels, author).
  - [`implementation.diff`](./implementation.diff) — the full diff implemented in this PR.

### Reported behavior (verbatim from the issue)

The issue shows the current `/solve_queue` output:

```
📋 Solve Queue Status

claude (pending: 0, processing: 1)

agent (pending: 0, processing: 0)

codex (pending: 0, processing: 0)

qwen (pending: 0, processing: 0)

gemini (pending: 0, processing: 0)

Completed: 0, Failed: 1
```

> Now I don't see actual list of executed issues/pull requests as clickable
> list, that must be fixed, and we we should add /queue as alias for it.
>
> It will simplify search tasks that are stuck or yet executing.

## Requirements (extracted verbatim from the issue)

Each requirement from the issue body, and where it is addressed:

1. **Show the actual list of executed issues/pull requests as a clickable list.**
   "Now I don't see actual list of executed issues/pull requests as clickable
   list, that must be fixed." → [Requirement 1: Clickable lists](#requirement-1--clickable-lists-of-executed-items).
2. **Add `/queue` as an alias for `/solve_queue`.** → [Requirement 2: `/queue` alias](#requirement-2--queue-alias).
3. **Collect data related to the issue into `./docs/case-studies/issue-1837`.**
   → [`issue-1837.json`](./issue-1837.json), [`implementation.diff`](./implementation.diff), and this document.
4. **Do a deep case study analysis (search online for additional facts/data).**
   → This document; see [Online research](#online-research).
5. **List each and all requirements from the issue.** → This section.
6. **Propose possible solutions / solution plans for each requirement.** →
   [Solution options](#solution-options-considered).
7. **Check known existing components/libraries that solve a similar problem or
   can help.** → [Existing components reviewed](#existing-components--libraries-reviewed).
8. **Plan and execute everything in this single pull request.** → All changes
   land in PR #1840 on branch `issue-1837-3c7f512ce3b5`.

## Requirement 1 — Clickable lists of executed items

### Why the list was missing

The detailed status is built by `SolveQueue.formatDetailedStatus()` in
[`src/telegram-solve-queue.lib.mjs`](../../../src/telegram-solve-queue.lib.mjs).
Before this change it iterated the per-tool queues and printed only the
`pending`/`processing` _counts_ (it derived the processing count from `pgrep` +
tracked isolation sessions), then appended a single `Completed: N, Failed: M`
summary line.

The queue object already tracks everything needed for a list:

- `this.queues[tool]` — array of pending `SolveQueueItem`s (each has `.url`,
  `.status`, `.getWaitTime()`, `.waitingReason`).
- `this.processing` — a `Map` of in-flight items keyed by id (each has `.tool`,
  `.url`, `.status`).
- `this.completed` / `this.failed` — arrays of finished items (capped at 100;
  failed items carry `.error`).

So no new data had to be collected — the information was discarded at the
formatting step. The fix is purely a formatting change: render those items as a
clickable list.

### Why "clickable" needs care under Telegram Markdown

The bot sends this message with `parse_mode: 'Markdown'` (legacy Markdown).
Under legacy Markdown:

- A **bare URL is auto-linked** and clickable — so even the old (URL-less) output
  would have been clickable _if_ it had printed URLs.
- The richer `[label](url)` **inline-link syntax** is supported, which lets us
  show a compact, human-readable label (`owner/repo#number`) instead of a long
  raw URL.
- **`_` and `*` are Markdown-special**; an owner/repo name containing them inside
  link _text_ can break the parser and make Telegram reject the whole message.

The implemented `formatQueueItemLink(url)` helper
([`src/telegram-solve-queue.helpers.lib.mjs`](../../../src/telegram-solve-queue.helpers.lib.mjs))
parses a GitHub issue/PR URL into `owner/repo#number` and:

- returns `[owner/repo#number](url)` when the label is Markdown-safe
  (`^[A-Za-z0-9/#.-]+$`), giving a compact clickable link; otherwise
- falls back to the **bare URL** (still auto-linked/clickable, just longer); and
- returns the original string unchanged for non-GitHub / unparseable URLs.

This keeps the message safe to parse in all cases while still being clickable.

### Keeping the message under Telegram's 4096-character cap

Telegram caps a message at **4096 UTF-8 characters after entity parsing** (see
[Online research](#online-research)). A busy queue could list hundreds of
items and blow past that cap. To stay safe, each section is capped at
`QUEUE_CONFIG.MAX_DISPLAY_ITEMS_PER_QUEUE` (default **5**, override via
`HIVE_MIND_MAX_DISPLAY_ITEMS_PER_QUEUE`) and collapses the remainder into a
localized `... and N more` line (the existing `queue_and_more` i18n key). The
`Completed`/`Failed` history is shown **most-recent-first** so the newest results
are easiest to find.

### New output format

```
📋 Solve Queue Status

claude (pending: 1, processing: 1)
  ▶️ owner/repo#12 (started, 3m 10s)
  • owner/repo#34 (waiting, 1m 2s)
    └ RAM usage is 70% (threshold: 65%)

agent (pending: 0, processing: 0)

codex (pending: 0, processing: 0)

qwen (pending: 0, processing: 0)

gemini (pending: 0, processing: 0)

Completed (3):
  ✅ owner/repo#7
  ✅ owner/repo#5
  ✅ owner/repo#2

Failed (1):
  ❌ owner/repo#8 — Error message text

Completed: 3, Failed: 1
```

Each `owner/repo#number` is a clickable link to the issue/PR. The final
`Completed: N, Failed: M` summary line is preserved for backward compatibility
(and the existing test asserts on it).

## Requirement 2 — `/queue` alias

Telegram bot commands are dispatched two ways in this codebase:

1. **Entity-based** via `bot.command(regex, handler)` in
   [`src/telegram-solve-queue-command.lib.mjs`](../../../src/telegram-solve-queue-command.lib.mjs).
   The regex was widened from `^solve[_-]?queue$` to
   `^(?:solve[_-]?queue|queue)$` (case-insensitive). This matches `/queue` and
   `/QUEUE` while still **not** matching unrelated commands like `/queued`.
2. **Text-based fallback** in [`src/telegram-bot.mjs`](../../../src/telegram-bot.mjs)
   (added for issue #1232, which handles hyphenated forms Telegram can't send as
   entities). The `handlers` map gained `queue: handleSolveQueueCommand`
   alongside the existing `solve_queue` / `solvequeue` entries.

The help text in all four locales (`en`, `ru`, `zh`, `hi`) was updated to
mention the alias, e.g. `` `/solve_queue` (alias: `/queue`) - Show solve queue
status ``.

There is no `setMyCommands` registration in the codebase, so the alias needed
only the regex + fallback changes — no command-menu update.

## Solution options considered

### Requirement 1 — how to render the list

| Option                                             | Description                                               | Trade-off                                                                                                                                   | Chosen                           |
| -------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **A. Bare URLs**                                   | Print `item.url` directly; rely on Telegram auto-linking. | Simplest; clickable; but long and noisy, and a list of raw URLs is hard to scan.                                                            | No                               |
| **B. Inline Markdown links `[owner/repo#n](url)`** | Compact, scannable, clickable.                            | Needs Markdown-safety guard for `_`/`*` in repo names.                                                                                      | **Yes** (with bare-URL fallback) |
| **C. MarkdownV2 / HTML parse mode**                | Richer/escaping-safe formatting.                          | Would require changing the parse mode for the whole message and re-escaping all existing content — large blast radius for no extra benefit. | No                               |
| **D. Telegram message entities (manual offsets)**  | Programmatic links without Markdown.                      | Most robust but verbose; offsets must be recomputed as the message is assembled — overkill here.                                            | No                               |

Option **B with a bare-URL fallback** (the implemented `formatQueueItemLink`)
gives the compact, clickable, scannable list the issue asks for while staying
safe under the existing legacy-Markdown pipeline.

### Requirement 1 — how to bound message size

| Option                                 | Description                                        | Chosen                                                                                        |
| -------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Cap per section + "and N more"**     | Show the first N (configurable) items per section. | **Yes** — reuses the existing `queue_and_more` key and `MAX_DISPLAY_ITEMS_PER_QUEUE` pattern. |
| **Paginate across multiple messages**  | Send several messages / inline keyboard pages.     | Deferred — more complex; not requested.                                                       |
| **Truncate the whole message blindly** | Cut at 4096 chars.                                 | No — could cut mid-link and break Markdown.                                                   |

### Requirement 2 — how to add the alias

| Option                                            | Description                              | Chosen                                                              |
| ------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| **Widen the existing regex + fallback map**       | One handler, two dispatch paths updated. | **Yes** — minimal, consistent with how `/solvequeue` already works. |
| **Register a separate `bot.command('queue', …)`** | Second registration.                     | No — duplicates wiring and risks drift between the two handlers.    |

## Existing components / libraries reviewed

- **`formatDuration` / `formatWaitingReason`** ([`telegram-solve-queue.helpers.lib.mjs`](../../../src/telegram-solve-queue.helpers.lib.mjs)) —
  already used for human-readable wait times and reasons; reused as-is for each listed item.
- **`lt()` limits-i18n** ([`src/limits-i18n.lib.mjs`](../../../src/limits-i18n.lib.mjs)) —
  already defines `queue_completed`, `queue_failed`, `queue_pending`,
  `queue_processing`, `queue_status_*`, and `queue_and_more`. The new lists reuse
  these keys, so **no new translation keys were needed**.
- **`QUEUE_CONFIG`** ([`src/queue-config.lib.mjs`](../../../src/queue-config.lib.mjs)) —
  the existing env-overridable config object; the new
  `MAX_DISPLAY_ITEMS_PER_QUEUE` follows the same `parseIntWithDefault(...)`
  pattern as every other tunable.
- **`parseGitHubUrl()`** ([`src/github.lib.mjs`](../../../src/github.lib.mjs)) —
  considered for parsing the URL into `owner/repo/number`. **Not** imported,
  because that module pulls in heavy GitHub-API dependencies that would bloat the
  formatting path; a small local regex in `formatQueueItemLink` is sufficient and
  dependency-free.
- **Text-fallback handler map** ([`src/telegram-bot.mjs`](../../../src/telegram-bot.mjs), issue #1232) —
  the established mechanism for command aliases that Telegram can't send as
  entities; reused for `/queue`.
- **Telegraf** — the bot framework; `bot.command(regex, handler)` already accepts
  a regex, so the alias needed only a wider pattern, not a new dependency.

## Online research

- **Telegram message length** — the Bot API limits a message to **1–4096 UTF-8
  characters after entity parsing**
  ([Telegram Bot API](https://core.telegram.org/bots/api),
  [node-telegram-bot-api #165](https://github.com/yagop/node-telegram-bot-api/issues/165)).
  This is the reason the lists are capped per section with `... and N more`.
- **Markdown inline links** — legacy Markdown supports `[inline URL](http://example.com/)`,
  and Telegram auto-links bare URLs; clients show an "Open this link?" confirmation
  ([Telegram Bot API](https://core.telegram.org/bots/api)). This is why both the
  compact-link and bare-URL fallbacks render as clickable.

## The implementation

### Files changed

| File                                       | Change                                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `src/telegram-solve-queue-command.lib.mjs` | Regex widened to `^(?:solve[_-]?queue\|queue)$` to match `/queue`.                                       |
| `src/telegram-bot.mjs`                     | Added `queue: handleSolveQueueCommand` to the text-fallback handler map.                                 |
| `src/telegram-solve-queue.helpers.lib.mjs` | New `formatQueueItemLink(url)` and `formatQueueHistorySection(...)` helpers.                             |
| `src/telegram-solve-queue.lib.mjs`         | `formatDetailedStatus()` now lists processing/pending/completed/failed items as clickable links.         |
| `src/queue-config.lib.mjs`                 | New `MAX_DISPLAY_ITEMS_PER_QUEUE` (default 5, env `HIVE_MIND_MAX_DISPLAY_ITEMS_PER_QUEUE`).              |
| `src/locales/{en,ru,zh,hi}.lino`           | Help text mentions the `/queue` alias.                                                                   |
| `tests/solve-queue.test.mjs`               | New tests for clickable links in pending/completed/failed sections.                                      |
| `tests/test-solve-queue-command.mjs`       | New tests asserting `/queue` and `/QUEUE` match (and `/queued` does not), plus the text-fallback wiring. |

The full diff is preserved in [`implementation.diff`](./implementation.diff).

### Design notes

- `formatQueueItemLink` and `formatQueueHistorySection` live in the **helpers**
  module (not the main lib) to keep `telegram-solve-queue.lib.mjs` under the
  repo's 1500-line ESLint `max-lines` cap and to make the link/section formatting
  independently unit-testable.
- The final `Completed: N, Failed: M` summary line is intentionally **retained**
  for backward compatibility and is still asserted by the existing
  `formatDetailedStatus includes all sections` test.

## Testing

- `tests/solve-queue.test.mjs` (72 tests) — includes two new tests:
  - `formatDetailedStatus renders clickable Markdown links for queued items (issue #1837)`
  - `formatDetailedStatus lists completed and failed items as clickable links (issue #1837)`
- `tests/test-solve-queue-command.mjs` (25 tests) — includes:
  - `Command regex matches queue (alias added in issue #1837)`
  - `Command regex matches QUEUE (case insensitive alias)`
  - `Command regex does not match unrelated commands like queued`
  - `telegram-bot.mjs includes /queue alias in text fallback handlers (issue #1837)`
- `npm run lint` passes (the main lib stays under the 1500-line limit).

## Follow-up — executing tasks were still not listed (PR #1847)

After PR #1840 merged, a new screenshot was posted on the issue (2026-05-30):

> Executing tasks are not listed, so it is hard to find them in chat.

The `processing: N` **count** was correct (e.g. `claude (pending: 0, processing:
1)`), but the executing task itself was **not** rendered as a clickable link —
exactly the case the issue cares most about ("search tasks that are stuck or yet
executing").

### Root cause

There are two independent sources of truth, and they disagree once a task starts
running:

- The processing **count** comes from `getExternalProcessingSnapshot()` =
  `max(pgrep count, tracked-isolation-session count)`. It reflects work running
  in **detached screen/isolation sessions**.
- The processing **list** iterated `this.processing` — the queue's own in-memory
  `Map`. But `executeItem()` moves an item to `this.completed` and **deletes it
  from `this.processing` in its `finally` block** the moment the work is
  dispatched to a detached session. So while a task is actually executing,
  `this.processing` is empty.

The result: the count says `1`, the list shows nothing. The executing item lived
only in the detached-session tracker (`session-monitor.lib.mjs`'s
`activeSessions` Map), which the formatter never consulted.

### Fix

Source the executing items from the same place the **count** comes from — the
tracked detached sessions — and merge them with the in-memory `processing` Map:

1. **`src/session-monitor.lib.mjs`** — new `getRunningSessionItems(verbose,
options)`. It walks `activeSessions` and returns the **currently-running**
   ones with their GitHub `url`, `tool`, `status`, `startTime`, and
   `isolationBackend`. Liveness is decided exactly as `monitorSessions` does:
   isolation sessions via `$ --status` (skipped unless still executing),
   non-isolation screen sessions via the `NON_ISOLATION_SESSION_TIMEOUT_MS`
   window plus a best-effort `screen -ls` check. This reuses the existing
   isolation-status machinery rather than adding a parallel one.
2. **`src/telegram-solve-queue.helpers.lib.mjs`** — new
   `collectExecutingItems({processingItems, sessionItems, tool})` merges the two
   sources, filtering by `tool` and **deduping by normalized GitHub URL** (so a
   task that is in both the in-memory Map and the session tracker is listed
   once), and `formatQueueProcessingItems({items, max, locale})` renders them as
   the `▶️ [owner/repo#n](url) (status, duration)` lines, capped at
   `MAX_DISPLAY_ITEMS_PER_QUEUE` with the localized `... and N more`.
3. **`src/telegram-solve-queue.lib.mjs`** — `formatDetailedStatus()` now awaits
   `getRunningSessionItems()` and renders the merged executing list via the two
   new helpers instead of looping over the (now-empty) `this.processing` Map. The
   source is injectable (`options.getRunningSessionItems`) for tests.

### Why this source, not another

- **`pgrep` alone** gives a count but no URL — it sees `solve` processes, not
  which issue/PR each is working on. It can power the count but not a clickable
  list.
- **`activeSessions`** already stores the `url` and `tool` for every detached
  session the bot launches (it has to, in order to post the completion
  notification and to block duplicate-URL submissions). It is the only source
  that already knows _which_ issue/PR is executing, so listing from it needs **no
  new bookkeeping** — only a read-side accessor.

### Tests

- **`tests/test-issue-1837-executing-list.mjs`** (new, 10 assertions) — unit
  tests for `getRunningSessionItems`: only **executing** isolation sessions are
  listed (completed ones excluded), live non-isolation screen sessions are
  listed, sessions whose screen is gone are excluded, and expired non-isolation
  sessions are excluded.
- **`tests/solve-queue.test.mjs`** — added:
  - `formatDetailedStatus lists executing tasks from tracked running sessions
(issue #1837)` — injects a running session with no item in `this.processing`
    and asserts the `▶️`-prefixed `[owner/repo#n](url)` link appears (and that
    `queue.processing.size === 0`, proving the list no longer depends on the
    in-memory Map).
  - `collectExecutingItems dedupes processing items and tracked sessions by URL`.
  - `collectExecutingItems skips sessions without a URL`.

## Outcome

All issue requirements are addressed across PR #1840 (clickable lists, `/queue`
alias, the original case study) and the follow-up PR #1847 (executing tasks now
listed, not just counted). The detailed `/solve_queue` (and `/queue`) status
shows the executed _and currently-executing_ issues/PRs as a clickable list,
`/queue` works as an alias, and this case study captures the data, analysis,
requirement breakdown, solution options, existing-component review, and the
follow-up root-cause fix.
