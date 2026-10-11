# Kill recovery notices posted to the wrong pull request

[Issue #2891](https://github.com/link-assistant/hive-mind/issues/2891): after a
host Docker daemon restart killed four `/codex` sessions for
link-assistant/router #724, #725, #727 and #728, the bot posted every
kill-recovery notice and intermediate log on router
[PR #721](https://github.com/link-assistant/router/pull/721). That PR is the
plan PR of the parent issue #720. [PR #2899](https://github.com/link-assistant/hive-mind/pull/2899)
fixes the PR selection.

The [requirements audit](requirements-audit.md) maps each requirement of the issue
to the change and test that cover it.

## Evidence

| File                                                                                   | Content                                                                                      |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [data/issue.json](data/issue.json)                                                     | Issue snapshot (it has no comments)                                                          |
| [data/closing-references.json](data/closing-references.json)                           | `closedByPullRequestsReferences` of router #724/#725/#727/#728                               |
| [data/pr-721.json](data/pr-721.json)                                                   | The plan PR: branch `issue-720-99e7abc4e6c1`, body `Fixes #720`, `Fixes #722` … `Fixes #741` |
| [data/pr-721-comments.json](data/pr-721-comments.json), [.md](data/pr-721-comments.md) | All 17 comments on #721, including the 14 misrouted ones                                     |
| [data/own-prs.json](data/own-prs.json)                                                 | The sessions' own PRs #749, #750, #752 and #753                                              |

GitHub returns two linked PRs for each sub-issue, and the plan PR comes first:

```
#724 → [#721 issue-720-99e7abc4e6c1 OPEN, #749 issue-724-878028a21e67 MERGED]
#725 → [#721 issue-720-99e7abc4e6c1 OPEN, #750 issue-725-052105988e50 MERGED]
#727 → [#721 issue-720-99e7abc4e6c1 OPEN, #752 issue-727-61ea612f008e MERGED]
#728 → [#721 issue-720-99e7abc4e6c1 OPEN, #753 issue-728-9679a13cda3c MERGED]
```

## Timeline (UTC)

| Time                      | Event                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-07 19:09          | PR #721 opened on `issue-720-…`. Its description closes #720 and the sub-issues #722–#741.                                                                                            |
| 10-07 20:03–20:06         | Normal solve comments on #721 (session summary, solution log, ready to merge).                                                                                                        |
| 10-08 23:55               | #749 opened for #724.                                                                                                                                                                 |
| 10-09 00:25               | #750 opened for #725.                                                                                                                                                                 |
| 10-09 02:59:59            | Completion kill-notice of session `292d52b8…` (an earlier OOM event) is posted on **#721** ([6073350762](https://github.com/link-assistant/router/pull/721#issuecomment-6073350762)). |
| 10-09 03:18               | #752 opened for #727.                                                                                                                                                                 |
| 10-09 09:14:06            | Same for session `fc853386…` on **#721** ([6077995466](https://github.com/link-assistant/router/pull/721#issuecomment-6077995466)).                                                   |
| 10-09 09:41               | #753 opened for #728.                                                                                                                                                                 |
| 10-09 12:11:39            | Kernel OOM-kills host dockerd. Its restart SIGKILLs the bot container and the four task containers (exit 137).                                                                        |
| 10-09 13:31               | Bot container started again by hand; kill recovery runs.                                                                                                                              |
| 10-09 13:32:28–13:33:52   | Four recovery-lifecycle comments (sessions `9243e682` #724, `bda4771d` #725, `175ff931` #727, `eec34a2b` #728) are created on **#721** and updated until 14:33.                       |
| 10-09 14:08–14:34         | Four intermediate session logs (13.5 MB to 59 MB) and four "Working session restarted after a kill" notices are posted on **#721**.                                                   |
| 10-09 14:50               | Issue #2891 opened.                                                                                                                                                                   |
| 10-09 16:49 – 10-10 03:25 | #753, #750, #752 and #749 are auto-merged. The sessions themselves always worked on their own PRs.                                                                                    |

Only the bot's monitor picked the wrong PR. Solve's comments ("AI Work Session
Started", solution logs) went to the right PRs, because
`checkExistingPRsForAutoContinue` rejects PRs whose branch does not match
`issue-<n>-` (`src/solve.auto-continue.lib.mjs`).

## Root causes

1. **First linked PR wins.** `resolvePullRequestUrlForSession`
   (`src/session-monitor.lib.mjs`) returned `linkedPRs[0].url` from
   `batchCheckPullRequestsForIssues`. A PR whose description says `Fixes #724`
   is linked to #724 by GitHub even when its branch and first closing reference
   belong to #720. Nothing checked that the PR belonged to the session's issue.
2. **Any PR URL in the log wins.** The fallback `resolvePullRequestUrlFromSessionLog`
   returned the first `…/pull/N` URL in the session log. A sub-issue body, the
   prompt or the agent can mention the plan PR long before solve prints its own.
3. **The wrong answer sticks.** The result is cached in
   `sessionInfo.resolvedPullRequestUrl` (issue #2189) and persisted. Every later
   recovery report, kill notice, log upload and completion link of the session
   reuses it. That is why one lookup put 14 comments on #721.
4. **`/merge` has the same pattern.** `fetchReadyIssuesWithPRs`
   (`src/github-merge.lib.mjs`) searched PRs whose body closes the issue and took
   the oldest. A plan PR is older than the PRs of its sub-issues, so it was chosen.

The single resolver serves every affected path: completion messages
(`monitorSessions`), the recovery lifecycle (`session-recovery-lifecycle.lib.mjs`),
kill notices and intermediate logs (`announceKillOnPullRequest` in
`session-monitor.kill-sections.lib.mjs`, which falls back only to the PR the
session was started on).

## Solution

| Requirement                                                                 | Change                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prefer the PR the session created or used                                   | The resolver first scans the session log for the lines solve prints for its own PR: `📍 PR URL:` (auto PR creation), `PR URL:` (continue mode) and `📍 URL:` (final verification, found by `gh pr list --head <branch>`). URLs that the log only mentions are ignored. The result is still cached in `sessionInfo.resolvedPullRequestUrl`.                                                                       |
| Among linked PRs, take the one on `issue-<n>-`; never a PR of another issue | New `isIssueOwnPullRequest` / `getPullRequestPrimaryIssueUrl` (`src/github-linking.lib.mjs`) reuse `resolvePrimaryIssueNumber` (issues #2335 and #2563): the branch number, or the first closing reference for a branch without the convention. `selectIssueOwnPullRequest` returns the first linked PR whose primary issue is the session's issue; otherwise the resolver returns `null` and nothing is posted. |
| Same selection everywhere                                                   | All session paths share `resolvePullRequestUrlForSession`. Batch results now carry `headRefName` and `primaryIssueUrl`. `/merge` sorts the issue's own PR first.                                                                                                                                                                                                                                                 |
| Debug output                                                                | With `--verbose`, the bot logs each skipped linked PR with its branch and owning issue, the announced PR it found, and why no PR was chosen.                                                                                                                                                                                                                                                                     |

When no PR of its own is known yet (the session was killed before solve
created one), the resolver returns `null`. The notice is not posted to a foreign
PR; the lookup runs again at the next report, and the Telegram message still
carries the issue link.

### Alternatives considered

- **Persist the PR URL when solve announces it.** That would need a structured
  channel from the solve process inside an isolated container to the bot.
  The log the bot already reads carries the same lines, so the scan gives the
  same answer without a new protocol.
- **Filter by branch only.** It would reject a PR the user opened by hand on an
  ordinary branch. `resolvePrimaryIssueNumber` already handles that case, and the
  related corner cases from #2335/#2563.
- **Reuse `excludeAncestorPullRequests` (issue #2685).** That filter needs
  native parent/sub-issue data. Router #720 lists its sub-issues in a PR
  description, so it would not apply, and it costs extra API calls.

## Known limitations

- A wrong `resolvedPullRequestUrl` saved by an older version in a session that
  is still tracked is reused. It cannot be told apart from a correct value
  without another lookup. New sessions are not affected.
- A PR on a non-conventional branch whose first closing reference names
  another issue is not treated as the issue's own. That is the intended
  behavior for a multi-issue PR.
- The scan takes the first announcement line in the log. Solve prints its own
  before the agent starts, so agent output can only win if it prints
  `PR URL: <another PR>` in a session that was killed before solve announced
  anything.
- The session log is now read before the linked-PR lookup, not only after it
  fails. The scan is chunked (issue #2189) and stops at the first match, and
  the answer is cached; a session with no announcement is scanned on each
  report until a PR is found, as before the fix for sessions without a
  linked PR.

## Existing components and online research

- GitHub links a PR to every issue its description closes with a keyword, and
  a single PR may close many issues ([Linking a pull request to an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue)).
  `closedByPullRequestsReferences` therefore lists every such PR. GitHub defines no
  "primary" PR, and the order is not a statement of ownership. GitHub's own
  [github-mcp-server change](https://github.com/github/github-mcp-server/pull/3006)
  also treats the field as a plain list (with `includeClosedPrs` and `totalCount`).
- GitHub's GraphQL API has no field for the PR that "belongs" to an issue. Ownership
  has to come from conventions: hive-mind's `issue-<n>-<hash>` branch name, or
  the first closing reference.
- Inside the repository, `resolvePrimaryIssueNumber` (issues #2335 and #2563),
  `isAncestorPullRequest` (issue #2685) and solve's `matchesIssuePattern`
  already encoded the ownership rules; the fix reuses them instead of adding a
  new parser.

No external issue was filed. GitHub's linking works as documented, and the bug
was in how hive-mind interpreted the list. No other project is involved.

## Reproduction and verification

- `node experiments/issue-2891-session-pr-selection.mjs --verbose` replays the
  captured linked-PR lists: the old rule gives `#721` for all four issues, the new
  one gives `#749`, `#750`, `#752` and `#753`.
- `node --test tests/session-pr-ownership-2891.test.mjs` covers the ownership
  helpers, the batch fields, the selection, the resolver with a linked list and
  with a session log, and the announcement parser. It uses the captured data.
