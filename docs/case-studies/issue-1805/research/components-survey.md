# Components Survey — Issue #1805

This survey looks at existing in-tree helpers and notable external libraries
that match the sub-problems we have to solve. The goal is to avoid
re-implementing anything that is already battle-tested.

## In-tree helpers

| Helper                                 | File                                     | Used for                                                                                                                                             |
| -------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseCommandArgs(text)`               | `src/telegram-merge-command.lib.mjs`     | Tokenising the args after `/merge`. Reused as-is — we only filter the result.                                                                        |
| `escapeMarkdownV2(text)`               | `src/telegram-merge-command.lib.mjs`     | Escaping labels in Telegram MarkdownV2 messages. Reused for new link labels.                                                                         |
| `MergeQueueProcessor.escapeMarkdown()` | `src/telegram-merge-queue.lib.mjs`       | Same escaper as above, scoped to the queue rendering. Reused.                                                                                        |
| `checkPRMergeable()`                   | `src/github-merge.lib.mjs`               | Tells the queue "this PR has merge conflicts" — the same flag we filter on for auto-resolve.                                                         |
| `getAllReadyPRs()`                     | `src/github-merge.lib.mjs`               | Already returns `{ pr.url, issue.url, … }` — everything we need to build links.                                                                      |
| `startAutoRestartUntilMergeable()`     | `src/solve.auto-merge.lib.mjs`           | The `--auto-merge` entry point from `solve.mjs`. We rely on it transitively when spawning a `solve` session for each conflicted PR.                  |
| `executeStartScreen('solve', args)`    | `src/telegram-command-execution.lib.mjs` | Spawns a `solve` session inside the screen-managed environment that the rest of the bot uses. The natural way to run the per-PR `--auto-merge` step. |
| `getProgressBar(pct)`                  | `src/limits.lib.mjs`                     | Reused unchanged for the progress message header.                                                                                                    |

## External libraries considered

- **Telegraf** — already present. We don't need additional libraries to render
  links; MarkdownV2 supports inline `[label](url)` and Telegraf forwards the
  `parse_mode: 'MarkdownV2'` request directly.
- **markdown-it / remark / etc.** — not relevant. Telegram has its own dialect
  of MarkdownV2 (not CommonMark) so a stricter renderer would mis-escape the
  output.
- **`yargs` / `commander`** — already used by `solve` for its CLI parsing, but
  the `/merge` command historically uses a custom tokeniser. Adding yargs just
  for one boolean flag is not worth the surface-area expansion (the issue
  description does not ask for richer arg semantics).
- **`gh` CLI** — already used throughout; conflict detection (`mergeStateStatus
=== 'DIRTY'`) is exposed through `checkPRMergeable()`.

## Conclusion

Everything needed for issue #1805 is already in the tree. The work is
**glue + rendering**: thread one flag through `/merge`, surface a small new
method on `MergeQueueProcessor`, and rewrite three text spans to emit
MarkdownV2 links.
