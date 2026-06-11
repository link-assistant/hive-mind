---
'@link-assistant/hive-mind': minor
---

fix(telegram): de-duplicate `/queue` display and split long messages without breaking markdown (#1891)

The `/queue` (alias `/solve_queue`) detailed display repeated the same words on every
line — every executing row said `(processing, …)`, every waiting row said
`(waiting, …)`, and the (almost always identical) per-item waiting reason was printed
once per item. Empty queues were also still printed. This wasted vertical space and
pushed real data off screen.

Display changes (`formatDetailedStatus` + queue helpers):

- Executing rows now render compactly as `• owner/repo#number (▶️ <dur>)` and pending
  rows as `• owner/repo#number (⏳ <dur>)` — the status word is replaced by the emoji
  marker inside the duration parenthesis.
- Processing and pending are split into two distinct compact lists per tool.
- The shared waiting reason is shown **once per tool** (only when all pending items
  agree on it) instead of once per item.
- Empty queues are skipped entirely.
- All queued items are listed (no per-queue truncation on the active lists).

Message-splitting changes (`splitTelegramMessageText` in `telegram-safe-reply.lib.mjs`,
the single universal splitter every Telegram send path funnels through):

- Splitting now happens only on line boundaries, so inline Markdown entities
  (bold/italic/links) are never cut in half.
- Fenced code blocks stay balanced per chunk: a split inside a code block closes the
  fence at the end of one chunk and reopens it — repeating the language — at the start
  of the next. The original fence marker (``` vs `~~~`) and indentation are preserved.
- Pathologically long single lines are hard-split as a fallback.

Both behaviours are covered by extensive new tests
(`tests/test-telegram-message-split-1891.mjs`, `tests/test-queue-compact-display-1891.mjs`).
