# Existing components & prior art — Issue #1891

The issue asks us to "check known existing components/libraries that solve a similar
problem or can help in solutions" and to "search online for additional facts and
data". This file records both the **in-repo components reused** and the **external
prior art** evaluated.

## In-repo components reused (no reinvention)

| Component                                                                 | File                                          | How it was reused                                                                                                         |
| ------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `splitTelegramMessageText`                                                | `src/telegram-safe-reply.lib.mjs`             | The single universal splitter every send path uses. Rewritten in place (line-based + fence-aware) so all callers benefit. |
| `findTelegramSplitIndex`                                                  | `src/telegram-safe-reply.lib.mjs`             | Kept as the fallback for hard-splitting a single over-long line at a natural separator.                                   |
| `safeReply` / `safeEditMessageText` / `installTelegramFormattingFallback` | `src/telegram-safe-reply.lib.mjs`             | Already chunk + fall back to plain text; they now inherit fence-safe chunking for free.                                   |
| `formatQueueItemLink`                                                     | `src/telegram-solve-queue.helpers.lib.mjs`    | Reused unchanged to render `[owner/repo#number](url)` clickable labels in both the executing and pending lists.           |
| `formatDuration`                                                          | `src/telegram-solve-queue.helpers.lib.mjs`    | Reused for the `▶️ <dur>` / `⏳ <dur>` durations (already localized, already human-readable from #1267).                  |
| `collectExecutingItems`                                                   | `src/telegram-solve-queue.helpers.lib.mjs`    | Reused to merge in-memory `processing` items with tracked detached sessions, deduped by URL (from #1837).                 |
| `lt()` / `t()` i18n helpers                                               | `src/limits-i18n.lib.mjs`, `src/i18n.lib.mjs` | Reused for the localized `pending:` / `processing:` labels and "… and N more".                                            |

Reusing the existing universal splitter is what makes R11 ("perfect across the
codebase") a one-place change instead of a per-call-site audit.

## External prior art (online research)

The problem — "split a Telegram message past 4096 chars **without breaking
Markdown / code blocks**" — is well-trodden. Findings that validated the chosen
design:

- **`telegramify-markdown`** (Python) — provides `split_markdownv2()` which "splits
  by the rendered MarkdownV2 length" and "handles all MarkdownV2 escaping rules
  correctly for different escaping contexts like normal text, code/pre blocks, and
  URLs", and can even extract long code blocks as files. Confirms the core idea:
  **split at safe boundaries and treat code/pre blocks specially.**
  <https://github.com/sudoskys/telegramify-markdown>
- **`node-telegram-bot-api` issue #534** ("Automatically split and send messages
  longer than 4096 chars") — the canonical community thread. The agreed approach is
  to **split at newline boundaries** and clip any entity that spans a split into both
  chunks; empty/whitespace-only chunks are dropped because Telegram rejects them.
  This is exactly our line-based strategy (and we already drop nothing useful because
  we never produce whitespace-only chunks for normal input).
  <https://github.com/yagop/node-telegram-bot-api/issues/534>
- **Telegram Bot API / `core.telegram.org/api/entities`** — documents that message
  entities (bold, italic, links, code spans) are positional and that, when escaping,
  "any markdown entity must first be closed before and reopened after". Our splitter
  applies the same close-before / reopen-after principle, but to **fenced code
  blocks** at chunk boundaries.
  <https://core.telegram.org/api/entities>
- **grammY `ParseMode`** and **`telegram-markdown-v2`** (npm) — confirm that the
  fenced-code-block language (` ```js `) is part of the entity and must be carried
  along; dropping it on reopen would lose syntax highlighting. Our `reopenFenceLine()`
  repeats the captured language for this reason.
  <https://grammy.dev/ref/types/parsemode> · <https://www.npmjs.com/package/telegram-markdown-v2>

### Why not adopt an external library?

- All mature splitters that understand code blocks are **Python**
  (`telegramify-markdown`); this codebase is Node/ESM.
- The Node options either don't split at all (`telegram-markdown-v2` is a
  _formatter_, not a splitter) or split without code-fence awareness
  (the `node-telegram-bot-api` #534 snippets).
- We already own a universal splitter that every send path funnels through. Bolting a
  dependency on would mean either replacing that hub (risk to every message) or
  running two splitters. Extending our own in place — ~60 lines, fully tested — is
  lower-risk and keeps the "one universal method" the issue explicitly relies on.

## Sources

- <https://github.com/sudoskys/telegramify-markdown>
- <https://github.com/yagop/node-telegram-bot-api/issues/534>
- <https://github.com/yagop/node-telegram-bot-api/issues/165>
- <https://core.telegram.org/api/entities>
- <https://grammy.dev/ref/types/parsemode>
- <https://www.npmjs.com/package/telegram-markdown-v2>
