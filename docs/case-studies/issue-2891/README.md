# Case study: issue #2891 — kill-recovery notices go to the wrong pull request

During the kill recovery of 2026-10-09, the recovery notices for four different tasks (link-assistant/router #724, #725, #727 and #728) were all posted to router#721. That is the case-study PR of the parent issue router#720, which planned those four sub-issues. Each task had its own PR (#749, #750, #752 and #753). GitHub links both PRs to each sub-issue, because the parent PR's description lists the sub-issues it plans, and the bot took the first linked PR.

Runtime at the incident: hive-mind 2.34.0, start-command 0.35.4, Docker 29.6.1. The code references below are to [`790c18d`](https://github.com/link-assistant/hive-mind/tree/790c18dec9ec0dd2281de05a48f2047690a60415) (before) and this branch (after).

Data in this folder:

- `data/issue.json`: the issue (`gh issue view 2891 --json title,body,comments`). It has no comments.
- `data/umbrella-3282.json`: the umbrella issue that tracks it.
- `data/pr-2899.json`, `data/pr-2899-body.json`, `data/pr-2899-files.txt`: the earlier, unmerged PR for this issue. Its closing reference was replaced with `[closing keyword removed]`.
- `data/pr-3295.json`: the merge that closed this issue by mistake on 2026-10-15.

## Timeline (UTC)

| Time                | Event                                                                                                                                                                                    | Evidence                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| before 2026-10-09   | router#720 is planned in PR #721 on branch `issue-720-99e7abc4e6c1`. Its description references the sub-issues #724, #725, #727 and #728, so GitHub links #721 to each of them           | issue body, "Root cause"            |
| before 2026-10-09   | `/codex` tasks for the sub-issues open their own PRs: #749 (`issue-724-878028a21e67`), #750 (`issue-725-052105988e50`), #752 (`issue-727-61ea612f008e`), #753 (`issue-728-9679a13cda3c`) | issue body, table                   |
| 2026-10-09 12:11:39 | The host dockerd is OOM-killed; every container is SIGKILLed, including the four tasks                                                                                                   | issue body, "Incident context"      |
| 13:31 onward        | The bot recovers the four sessions. Each recovery notice is posted to router#721 (comments 6081947908, 6081957476, 6081964840 and 6081974137), not to the task's own PR                  | issue body, table with comment URLs |
| 2026-10-15 12:14    | The merge of #3295 closes the issue with an appended closing line; it is reopened                                                                                                        | status note, `data/pr-3295.json`    |

The GraphQL answer for router#724 (from the issue) shows the order the bot saw:

```
issue(number:724){ closedByPullRequestsReferences … }
→ [{number:721, headRefName:"issue-720-99e7abc4e6c1"}, {number:749, headRefName:"issue-724-878028a21e67"}]
```

## Requirements

From the issue's "Suggested fix" section:

1. R1. Prefer the PR the session itself created or used: the `issue-<n>-*` branch or the PR URL that solve printed.
2. R2. Among linked PRs, pick the one whose head branch matches `issue-<n>-`. Never pick a PR whose branch belongs to another issue.
3. R3. Use the same selection everywhere a PR is resolved for a session: completion messages, kill notices and log attachments.
4. Expected: each notice lands on the task's own PR.
5. From the case-study template: collect the data, reconstruct the timeline, find the root cause, and check every similar place in the codebase.

## Root causes and fixes

| Problem                                                       | Root cause                                                                                                                                                                                                                                                                                     | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Test                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The first linked PR is used (R2)                              | [`resolvePullRequestUrlForSession`](https://github.com/link-assistant/hive-mind/blob/790c18dec9ec0dd2281de05a48f2047690a60415/src/session-monitor.lib.mjs#L1076-L1110) returned `linkedPRs[0].url`. The linked PRs did not even carry their head branch, so the bot could not tell them apart. | New `src/session-own-pr.lib.mjs`. `selectSessionPullRequest` prefers, in order: a PR on the session issue's `issue-<n>-*` branch (`branchIssueNumber`); a PR on a non-issue branch (a custom branch); a PR whose branch is unknown. A PR on another issue's branch is never chosen. `lookupSessionPullRequestUrl` applies it to the linked PRs and logs each rejected PR in verbose mode. `batchCheckPullRequestsForIssues` (`src/github.batch.lib.mjs`) now asks GraphQL for `headRefName` and keeps it on each linked PR. | `tests/session-own-pr-2891.test.mjs`: "router#724: the parent plan PR listed first is not chosen"; "a PR whose branch belongs to another issue is never chosen"; "a PR on a custom branch is used only when no own branch exists"; "linked PRs carry the head branch fetched by GraphQL"; "the default lookup returns the own PR, or null instead of another issue PR" |
| The session-log fallback takes the first PR URL it meets (R1) | [`resolvePullRequestUrlFromSessionLog`](https://github.com/link-assistant/hive-mind/blob/790c18dec9ec0dd2281de05a48f2047690a60415/src/session-monitor.lib.mjs#L358-L377) returned the first `/pull/N` URL in the log, which can be a PR the agent only mentioned (such as the parent plan PR). | `createSessionPullRequestUrlScanner` reads the log chunk by chunk. It returns the URL on solve's own `PR URL:` line (`📍 PR URL:` for a new PR, `PR URL:` in continue mode) as soon as it sees it. Otherwise it returns the first PR URL of the same repository that the linked-PR lookup did not already reject as another issue's PR.                                                                                                                                                                                     | "the session log prefers the PR URL solve printed over the first mentioned PR"; "the session log skips PRs already known to belong to another issue"                                                                                                                                                                                                                   |
| Several places resolve a PR (R3)                              | Kill notices (`reportRecoveryLifecycle`, `src/session-recovery-lifecycle.lib.mjs`), completion messages and log attachments (the completion path in `src/session-monitor.lib.mjs`) all resolve through `resolvePullRequestUrlForSession`.                                                      | Fixing that one function covers all of them, and the result is stored in `resolvedPullRequestUrl`. The lifecycle notice uses the session's own URL only when the task was started on a pull request (`urlContext.type === 'pull'`). Without an own PR, a failed recovery is reported on the task's issue (`7e1d178`, issue #2630), never on another PR.                                                                                                                                                                     | The tests above, through the real `lookupSessionPullRequestUrl` with an injected batch lookup                                                                                                                                                                                                                                                                          |

Other places that pick a PR from `linkedPRs` were checked with `grep -rn "linkedPRs\[0\]" src`. The only other one is `/merge` (`src/github-merge.lib.mjs`, around L258), which pairs each issue with its oldest linked PR. A parent plan PR is usually older than a sub-issue's own PR, so `/merge` could pair the sub-issue with the plan PR. It now sorts the same way and then applies `selectSessionPullRequest`, so another issue's PR is never paired. An issue with no PR of its own is skipped and the reason is logged in verbose mode. The test is "/merge pairs a ready sub-issue with its own PR, not the older parent plan PR that also closes it", which runs the real `fetchReadyIssuesWithPRs` with a fake `gh`.

## Tests

`tests/session-own-pr-2891.test.mjs` has 8 tests. The router#724 test uses the exact linked-PR list from the issue (#721 on `issue-720-99e7abc4e6c1` first, then #749 on `issue-724-878028a21e67`) and asserts that #749 is chosen.

## What remains

- **Cached wrong answers.** A session persisted by an older version may already hold a wrong `resolvedPullRequestUrl`, which is reused without a new lookup. This affects only sessions that were running during the upgrade.
- **REST fallback.** When the GraphQL lookup fails and the REST fallback is used, linked PRs have no head branch. Such PRs are the last choice, but between two of them the first still wins.
- **The earlier PR** #2899 has the same scope and is superseded by this branch where they overlap; the maintainer should pick one.

## Related components

- GitHub's `closedByPullRequestsReferences` and timeline `CrossReferencedEvent` data ([GraphQL docs](https://docs.github.com/en/graphql/reference/objects#issue)). A PR is linked to every issue its description closes, so a plan PR that lists sub-issues with closing keywords is linked to all of them.
- solve's branch naming (`issue-<n>-<hash>`) is what makes the own PR identifiable without extra state.

## Reproduction

```bash
npm ci
node --test tests/session-own-pr-2891.test.mjs
```

By hand: create a parent issue with a plan PR whose description closes two sub-issues, run `/solve` on one sub-issue, then kill its task container. On a release without this branch, the recovery notice goes to the plan PR when GitHub lists it first; on this branch it goes to the sub-issue's own PR.
