# Issue #1760 - /hive skipped an existing draft solution PR

- Issue: https://github.com/link-assistant/hive-mind/issues/1760
- Pull request: https://github.com/link-assistant/hive-mind/pull/1768
- Filed: 2026-05-06T11:31:38Z
- Affected command: `/hive --all-issues --once --skip-issues-with-prs`
- Affected private repository: named in the public issue; raw private logs are not committed here.

## TL;DR

`/hive --skip-issues-with-prs` incorrectly treated open draft pull requests as absent. During the incident, issue `#110` already had pull request `#111`, but that PR was temporarily converted back to draft while an automated work session rechecked CI. The batch GraphQL checker filtered it out with `!item.source.isDraft`, so `/hive` queued the issue and created duplicate PR `#116`.

The fix is to count every open linked PR that uses closing keywords, regardless of draft status. Draft PRs are work in progress, but they are still active solution drafts and must block duplicate work.

## Files in this folder

| File                                    | Contents                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `data/public-issue-1760.json`           | Public issue metadata with the private log URL/body summarized rather than copied. |
| `data/pr-1768-initial.json`             | Prepared PR metadata before this fix replaced the placeholder title/body.          |
| `data/sanitized-incident-timeline.json` | Reconstructed incident timeline with no private log body or source code.           |
| `data/sanitized-evidence.md`            | Short sanitized excerpts from the raw execution log and GitHub API evidence.       |

The raw gist log was inspected locally at `/tmp/hive-issue-1760/issue-1760-source-log.raw`. It is intentionally excluded from the repository because it contains private repository output, tool prompts, command output, uploaded-log URLs, and authentication context.

## Requirements from the issue

1. Download and inspect all related logs and data.
2. Preserve only non-private, non-sensitive compiled evidence under `docs/case-studies/issue-1760`.
3. Reconstruct the timeline and sequence of events.
4. List each requirement and determine root causes.
5. Propose solutions and solution plans for every requirement.
6. Search online for additional facts and data.
7. Add debug or verbose output if data is insufficient to find the root cause.
8. Report issues to other projects only if another project is responsible.
9. Complete the work in one pull request.

## Reconstructed timeline

| Time (UTC)           | Event                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------- |
| 2026-05-06T07:36:46Z | Private issue `#110` was created.                                                           |
| 2026-05-06T07:37:44Z | PR `#111` was created for issue `#110`. Its body used a closing keyword for the issue.      |
| 2026-05-06T07:37:45Z | GitHub issue timeline recorded the cross-reference from PR `#111` to issue `#110`.          |
| 2026-05-06T07:58:03Z | PR `#111` was marked ready for review.                                                      |
| 2026-05-06T11:15:55Z | A later automated work session on PR `#111` started and converted the PR to draft mode.     |
| 2026-05-06T11:16:15Z | The reported `/hive` command started.                                                       |
| 2026-05-06T11:16:25Z | `/hive` fetched five open issues and ran the batch GraphQL PR check.                        |
| 2026-05-06T11:16:25Z | Batch PR check reported `0/5 issues have open PRs`, so issue `#110` was added to the queue. |
| 2026-05-06T11:16:51Z | Worker recheck for issue `#110` again reported `0/1 issues have open PRs`.                  |
| 2026-05-06T11:17:19Z | Duplicate PR `#116` was created for issue `#110`.                                           |
| 2026-05-06T11:17:20Z | GitHub issue timeline recorded the cross-reference from PR `#116` to issue `#110`.          |
| 2026-05-06T11:18:55Z | PR `#111` was marked ready for review again.                                                |
| 2026-05-06T14:27:07Z | PR `#111` was merged.                                                                       |
| 2026-05-06T14:27:09Z | Issue `#110` was closed by the merged linked PR.                                            |
| 2026-05-06T18:57:29Z | Duplicate PR `#116` was closed unmerged.                                                    |

## Root cause

The duplicate was caused by this condition in `src/github.batch.lib.mjs`:

```javascript
item.source.state === 'OPEN' && !item.source.isDraft;
```

The surrounding logic was already correct in two important ways:

- It queried GitHub issue timeline `CrossReferencedEvent` entries whose source was a pull request.
- It required a real closing keyword such as `Fixes #110`, `Closes #110`, or `Resolves #110`, which avoids false positives from casual references.

The draft exclusion was the defect. `/hive --skip-issues-with-prs` is documented and logged as skipping issues that have any open PRs. Draft PRs are open PRs, and in this project they explicitly represent an active automated solution draft. Excluding them allowed concurrent duplicate work during the window where PR `#111` was open but draft.

## Why the final summary later found both PRs

The same batch checker reported `5/5 issues have open PRs` at the end of the run and listed both PR `#111` and PR `#116`. That does not contradict the earlier failure. By then PR `#111` had already been marked ready for review again, so the old `!isDraft` filter no longer hid it.

## Online research

GitHub documents that linking a pull request to an issue shows collaborators that someone is working on the issue and can automatically close the issue when the linked PR is merged:
https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue

GitHub also documents draft pull requests as work-in-progress PRs that cannot be merged until marked ready for review:
https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests

Taken together, the expected `/hive` behavior is to treat an open linked draft PR as active work, not as absence of work.

## Fix

Move the timeline parsing into `extractLinkedPullRequestsForIssue()` and count linked PRs when:

1. The timeline source is a pull request.
2. The PR state is `OPEN`.
3. The PR body or title has a closing keyword for the issue.

The helper returns `isDraft` in the linked PR metadata for visibility, but no longer excludes draft PRs.

## Solution plan coverage

| Requirement                            | Solution                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------- |
| Preserve evidence without private data | Keep raw logs in `/tmp`; commit only sanitized summaries and short excerpts.                |
| Find root cause                        | Compare raw `/hive` decisions with GitHub timeline state; isolate the `!isDraft` filter.    |
| Prevent duplicate PR creation          | Count open draft PRs in the batch checker used by queue filtering and worker rechecks.      |
| Preserve false-positive protection     | Keep the closing-keyword test from issue `#1094`; casual issue mentions still do not count. |
| Add test coverage                      | Add a focused regression test for an open draft PR whose body contains `Resolves #110`.     |
| Avoid unnecessary third-party reports  | No upstream GitHub or private-repo defect was found; behavior was internal to hive-mind.    |

## Verification

- The new regression test fails before the fix with `0 !== 1` for an open draft PR that resolves the issue.
- After the fix, the same test passes and confirms non-closing draft PR mentions are still ignored.
- Existing `prClosesIssue` coverage remains unchanged and verifies closing-keyword parsing.
