# Case Study: Issue #1658 - `(--isolation screen)` in Telegram LINO configuration

- Issue: [link-assistant/hive-mind#1658](https://github.com/link-assistant/hive-mind/issues/1658)
- Prepared PR: [link-assistant/hive-mind#1659](https://github.com/link-assistant/hive-mind/pull/1659)

## Summary

Issue #1658 reported that `hive-telegram-bot --configuration` failed with:

```text
Error: TELEGRAM_BOT_TOKEN not set. Use --token or TELEGRAM_BOT_TOKEN env var.
```

The failure happened when `TELEGRAM_HIVE_OVERRIDES` or `TELEGRAM_SOLVE_OVERRIDES`
contained a parenthesized Links Notation option/value link:

```text
(--isolation screen)
```

Removing that line made the bot start, but the line is valid Links Notation and is
the natural form for CLI options that take a separate value.

## Requirements Extracted

1. `(--isolation screen)` must be accepted in Telegram bot LINO configuration.
2. Option/value links must work for all configured override lists that use separate
   CLI option values, not only for `--isolation`.
3. LENV parsing and LINO string-value parsing must both preserve those option/value
   links.
4. Existing validation should continue rejecting unparenthesized same-line option
   mistakes such as `--option1 --option2`.
5. `--isolation` in locked Telegram overrides must be consumed by Telegram isolation
   handling and not forwarded to solve/hive yargs validation.
6. Issue data and reproduction evidence must be preserved in this case-study folder.
7. Direct `--isolation screen` argument vectors must preserve `screen` as the
   effective Telegram execution isolation backend for solve/hive launches.

## Data Inventory

Saved source data:

- `source-data/github/issue-1658.json`
- `source-data/github/issue-1658-comments.json`
- `source-data/github/pr-1659.json`
- `source-data/github/pr-1659-review-comments.json`
- `source-data/github/pr-1659-conversation-comments.json`
- `source-data/github/pr-1659-reviews.json`
- `source-data/npm/links-notation-npm-view.json`
- `source-data/reproduction/before-dry-run.log`
- `source-data/reproduction/before-dry-run.exit-code`
- `source-data/reproduction/after-dry-run.log`
- `source-data/reproduction/after-dry-run.exit-code`

The refreshed PR source data includes five PR conversation comments and no PR
review comments or submitted reviews. The third conversation comment requested an
explicit double-check that `--isolation screen` is passed through correctly.

## Online Research

Sources checked on April 23, 2026:

- npm metadata for `links-notation`, saved locally in
  `source-data/npm/links-notation-npm-view.json`.
- jsDelivr package page for `links-notation`:
  https://www.jsdelivr.com/package/npm/links-notation
- docs.rs page for `links-notation` 0.13.0:
  https://docs.rs/crate/links-notation/0.13.0

Relevant facts:

- The latest observed `links-notation` package version is `0.13.0`.
- The package is described as a Links Notation parser for JavaScript.
- The parser documentation shows that parenthesized single-line links are valid,
  including forms equivalent to `(id: value1 value2)`.

Inference from sources:

- The external parser is behaving consistently by returning a nested link for
  `(--isolation screen)`.
- The bug was in Hive Mind's adapter logic: it rejected or dropped nested links
  before they could become CLI arguments.

## Timeline

- 2026-04-23 22:24 UTC: Issue #1658 opened with a Telegram bot configuration that
  fails only when `(--isolation screen)` is present.
- 2026-04-23 22:25 UTC: Draft PR #1659 created for branch
  `issue-1658-eb9d0c1c5c6a`.
- Investigation reproduced the failure with Telegram env vars removed:
  `source-data/reproduction/before-dry-run.log`.
- The fix was verified with `--dry-run`; the same configuration now exits 0 and
  keeps `--isolation` plus `screen` in both override summaries:
  `source-data/reproduction/after-dry-run.log`.
- 2026-04-23 22:53 UTC: PR feedback requested a direct double-check for
  `--isolation screen` pass-through to solve/hive command execution.
- 2026-04-23 22:54 UTC: PR #1659 was converted back to draft for this follow-up
  work session and the GitHub source-data files were refreshed.

## Root Causes

1. `LenvReader.parse()` treated any nested tuple mixed with direct list items as a
   same-line formatting error. That caught invalid input like `--a --b`, but it
   also rejected valid parenthesized links like `(--isolation screen)`.
2. `LinksNotationManager.parseStringValues()` only returned top-level string
   values, so nested option/value links were silently dropped when they were not
   rejected earlier.
3. Telegram startup validation passed configured overrides directly into solve/hive
   yargs. Once `--isolation screen` is preserved, yargs must not see it because
   `--isolation` is a Telegram execution option, not a solve/hive CLI option.
4. `loadLenvConfig()` was called without `await`, which could turn configuration
   parser failures into misleading downstream errors such as "token not set".

## Implemented Fix

1. Flatten nested LINO links into string argument values for LENV and LINO
   string-value parsing.
2. Preserve the same-line validation by checking raw configuration lines: bare
   `--option value` remains invalid, while explicit `(--option value)` is valid.
3. Strip and validate `--isolation` from configured solve/hive overrides before
   yargs validation.
4. Strip `--isolation` again after merging locked overrides with user arguments,
   then pass the effective isolation backend to execution or queueing.
5. Await LENV configuration loading in the Telegram bot entry point.
6. Add regression coverage for the issue #1658 configuration shape.
7. Include the direct `--isolation screen` extraction test in the main `npm test`
   suite so CI verifies that `screen` is retained as the effective backend.

Note: solve/hive yargs configs do not define an `--isolation` option. In the
Telegram bot, correct pass-through means parsing `--isolation screen` into the
effective execution backend, stripping those two tokens before solve/hive yargs
validation, and passing that backend to `isolation-runner` for execution or
queueing.

## Rejected Alternatives

1. Remove the same-line validation entirely.
   Rejected because issue #1086 added that validation to prevent malformed override
   lists from being silently truncated.
2. Preserve `(--isolation screen)` as a single literal string.
   Rejected because solve/hive execution expects an argument vector:
   `--isolation`, `screen`.
3. Add an issue against `links-notation`.
   Rejected because the parser output is compatible with the documented LINO model;
   Hive Mind needed to flatten the parsed structure correctly.

## Verification

Focused checks:

```bash
node tests/test-lenv-reader.mjs
node tests/test-lino.mjs
node tests/test-telegram-bot-configuration-isolation-links-notation.mjs
node tests/test-extract-isolation-from-args.mjs
node tests/test-telegram-bot-hero-links-notation.mjs
```

Repository checks:

```bash
npm run lint
npm run format:check
npm test
```

The new dry-run regression explicitly unsets all Telegram-related environment
variables so `TELEGRAM_BOT_TOKEN` must come from `--configuration`.
