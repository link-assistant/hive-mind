# Case study: issue #3684 — auto-recovery created three umbrella issues

## What happened

`/solve https://github.com/link-foundation/browser-commander` (repository mode,
solve v2.39.2) combined the two open issues #179 and #180 into one combined
("umbrella") issue. The run was killed by the OOM killer, auto-recovery ran
the same command again, and every run filed another combined issue:

| Combined issue | Created (UTC)    | Sub-issues             | Pull request                                 | Fate                    |
| -------------- | ---------------- | ---------------------- | -------------------------------------------- | ----------------------- |
| #181           | 2026-10-21 15:07 | #179, #180             | #182 (`issue-181-77f3853938b6`)              | closed at 18:54 by #184 |
| #183           | 2026-10-21 15:41 | #179, #180, #181       | #184 (`issue-183-46f51c531344`), auto-merged | closed at 18:54 by #184 |
| #185           | 2026-10-21 15:46 | #179, #180, #181, #183 | #186 (`issue-185-5f651a6bf157`)              | still open              |

The screenshots in [`screenshots/`](screenshots) are the ones attached to the
issue. All GitHub data (issues, comments, timelines, sub-issues and pull
requests) is in [`data/`](data), and the two run logs attached to PR #182 and
PR #184 are in [`logs/`](logs) (gzip).

## Timeline

All times are 2026-10-21 UTC, taken from [`data/`](data) and the two logs.

| Time          | Event                                                                                                                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 08:40 / 09:28 | #179 and #180 are opened.                                                                                                                                                                                                                                           |
| 15:07:25      | **Run 1** starts: `solve https://github.com/link-foundation/browser-commander --think high --auto-merge --tool claude --attach-logs --verbose …`, with no `--resume` (`logs/pr-182-failure-run1.log.gz`, line 8). Container OOM-kill count: 0.                      |
| 15:07:38      | Run 1 creates #181 and attaches #179 and #180 as sub-issues.                                                                                                                                                                                                        |
| 15:08:33      | Run 1 opens draft PR #182 on `issue-181-77f3853938b6`.                                                                                                                                                                                                              |
| 15:39:23      | Run 1 is killed (exit 137; "processes killed by the OOM killer so far: 2"). Its uncommitted work goes to `recovery/issue-181-77f3853938b6`, and at 15:39:43 PR #182 receives a "Solution Draft Failed" comment.                                                     |
| 15:41:29      | **Run 2** (auto-recovery) starts in a fresh container with `solve https://github.com/link-foundation/browser-commander … --resume d85c9a23-5c61-45c3-b1e1-7d099f9ef893` (`logs/pr-184-solution-run2.log.gz`, line 8). The replayed URL is the repository, not #181. |
| 15:41:35      | Run 2 reports "Open issues found: 3", because #181 itself is counted as work.                                                                                                                                                                                       |
| 15:41:39–46   | Run 2 moves #179 and #180 away from #181 ("still a sub-issue of #181 (open, left over from an earlier run); moving it to #183") and creates #183.                                                                                                                   |
| 15:42:01      | Auto-continue finds PR #182 but skips it: "Branch 'issue-181-77f3853938b6' doesn't match expected pattern 'issue-183-*'". Run 2 opens PR #184 at 15:42:26.                                                                                                          |
| 15:46:46      | **Run 3** creates #185 ("Address all 4 open issues"), with #179, #180, #181 and #183 as sub-issues, and opens PR #186 at 15:47:54. No log of run 3 exists, because PR #186 has no attached log.                                                                     |
| 18:54:14      | PR #184 is auto-merged, which closes #179, #180, #181 and #183. #185 and PR #186 stay open.                                                                                                                                                                         |

## Requirements

| #   | Requirement (issue text)                                                                                                | Status / where                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | "not create an issue if it is already created and already contains all other issues in the repository"                  | Done. Repository mode reuses the open combined issue (see Fix 1). Covered by `tests/repository-mode-reuse-combined-issue-3684.test.mjs` and `experiments/issue-3684-repeated-repository-mode-runs.mjs`. |
| R2  | "in all other logic we should do an action only if it was not yet done, so we don't duplicate anything on repeated run" | Done for every creator that duplicated on a repeated run (see Fix 2 and the audit). Covered by `tests/repeated-run-idempotency-3684.test.mjs`.                                                          |
| R3  | Download all logs and data to `./docs/case-studies/issue-3684`                                                          | Done: `data/`, `logs/`, `screenshots/`.                                                                                                                                                                 |
| R4  | Timeline, requirements, root causes, solutions, existing components, online research                                    | This document.                                                                                                                                                                                          |
| R5  | "If there is not enough data to find actual root cause, add debug output and verbose mode"                              | Done for the one cause the data cannot prove, run 3 (see Fix 3).                                                                                                                                        |
| R6  | Report issues to other repositories when relevant                                                                       | Not needed: every external system behaved as documented (see the "Upstream" section).                                                                                                                   |
| R7  | "double check to fully apply requirements to entire codebase"                                                           | See the "Audit of other creators" section.                                                                                                                                                              |

## Root causes

1. **Combined issues were counted as work and never reused.** The open-issue
   listing returned #181 like any other issue, so run 2 wanted "3 open issues",
   no existing combined issue matched that set, and it created a new one. The
   sub-issue attachment then used `replace_parent` to pull #179 and #180 away
   from #181. Each later run added the previous umbrella to the scope, which
   gave "Address all 4 open issues" in #185.
2. **Recovery replays the repository URL.** A kill recovery re-runs the
   original command line plus `--resume <session>`, and for repository mode
   the original URL is the repository. Each recovery therefore re-enters
   repository mode from scratch. That is correct only if repository mode is
   idempotent, and it was not. In the same way, auto-continue looked for
   `issue-183-*` branches and skipped PR #182, so the earlier work was
   abandoned too.
3. **A third run started while run 2 was still running (unproven).** #185 was
   created five minutes after #183, while run 2 was still working on PR #184
   (it finished after 18:50). No log of run 3 exists. Its scope (#179, #180,
   #181, #183) means it ran the same repository-mode command after #183
   existed. The most likely source is a second recovery path firing for the
   same kill. The candidate is the failed-in-place-start relaunch
   (`detectFailedInPlaceStart` / `relaunchFailedInPlaceStart` in
   `src/session-kill-resume.start-failure.lib.mjs`, #2887). That is a
   hypothesis: the available data cannot confirm it.

## Fixes

### Fix 1 — repository mode is idempotent (R1)

- `src/solve.repository-mode.lib.mjs`:
  - an open issue carrying the repository-mode marker
    (`<!-- hive-mind-solve-repository-mode -->`) is now excluded from the work
    list, with the reason `REPOSITORY_MODE_COMBINED_ISSUE_REASON`;
  - `findRepositoryModeIssues` returns the open combined issues together with
    their "Required closing references";
  - `selectReusableRepositoryModeIssue` picks the newest one whose references
    cover every remaining open issue.
- `src/solve.repository-mode.run.lib.mjs`:
  - `resolveRepositoryModeTarget` reuses that issue;
  - `reuseRepositoryModeIssue` refreshes its body only when an issue was added,
    and attaches only the sub-issues that are not yet attached
    (`fetchSubIssueNumbers`);
  - an issue whose parent is already the target issue counts as attached, so
    there is no `replace_parent` churn.
- **Effect on the incident:** run 2 continues #181. Auto-continue then expects
  `issue-181-*` and continues PR #182, so the earlier work is not lost.

### Fix 2 — other one-time actions are not repeated (R2, R7)

| Action                                                                | Before                                                     | Now                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/fix --ci-cd`, `/fix --update-all-dependencies` (fixed-title issues) | a new issue on every run                                   | `createOrReuseTaskIssue` (`src/task.issue-creation.lib.mjs`) finds the open issue with exactly that title and refreshes its body. It checks the newest open issues first, which is read-after-write consistent, then falls back to issue search. |
| `/task --split`                                                       | split the parent again and filed a second set of sub-tasks | `parseParentSplitSection` (`src/task.split.lib.mjs`) detects the split section an earlier run wrote. `runSplitMode` then reports "already split into …" and creates nothing.                                                                     |
| "Repository Initialization Required" notice on an empty repository    | posted on every run                                        | `findCommentWithMarker` (`src/tool-comments.lib.mjs`). The notice is posted only when no earlier comment carries the marker (`src/solve.repo-setup.lib.mjs`, `src/solve.repository.lib.mjs`).                                                    |

### Fix 3 — trace for the unproven cause (R5)

With `--verbose`, repository mode now logs whether the run is a `--resume`
replay, which open combined issues of earlier runs exist (and which issues
each one requires), and the decision it took:

```
   [VERBOSE] repository mode: replayed with --resume d85c9a23-…; open combined issues of earlier runs: #181 (requires #179, #180)
   [VERBOSE] repository mode: work #179, #180; decision: reuse #181 (covers every issue)
```

If another unexpected run happens, its log shows directly whether it was a
replay and what it found.

## Audit of other creators (R7)

Every place that creates an issue, a pull request, a sub-issue or a one-time
comment was checked. The table lists what was left unchanged, and why.

| Creator                                    | Repeated-run behaviour                                                                                                                                                                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/solve <issue>` pull request              | Already idempotent: auto-continue (on by default) reuses the open PR of the issue's `issue-<n>-*` branch.                                                                                                                                           |
| Sub-issue attachment                       | Already-attached issues are skipped (Fix 1).                                                                                                                                                                                                        |
| `gh issue create` retries                  | Already guarded by `findRecentlyCreatedIssue` (#3326, #3552).                                                                                                                                                                                       |
| `/task` (free-form Telegram task)          | Unchanged. Each `/task` message is a new request with a new, model-written title, and two identical texts can be two real tasks. Reusing one would silently drop the user's request. Fixed-title tasks go through `createOrReuseTaskIssue` (Fix 2). |
| Session kill / recovery / failure comments | Unchanged by design. Each one reports a distinct event (a new kill, a new attempt), so a second comment carries new information.                                                                                                                    |
| Work-session started/ended comments        | Unchanged by design: one pair per session.                                                                                                                                                                                                          |

## Remaining limits

- **Check-then-act race.** Two runs that list issues at the same moment,
  before either has created its combined issue, can still both create one.
  GitHub's REST API has no idempotency key for `POST /issues`, so the race
  cannot be closed from the client without a shared lock. Run 3 started five
  minutes after #183 was created, so it would now reuse #183 instead of
  creating #185. It would, however, still continue PR #184 alongside run 2.
  Only finding out why a second run started at all (cause 3, now traced)
  removes that.
- **Search-index lag.** `/fix` issue lookups list the 100 newest open issues
  before using the search API, because the search index is updated
  asynchronously. A fixed-title issue older than those 100, and created
  seconds ago, is the only case that both lookups would miss.

## Existing components and online research

- **GitHub sub-issues REST API**
  ([docs](https://docs.github.com/en/rest/issues/sub-issues)): an issue has at
  most one parent, and `POST …/sub_issues` with `replace_parent: true` moves it.
  This is exactly what run 2 did to #179 and #180. Repository mode now checks
  the current parent first.
- **GitHub search API**: the search index is updated asynchronously, so a
  just-created issue may be missing from `search/issues` for some time.
  [Kargo's `gh-search-issues` docs](https://docs.kargo.io/user-guide/reference-docs/promotion-steps/gh-search-issues)
  give about 60 s, and Jira
  ([JRACLOUD-97427](https://jira.atlassian.com/browse/JRACLOUD-97427)) and
  GitLab ([gitlab#577380](https://gitlab.com/gitlab-org/gitlab/-/issues/577380))
  show the same "search and reconcile" problem. Hence the REST listing first
  (Fix 2).
- **Idempotency keys**: the IETF draft
  [The Idempotency-Key HTTP Header Field](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header)
  (and Stripe's `Idempotency-Key`) make a retried POST safe on the server
  side. GitHub's issue API does not support it, so hive-mind derives the key
  from content it controls: the repository-mode marker plus the closing
  references, the fixed title, the split section, and the comment marker.
  This is the "natural idempotency key" pattern.
- **Existing hive-mind building blocks reused**:
  - `findRecentlyCreatedIssue` (#3326);
  - `parseRequiredClosingReferences` (repository mode, #3108);
  - `appendOrReplaceParentSplitSection` (`/task --split`);
  - the tool-comment markers in `src/tool-comments.lib.mjs`.

## Upstream

No report was filed. GitHub's sub-issue and search APIs behaved as documented,
and the duplicates came from hive-mind calling them non-idempotently.

## Reproduce

```bash
node experiments/issue-3684-repeated-repository-mode-runs.mjs   # three runs → one combined issue, two sub-issue POSTs
node --test tests/repository-mode-reuse-combined-issue-3684.test.mjs tests/repeated-run-idempotency-3684.test.mjs
```

On the code before the fix (`3cd6c96b3`), the same script reports
`combined issues created: 3; sub-issue POST calls: 14`, with every earlier
umbrella nested under the last one. That is the shape of #181 → #183 → #185.
