# Issue 2021 Case Study: Joined GitHub URL Options

## Artifacts

- `issue.json`: raw issue metadata from GitHub API.
- `issue-comments.json`: raw issue comments; the issue had no comments at investigation time.
- `pr-2022.json`: prepared pull request metadata before this fix.
- `pr-conversation-comments.json`, `pr-review-comments.json`, `pr-reviews.json`: raw PR discussion/review data; all were empty at investigation time.
- `issue-2021-screenshot.png`: downloaded screenshot from the issue body and verified as a PNG before inspection.

## Timeline

- 2026-07-07 12:56:35 UTC: issue 2021 opened with a Telegram screenshot showing a command rejected by the bot.
- 2026-07-07 14:25:27 UTC: issue 2021 last updated before implementation.
- 2026-07-07 14:37:29 UTC: PR 2022 opened as a draft placeholder from branch `issue-2021-3f5114d020d4`.
- 2026-07-07: local reproduction showed the Telegram parser kept `https://github.com/leaderstat/wb-part2/issues/169--model` as one token, and the CLI parser treated the following `opus` token as an unknown argument.

## Requirements

- Support Telegram bot commands where a GitHub issue or pull request URL is immediately followed by an option marker without a separating space.
- Support the same joined URL and option form in the CLI.
- Preserve the existing convenience where typographic dashes are interpreted as long option prefixes.
- Apply the behavior to `--model` and other long options.
- Compile issue and PR data under `docs/case-studies/issue-2021`.
- Reconstruct the sequence of events, identify root cause, evaluate reusable components, and document solution options.

## Root Cause

Telegram command parsing had a local normalization pass that changed U+2014 em dash to `--`, then split only on whitespace. A command such as:

```text
/claude https://github.com/leaderstat/wb-part2/issues/169—model opus
```

effectively became one positional token ending in `169--model`, followed by `opus`.

The same token shape could also reach CLI parsing when a user typed or pasted a GitHub issue URL joined directly to a long option. Because the URL and option marker were already in one argv item, the downstream yargs/lino parser did not have a distinct `--model` token to parse.

## Research Notes

- Node exposes command-line arguments as an already-split `process.argv` array, so this fix belongs before option parsing for CLI entry points: https://nodejs.org/api/process.html#processargv
- `yargs-parser` accepts a string or array of args and parses options from those inputs, but it does not infer that the suffix of a positional URL is a separate option token: https://github.com/yargs/yargs-parser/blob/main/README.md
- Shell-style parsers such as `shell-quote` can parse quoted command strings, but they cover a broader POSIX shell grammar and would add avoidable dependency and behavior surface for Telegram messages: https://github.com/ljharb/shell-quote
- GitHub documents issue and pull request URL references using the `/issues/{number}` and related URL shapes, matching the positional URL accepted by this project: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls

## Solution Options

1. Add a shell-like tokenizer to Telegram command parsing.
   This would help with some command strings, but it is heavier than needed and does not address real CLI argv values that are already split by the OS/runtime.

2. Configure yargs/lino differently.
   This cannot fully solve the problem because yargs sees one positional argv item. It needs a separate `--model` or `--verbose` token before option parsing begins.

3. Add a shared pre-parser normalization step.
   This is the implemented option. It normalizes typographic long-option dashes and splits only GitHub issue or pull request URL tokens that end with a long-option marker, for example `.../issues/169--model`.

## Implemented Plan

- Added `src/argument-normalization.lib.mjs` with a focused `normalizeCliArgs()` helper.
- Reused that helper from Telegram parsing and CLI parsing.
- Normalized raw argv in `solve` and `hive` entry paths so explicit option detection and parser input stay consistent.
- Added regression coverage in `tests/test-issue-2021-joined-options.mjs` for Telegram and CLI inputs.

## Verification

- Before the fix, the new regression test failed with Telegram returning one joined URL token and CLI reporting `Unknown argument: opus`.
- After the fix:
  - `node tests/test-issue-2021-joined-options.mjs`
  - `node tests/test-telegram-bot-command-aliases.mjs`
  - `node tests/test-telegram-options-before-url.mjs`
  - `node tests/test-malformed-flags.mjs`
  - `node tests/test-lino-arguments-cli.mjs`
  - `npm run lint`
  - `npm run test`

All listed commands passed locally.
