# Case study: issue #3176 — repository mode selects bot-maintained status issues (reports, dashboards) as work

- Issue: https://github.com/link-assistant/hive-mind/issues/3176 (opened 2026-10-13, reopened 2026-10-15)
- Pull requests: #3390 (this branch, commit `d34879d4`, merge `efec3829`), draft #3179 (WIP, logs only)
- Parent: #3282 (critical-path umbrella)
- Real case: link-assistant/calculator#258 ("Coverage gap report", opened and updated weekly by
  `github-actions[bot]`), combined issue link-assistant/calculator#260, workaround pull request link-assistant/calculator#261
- Related: #3174 (the post-session link repair would add the closing line for the status page whatever the agent
  decides)

## Collected data

| File                                   | What it is                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `issue.json`                           | `gh issue view 3176 --json title,body,comments,createdAt,closedAt`, taken 2026-10-15 |
| `raw/pr-3390-commit-d34879d4-src.diff` | Source and changeset diff of the fix on this branch                                  |

The issue's own reproduction script and output are in the calculator repository:
[`experiments/issue-258/hive-mind-dashboard-selection-repro.mjs`](https://github.com/link-assistant/calculator/blob/09410d73/experiments/issue-258/hive-mind-dashboard-selection-repro.mjs)
and
[`docs/case-studies/issue-258/data/hive-mind-dashboard-selection-repro.txt`](https://github.com/link-assistant/calculator/blob/09410d73/docs/case-studies/issue-258/data/hive-mind-dashboard-selection-repro.txt).
The diff contains a source line that already exists in the repository and quotes GitHub's one-keyword-per-issue rule
as an example.

## Timeline (UTC)

| Time                | Event                                                                                                                                                                                     | Evidence     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 2026-10-12 14:25:19 | calculator#258 "Coverage gap report" created by `github-actions[bot]`; its weekly workflow sent `state: 'open'` with every update, so closing it lasted only until the next run           | issue body   |
| 2026-10-13          | `/solve https://github.com/link-assistant/calculator` (repository mode) creates calculator#260 with three open issues; its required closing block contains the status page calculator#258 | issue body   |
| 2026-10-13          | Workaround pull request calculator#261 makes the workflow update the issue without reopening it                                                                                           | issue body   |
| 2026-10-13 06:05:57 | Issue #3176 opened with a reproduction against `ed6a155` (v2.35.8), root cause and a four-point suggested fix                                                                             | `issue.json` |
| 2026-10-13 06:13:57 | Draft PR #3179 opened by the solver; it only contains a WIP commit and logs (no code)                                                                                                     | timeline     |
| 2026-10-14 17:55:01 | Attached to the umbrella #3282                                                                                                                                                            | timeline     |
| 2026-10-15 12:14:42 | Closed by the merge of #3295 through the link-repair lines of #3174, without a fix; reopened at 12:20:25                                                                                  | timeline     |
| 2026-10-15 18:53:04 | Commit `d34879d4` on this branch; merged into the #3282 branch as `efec3829` at 18:59                                                                                                     | `git log`    |

## Requirements from the issue

1. **Opt-out by the repository.** Skip open issues with a label from a configurable list (e.g. `--skip-issue-labels`,
   default something like `hive-mind:skip`, `dashboard`, `status`) or with the body marker `<!-- hive-mind:skip -->`,
   through the existing `exclude` path of `selectOldestOpenIssues`.
2. **Bot-authored issues** (`user.type === 'Bot'`): skip them unless a flag includes them, or at least list them
   separately in the combined issue.
3. **Show what was left out**, with the reason, in the combined issue body, so the scope stays reviewable.
4. **Regression tests:** `selectOldestOpenIssues` with a labeled, a marked and a bot-authored issue;
   `prepareRepositoryModeIssue` passing the exclusions; the combined body listing the skipped issues and leaving them
   out of the closing block.

## Root causes (at `ed6a155`)

- **RC1.** `selectOldestOpenIssues` filtered out only pull requests. It had an `exclude` option, but
  `prepareRepositoryModeIssue` never passed it and no CLI option set it.
- **RC2.** Nothing looked at labels, the author type or a body marker, so a repository could not say "this issue is
  not work".
- **RC3.** `buildCombinedIssueBody` put every selected issue in the required closing block. With the link repair of
  #3174 the pull request then closed the status page regardless of the agent, and its workflow reopened it for the
  next run — a loop.

## Solutions on this branch

| Req. | Change                                                                                                                                                                                                                                                                                                                                                                | Where                                                                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `REPOSITORY_MODE_SKIP_MARKER` (`<!-- hive-mind:skip -->`, matched case-insensitively with optional spaces) and `DEFAULT_SKIP_ISSUE_LABELS` (`hive-mind:skip`, `dashboard`, `status`). `parseSkipIssueLabels` reads `--skip-issue-labels` (comma separated; `""` or `none` turns label skipping off; a custom list replaces the defaults).                             | `src/solve.repository-mode.lib.mjs:103-125`                                                                                                                                                   |
| 1, 2 | `getRepositoryModeExclusionReason` returns the reason an issue is not work: a skip label (case-insensitive), the marker, or a bot author (`user.type === 'Bot'` or a login ending in `[bot]`) unless `includeBotIssues`. `selectOldestOpenIssues` applies it together with `exclude` and returns the skipped issues in `excluded`, oldest first, not counted as work. | `src/solve.repository-mode.lib.mjs:156-167`, `:189-220`                                                                                                                                       |
| 1, 2 | CLI options `--skip-issue-labels` (string) and `--include-bot-issues` (boolean, default false); `repositoryModeSelectionFromArgv` turns them into the selection passed by `solve.mjs` and by the Telegram `/solve` preflight.                                                                                                                                         | `src/solve.config.lib.mjs:779-788`; `src/solve.repository-mode.lib.mjs:133-138`; `src/solve.mjs:164-166`; `src/telegram-bot.mjs:670`; `src/telegram-solve-repository-preflight.lib.mjs:37-48` |
| 1    | `prepareRepositoryModeIssue` and `resolveRepositoryModeTarget` take and forward the selection, so skipped issues are neither attached as sub-issues nor listed in the required closing block. The open-issue total still counts them.                                                                                                                                 | `src/solve.repository-mode.run.lib.mjs:138-160`, `:335-349`                                                                                                                                   |
| 3    | The combined issue gets a scope line with the number of skipped issues and an "Issues left out of this run" section with each issue and its reason, telling the agent not to close them. The log lists them before anything is created, and the summary shows "Skipped (not work)". If only skipped issues are open, the run reports no work and names them.          | `src/solve.repository-mode.lib.mjs:296-325`, `:380-382`; `src/solve.repository-mode.run.lib.mjs:356-358`, `:371-378`                                                                          |
| —    | Documentation of both options in `docs/CONFIGURATION.md` (and the hi, ru, zh translations); an entry in the PR's single changeset `.changeset/issue-3282-sub-issues.md`.                                                                                                                                                                                              | `docs/CONFIGURATION.md:601`                                                                                                                                                                   |

## Tests

| Command                                                              | Result     |
| -------------------------------------------------------------------- | ---------- |
| `node --test tests/repository-mode-skip-status-issues-3176.test.mjs` | 14/14 pass |
| `node tests/test-solve-repository-mode-2212.mjs`                     | 47/47 pass |
| `node tests/test-repository-mode-closing-references-2306.mjs`        | 22/22 pass |

Run on this branch on 2026-10-15. The #3176 file covers every item of requirement 4: the issue's reproduction (the bot
coverage report is no longer selected), `--include-bot-issues`, a `[bot]` login without `user.type`, skip labels
(case-insensitive), a custom and an empty label list, the body marker, `parseSkipIssueLabels`, the combined body
listing skipped issues with their reason and leaving them out of the closing block, the log summary,
`prepareRepositoryModeIssue` applying the exclusions (and including the bot issue with `includeBotIssues`), one real
issue next to a bot report being solved directly (#3108 path), a repository with only status pages reporting no work
(also in the Telegram preflight), the CLI options reaching the selection, and `solve.mjs` / the Telegram preflight
passing them.

## What remains, and why

Status: **FIXED in code, not released.** All four requirements are implemented and tested. Open points:

1. **Not released.** `d34879d4` is only on this branch; npm `latest` (2.37.0) does not contain it.
2. **Bot-authored issues are skipped by default.** The issue allowed either default; skipping was chosen. A real bug
   that a bot files (for example a scheduled workflow that opens one issue per failure) is now left out unless
   `--include-bot-issues` is given. It is listed with its reason, so it stays visible.
3. **No CLI option for issue numbers.** The `exclude` list of `selectOldestOpenIssues` (reason "excluded by number")
   is reachable only from code.
4. **Combined issues created before this change are not rewritten.** A status page that an earlier run already
   attached as a sub-issue or listed in an existing combined issue stays in that issue's required scope; re-running
   repository mode creates a new combined issue with the new selection.
5. The calculator repository still relies on its own workaround (calculator#261); nothing in hive-mind changes the
   status-page workflow there.

## Existing components

- GitHub's REST issue list returns `user.type` (`"Bot"` for apps) and labels for each issue
  ([List repository issues](https://docs.github.com/en/rest/issues/issues#list-repository-issues)).
- `actions/stale` uses the same "exempt by label" idea (`exempt-issue-labels`, a comma separated list)
  ([actions/stale](https://github.com/actions/stale)).
- Renovate's Dependency Dashboard is an issue that a bot keeps open and updates — the most common case of a status
  page that is not work ([Renovate docs](https://docs.renovatebot.com/key-concepts/dashboard/)).
- GitHub search can filter such issues out too (`-label:status`, `-author:app/github-actions`), but repository mode
  lists issues through the REST API, so the filter lives in `selectOldestOpenIssues`.

## Reproduction

```bash
node --test tests/repository-mode-skip-status-issues-3176.test.mjs
node tests/test-solve-repository-mode-2212.mjs
node tests/test-repository-mode-closing-references-2306.mjs
```
