# Case Study: Issue #1930 Cleanup Confirmation and Command Rename

Issue: https://github.com/link-assistant/hive-mind/issues/1930
PR: https://github.com/link-assistant/hive-mind/pull/1934
Branch: `issue-1930-79b41127892b`

## Data Collected

Raw GitHub snapshots and verification logs are saved in `data/`:

| File                                 | Contents                                                    |
| ------------------------------------ | ----------------------------------------------------------- |
| `issue-1930.json`                    | Issue title, body, labels, timestamps, and URL.             |
| `issue-comments.json`                | Issue comments. Empty at investigation time.                |
| `pr-1934.json`                       | Prepared PR state, body, commits, and checks.               |
| `pr-conversation-comments.json`      | PR conversation comments. Empty at investigation time.      |
| `pr-review-comments.json`            | PR inline review comments. Empty at investigation time.     |
| `pr-reviews.json`                    | PR reviews. Empty at investigation time.                    |
| `related-merged-prs.json`            | Recent merged PRs found with `cleanup` search.              |
| `confirmation-reproduction.txt`      | Old trim/lowercase behavior compared with the fixed parser. |
| `test-cleanup-confirmation-1930.log` | Focused regression test output.                             |
| `test-cleanup-1848.log`              | Existing cleanup classification test output.                |

## Timeline

1. On 2026-06-15, the maintainer reported that typing a visible `yes` could still cancel cleanup after pressing other keys such as Ctrl+Tab or changing keyboard/window focus.
2. The prepared PR #1934 initially contained only the automation scaffold commit.
3. Related cleanup work was traced to merged PR #1849, which added the task-aware cleanup command, and PR #1852, which added process diagnostics.
4. The failing behavior was reproduced with hidden terminal control bytes around `yes`: the old exact `trim().toLowerCase() === 'yes'` check rejects that input.

## Requirements

| ID  | Requirement                                                                            | Resolution                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | A visually correct `yes` must work even after non-text terminal keys or deleted input. | Added shared confirmation normalization that strips terminal escape sequences and replays common erase controls before requiring exact `yes`. |
| R2  | Rename the cleanup command to `hive-cleanup`.                                          | Package bin metadata, help text, and README examples now use `hive-cleanup`.                                                                  |
| R3  | Cleanup output should show what each folder relates to, not just size/path.            | Cleanup report records now include git repo/branch/dirty state and active task PR/issue/session context where available.                      |
| R4  | Include related `$` session and pull request context when available.                   | Session-derived active tasks preserve session ID/name/status/workspace; active PR tasks print `PR #...` in one-line summaries.                |
| R5  | Collect issue data and perform a case-study analysis.                                  | This folder stores the raw data, reproduction evidence, sources, root-cause analysis, and verification logs.                                  |
| R6  | Avoid filing unrelated upstream issues unless an external project is at fault.         | No upstream issue was filed; the root cause is local prompt handling and reporting gaps.                                                      |

## Root Causes

1. `src/cleanup.mjs` used `execSync('read answer && echo $answer')` for a destructive prompt. That delegated interactive input to Bash and then compared the returned raw string exactly against `yes`.
2. Terminal shortcuts can produce ANSI/control sequences that are not visible as ordinary text. If such bytes remain in the line around a visible `yes`, the exact compare rejects it.
3. `cleanup-test-repos.mjs` had the same prompt pattern, so the bug existed in more than one destructive confirmation flow.
4. Cleanup classification retained enough internal data to make safe decisions, but display records did not preserve enough task/session/git context for readable one-line output.
5. The public bin name `cleanup` was too generic for an npm-installed CLI and no longer matched the requested command name.

## Existing Components Reviewed

- `src/cleanup.lib.mjs`: pure cleanup classification helpers and the best place to enrich report records without changing OS behavior.
- `src/cleanup.os.lib.mjs`: active task/session discovery from procfs, screen/tmux, `$ --status`, and GitHub PR branch lookups.
- `src/cleanup.mjs`: CLI orchestration, report rendering, and confirmation prompt.
- `cleanup-test-repos.mjs`: separate GitHub test-repository cleanup helper with the same confirmation pattern.
- `tests/test-cleanup-1848.mjs`: existing offline cleanup coverage from PR #1849.

## External Research

The Node.js Readline documentation identifies `node:readline` as the built-in line-input interface for stdin/stdout prompts and documents `rl.question()` for waiting for user input. That is a better fit than spawning Bash for a Node CLI prompt.

The GNU Bash manual documents `read` as line input that performs shell word handling, while GNU Readline separately owns many terminal editing behaviors. This supports the local fix: keep prompt handling in Node and normalize terminal control sequences before confirmation.

Sources are listed in `research-sources.json`.

## Solution Plan

1. Add a shared confirmation helper:
   - strip ANSI/terminal escape sequences;
   - replay Backspace, Delete, Ctrl+U, and Ctrl+W editing controls when present;
   - remove remaining non-printing controls;
   - accept only exact normalized `yes`, case-insensitive.
2. Replace Bash-backed confirmation reads in both cleanup scripts with Node readline.
3. Add tests that fail under the old trim/lowercase comparison and pass under the normalized parser.
4. Rename the package executable to `hive-cleanup` and update help/README examples.
5. Keep cleanup safety decisions unchanged, but add report-only context:
   - active task PR/issue number;
   - session ID/name/status/workspace when discovered;
   - git remote, branch, and dirty/unpushed state.
6. Add a changeset so release automation picks up the CLI change.

## Verification

Focused checks saved in `data/`:

- `node tests/test-cleanup-confirmation-1930.mjs`
- `node tests/test-cleanup-1848.mjs`
- `node src/cleanup.mjs --help`

Broader local checks are run from the PR root before finalizing.
