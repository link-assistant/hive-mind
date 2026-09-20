# Issue 1734 Case Study: `/task` Issue Creation

## Summary

Issue 1734 requested that `hive-telegram-bot` support creating GitHub issues from `/task` messages. The missing behavior was caused by the Telegram `/task` command being hard-wired to task splitting: every `/task` invocation received `--split`, and the command handler required an existing GitHub issue URL.

The implemented solution adds an issue-creation path for `/task` while keeping `/split` and `/task --split` on the existing task-splitting path.

## Raw Data

- `data/issue-1734.json`: issue metadata and body.
- `data/issue-1734-comments.json`: issue comments; empty at investigation time.
- `data/pr-1735.json`: prepared PR metadata before implementation.
- `data/pr-1735-comments.json`, `data/pr-1735-review-comments.json`, `data/pr-1735-reviews.json`: PR discussion channels; empty at investigation time.
- `data/pr-1735-initial.diff`: initial prepared PR diff, containing only the generated `.gitkeep` timestamp update.
- `data/related-prs-telegram-task-split.json`: recent merged PRs related to Telegram task/split behavior.
- `data/research-sources.json`: external references checked during analysis.

## Requirements

- `/task` should create a GitHub issue from a repository link and issue text.
- The repository link may appear before or after the issue text.
- The repository link may be provided through `--repository <link>` before or after the issue text.
- The same layouts must work when `/task` is sent inline or as a reply to a message containing the repository and issue text.
- The created issue title must come from the first issue-text line and be truncated with `...` when it exceeds the GitHub title limit used by the bot.
- The issue body must preserve the full issue text.
- The bot must reply to the `/task` command message with the full created issue URL so `/solve` can be used as a reply to that bot response.
- `/split` and explicit `/task --split` must keep the existing task-splitting behavior.

## Root Cause

`src/telegram-task-command.lib.mjs` used `applyTaskCommandDefaults()` to append `--split` to all task command arguments. That made `/task` an alias for the splitter rather than a distinct issue-creation command. The handler also validated only existing GitHub issue URLs, so repository URLs and free-form issue text had no valid execution path.

## Solution

- Added `src/task.issue-creation.lib.mjs` to parse repository-plus-issue-text payloads, derive titles, create issues through `gh issue create`, and parse the returned issue URL.
- Changed `/task` defaults so only `/split` auto-adds `--split`; `/task --split` still works explicitly.
- Added a `/task` issue-creation branch in the Telegram command handler.
- Kept splitter execution for `/split` and `/task --split`.
- Updated Telegram help text to document `/task` issue creation separately from `/split`.
- Added regression tests for all required repository/text layouts and title truncation.

## Verification

- `node tests/test-telegram-task-command.mjs`
- `npm run lint -- --quiet`
- `npm test`

All 79 default test files passed locally. The local environment used Node v20.20.2 even though `package.json` declares `node >=24.0.0`; the test suite still passed in this environment.
