# Case study: issue #2306 — a repository-mode pull request was merged without closing the listed issues

- Issue: https://github.com/link-assistant/hive-mind/issues/2306
- Pull request with the fix: https://github.com/link-assistant/hive-mind/pull/2307
- Affected run: combined issue [konard/vietnam-accomodation-search#50](https://github.com/konard/vietnam-accomodation-search/issues/50), pull request [#51](https://github.com/konard/vietnam-accomodation-search/pull/51)
- hive-mind version of the run: 2.32.0 (`--tool codex`, model `gpt-6-sol`)

## Summary

`/solve https://github.com/konard/vietnam-accomodation-search --auto-merge ...` ran in repository mode (#2212). It created the combined issue #50, which lists 7 open issues and asks for one closing reference per issue. The pull request #51 was merged automatically with only `Fixes #50` in its description. GitHub closed #50, and all 7 listed issues (#16, #39, #40, #41, #42, #43, #48) stayed open.

Four defects combined to produce this:

| #   | Root cause                                                                                                                                                                                                          | Fix                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RC1 | 6 of 7 issues could not be attached as sub-issues: they were still sub-issues of closed combined issues from earlier runs (#20, #44), and GitHub allows one parent (HTTP 422 "Sub issue may only have one parent"). | Read the current parent; if it is closed or a generated combined issue, move the issue with the documented `replace_parent` parameter.                 |
| RC2 | `--ensure-all-sub-issues-addressed` only checked **native** sub-issues. With 1 of 7 attached, it checked only #48 and never saw the other 6.                                                                        | Also parse the "Required closing references" block of the combined issue body; both sources are merged.                                                |
| RC3 | Missing closing references never blocked `--auto-merge`. Once CI was green the pull request was merged, although the AI had explicitly withheld the references because it could not finish the work.                | Both auto-merge paths now run a closing-references gate and post an "auto-merge blocked" comment that lists the missing references instead of merging. |
| RC4 | The log was uploaded once, before the post-solve restart loops ran. Two hours of restart iterations and the auto-merge were never published, which made the investigation harder.                                   | The log is uploaded again when any post-solve restart loop ran iterations.                                                                             |

## Data

Everything used for this study is in [`data/`](./data):

| File                                                                  | Content                                                                                                                                  |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [`solve-log-pr51.txt`](./data/solve-log-pr51.txt)                     | The complete log attached to PR #51 (22 MB; the account email and id are redacted). It ends at 05:54:36, when it was uploaded — see RC4. |
| [`issue-50.json`](./data/issue-50.json), `issue-50-view.txt`          | The combined issue #50 (REST API and `gh issue view`)                                                                                    |
| [`issue-48.json`](./data/issue-48.json)                               | #48 — the combined issue of the previous run, still open                                                                                 |
| [`pr-51.json`](./data/pr-51.json), `pr-51-view.txt`                   | The merged pull request #51                                                                                                              |
| [`pr-51-comments.txt`](./data/pr-51-comments.txt)                     | Conversation comments on #51                                                                                                             |
| [`pr-51-description-edits.json`](./data/pr-51-description-edits.json) | Edit history of the #51 description (GraphQL `userContentEdits`)                                                                         |
| [`issue-states-after-merge.tsv`](./data/issue-states-after-merge.tsv) | State and parent of every listed issue after the merge                                                                                   |
| [`hive-mind-issue-2306.md`](./data/hive-mind-issue-2306.md)           | The text of this issue                                                                                                                   |

## Timeline (UTC)

| When                | Event                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-09-22 16:19    | Combined issue #20 ("Address all 8 open issues", repository mode) is closed. #16 stays open as its native sub-issue.                                                                                                                                                                 |
| 2026-09-24 19:44    | Combined issue #44 ("Address all 5 open issues") is closed. #39–#43 stay open as its native sub-issues.                                                                                                                                                                              |
| 2026-09-26 01:52    | Repository mode creates #48 ("Address all 6 open issues"). Its sub-issue summary is 0: the attachments failed the same way (RC1).                                                                                                                                                    |
| 2026-09-26 02:25    | PR #49 is merged and closes #48 (and more); the owner reopens them at 17:34 because the acceptance gates were not met.                                                                                                                                                               |
| 2026-09-27 04:19:30 | `solve https://github.com/konard/vietnam-accomodation-search --think xhigh --auto-merge --tool codex --attach-logs --verbose ...` starts (v2.32.0).                                                                                                                                  |
| 04:19:39            | Repository mode selects 7 issues (#16, #39–#43, #48) and creates #50.                                                                                                                                                                                                                |
| 04:19:42 – 04:19:50 | `⚠️ Could not attach #16 … #43 as a sub-issue: … Sub issue may only have one parent (HTTP 422)` (log lines 51–56).                                                                                                                                                                   |
| 04:19:52            | `Sub-issues attached: 1/7 (6 could not be attached)`. Only #48 becomes a native sub-issue of #50 (log line 58).                                                                                                                                                                      |
| 04:20:34            | Draft PR #51 is created with `Fixes #50`.                                                                                                                                                                                                                                            |
| 05:42:23            | The AI comments that the remaining acceptance work needs operator inputs (npm token, Telegram credentials, deployment window) and that "PR #51 remains draft, with no closing references, until the linked acceptance checklists pass". It removes `Fixes #50` from the description. |
| 05:54:32            | hive-mind re-adds `Fixes #50` ("Updated PR body to include "Fixes #50"") and converts the PR to ready for review at 05:54:35.                                                                                                                                                        |
| 05:54:36            | The log is uploaded — the only upload of this run. The attached log ends here.                                                                                                                                                                                                       |
| 05:55 – 07:48       | Post-solve restart iterations keep committing. The ensure-sub-issues loop checks only native sub-issues, i.e. #48. None of this appears in any attached log (RC4).                                                                                                                   |
| 06:24:46            | The AI comments: "I have left PR #51 draft and have not added `Fixes #48` while its acceptance checklist is open."                                                                                                                                                                   |
| 07:53:37            | Auto-merge: "🎉 Auto-merged … All CI checks have passed". GitHub closes #50 only.                                                                                                                                                                                                    |
| after               | #16 (parent #20, closed), #39–#43 (parent #44, closed) and #48 (parent #50, closed) are all still open ([`issue-states-after-merge.tsv`](./data/issue-states-after-merge.tsv)).                                                                                                      |

## Requirements from the issue

1. Download all logs and data of the incident into `docs/case-studies/issue-2306` — done, see [Data](#data).
2. Reconstruct the timeline — see [Timeline](#timeline-utc).
3. List every requirement — this section.
4. Find the root cause of each problem — see [Root causes](#root-causes).
5. Propose solutions and plans, checking existing components — see [Solutions](#solutions) and [Existing components](#existing-components-and-online-facts).
6. Search online for more facts — see [Existing components](#existing-components-and-online-facts).
7. Add debug output if the data is not enough — the data was enough; extra verbose output was added anyway (see RC2 and RC4).
8. Report issues to other projects where relevant — not needed: every defect is in hive-mind's own logic, and GitHub behaves as documented.
9. Apply the fix everywhere it is relevant — both auto-merge paths (`solve.auto-merge.lib.mjs` watch loop and `solve.auto-merge-attempt.lib.mjs` one-shot attempt) run the new gate. `task.mjs` also attaches sub-issues, but only to newly created issues, which cannot have a parent yet, so it is unchanged.
10. The user-visible expectation (issue title): a repository-mode pull request must actually close the issues it lists, or must not be merged automatically.

## Root causes

### RC1 — stale parents block the attachment

GitHub allows one parent per sub-issue. Every earlier repository-mode run left its combined issue as the parent of the issues it listed. When the pull request did not close them (because the owner reopened them, or the references were missing), the issues stayed attached to a **closed** combined issue. `attachSubIssues()` (`src/solve.repository-mode.run.lib.mjs`) treated the 422 as a plain failure:

```
[2026-09-27T04:19:42.269Z] [INFO]    ⚠️  Could not attach #16 as a sub-issue: gh: An error occurred while adding the sub-issue to the parent issue. Sub issue may only have one parent (HTTP 422)
...
[2026-09-27T04:19:52.327Z] [INFO]    Sub-issues attached: 1/7 (6 could not be attached)
```

The same happened to #48 on 2026-09-26 (its sub-issue summary is `{total: 0}`), so the problem compounds with every run.

### RC2 — the check only knew native sub-issues

`runEnsureAllSubIssuesAddressed()` fetched `GET /issues/50/sub_issues`, which returned only #48. The combined issue body lists all 7 issues in its "Required closing references in the pull request description" block, but that block was never read. So the check that exists to guarantee "one closing reference per issue" was blind to 6 of the 7 issues.

### RC3 — missing references did not block the automatic merge

Even for #48, which the check did see, the loop only restarted the AI (up to 5 times) and then gave up. The AI refused, reasonably, to add `Fixes #48` because the acceptance gates needed human-provided credentials (comment at 06:24:46). Neither auto-merge path looked at the closing references, so once CI passed:

```
## 🎉 Auto-merged
This pull request has been automatically merged by hive-mind.
- All CI checks have passed
```

A pull request that intentionally does not close the issues it was created for was merged unattended. It closed only #50, which made the result look complete.

### RC4 — the restart iterations were never logged

`verifyResults()` uploads the log before the post-solve loops (escalation, auto-ensure, keep-working, ensure-sub-issues) run. None of them uploads again, and `attachFinalLogIfMissing()` skips the upload because a log was already attached. The attached log ends at 05:54:36, while commits continued until 07:48 and the merge happened at 07:53.

## Solutions

All changes are in PR #2307.

### RC1 — move issues away from stale parents

- `buildAddSubIssueApiArgs({ replaceParent })` sends `-F replace_parent=true` (`src/task.split.lib.mjs`).
- `buildParentIssueApiArgs()` reads `GET /repos/{o}/{r}/issues/{n}/parent`.
- On "Sub issue may only have one parent", `attachSubIssues()` reads the current parent. `shouldReplaceSubIssueParent()` allows the move only when that parent is **closed** or is a generated combined issue (it contains the `<!-- hive-mind-solve-repository-mode -->` marker). An open parent written by a person is kept: taking the issue away from a human-maintained epic would be surprising. Such an issue is still required through the closing-references block (RC2).
- The result reports `moved` issues, and the summary prints them.

### RC2 — required issues = native sub-issues ∪ closing-reference block

- `parseRequiredClosingReferences(body)` (`src/solve.repository-mode.lib.mjs`) reads the fenced block under the `REQUIRED_CLOSING_REFERENCES_HEADING`, only for bodies with the repository-mode marker. For the real #50 body it returns `[16, 39, 40, 41, 42, 43, 48]`.
- `mergeRequiredSubIssues()` merges both sources and tags each entry with `source: 'sub-issue' | 'issue-body'`.
- `fetchRequiredSubIssues()` tolerates one source failing. The loop logs how many issues came only from the body, and lists them with `--verbose`.

### RC3 — closing-references gate before any automatic merge

- `evaluateClosingReferencesGate()` (pure) and `checkClosingReferencesBeforeMerge()` (I/O) in `src/solve.ensure-sub-issues*.lib.mjs`. The gate is on when `--ensure-all-sub-issues-addressed` is set or the issue body has the repository-mode marker. It produces a `missing_closing_references` blocker listing every missing issue and the exact `Fixes #N` lines to add.
- Both auto-merge paths add this blocker to the existing issue blockers (#2144) and report through `reportAutoMergeBlockedByIssue()` instead of merging.
- `buildAutoMergeBlockedComment()` tells the user to add the references and re-run, or to merge manually knowing the issues will stay open. It no longer suggests reopening the issue for this reason.
- A failure of the gate itself is logged and reported but fails open, the same as the existing blocker checks, so a GitHub API hiccup cannot block every merge.

Replaying the real data: for PR #51 the gate reports "The pull request #51 description does not close 7 of the 7 issue(s) required by #50", so the merge would have been held back with a comment.

### RC4 — upload the log again after restart iterations

`attachLogAfterPostSolveRestarts()` (`src/attach-logs-guarantee.lib.mjs`) runs after the last post-solve loop in `solve.mjs`. It uploads the log again when at least one loop ran iterations and `--attach-logs` is on. It never throws.

### Tests

- `tests/test-repository-mode-closing-references-2306.mjs` (22 tests) replays the real #50/#51 data (7 of 7 missing → blocked; a fixed description → allowed). It also covers the parent move with a fake `gh` (closed or generated parent → moved with `replace_parent`; open human parent → kept), the blocked-merge comment, the gate in both merge paths, and the log re-upload.
- Updated: `tests/test-solve-repository-mode-2212.mjs` (the parent lookup is a GET, not a retry) and `tests/test-closed-issue-merge-blocking-2144.mjs` (the gate is now the union of both blocker sources).

## Existing components and online facts

- **GitHub REST "Add sub-issue"** — `POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues`, body `sub_issue_id` (required) and `replace_parent` (boolean): "Option that, when true, instructs the operation to replace the sub-issues current parent issue". The page also warns that "Creating content too quickly using this endpoint may result in secondary rate limiting". https://docs.github.com/en/rest/issues/sub-issues#add-sub-issue
- **GitHub REST "Get parent issue"** — `GET /repos/{owner}/{repo}/issues/{issue_number}/parent`, which answers 404 "No parent issue found" when there is none (verified on #50, see `issue-states-after-merge.tsv`). https://docs.github.com/en/rest/issues/sub-issues#get-parent-issue
- **Closing keywords** — `close(s|d)`, `fix(es|ed)`, `resolve(s|d)`. For several issues "use full syntax for each issue", and the keywords are interpreted only when the pull request targets the default branch. https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue. hive-mind already had `findMissingSubIssueReferences()` (#2212) implementing exactly these rules, so it was reused rather than re-implemented.
- **GitHub's own auto-merge** (`gh pr merge --auto`) only waits for required checks and reviews. It has no notion of "the linked issues must be closed", so it cannot replace this gate. The closest native feature is a required status check. A custom check that runs the same gate in the target repository is a possible follow-up for users who merge manually.

## Observations and possible follow-ups

- **#48 is itself an older combined issue.** Repository mode selected it as one of the "open issues" of the repository. With this fix its `Fixes #48` is required like any other, which closes the superseded umbrella once the new pull request is merged. Excluding open generated combined issues from the selection would be an alternative, but it would leave them open forever, so the current behavior is kept.
- **Parallel work on RC1.** The open pull request [#2300](https://github.com/link-assistant/hive-mind/pull/2300) (issue [#2284](https://github.com/link-assistant/hive-mind/issues/2284)) also reclaims sub-issues whose parent is closed, using the same `replace_parent` option and the same `buildAddSubIssueApiArgs({ replaceParent })` shape. RC2–RC4 (the closing-references gate before auto-merge, and the log re-upload) exist only in this pull request. Whichever one merges second must keep a single reclaim implementation.
- The AI's reason for withholding the references was legitimate: the remaining acceptance steps needed secrets and operator access. The correct outcome for such a run is a ready pull request that is **not** merged automatically, plus a comment that says exactly why. This is what the gate now produces.
