# Issue 1966 Case Study: Fuzzy Suggestions for Unknown Options

## Summary

Issue: https://github.com/link-assistant/hive-mind/issues/1966
Pull request: https://github.com/link-assistant/hive-mind/pull/1967
Prepared branch: `issue-1966-22ab94789f7c`
Investigation date: 2026-06-21

The reported Telegram command used `--mode opus` where the intended option was
`--model opus`. The bot replied with only the raw yargs error:

```text
❌ Invalid options: Unknown argument: mode

Use /help to see available options
```

The requested behavior was to show a direct suggestion such as
`Did you mean --model option?` and include four more close alternatives. The same
friendly behavior was requested for Telegram bot commands and CLI commands.

## Evidence

- Issue screenshot: [issue-screenshot.png](./issue-screenshot.png)
- Issue metadata: [issue.json](./issue.json)
- Issue comments: [issue-comments.json](./issue-comments.json)
- PR metadata: [pr.json](./pr.json)
- PR conversation comments: [pr-conversation-comments.json](./pr-conversation-comments.json)
- PR review comments: [pr-review-comments.json](./pr-review-comments.json)
- PR reviews: [pr-reviews.json](./pr-reviews.json)

## Root Cause

The repository already had `src/option-suggestions.lib.mjs`, but it was only
used by the solve CLI parsing path. Telegram `/solve` and `/hive` commands use
`parseArgsWithYargs()` from `src/telegram-solve-command.lib.mjs`, which threw the
raw yargs error without calling the suggestion helper.

The existing suggestion helper also returned only three suggestions by default
and collected single-letter aliases alongside full option names. For the
reported typo `mode`, the current helper produced:

```text
Unknown argument: mode

Did you mean one of these?
  • --model
  • -d
  • -m
```

That explained both problems: Telegram did not use the helper, and the helper's
ranking/formatting was not aligned with the requested top-match-plus-four UI.

## Online Research

These references were used to compare expected CLI behavior:

- Commander documents that unknown options are treated as errors and shows
  built-in "Did you mean" suggestions for similar options:
  https://github.com/tj/commander.js/blob/master/Readme.md
- Commander API docs expose `showSuggestionAfterError` for similar
  command/option suggestions:
  https://www.jsdocs.io/package/commander
- oclif supports friendly error output with explicit suggestions:
  https://oclif.io/docs/commands/
- oclif flag documentation frames flags/options as first-class command inputs,
  which supports validating option typos at the parser boundary:
  https://oclif.io/docs/flags/

## Fix

The fix centralizes unknown-option enhancement at parser boundaries:

- `src/option-suggestions.lib.mjs`
  - Defaults to five suggestions.
  - Prefers canonical long option names over one-letter aliases.
  - Normalizes camelCase, snake_case, and kebab-case before ranking.
  - Formats the closest match as `Did you mean \`--option\` option?`.
  - Lists remaining close matches under `Other close matches:`.
  - Exposes `enhanceUnknownArgumentError()` so callers can preserve error
    handling while marking enhanced errors.
- `src/cli-arguments.lib.mjs`
  - Enhances yargs unknown-option errors for shared CLI commands.
- `src/telegram-solve-command.lib.mjs`
  - Enhances Telegram `/solve` and `/hive` parse errors.
- `src/telegram-task-command.lib.mjs`
  - Validates `/split` and `/task --split` arguments before spawning `task`, so
    unknown options are reported immediately in Telegram.
- `src/telegram-bot.mjs`
  - Enhances startup validation errors for `TELEGRAM_SOLVE_OVERRIDES` and
    `TELEGRAM_HIVE_OVERRIDES`.

## Reproduction Test

The regression test in `tests/test-option-suggestions-1966.mjs` reproduces the
reported typo:

```text
/claude https://github.com/link-assistant/hive-mind/pull/1965 --mode opus
```

Before the fix, the test failed because the message did not contain
`Did you mean \`--model\` option?` and short aliases crowded the suggestions.
The failure log is saved as
[test-option-suggestions-before.log](./test-option-suggestions-before.log).

After the fix, the same path produces:

```text
Unknown argument: mode

Did you mean `--model` option?

Other close matches:
  • `--plan-model`
  • `--worker-model`
  • `--fallback-model`
  • `--finalize-model`
```

The passing logs are saved as:

- [test-option-suggestions-after.log](./test-option-suggestions-after.log)
- [test-telegram-task-after.log](./test-telegram-task-after.log)

## Verification

Local commands run:

```bash
node tests/test-option-suggestions-1966.mjs
node tests/test-telegram-task-command.mjs
npm run format:check
npm run lint
npm test
npm ci --loglevel verbose
```

Verification logs:

- [test-option-suggestions-after.log](./test-option-suggestions-after.log)
- [test-telegram-task-after.log](./test-telegram-task-after.log)
- [format-check.log](./format-check.log)
- [lint.log](./lint.log)
- [npm-test.log](./npm-test.log)
- [npm-ci.log](./npm-ci.log)
