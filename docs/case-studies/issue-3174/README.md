# Case study: issue #3174 — post-session link repair adds closing references for sub-issues a planning PR only created, and auto-merge closes them unimplemented

- Issue: https://github.com/link-assistant/hive-mind/issues/3174 (opened 2026-10-13, reopened 2026-10-15)
- Pull requests: #3295 (merged 2026-10-15, first part), #3390 (this branch, second part), draft #3175 (WIP, logs only)
- Parent: #3282 (critical-path umbrella)
- Original incident: link-assistant/calculator#227 / link-assistant/calculator#228, case study in
  [calculator `docs/case-studies/issue-247`](https://github.com/link-assistant/calculator/blob/1b91a43a/docs/case-studies/issue-247/README.md)

## Collected data

| File                                        | What it is                                                                                                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue.json`                                | `gh issue view 3174 --json title,body,comments,createdAt,closedAt`, taken 2026-10-15                                                                                                      |
| `raw/pr-3295-commit-35bdc2d2-src.diff`      | Source and changeset diff of the first fix (kept-open and other-repository sub-issues)                                                                                                    |
| `raw/pr-3390-commit-355d0f14-src.diff`      | Source diff of the second fix on this branch (closed, later-created, other-PR, "Part of")                                                                                                 |
| `../../../experiments/issue-3174-repro.mjs` | Reproduction script added with #3295 (calls the real `repairRequiredIssueLinks` with a fake `gh`); on this branch it shows the repair adding nothing and removing the three earlier lines |

The diffs are copies of source code that is already in the repository; they contain example strings such as
closing-keyword examples (an issue number after a keyword) that the code uses in its own messages and tests.

## Timeline (UTC)

| Time                     | Event                                                                                                                                                                                                  | Evidence                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| 2026-10-07 10:31:07      | On calculator#228 (the plan PR for calculator#227) the `finally`-block repair appends `Fixes` lines for calculator#229 to calculator#246, although the description says they stay open                 | calculator case study    |
| 2026-10-07 10:33:43      | The agent removes the lines                                                                                                                                                                            | PR description revisions |
| 2026-10-07 10:44:47      | The next repair re-adds them                                                                                                                                                                           | PR description revisions |
| 2026-10-12 19:16 / 19:23 | The agent removes them twice more                                                                                                                                                                      | PR description revisions |
| 2026-10-12 19:40:26      | The repair re-adds them again                                                                                                                                                                          | PR description revisions |
| 2026-10-12 19:44:21      | Hive Mind auto-merges calculator#228; GitHub closes calculator#236 to calculator#246, none of them implemented (reopened by hand later)                                                                | closed events            |
| before the merge         | The same lines make `--skip-issues-with-prs` skip every open calculator issue (calculator#247, #2685)                                                                                                  | issue body               |
| 2026-10-13 (probe)       | calculator#261: a description saying "does not close calculator#258" still lists #258 in `closingIssuesReferences` — GitHub ignores the negation                                                       | issue body               |
| 2026-10-13 05:50:35      | Issue #3174 opened with a root cause at `ed6a155` (v2.35.8), a reproduction and a five-point suggested fix                                                                                             | `issue.json`             |
| 2026-10-13 06:01:49      | Draft PR #3175 opened by the solver; it only contains a WIP commit and logs (no code)                                                                                                                  | timeline                 |
| 2026-10-14 17:44–17:46   | #3276 filed: the same repair followed sub-issues into link-assistant/formal-ai, so merging #3225 closed 11 formal-ai issues; added as a sub-issue of #3174                                             | timeline                 |
| 2026-10-14 17:54:42      | #3174 attached to the umbrella #3282                                                                                                                                                                   | timeline                 |
| 2026-10-14 18:00:58      | PR #3295 opened (kept-open by description, other-repository sub-issues, negated keywords in the merge guard)                                                                                           | PR                       |
| 2026-10-15 09:57:29      | Commit `35bdc2d2` (PR #3295)                                                                                                                                                                           | `git log`                |
| 2026-10-15 12:14:32      | PR #3295 merged. Production (2.35.8/2.36.0, without the fix) had appended 27 `Fixes` lines for the whole #3282 tree below a `---`, so the merge closed issues #3174 and #3282 and all their sub-issues | issue status note        |
| 2026-10-15 12:19–12:20   | The maintainer reopens them by hand and adds a status note: still open are sub-issues created after the PR, sub-issues another PR closes, and the release                                              | `issue.json`, timeline   |
| 2026-10-15 12:46         | v2.36.1 published to npm with `35bdc2d2`                                                                                                                                                               | npm                      |
| 2026-10-15 13:58–14:19   | Follow-ups filed: #3354, #3357 (PR #3365, open), #3358, #3359                                                                                                                                          | timeline                 |
| 2026-10-15 16:00         | v2.37.0 published (still without the second part)                                                                                                                                                      | npm                      |
| 2026-10-15 17:31         | Commit `355d0f14` on PR #3390: closed, later-created, other-PR and "Part of" handling                                                                                                                  | `git log`                |

## Requirements from the issue

The issue's "Suggested fix" and status note give these requirements:

1. **Scope.** A native sub-issue is not required when it was created after the PR was opened (plan output) or when
   another PR already closes it. Keep the repository-mode block, and keep the all-sub-issues behaviour when the parent
   asks for implementation (for example through an opt-in marker or flag).
2. **Respect the description.** Do not add a closing reference when the description mentions `#N` without a keyword
   ("Part of #N", "#N stays open", "#N to #M stay open"); log it instead.
3. **Never undo the agent.** Do not re-add a reference the agent removed; report the conflict in the session summary.
4. **Parser parity.** Either make `extractClosingIssueReferences` return negated references (GitHub closes them) and
   report them as errors, or use GraphQL `closingIssuesReferences` as the truth for repair, skip and merge checks.
   Before auto-merge, refuse when `closingIssuesReferences` includes an open sub-tree issue with no commits in the PR
   (overlaps #2406).
5. **Regression test** with the calculator#227 wording, asserting that sub-issues created during the session are not
   added.
6. (Status note) Release the fix, so production stops appending these lines.

## Root causes

- **RC1 — everything in the tree was required.** At `ed6a155`, `fetchRequiredIssueScope` walked `…/sub_issues`
  recursively and marked every node as required. Today the walk is still in `fetchRequiredIssueScope`
  (`src/issue-link-verification.lib.mjs:174-206`), but the result is split before use (RC1 fix below).
- **RC2 — the repair overrode the agent.** `repairRequiredIssueLinks` (`src/pr-issue-link-repair.lib.mjs:19-67`) runs
  in a `finally` block after every session (`src/solve.restart-shared.lib.mjs:554-555`,
  `src/solve.results.lib.mjs:125-132`) and appended a line for each missing required issue, ignoring the prose.
- **RC3 — auto-merge did not check what GitHub would close.** The merge guard compared the description with the
  required list, never with `closingIssuesReferences`.
- **RC4 — the parser disagrees with GitHub on negation.** `extractClosingIssueReferences`
  (`src/github-linking.lib.mjs:38-53`) skips a keyword whose clause contains "not", "never", "won't" and similar
  (`src/github-linking.lib.mjs:43-49`). GitHub does not, so Hive Mind can think an issue stays open while the merge
  closes it. GitHub's docs list only the keyword forms, with no negation rule
  ([Linking a pull request to an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)).
- **RC5 — follow-sub-issues across repositories (#3276).** Sub-issues in other repositories were required and repaired
  although the PR cannot fix them.

## Solutions on this branch

| Req. | Change                                                                                                                                                                                                                                                                                                                                                                                                                                      | Where                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `splitPullRequestScope` defers a sub-issue that is closed (`closed`), was created after the PR (`created_after_pr`), or is claimed by another **open** PR (`other_pr`, via GraphQL `closedByPullRequestsReferences` and cross-referenced PR bodies, in batches of 50). Issues listed in a repository-mode block stay required. A malformed claims answer throws, so the check fails closed. The PR's own number is removed from the claims. | `src/issue-link-verification.lib.mjs:91-120` (claims), `:130-146` (split), `:135` (listed issues)                                           |
| 2    | `splitDescriptionScope` defers issues the description mentions without a keyword (`description`), issues "Part of", "towards", "progress on" or "#N stays/remains open" (`partial`, which also applies to the primary issue), and the sub-trees of deferred issues (`parent`). Ranges such as "#236 to #246" count, capped at 500 numbers. Every deferral is logged with its reason.                                                        | `src/issue-link-verification.lib.mjs:66-88`, `:149-166`; `src/github-linking.lib.mjs:126-172`; log at `src/pr-issue-link-repair.lib.mjs:52` |
| 3    | Lines an earlier repair appended (below the `---` block) for deferred or other-repository issues are removed again, and the removal is logged.                                                                                                                                                                                                                                                                                              | `src/issue-link-verification.lib.mjs:38-54` (`splitRepairBlock`), `src/pr-issue-link-repair.lib.mjs:38-48`, `:60`                           |
| 4    | The merge guard reads GitHub's `closingIssuesReferences` (default-branch base only) and refuses the merge when GitHub would close an issue in another repository, or an issue the description keeps open or that is deferred, including through a negated keyword. Other-repository sub-issues block the merge before that.                                                                                                                 | `src/issue-link-verification.lib.mjs:266-308`, called from `src/issue-completion.lib.mjs:32,45`                                             |
| 5    | Regression tests (see below), including the calculator#227 plan PR case.                                                                                                                                                                                                                                                                                                                                                                    | `tests/issue-3174-link-repair-scope.test.mjs`                                                                                               |
| RC5  | Other-repository sub-issues are collected separately and never required or repaired (from #3295).                                                                                                                                                                                                                                                                                                                                           | `src/issue-link-verification.lib.mjs:191-194`, `src/pr-issue-link-repair.lib.mjs:51`                                                        |

## Tests

All three files pass on this branch (2026-10-15):

| Command                                                       | Result     |
| ------------------------------------------------------------- | ---------- |
| `node --test tests/issue-3174-link-repair-scope.test.mjs`     | 12/12 pass |
| `node --test tests/issue-link-verification-2335.test.mjs`     | 17/17 pass |
| `node --test tests/pr-description-preservation-2549.test.mjs` | 9/9 pass   |

`tests/issue-3174-link-repair-scope.test.mjs` covers: range and negated mentions (`extractOpenIssueMentions`),
`splitRepairBlock`, the calculator#227 plan PR (repair adds nothing and removes the earlier lines), an unmentioned
sub-issue that is still repaired (#2335 behaviour kept), an umbrella's child subtree, other-repository sub-issues
(#3276), a negated keyword blocking the merge (calculator#261 probe), "Part of" wording and the #3282 umbrella,
sub-issues created after the PR or already closed (calculator numbering 227/228/229/236/237/240), sub-issues claimed
by another open PR (including stacked PRs, #2407), and repository-mode listed issues that stay required plus a
malformed claims answer that fails closed.

## What remains, and why

Status: **PARTIAL.** The behaviour that closed calculator#236 to calculator#246 and the #3282 tree is covered by
code and tests, but these parts of the issue are not done:

1. **Not released.** `35bdc2d2` is in v2.36.1 and later. `355d0f14` (closed / later-created / other-PR / "Part of")
   is only on this branch; npm `latest` (2.37.0) does not contain it. Until it is released and deployed, production
   keeps appending lines for sub-issues created after the PR.
2. **"Never undo the agent" is only partly done.** The repair now removes its own earlier lines for deferred issues,
   but if the agent deletes the line of a still-required sub-issue without saying why in the prose, the next repair
   adds it back (this is the #2335 behaviour the tests keep on purpose). There is no conflict report in the session
   summary.
3. **Parser parity is not done for every consumer.** `extractClosingIssueReferences` still skips negated keywords
   (`src/github-linking.lib.mjs:43-49`). Through `prClosesIssue` (`src/github-linking.lib.mjs:67-75`) it is also used
   by `src/github.batch.lib.mjs` (the open-PR checks behind `/hive --skip-issues-with-prs`),
   `src/github-issue-auto-close.lib.mjs:77` and `src/solve.ensure-sub-issues.detect.lib.mjs:113`, which can therefore
   still disagree with GitHub about a negated keyword. Only the merge guard uses `closingIssuesReferences`, and only when the base is the default
   branch (GitHub ignores keywords on other bases).
4. **No "no commits for this issue" check before merge.** The guard refuses deferred and kept-open issues, but not
   an open sub-tree issue that is required and has no work in the PR. The #2406 work merged into this branch (issue
   completion evidence before merge) is the place for that; it was not checked here.
5. **No opt-in marker or flag** for "this parent asks for implementation of all sub-issues". An explicit closing line
   in the description acts as the override instead. `created_after_pr` uses timestamps, not the plan wording.
6. The regression test uses the calculator issue numbers and a plan description, not the literal sentence from
   calculator#227.

Related follow-ups: #3354 (close every intended linked issue after a merge), #3357 / PR #3365 (unify the three
post-merge closing implementations), #3358 (cross-repository closing), #3359 (close a parent when all sub-issues are
done).

## Existing components

- GitHub GraphQL `PullRequest.closingIssuesReferences` and `Issue.closedByPullRequestsReferences`
  ([GraphQL objects reference](https://docs.github.com/en/graphql/reference/objects#pullrequest)) — the only
  authoritative answer to "what will this merge close"; used by the merge guard and the claims lookup.
- GitHub's closing keywords work only for PRs into the default branch
  ([GitHub docs](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)).
- GitHub sub-issues REST API (`/issues/{n}/sub_issues`)
  ([REST docs](https://docs.github.com/en/rest/issues/sub-issues)).
- GitLab documents the same negation behaviour:
  [gitlab-foss#55970](https://gitlab.com/gitlab-org/gitlab-foss/-/work_items/55970).
- Workaround used in calculator: a required CI check
  ([`scripts/check-closing-references.mjs`](https://github.com/link-assistant/calculator/blob/1b91a43a/scripts/check-closing-references.mjs))
  that fails when the description's closing keywords contradict its prose.

## Reproduction

```bash
node experiments/issue-3174-repro.mjs
for t in tests/issue-3174-link-repair-scope.test.mjs tests/issue-link-verification-2335.test.mjs tests/pr-description-preservation-2549.test.mjs; do
  node --test "$t"
done
```
