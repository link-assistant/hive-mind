# Issue 3108 case study: a repository with one open issue does not need a parent issue

- Issue: [link-assistant/hive-mind#3108](https://github.com/link-assistant/hive-mind/issues/3108)
- Pull request: [link-assistant/hive-mind#3109](https://github.com/link-assistant/hive-mind/pull/3109)
- Incident repository: [link-foundation/lino-objects-codec](https://github.com/link-foundation/lino-objects-codec)
- Affected version: `solve v2.35.3` (the repository-mode code is unchanged in `2.35.6`, the version on `main` when this fix started)

## Executive summary

`/codex https://github.com/link-foundation/lino-objects-codec —think xhigh —auto-merge` ran `/solve`
in repository mode ([#2212](https://github.com/link-assistant/hive-mind/issues/2212)). The repository
had exactly one open issue, [#68](https://github.com/link-foundation/lino-objects-codec/issues/68).
Repository mode still created a parent issue,
[#69 "Address the single open issue in link-foundation/lino-objects-codec"](https://github.com/link-foundation/lino-objects-codec/issues/69).
It attached #68 as #69's only native sub-issue and solved #69 with `--deep-analysis` and
`--ensure-all-sub-issues-addressed`. The outcome was correct: [PR #70](https://github.com/link-foundation/lino-objects-codec/pull/70)
was merged and closed both #68 and #69. But it left behind a duplicate issue that served no purpose and
added two GitHub write requests and a second closing reference.

The issue asks for the command to behave as if `https://github.com/link-foundation/lino-objects-codec/issues/68`
had been given. That is now what happens, in the CLI and in the Telegram bot.

## Evidence inventory

| Artifact                                                                                                                                 | What it shows                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`data/github/hive-mind-issue-3108.json`](data/github/hive-mind-issue-3108.json)                                                         | The issue text and requested behavior (no comments at collection time).                                |
| [`data/issue-screenshot.png`](data/issue-screenshot.png)                                                                                 | The Telegram exchange: the bot echoed `URL: https://github.com/link-foundation/lino-objects-codec`.    |
| [`data/logs/lino-objects-codec-solve-log-excerpt.txt`](data/logs/lino-objects-codec-solve-log-excerpt.txt)                               | Start and end of the sanitized session log. Lines 44–55 show repository mode creating #69 for 1 issue. |
| [`data/github/lino-objects-codec-issue-68.json`](data/github/lino-objects-codec-issue-68.json)                                           | The real work item (opened 11:43:19Z, closed by PR #70).                                               |
| [`data/github/lino-objects-codec-issue-69.json`](data/github/lino-objects-codec-issue-69.json)                                           | The generated parent issue, with the `<!-- hive-mind-solve-repository-mode -->` marker.                |
| [`data/github/lino-objects-codec-issue-69-sub-issues.json`](data/github/lino-objects-codec-issue-69-sub-issues.json)                     | GitHub's sub-issue list for #69: only `#68`.                                                           |
| [`data/github/lino-objects-codec-pr-70.json`](data/github/lino-objects-codec-pr-70.json)                                                 | The merged PR. `closingIssuesReferences` = `[68, 69]`; branch `issue-69-dab96606bd2e`.                 |
| [`data/github/lino-objects-codec-pr-70-comments.json`](data/github/lino-objects-codec-pr-70-comments.json)                               | Session summary, the uploaded log link, and the auto-merge notice.                                     |
| [`logs/repro-before.log`](logs/repro-before.log), [`logs/repro-after.log`](logs/repro-after.log)                                         | Offline reproduction (`experiments/issue-3108-single-issue-repro.mjs`) before and after the fix.       |
| [`logs/test-issue-3108-before.log`](logs/test-issue-3108-before.log), [`logs/test-issue-3108-after.log`](logs/test-issue-3108-after.log) | The new regression test on the old code (fails) and on the fixed code (14/14 pass).                    |

The full sanitized session log (4.2 MB) is linked from PR #70:
<https://gist.githubusercontent.com/konard/83eb9eccf22559a3cbfe840c374974d8/raw/8c67d24f2993e2b9229759933ef5ca5bd611b319/tmp-hive-mind-log-upload-uVcyQg-sanitized.log.txt>.
Only an excerpt is kept here, so the repository does not grow by 4 MB.

## Reconstructed timeline (2026-10-11, UTC)

| Time         | Event                                                                                                                                                             | Source                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 11:43:19     | #68 "Readable decoder fails on valid 144MB document…" is opened. It is the only open issue in the repository.                                                     | issue-68.json                  |
| ~13:30       | Telegram: `/codex https://github.com/link-foundation/lino-objects-codec —think xhigh —auto-merge`. The bot replies "Executing…" with `URL: …/lino-objects-codec`. | screenshot                     |
| 13:30:48.735 | `solve v2.35.3` starts with `https://github.com/link-foundation/lino-objects-codec --think xhigh --auto-merge --tool codex …`.                                    | log lines 6–8                  |
| 13:30:54.585 | `📦 REPOSITORY MODE`. `Open issues found: 1`, `Requested in one PR: 1`, `Attached as sub-issues: 1 (limit 100)`.                                                  | log lines 44–48                |
| 13:30:55.207 | `📝 Creating the combined issue...`                                                                                                                               | log line 50                    |
| 13:30:56     | #69 "Address the single open issue in link-foundation/lino-objects-codec" is created.                                                                             | issue-69.json                  |
| 13:30:57.943 | `✅ Created combined issue: …/issues/69`, `Sub-issues attached: 1/1`. Solving continues with #69 as the input URL.                                                | log lines 53–55, 72            |
| 13:31:21     | Draft PR #70 is opened on branch `issue-69-dab96606bd2e`. Its first step reads #69 and then follows the reference to #68.                                         | pr-70.json, log lines 777, 963 |
| 13:40–13:55  | The agent writes `docs/case-studies/issue-68/README.md`, describing the scope as "parent issue #69, including issue #68".                                         | log lines 4333–4335            |
| 14:03:11     | Session summary posted on PR #70.                                                                                                                                 | pr-70-comments.json            |
| 14:04:43     | Issue #3108 is filed against hive-mind.                                                                                                                           | hive-mind-issue-3108.json      |
| 14:06:13–14  | PR #70 is auto-merged. #68 and #69 are both closed as completed.                                                                                                  | pr-70.json, issue-6{8,9}.json  |

## Requirements traceability

| #   | Requirement (from #3108)                                                                              | Resolution                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | "Instead of creating issue for single sub issue …"                                                    | Repository mode no longer creates a parent issue or attaches sub-issues when the repository has exactly one open issue (`src/solve.repository-mode.run.lib.mjs`).                                                                         |
| R2  | "We should have converted that to `/codex …/issues/68 —think xhigh —auto-merge`"                      | The CLI swaps in the issue URL with no repository-mode `argvOverrides`, just as if `/solve <issue-url>` had been run. The Telegram bot rewrites the command arguments, echo, and queue key to the issue URL and keeps every other option. |
| R3  | "As there only one issue there is no need to create parent issues."                                   | Two or more open issues still get the #2212 combined issue. Zero issues still get the #2266 no-work reply.                                                                                                                                |
| R4  | Download all logs and data into `./docs/case-studies/issue-3108`                                      | This folder: [`data/`](data) and [`logs/`](logs), plus [`MANIFEST.md`](MANIFEST.md).                                                                                                                                                      |
| R5  | Deep case study: timeline, requirements, root causes, solutions, existing components, online research | This document.                                                                                                                                                                                                                            |
| R6  | Add debug output / verbose mode if data is insufficient                                               | The data was sufficient. The CLI now logs `🎯 Only one open issue: #N…` together with the issue URL, and the bot logs `[VERBOSE] Repository has a single open issue; solving <url> directly`.                                             |
| R7  | Report issues in other repositories when they are involved                                            | Nothing to report: the fault is entirely in hive-mind. lino-objects-codec and GitHub behaved correctly (see [External reports](#external-reports)).                                                                                       |

## Reproduction

[`experiments/issue-3108-single-issue-repro.mjs`](../../../experiments/issue-3108-single-issue-repro.mjs) calls
`resolveRepositoryModeTarget` with a fake `gh` that lists only #68 and records every call. It exits 1 if
any GitHub write happens or if the target is not #68.

Before (commit `4b1345c7`, [`logs/repro-before.log`](logs/repro-before.log)):

```text
📝 Creating the combined issue...
✅ Created combined issue: https://github.com/link-foundation/lino-objects-codec/issues/69
   Sub-issues attached: 1/1
---
issue to solve: https://github.com/link-foundation/lino-objects-codec/issues/69
argv overrides: {"deep-analysis":true,"deepAnalysis":true,"ensure-all-sub-issues-addressed":true,"ensureAllSubIssuesAddressed":true}
GitHub write calls: 2
```

After ([`logs/repro-after.log`](logs/repro-after.log)):

```text
🎯 Only one open issue: #68. Solving it directly, without creating a combined issue.
   Issue URL: https://github.com/link-foundation/lino-objects-codec/issues/68
---
issue to solve: https://github.com/link-foundation/lino-objects-codec/issues/68
argv overrides: {}
GitHub write calls: 0
```

The regression test [`tests/test-issue-3108-repository-single-issue.mjs`](../../../tests/test-issue-3108-repository-single-issue.mjs)
covers the same scenario plus the Telegram path. On the old code it fails at import time, because the
helpers it pins down do not exist there ([`logs/test-issue-3108-before.log`](logs/test-issue-3108-before.log)).
The experiment above is the behavioral before/after comparison.

## Root causes

### 1. Repository mode treated "one issue" as a case of "many issues"

`resolveRepositoryModeTarget` created the combined issue whenever at least one issue was selected. The
only special handling for a single issue was cosmetic. `buildCombinedIssueTitle` has had a dedicated title
for it since repository mode was added (`614eb2ee`, 2026-09-05):

```js
if (count === 1) {
  return `Address the single open issue in ${repository}`;
}
```

So the case was anticipated, but it was modeled as a title variant instead of a different control flow.
The [#2212 requirements](../issue-2212/README.md) describe aggregating _all_ open issues into one PR. With
a single issue there is nothing to aggregate, and the parent adds nothing over the original issue:

- the sub-issue list contains just the issue itself;
- the PR has to reference both issues;
- the `--ensure-all-sub-issues-addressed` check verifies one reference, which normal `/solve` already guarantees with `Fixes #N`;
- the agent spends its first steps working out what the parent points to (log lines 777–999).

### 2. The Telegram bot never learns which issue will be solved

Since #2266, the bot already lists the repository's open issues during preflight (`checkRepositoryModeWork`),
but it used the result only for the "no open issues" reply. It then echoed, de-duplicated, and launched
the repository URL. Even with a CLI-only fix, the Telegram message would still show
`URL: https://github.com/link-foundation/lino-objects-codec`. A later `/solve …/issues/68` would also not
be recognized as a duplicate of the running session, because the queue key was the repository URL.

### 3. A note on dry runs

`--dry-run` previously printed the combined-issue summary ("Attached as sub-issues: 1") for a single issue. It now reports the issue that
would be solved instead, since there is nothing to preview.

## Solutions considered

| Option                                                                                 | Verdict                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Keep the parent and improve its body                                                | Rejected. The issue explicitly says no parent is needed.                                                                                                                                            |
| B. Short-circuit in the CLI only (`resolveRepositoryModeTarget` returns the issue URL) | Necessary: it covers the CLI, `/solve` from every bot command alias, and the queue/isolation runners, because they all end up running `solve <repo-url>`.                                           |
| C. Also rewrite the Telegram command to the issue URL before echoing/queueing          | Chosen together with B. It matches the issue's "we should have converted that to …/issues/68" literally, and it reuses the open-issue list the #2266 preflight already fetches (no extra API call). |
| D. Decide by the capped native-attachment list (`selected.length === 1`)               | Rejected. With `limit` < number of open issues it would drop issues silently. The decision uses the full uncapped list (`allIssues.length === 1`).                                                  |
| E. Ignore an already open repository-mode parent when counting                         | Out of scope. An open parent from an earlier run is a real open issue, and #2306 already handles stale parents. Recorded under [residual risks](#residual-risks).                                   |

## Implementation

- `selectSingleIssueTarget({ repository, issues })` (`src/solve.repository-mode.lib.mjs`) is a pure helper. It returns the issue, including a URL fallback when `html_url` is missing, only when the list has exactly one entry.
- `prepareRepositoryModeIssue` returns `singleIssue`, computed from **all** open issues, so the CLI and the bot preflight agree.
- `resolveRepositoryModeTarget` returns `{ handled: true, singleIssue: true, issueUrl, argvOverrides: {} }` before any combined-issue work. `src/solve.mjs` already switches to `repositoryMode.issueUrl` and applies the (now empty) overrides, so solving continues exactly as for `/solve <issue-url>`.
- `preflightRepositoryTarget` (`src/telegram-solve-repository-preflight.lib.mjs`) returns `{ repliedNoWork, singleIssue }`. `replyIfRepositoryHasNoWork` keeps its boolean contract on top of it.
- `redirectRepositoryArgsToSingleIssue` replaces only the argument that is the repository URL (original, normalized, or canonical form) and returns new arrays. If it cannot apply the change safely it returns `null` and the CLI fallback (B) takes over.
- `src/telegram-bot.mjs` applies the redirect right after the no-work preflight and before `normalizedUrl`, the info block, duplicate detection, and launch.

## Expected result

For the incident command the bot now replies with `URL: https://github.com/link-foundation/lino-objects-codec/issues/68`
and runs `solve https://github.com/link-foundation/lino-objects-codec/issues/68 --think xhigh --auto-merge --tool codex …`.
No #69 is created. The PR closes #68 only, on a branch named `issue-68-…`.

## Existing components and online research

- **GitHub sub-issues** are a native parent/child relation managed through the REST API
  `POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues` with the numeric `sub_issue_id`
  ([REST docs](https://docs.github.com/en/rest/issues/sub-issues)). The limit was raised to 100 sub-issues per
  parent in December 2024 ([changelog](https://github.blog/changelog/2024-12-12-github-issues-projects-close-issue-as-a-duplicate-rest-api-for-sub-issues-and-more/)),
  which is the `MAX_SUB_ISSUES_PER_PARENT` that #2212 uses. A hierarchy is meant for breaking work down. A
  parent with exactly one child just repeats that child.
- **Closing keywords**: one PR can close several issues if each one gets its own keyword (`Fixes #68, fixes #69`),
  and only when the PR targets the default branch
  ([GitHub docs](https://help.github.com/articles/closing-issues-using-keywords)). PR #70 needed exactly this
  to close both issues. With a single issue, `Fixes #68` is enough, which is what plain `/solve` already writes.
- **Similar tools**: GitHub CLI extensions such as [`gh-sub-issue`](https://pkg.go.dev/github.com/yahsan2/gh-sub-issue)
  only manage the relation. They do not decide when a parent is worth creating, so there was nothing to reuse
  for this decision. The fix is a small pure function next to the existing selection helpers
  (`selectOldestOpenIssues`).

## Verification

- `node --test tests/test-issue-3108-repository-single-issue.mjs`: 14/14 pass ([`logs/test-issue-3108-after.log`](logs/test-issue-3108-after.log)).
- The #2212, #2266, and #2306 suites still pass. Two #2212 fixtures that used a single issue to exercise the combined-issue path now use two issues, which is the only case where that path is still taken.
- `npm run lint` and Prettier pass.

## Residual risks

- A combined issue left open by an earlier repository-mode run counts as an open issue. If it is the only one, it is now solved directly. That is correct behavior: solving the parent addresses its sub-issues, and `--ensure-all-sub-issues-addressed` is still available explicitly.
- If the Telegram preflight fails (for example, the GitHub API is unavailable), the bot echoes the repository URL as before. The CLI then still applies the shortcut, so no parent issue is created.

## External reports

No upstream report was filed. GitHub's API and lino-objects-codec behaved as documented: the duplicate parent
was created deliberately by hive-mind's own code.

Side finding, unrelated to the behavior in #3108: the first automated attempt on PR #3109
(`--tool agent --model formal-ai`, [failure comment](https://github.com/link-assistant/hive-mind/pull/3109#issuecomment-6109913438))
stopped after the model answered "Let me open e.g and read what it says." and called `read` with
`filePath: /tmp/gh-issue-solver-1791727879522/e.g`. That turned the abbreviation "e.g." from the prompt into
a file path, and the error `File not found: …/e.g` ended the session (see
`dev/log/issues/3108/pulls/3109/sessions/ses_ed4b198fcffe12KcyKwpIcBf0s/solve.log`, lines 1741–1942). This is a model
quality problem, not a hive-mind or #3108 defect, so it is only recorded here.
