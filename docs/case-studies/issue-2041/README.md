# Issue 2041 Case Study: Fix all CI/CD false positives, false negatives, warnings and errors

## Summary

Issue 2041 asks us to sweep the CI/CD pipeline for **any** failing checks, false
positives, false negatives, warnings, or errors, and fix every one of them —
applying the fix across the whole codebase (not just one spot) and reusing best
practices from the four `*-ai-driven-development-pipeline-template` repositories.
The concrete trigger is a red run:

- https://github.com/link-assistant/hive-mind/actions/runs/29125268021

The raw failing log is archived in `data/run-29125268021-failed.log`.

## Timeline / sequence of events

1. Issues #2032 and #2038 reworked the `--think` option from a fixed yargs
   `choices` enum into a rich, normalized vocabulary (off synonyms, `minimal`,
   `adaptive`, numeric percentages/fractions). Validation moved out of yargs'
   built-in `choices` mechanism into a shared `normalizeAndValidateThink(argv)`
   helper in `src/solve.config.lib.mjs`.
2. `hive.config.lib.mjs` wired that helper into its yargs config via a
   `.check(argv => { normalizeAndValidateThink(argv); return true; })` so parsing
   itself rejects invalid `--think` values.
3. `solve.config.lib.mjs` **did not** add the same `.check()`. Instead it only
   called `normalizeAndValidateThink(argv)` in `parseArguments()` — the CLI entry
   path used by `solve.mjs`. Any consumer that parses solve options through the
   yargs config _without_ going through `parseArguments()` therefore lost
   `--think` validation entirely.
4. The Telegram bot is exactly such a consumer: `src/telegram-bot.mjs:866` calls
   `parseArgsWithYargs(args, yargs, createSolveYargsConfig)` to validate solve
   options. After the #2038 refactor, `/solve … --think <invalid>` was silently
   accepted (a **false negative** — a genuine CI/production regression).
5. The regression test `tests/test-telegram-options-before-url.mjs` (guarding
   issue #1662) still expected the _old_ yargs `choices` error format
   (`Argument: think, Given: "ma"`, with quoted `"off"`/`"max"` choices). Because
   `parseArgsWithYargs` no longer rejected the value at all, the test failed with
   **"Missing expected rejection."** — this is the check that turned run
   29125268021 red (`test-suites` → "Run default test suite").

## Requirements (enumerated from the issue body)

- R1: Find and fix every CI/CD false positive, false negative, warning, and error.
- R2: Reuse best practices from the JS/Rust/Python/C# pipeline templates and, if
  the same problem exists in a template, report it upstream.
- R3: Download the logs/data for the failing run into
  `./docs/case-studies/issue-2041/` and produce a deep case-study analysis
  (timeline, requirements, root causes, solution plans, existing components).
- R4: If data is insufficient to find the root cause, add debug/verbose output so
  the next iteration can.
- R5: If the problem relates to another reportable repository, file an issue there
  with a reproducible example, workaround, and fix suggestion.
- R6: Apply each fix across the entire codebase (fix in all affected places).

## Root cause

**Validation asymmetry between `solve.config` and `hive.config`.** The #2038
refactor centralized `--think` validation in `normalizeAndValidateThink()` but
only `hive.config.lib.mjs` invoked it from inside its yargs config
(`.check()`). `solve.config.lib.mjs` relied solely on the CLI `parseArguments()`
path calling it. Every non-CLI consumer of the solve yargs config — most
importantly the Telegram bot's `parseArgsWithYargs()` — therefore performed no
`--think` validation, so invalid values were accepted (false negative). The
regression test caught the gap but asserted the pre-#2038 error format, so it
reported the failure as a hard error.

## Fix

1. `src/solve.config.lib.mjs`: add the same `.check(argv => { normalizeAndValidateThink(argv); return true; })`
   to `createYargsConfig`, mirroring `hive.config.lib.mjs`. Now any consumer that
   parses solve options through the yargs config (CLI **and** Telegram) rejects
   invalid `--think` values consistently. This closes R1/R6 for the `--think`
   surface — the fix now lives in every place that builds a solve/hive parser.
2. `tests/test-telegram-options-before-url.mjs`: update the assertions to the
   #2038 vocabulary (`Invalid --think value: "ma"`, listing
   `off, minimal, low, medium, high, xhigh, ultra, max`) while still guarding the
   original #1662 intent — the guidance is reported **once**, not duplicated per
   URL-probing parse.

## Verification

- `node tests/test-telegram-options-before-url.mjs` → 4 passed, 0 failed.
- Related `--think` suites remain green: `test-issue-2032-default-think-off.mjs`,
  `test-issue-2038-think-normalization.mjs`, `test-claude-think-prompt-gating.mjs`.

## Existing components reused

- `normalizeThinkLevel` / `ADAPTIVE_THINK_LEVEL` (`src/think-level.lib.mjs`) — the
  canonical `--think` vocabulary and validation, already the source of truth.
- yargs `.check()` — the same mechanism `hive.config.lib.mjs` already used; the
  fix simply brings `solve.config` to parity rather than inventing new validation.

## Templates (R2)

The `--think` option and the solve/hive yargs configs are specific to hive-mind
and are not present in the generic pipeline templates
(`js/rust/python/csharp-ai-driven-development-pipeline-template`), so this
particular false-negative does not exist upstream and needs no upstream report.
The general lesson — _keep validation attached to the parser, not to one entry
path_ — is a codebase practice rather than a template workflow change.
