# Analysis — Issue #1891

## Timeline / sequence of events

1. **2026-06-10 23:17 UTC** — `konard` opens issue #1891 ("We have too much
   duplication in `/queue` display"), labelled `bug`, with a screenshot
   (`assets/queue-screenshot.png`) of the live `/queue` output and concrete
   before/after format examples. No comments follow; the issue body is the entire
   specification.
2. The issue traces back to the display introduced/extended for the `/queue`
   (`/solve_queue`) command:
   - #1232 added `/solve_queue`,
   - #1267 added per-tool grouping, human-readable durations, and the
     `MAX_DISPLAY_ITEMS_PER_QUEUE` cap with "… and N more",
   - #1837 added the short `/queue` alias, clickable `owner/repo#number` links, and
     the executing-list merge with detached sessions.
     Each step added information; none removed the per-line status word or the
     repeated waiting reason, so the duplication accumulated.
3. **PR #1892** (this work) addresses every requirement (see `requirements.md`).

## Problem 1 — Duplication in the display

### Root cause

The old `formatDetailedStatus` rendered each item through a single helper that
embedded the _status word_ and the _waiting reason_ on every line:

```
  ▶️ owner/repo#n (processing, 2h 14m 16s)
  ⏳ owner/repo#n (waiting, 5m 2s) — <reason>
```

Three sources of duplication:

1. **The status word is constant within its list.** Everything in the executing
   list is "processing"; everything in the pending list is "waiting". Printing the
   word on every line conveys zero marginal information.
2. **The waiting reason is (almost) constant within a tool.** The queue blocks a
   whole tool on the same limit (e.g. "Claude 5 hour session limit is 95%"), so the
   reason is identical for every pending item — yet it was printed once per item.
3. **Empty queues were still printed** (`*agent* (pending: 0, processing: 0)` …),
   adding four dead lines to almost every message.

### Solution

- Move the status signal **into the duration parenthesis as an emoji**:
  `(▶️ <dur>)` for executing, `(⏳ <dur>)` for pending. The emoji is the marker, so
  the word "processing"/"waiting" disappears.
- Split the queue into explicit labeled lists (Processing, Pending, Completed,
  Failed) so the reader groups items visually without a per-line status word.
- Render the tool name as a plain header; counts live only on the individual list
  labels, e.g. `*Pending* (2):`, so `(pending: N, processing: N)` is not repeated
  above the same lists.
- Print the **shared waiting reason once per tool**, and only when all pending items
  agree on it (`distinctReasons.length === 1`). Divergent reasons suppress the
  shared line rather than print a misleading one.
- **Skip empty queues** with an early `continue`.

## Problem 2 — Splitting long messages without breaking markdown

### Root cause

Removing the per-queue truncation (R6: "try to fit more data") means a `/queue`
message can now exceed Telegram's **4096-character** limit. The previous
`splitTelegramMessageText` split on arbitrary separators (including mid-line), which
can:

- cut an inline entity in half (e.g. `[label](ur` … `l)`), producing
  `can't parse entities` errors, and
- split **inside a fenced code block**, leaving one chunk with an unclosed ` ``` `
  and the next chunk starting in a broken state — exactly the failure the issue
  calls out ("without breaking the markdown (especially code blocks)").

### Solution

A line-based, fence-aware splitter:

- **Split only on `\n`.** Telegram's legacy-Markdown inline entities (bold, italic,
  code span, link) cannot span a newline, so a line boundary is always a safe place
  to cut an inline entity — there are none crossing it.
- **Track fenced code blocks.** A regex (`/^(\s*)(```+|~~~+)(.*)$/`) recognises a
  fence line and captures its indentation, marker, and language/info string. A
  running `openFence` toggles as fences are seen.
- **Close + reopen across a split.** When a chunk is flushed mid-code-block, the
  splitter appends a closing fence (same indent + marker) to the current chunk and
  seeds the next chunk with a reopening fence that **repeats the language** — so each
  chunk is independently valid Markdown and the code block renders continuously.
- **Reserve headroom** (`FENCE_HEADROOM`) so adding a close/reopen pair never pushes
  a chunk past the limit, and **hard-split** any single physical line that alone
  exceeds the budget (pathological input) using the existing
  `findTelegramSplitIndex`.
- **Preserve the marker kind and indentation** — a `~~~python` block reopens as
  `~~~python`, an indented block keeps its indent — so we never silently rewrite the
  author's fence style.

This lives in the one universal splitter (`src/telegram-safe-reply.lib.mjs`) that
**every** Telegram send path already funnels through, satisfying R11 ("perfect
across the codebase") without touching each call site.

## Codebase-wide audit (R18)

- **Send paths** — `safeReply`, the wrapped `telegram.sendMessage`, and the wrapped
  `telegram.editMessageText` all call `splitTelegramMessageText`. Fixing the splitter
  fixes every outbound message, including edits (which also forward overflow chunks
  via `sendFollowUpChunk`).
- **Queue formatters** — `formatDetailedStatus` (the `/queue` detail) is the only
  formatter that listed items with a status word + reason; it is fixed.
  `formatStatus` (one line per tool, used by `/limits`) never listed items, so it has
  no duplication and is intentionally untouched.
- **History sections** — `formatQueueHistorySection` (Completed/Failed) keeps its cap
  by design (see `requirements.md`, "out of scope").

## Scope: other repositories (R17)

The bug is entirely internal: it is in this repo's Telegram rendering
(`telegram-solve-queue*.mjs`) and message-splitting (`telegram-safe-reply.lib.mjs`)
code. The `owner/repo#number` strings in the screenshot (e.g.
`uselessgoddess/ryzr`, `link-foundation/box`) are just _queued work items_, not the
source of the bug. There is therefore **no upstream/third-party repository to file a
report against**. Prior art in external projects is catalogued in
`existing-components.md` for design validation, not as a defect to report.

## Risk / trade-off notes

- **Listing all items** can make a message long; mitigated by the markdown-safe
  splitter. Worst case is several messages instead of a truncated one — the issue
  explicitly accepts this ("it will be fine if it does not fit in one message").
- **Shared-reason heuristic**: if two pending items genuinely have different reasons
  we show none (rather than a wrong single one). The per-item status is still implied
  by the ⏳ marker; the detailed reason remains available in each item's own status
  message. This matches the issue's "it usually [is] all the same".
- **Backward compatibility**: `formatQueueProcessingItems` is kept as a deprecated
  alias of `formatQueueExecutingItems` so any external caller keeps working.
