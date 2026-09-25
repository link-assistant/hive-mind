# Issue #2284 — repository mode did not mark the issues it took on as in progress

## Executive summary

`/solve <repository-url>` (repository mode, introduced by
[issue #2212](https://github.com/link-assistant/hive-mind/issues/2212)) collects
every open issue of a repository, creates one combined issue, attaches the open
issues to it as GitHub native sub-issues, and solves the combined issue with a
single pull request. [Issue #2284](https://github.com/link-assistant/hive-mind/issues/2284)
asks for every issue in such a run to be assigned to the account doing the work,
so GitHub shows which issues are in progress.

The evidence shows that only the pull request was ever assigned. In
`konard/vietnam-accomodation-search`, **0 of 40 issues** have an assignee, while
**7 of 7 pull requests** are assigned to `konard`. Repository mode had no
assignment step, and the only assignment in the solve flow is
`gh pr create --assignee` in `src/solve.auto-pr.lib.mjs`.

The investigation also found a closely related defect in the same step. When a
second repository-mode run started, issues left over from an earlier combined
issue could not be attached to the new one. They still belonged to the old,
already closed parent, and GitHub rejected each of them with
`HTTP 422 Sub issue may only have one parent`. The run on 2026-09-25 created
[#46](https://github.com/konard/vietnam-accomodation-search/issues/46) with
**0/6 sub-issues attached**. Its body still said
"Issues attached as sub-issues of this issue: 6".

This change:

1. assigns the current `gh` user to the combined issue and to every selected
   issue as soon as the combined issue exists;
2. moves an issue whose current parent is **closed** to the new combined issue
   with the documented `replace_parent` option. An issue under an **open**
   parent is left where it is, because someone may still be using that parent.

## Evidence bundle

| Artifact                                                                         | SHA-256                                                            | Purpose                                                                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| [`evidence/hive-mind-issue-2284.json`](evidence/hive-mind-issue-2284.json)       | `2ad5880aab37126345493bb4b3fabf2ea1b19307ebe6acfbc2d2ac670a2da815` | The issue as filed (no comments existed when this study was written).                                                           |
| [`evidence/pr-21-solve-log-head.txt`](evidence/pr-21-solve-log-head.txt)         | `46021b5b070e362652a9fb2475ba37c1977e84d1f35bcaa938a524eb0e373c71` | First 245 lines of the sanitized solve log attached to PR #21 (combined issue #20). Covers repository mode through PR creation. |
| [`evidence/pr-47-solve-log-head.txt`](evidence/pr-47-solve-log-head.txt)         | `8e259240d26ad9fe3f209fbe89eb2b94cc92013e2cc6ed50041e6628f0bdfa6f` | First 70 lines of the sanitized solve log attached to PR #47 (combined issue #46), with the six HTTP 422 attachment failures.   |
| [`evidence/issues-assignees.json`](evidence/issues-assignees.json)               | `833ec26d04fc54c46baf61048c13171e39986aafebe989a1ed96ff3b4642b5b2` | Every issue in the target repository with its assignees.                                                                        |
| [`evidence/pull-requests-assignees.json`](evidence/pull-requests-assignees.json) | `ce0be546b47ac73009eec498009a74f6815b4207a60eafb934f473c0b822cac1` | Every pull request in the target repository with its assignees.                                                                 |
| [`evidence/timeline-issue-*.json`](evidence/)                                    | see `sha256sum evidence/*`                                         | Timeline events (`sub_issue_added`, `parent_issue_added`, `assigned`, …) of combined issues #20, #37, #44, #46 and sub-issues.  |

The full logs are available in the gists linked from the pull requests:
[PR #21 log](https://gist.github.com/konard/e9ff5de5199510791c2820a83dcdf9c3) and
[PR #47 log](https://gist.github.com/konard/5250e205e1e662c3177486986ccf8205).
Only the relevant excerpts are committed here.

## Timeline

| Time (UTC)       | Event                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-22 12:23 | `solve https://github.com/konard/vietnam-accomodation-search --tool codex --think xhigh --auto-merge` (hive-mind v2.29.0) enters repository mode and finds 8 open issues (#12–#19).                     |
| 2026-09-22 12:24 | Combined issue #20 is created and #12–#19 are attached (`sub_issue_added` ×8). No `assigned` event is recorded on any of the nine issues.                                                               |
| 2026-09-22 12:24 | PR #21 is created with `gh pr create … --assignee konard`, and the log says `👤 Assigned to: konard`. This is the only assignment in the run.                                                           |
| 2026-09-22 16:19 | PR #21 is auto-merged. #16 ("Revalidate … on the next release") stays open, but it remains a sub-issue of the now closed #20.                                                                           |
| 2026-09-23/24    | Further repository-mode runs create #29 (2026-09-23 09:49) and #37 and #44 (2026-09-24 18:24). #39–#43 end up as sub-issues of #44, which is closed at 19:44 while they stay open.                      |
| 2026-09-25 15:38 | Repository mode (v2.32.0) finds 6 open issues (#16, #39–#43), creates #46, and every attachment fails with `Sub issue may only have one parent (HTTP 422)`. The log reports `Sub-issues attached: 0/6`. |
| 2026-09-25       | Issue #2284 is filed: "When solving all open issues, we must assign ourselves to all of them, so it is clear which issues are in the progress".                                                         |

## Requirements

| #   | Requirement (source)                                                                                       | Status                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| R1  | When solving all open issues (repository mode), assign ourselves to all of them (issue title).             | Done: the combined issue and every selected issue are assigned to the current `gh` user.                   |
| R2  | Make it clear which issues are in progress (issue title).                                                  | Done: assignment (R1), plus leftover issues are re-parented under the active combined issue (R6).          |
| R3  | Download logs and data into `docs/case-studies/issue-2284` (issue body).                                   | Done: see the evidence bundle.                                                                             |
| R4  | Reconstruct the timeline, find root causes, propose solutions, and check existing components (issue body). | Done: this document.                                                                                       |
| R5  | Add debug output if the root cause cannot be found (issue body).                                           | Not needed: the root cause is confirmed. New log lines report assignment and re-parenting results per run. |
| R6  | Apply the requirement everywhere it occurs in the codebase (issue body).                                   | Done: see "Scope across the codebase".                                                                     |
| R7  | Report issues in other repositories when relevant (issue body).                                            | Not applicable: GitHub and `gh` behave as documented; both defects were in hive-mind.                      |

## Root causes

### RC1 — repository mode had no assignment step

`resolveRepositoryModeTarget` in `src/solve.repository-mode.run.lib.mjs` did four
things: list issues, create the combined issue, attach sub-issues, and hand the
combined issue back to `/solve`. None of them touched assignees. The normal
solve flow assigns only the pull request (`src/solve.auto-pr.lib.mjs`, after a
collaborator check). So an issue picked up by repository mode looked exactly
like an untouched issue on GitHub, and the PR that would close it was the only
place that showed ownership. The PR is not visible from the issue list, and the
"Development" link only appears for issues the PR closes by keyword.

### RC2 — a closed earlier parent blocked re-attachment

GitHub allows exactly one parent per issue. The add-sub-issue endpoint rejects an
issue that already has a parent unless `replace_parent: true` is sent
([REST docs](https://docs.github.com/en/rest/issues/sub-issues#add-sub-issue)).
Repository mode never sent it and treated the 422 as a generic, non-fatal
failure. Every issue that outlived its combined issue, because its live
acceptance gate stayed pending, was therefore impossible to track from later
runs. Closing a parent issue does not detach its sub-issues.
`GET /repos/konard/vietnam-accomodation-search/issues/43/parent` still returns
the closed #44.

## Solution

### Assignment (RC1)

`assignIssuesToCurrentUser` in `src/solve.repository-mode.run.lib.mjs`:

1. `gh api user --jq .login` finds the account that is doing the work;
2. `GET /repos/{owner}/{repo}/assignees/{login}` runs **once** and returns 204
   when the user can be assigned and 404 when not
   ([docs](https://docs.github.com/en/rest/issues/assignees#check-if-a-user-can-be-assigned)).
   A contributor who cannot be assigned (for example one working through a fork
   without push access) is detected without sending one useless request per
   issue;
3. `POST /repos/{owner}/{repo}/issues/{n}/assignees` with `assignees[]=<login>`
   runs for the combined issue and each selected issue. The endpoint **adds**
   assignees, so existing ones are kept;
4. the response is checked for the login. GitHub "silently ignores" assignees it
   cannot add and still answers 201, for example when the issue already has 10
   assignees
   ([docs](https://docs.github.com/en/rest/issues/assignees#add-assignees-to-an-issue)),
   so the exit code alone would report false successes;
5. requests are spaced one second apart and retried with backoff on rate limits.
   This follows the same policy as the sub-issue attachment and uses the retry
   helper now shared by both.

The step is best effort. A failure is logged per issue, and the run continues,
because being unable to assign someone should not stop the actual work.

### Re-parenting (RC2)

When attaching fails with "may only have one parent", `attachSubIssues` fetches
the current parent (`GET …/issues/{n}/parent`):

- **closed parent**: the issue is moved with `replace_parent=true`, and
  `↪️ Moving #n from closed parent … to #m` is logged;
- **open parent**: the issue is left alone and reported as not attached.
  Taking it from an active epic or from a concurrent run would be wrong;
- **parent cannot be inspected**: the issue is reported as not attached and is
  never replaced blindly.

The summary line now reads, for example,
`Sub-issues attached: 6/6 (6 moved from a closed parent)`.

### Alternatives considered

| Option                                                  | Why not chosen                                                                                                                                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gh issue edit <n> --add-assignee @me`                  | Uses GraphQL and fails the whole command on an invalid assignee. It gives no response body to verify the silent-drop case, and it costs an extra `gh` call per issue to resolve `@me`. The REST calls above are explicit and easy to test with a fake runner. |
| Label issues `in progress` instead of assigning         | Labels are repository-specific and may not exist. Assignees are GitHub's built-in "who is working on this" signal, shown in issue lists and filterable with `assignee:@me`. This matches the issue's wording.                                                 |
| Assign in every single-issue `/solve` run               | Broader behavior change than requested. The issue is scoped to "solving all open issues", and single-issue runs already assign the pull request that links to the issue.                                                                                      |
| Always pass `replace_parent=true`                       | Would move issues away from user-maintained epics or from another in-flight combined issue.                                                                                                                                                                   |
| Remove the old parent link first (`DELETE …/sub_issue`) | Two mutations instead of one, and a window where the issue has no parent. `replace_parent` does this atomically.                                                                                                                                              |

## Scope across the codebase

- **Repository mode** (`/solve <repo-url>`, CLI and Telegram, which share
  `resolveRepositoryModeTarget`): fixed.
- **Single-issue `/solve`, `/hive`, `/fix --ci-cd`, `/fix --update-dependencies`**:
  these work on one issue per pull request, and the pull request is already
  assigned (`src/solve.auto-pr.lib.mjs`). They are not "solving all open issues",
  so they are unchanged.
- **`/task --split`** (`src/task.mjs`) attaches freshly created child issues,
  which never have a parent, so RC2 cannot occur there. The new `replaceParent`
  option of `buildAddSubIssueApiArgs` defaults to `false`, so its requests are
  unchanged.

## Verification

- `tests/test-issue-2284-repository-mode-assignment.mjs` has 15 tests. It
  replays both incidents against a fake `gh`: the #20 run, where all nine
  issues must now be assigned, and the #46 run, where all six leftovers must be
  moved from their closed parents. It also covers the best-effort paths:
  unknown user, non-assignable user, silently dropped assignee, per-issue
  failure, rate-limit retry, open parent, and an unreadable parent.
- Without the fix, the test file fails: `assignIssuesToCurrentUser` does not
  exist, and `moved` is not reported.
- Live check with `experiments/issue-2284-live-assign.mjs`:
  - `link-assistant/hive-mind#2284` returned `assigned: [2284]`, and
    `gh issue view 2284 --json assignees` lists `konard`;
  - `torvalds/linux` returned
    `skippedReason: "konard cannot be assigned to issues in torvalds/linux: gh: Not Found (HTTP 404)"`,
    with no POST sent.
- `replace_parent` was not exercised live because that would re-parent real
  issues. It follows the documented contract, and
  `GET /repos/konard/vietnam-accomodation-search/issues/43/parent` was verified
  live (it returns the closed #44).

## Follow-up ideas (not required by the issue)

- The combined issue body claims "Issues attached as sub-issues of this issue:
  N" before attachment runs. It could be edited afterwards to the real count.
- When the pull request of a repository-mode run is merged without closing some
  sub-issues (for example pending live gates), the assignee stays on those
  issues. That is still accurate, because they are the account's unfinished
  work, but a future run could remove the assignee when it closes the combined
  issue.
