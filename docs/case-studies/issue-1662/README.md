# Case Study: Issue #1662 - Telegram Options Before URL

## Summary

Issue #1662 reported that a Telegram command shaped like this failed:

```text
/codex --model gpt-5.4-mini https://github.com/konard/p-vs-np/issues/476
```

The bot responded with `First argument must be a GitHub URL` even though the URL was present. The failure was reproduced from the attached screenshot and the raw issue body. The root cause was Telegram-side validation reading `args[0]` as the URL, while normal CLI parsing allows named options before the first positional argument.

## Local Evidence

Captured files:

| File                           | Purpose                                            |
| ------------------------------ | -------------------------------------------------- |
| `issue-1662.json`              | Raw issue title, body, labels, timestamps, and URL |
| `issue-1662-comments.json`     | Issue comments, empty at capture time              |
| `issue-1662-events.json`       | Issue event timeline                               |
| `pr-1663.json`                 | Prepared PR metadata                               |
| `pr-1663-comments.json`        | PR conversation comments, empty at capture time    |
| `pr-1663-review-comments.json` | PR inline review comments, empty at capture time   |
| `pr-1663-reviews.json`         | PR reviews, empty at capture time                  |
| `screenshot-08ce9e7a.png`      | Verified PNG screenshot from the issue             |
| `research-sources.json`        | External source list                               |

The screenshot shows the failing command and the bot response. The command uses `/codex`, which is a Telegram alias for `/solve --tool codex`.

## Timeline

| Time                             | Event                                                                       |
| -------------------------------- | --------------------------------------------------------------------------- |
| 2026-04-24 08:09:29 UTC          | Issue #1662 was opened with the failing `/codex --model ... <url>` command. |
| 2026-04-24 08:09:51 UTC          | Issue metadata was updated.                                                 |
| 2026-04-24 current investigation | The prepared PR #1663 was still draft and had no comments or reviews.       |

## Requirements

1. Telegram `/solve`-family commands must accept options before the first positional URL.
2. Per-tool aliases such as `/codex`, `/claude`, `/opencode`, and `/agent` must keep working.
3. Reply-to-message URL extraction must still work for commands such as `/solve --model opus`.
4. `/hive` should follow the same option-before-positional behavior because it also accepts options and a GitHub URL.
5. The implementation should reuse yargs parsing behavior rather than custom `args[0]` validation.
6. A regression test should cover the reported command shape.

## Root Cause

`parseCommandArgs()` tokenized the command correctly:

```text
["--model", "gpt-5.4-mini", "https://github.com/konard/p-vs-np/issues/476"]
```

After applying the `/codex` tool alias, the URL was still present, but not at index 0. `validateGitHubUrl()` then cleaned and validated only `args[0]`, so it validated `--model` instead of the yargs positional URL.

The same assumption also affected display and execution metadata, because several downstream paths expected the URL to be first after validation.

## External Research

Yargs documents command positional arguments via `positional()` and command options. The yargs-parser README describes the parsed result as key/value option entries plus `_` for positional arguments. This supports using the configured yargs parser to identify the command URL rather than assuming the first raw token is positional.

Sources:

- https://yargs.js.org/
- https://github.com/yargs/yargs-parser

## Solution

The fix adds shared Telegram argument helpers in `src/telegram-solve-command.lib.mjs`:

- `parseArgsWithYargs()` parses Telegram token arrays through the same yargs config used by `solve` and `hive`.
- `getFirstParsedPositionalArg()` reads yargs positional output by dashed or camel-case name.
- `moveArgumentToFront()` normalizes the validated positional URL back to the legacy URL-first internal shape.

`src/telegram-bot.mjs` now:

- uses yargs positional parsing before deciding whether a replied message should be scanned for a URL;
- validates `/solve` and `/hive` URLs from parsed positional arguments;
- keeps malformed flag detection before URL validation;
- suppresses noisy yargs stderr during Telegram-side validation;
- keeps execution arguments URL-first after validation for existing queue/session code.

## Verification

Focused tests:

```bash
node tests/test-telegram-options-before-url.mjs
node tests/test-telegram-bot-command-aliases.mjs
node tests/test-solve-reply-with-options.mjs
node tests/test-telegram-validate-url.mjs
```

Broader checks:

```bash
npm run lint
npm test
```

`npm test` now includes `tests/test-telegram-options-before-url.mjs` so the reported command shape is covered by the configured test suite.
