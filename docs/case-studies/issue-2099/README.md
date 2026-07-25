# Case study — issue #2099: Archcore Copilot adapter run

- Hive Mind issue: [link-assistant/hive-mind#2099](https://github.com/link-assistant/hive-mind/issues/2099)
- Source issue: [archcore-ai/plugin#24](https://github.com/archcore-ai/plugin/issues/24)
- Abandoned draft: [archcore-ai/plugin#26](https://github.com/archcore-ai/plugin/pull/26)
- Completed replacement: [archcore-ai/plugin#27](https://github.com/archcore-ai/plugin/pull/27)

## 1. Outcome

The working session implemented the requested GitHub Copilot CLI adapter and
validated it locally, but it did not operate perfectly:

1. Hive Mind created its placeholder branch and PR from the repository default,
   `main`, while the issue and repository guidance required development against
   `dev`.
2. The agent correctly discovered that `main` and `dev` had unrelated histories
   and merged `dev` into the local feature branch.
3. In the same shell command, it changed PR 26's base to `dev` **before pushing
   the merge**. GitHub therefore evaluated the still-remote `main`-rooted head
   against unrelated `dev` and closed the PR.
4. The implementation continued successfully, but PR 26 could not be reopened.
   The agent created PR 27 as a replacement.
5. PR 27's workflow was held at GitHub's expected fork-approval gate. No jobs
   existed, so there were no CI logs to download.

This PR fixes the Hive Mind defect that made step 3 possible: all generated
agent prompts now require the new base ancestry to be pushed and verified at
the remote head SHA before an existing PR is retargeted. The regression covers
all six prompt backends and the instruction is present in all four localized
prompt catalogs.

## 2. Evidence archive

Raw records are under [`data/`](./data):

| Evidence                                                                                       | Purpose                                                                              |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [`data/logs/solution-draft.log.gz`](./data/logs/solution-draft.log.gz)                         | Complete 21,963-line authenticated Gist log attached to PR 27, losslessly compressed |
| [`data/hive-mind/issue-2099.json`](./data/hive-mind/issue-2099.json)                           | Hive Mind issue and requirements                                                     |
| [`data/archcore-plugin/issue-24.json`](./data/archcore-plugin/issue-24.json)                   | Source issue                                                                         |
| [`data/archcore-plugin/issue-24-timeline.json`](./data/archcore-plugin/issue-24-timeline.json) | Labels and links to PRs 26 and 27                                                    |
| [`data/archcore-plugin/pr-26/`](./data/archcore-plugin/pr-26/)                                 | Draft metadata and all three GitHub comment/review channels                          |
| [`data/archcore-plugin/pr-27/`](./data/archcore-plugin/pr-27/)                                 | Replacement metadata, timeline, comments, reviews, and zero-job CI run               |
| [`data/upstream/archcore-cli-27/`](./data/upstream/archcore-cli-27/)                           | Upstream session-start envelope defect found by live testing                         |
| [`data/upstream/copilot-cli-4234/`](./data/upstream/copilot-cli-4234/)                         | Upstream plugin MCP working-directory defect found by live testing                   |

The Gist was downloaded with `gh gist view`, not unauthenticated HTTP. The log is
plain text and its credentials are redacted by the original run.

## 3. Timeline

| Time (UTC, 2026-07-23) | Event                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| 14:15:30               | Feature branch receives placeholder commit `1f29821`, rooted on synthesized `main`                       |
| 14:15:39               | Hive Mind creates draft PR 26 with `base=main`                                                           |
| 14:17:15               | Agent discovers `dev` is the required source-of-truth branch                                             |
| 14:18:22               | Agent starts one command: merge unrelated `dev` locally, then immediately run `gh pr edit 26 --base dev` |
| 14:18:24               | GitHub closes PR 26 while its remote head still points to `1f29821`                                      |
| 14:18:26               | Command reports local merge commit `d0bdb37`; it has not been pushed                                     |
| 14:22–15:08            | Agent builds, tests, live-smokes, and commits the adapter                                                |
| 15:08                  | Final implementation head `8bce7fd` is pushed                                                            |
| 15:14–15:15            | Reopen attempts fail because PR 26 retained the frozen pre-merge head                                    |
| 15:16:07               | Replacement PR 27 is opened against `dev`                                                                |
| 15:16:11               | GitHub creates workflow run `30019746799` with `action_required` and zero jobs                           |
| 15:17:19               | Agent posts the correct maintainer-approval request                                                      |
| 15:18:40               | Complete run log is attached to PR 27                                                                    |

## 4. Requirements and disposition

| #   | Requirement                                                                         | Disposition                                                                                         |
| --- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| R1  | Inspect source issue 24 and every linked fork PR/issue                              | Issues 24, CLI 27, Copilot CLI 4234, PRs 26/27, timelines, and all comment/review channels archived |
| R2  | Collect all related logs and data                                                   | Complete 6.5 MB log plus raw GitHub records stored here                                             |
| R3  | Reconstruct the timeline                                                            | Section 3                                                                                           |
| R4  | Classify false positives, false negatives, errors, and warnings                     | Section 5                                                                                           |
| R5  | Find root causes and fix every Hive Mind defect                                     | Unsafe PR retarget ordering fixed across all prompt backends/locales                                |
| R6  | Report defects in other repositories with reproductions/workarounds/fix suggestions | Existing reports archcore-ai/cli#27 and github/copilot-cli#4234 satisfy this                        |
| R7  | Research known components and online facts                                          | Section 7                                                                                           |
| R8  | Add diagnostics if evidence is insufficient                                         | Not needed for the main defect; exact command, SHAs, timeline, and GitHub state are present         |
| R9  | Provide a reproducing automated test                                                | `tests/test-pr-base-retarget-order-2099.mjs`                                                        |

## 5. Signal classification

### True defect — PR retarget ordering

The log contains the exact unsafe sequence:

```text
git merge --no-ff --allow-unrelated-histories upstream/dev ...
gh pr edit 26 --repo archcore-ai/plugin --base dev
```

The merge only changed the local branch. Because no `git push` preceded
`gh pr edit`, GitHub still saw remote head `1f29821`, whose ancestry was `main`.
This is the root cause of the abandoned PR.

### True external defects — correctly reported

- `archcore-ai/cli#27`: CLI 0.5.7 returned a Claude-specific
  `hookSpecificOutput` envelope for the Copilot host instead of Copilot's
  top-level `additionalContext`. The report contains reproduction, workaround,
  and a concrete implementation suggestion.
- `github/copilot-cli#4234`: plugin MCP children started in the installed plugin
  directory without project-root information. The report contains a minimal
  reproducer, workaround, and suggested contract changes.

These are not Hive Mind defects and did not justify local Hive Mind code changes.

### Expected warning — fork workflow approval

Run `30019746799` had conclusion `action_required`, the exact final head SHA, and
an empty `jobs` array. GitHub documents that public-fork workflows can require a
maintainer with write access to approve them. The 403 from the approval endpoint
was therefore an authorization boundary, not a failed test and not stale CI.
The agent correctly posted a maintainer-action comment.

### Benign/recovered environment signals

- `failed to set up git credential helper ... .gitconfig: Device or resource
busy`: clone completed and authenticated GitHub operations continued. This was
  noisy but did not affect repository state.
- `jq: command not found`: the agent's first research formatter assumed `jq`;
  it immediately recovered with GitHub CLI's built-in `--jq`.
- `gh pr checks` exited 1 with “no checks reported”: accurate for a run stopped
  before job creation, but misleading when chained with otherwise successful
  repository checks.
- Codex file-watcher “failed to unwatch” warning occurred after completion and
  had no task impact.

No false-negative test result was found: the local `make all` result (385 Bats
tests) and five Codex smoke tests were genuine. No CI test suite actually ran.

## 6. Fix and regression

The generated workflow guidance now establishes this invariant:

```text
new base merged locally
    -> feature head pushed
    -> remote head SHA verified
    -> existing PR base changed
```

The regression test builds every supported agent's system prompt (`agent`,
Claude, Codex, Gemini, OpenCode, and Qwen) and requires all three safety clauses:
push ancestry first, verify the remote head SHA, and only then retarget.

This narrowly fixes the observed cause without guessing a target branch from
free-form issue prose. Automatic branch inference would create a new class of
false positives; the issue's phrase “landed on dev” describes repository state
but is not a machine-readable request equivalent to `--base-branch dev`.

## 7. Prior art and online research

- [GitHub's base-change documentation](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/changing-the-base-branch-of-a-pull-request)
  warns that changing the base rewrites the comparison and can remove commits
  and invalidate review context.
- [GitHub's branch comparison documentation](https://docs.github.com/en/pull-requests/how-tos/commit-changes/comparing-commits)
  defines the base as the comparison start and head as its endpoint.
- [GitHub's PR comparison model](https://docs.github.com/en/enterprise-server%403.17/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-comparing-branches-in-pull-requests)
  uses the merge base; merging the intended base into the topic branch updates
  that common ancestor.
- [`gh pr edit`](https://cli.github.com/manual/gh_pr_edit) exposes `--base` but
  performs no local push for the user. Therefore automation must establish and
  verify remote ancestry itself before invoking it.
- [GitHub's fork-run approval documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/approve-runs-from-forks)
  confirms that a maintainer with write access may be required; the
  [REST endpoint](https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2026-03-10)
  requires Actions write permission.

## 8. Remaining external state

PR 27 remains open and its merge state is dirty against the current `dev`.
That repository is outside this issue's writable branch scope. Its maintainer
must approve/re-run CI and reconcile the latest `dev` changes. Hive Mind's
local defect is independently reproduced and fixed here.
