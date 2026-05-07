# Case Study: Issue #1618 - Per-Tool `/solve` Aliases in Telegram Bot

## Summary

Issue #1618 requests four Telegram command aliases:

```text
/claude
/codex
/opencode
/agent
```

Each alias should behave like `/solve --tool <tool>`, while preserving the existing
`/solve`, `/do`, and `/continue` commands. The implementation adds shared solve-command
parsing helpers, registers all aliases in both Telegraf command handling and the text fallback,
updates `/help`, and updates the related documentation.

## Requirements From Issue #1618

| Requirement                | Implementation plan                                                                                  | Status |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ------ |
| Add `/claude` alias        | Parse `/claude ...` and append `--tool claude` before solve validation and queueing.                 | Done   |
| Add `/codex` alias         | Parse `/codex ...` and append `--tool codex` before solve validation and queueing.                   | Done   |
| Add `/opencode` alias      | Parse `/opencode ...` and append `--tool opencode` before solve validation and queueing.             | Done   |
| Add `/agent` alias         | Parse `/agent ...` and append `--tool agent` before solve validation and queueing.                   | Done   |
| Preserve existing aliases  | Keep `/solve`, `/do`, and `/continue` on the same handler with unchanged argument behavior.          | Done   |
| Update `/help`             | List all aliases and explain that tool aliases imply `--tool <tool>`.                                | Done   |
| Update related docs        | Update README, localized README files, CONFIGURATION docs, and FREE_MODELS Telegram examples.        | Done   |
| Compile issue data locally | Store issue, PR, comments, related PRs, and code-search evidence under this case-study folder.       | Done   |
| Research related facts     | Check Telegram command constraints and recent related repository PRs before choosing the design.     | Done   |
| Add regression coverage    | Extend the Telegram command alias test to cover plain aliases, tool aliases, bot mentions, and wins. | Done   |

## Raw Data Collected

| Path                                                     | Source                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| `raw-data/issue-1618.json`                               | `gh issue view 1618`                                       |
| `raw-data/issue-1618-comments.json`                      | Issue comments API with `--paginate`                       |
| `raw-data/pr-1619.json`                                  | Existing prepared PR #1619                                 |
| `raw-data/pr-1619-issue-comments.json`                   | PR conversation comments API with `--paginate`             |
| `raw-data/pr-1619-review-comments.json`                  | PR review comments API with `--paginate`                   |
| `raw-data/related-prs-telegram-alias.json`               | Merged PR search for `telegram alias`                      |
| `raw-data/related-prs-telegram-command.json`             | Merged PR search for `telegram command`                    |
| `raw-data/pr-564.json`                                   | Prior `/do` and `/continue` alias PR details               |
| `raw-data/pr-564.diff`                                   | Prior `/do` and `/continue` alias implementation diff      |
| `raw-data/github-code-search-telegram-solve-aliases.txt` | Repository code search for existing Telegram solve aliases |

## External Facts

Telegram's `BotCommand` object constrains command text to 1-32 characters using lowercase
English letters, digits, and underscores. The requested `/claude`, `/codex`, `/opencode`,
and `/agent` commands satisfy that constraint.

Source: https://core.telegram.org/bots/api#botcommand

## Existing Components Reviewed

| Component                                     | Relevant behavior                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/telegram-bot.mjs`                        | Handles `/solve`, `/do`, `/continue`, validates args, merges locked solve overrides, queues by tool.    |
| `src/telegram-message-filters.lib.mjs`        | Provides text fallback command extraction for messages where Telegram command entities are unavailable. |
| `src/solve.config.lib.mjs`                    | Already defines `--tool` choices: `claude`, `opencode`, `codex`, and `agent`.                           |
| `tests/test-telegram-bot-command-aliases.mjs` | Existing test file for `/do` and `/continue`; now extended to cover the per-tool aliases.               |
| PR #564                                       | Prior alias implementation established the shared-handler and text-fallback pattern for solve aliases.  |

No new external library is needed. The existing Telegraf command registration, text fallback,
and solve yargs validation already provide the necessary extension points.

## Root Cause

The bot already had a shared `handleSolveCommand()` for `/solve`, `/do`, and `/continue`, but
the command list was hard-coded in two places: `bot.command(...)` and the text fallback handler.
Argument parsing also lived inline in `telegram-bot.mjs`, which made alias-specific behavior
hard to test without loading the full bot.

That was enough for plain aliases, but not for per-tool aliases that must modify solve arguments
before validation, duplicate-session checks, queue selection, and execution.

## Solution

1. Add `src/telegram-solve-command.lib.mjs` with pure helpers:
   - shared solve command names
   - per-tool alias map
   - command argument parsing
   - tool alias detection
   - `--tool` replacement so `/codex ... --tool claude` still runs as Codex
2. Import those helpers from `src/telegram-bot.mjs`.
3. Register all solve command names with Telegraf.
4. Build the text fallback handler map from the same command-name list.
5. Apply the tool alias before reply URL extraction, option validation, override merging, queue checks, and execution.
6. Update `/help` and related docs.
7. Add the alias test to `npm test`.

## Alternatives Considered

| Option                                 | Tradeoff                                                                                       | Decision |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- | -------- |
| Hard-code four more aliases inline     | Fast, but duplicates command names in two places and pushes `telegram-bot.mjs` near CI limits. | Rejected |
| Add separate handlers per tool alias   | Simple to read at first, but repeats validation, queueing, and execution logic.                | Rejected |
| Prepend `--tool <tool>` to user args   | Closest textual expansion, but keeps conflicting user `--tool` values ambiguous.               | Rejected |
| Shared helper plus authoritative alias | Keeps one command registry, remains testable, and makes `/codex` reliably mean Codex.          | Chosen   |

## Regression Coverage

`tests/test-telegram-bot-command-aliases.mjs` covers:

- `/solve`, `/do`, and `/continue` remain plain solve commands.
- `/claude`, `/codex`, `/opencode`, and `/agent` append the expected `--tool` value.
- Bot mentions like `/agent@SwarmMindBot` parse correctly.
- Telegram em-dash normalization still works.
- Explicit user `--tool` values are replaced by the command alias, so the command name wins.
- Every per-tool alias is included in the shared command-name registry.

## Residual Risk

The helper treats the command alias as authoritative when users also pass a conflicting `--tool`
argument. This is deliberate because `/codex ... --tool claude` is otherwise ambiguous, and command
names are the user-facing shortcut being requested. Locked `TELEGRAM_SOLVE_OVERRIDES` still run
after user args and can override the alias when administrators intentionally enforce a bot policy.
