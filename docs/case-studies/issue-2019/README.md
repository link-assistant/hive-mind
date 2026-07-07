# Issue 2019 Case Study: non-fork replacement safety stop

## Summary

Issue #2019 asked whether this failure was a false positive or a false negative:

```text
Repository setup halted - existing fork replacement could lose commits.
```

The answer is: it was a true positive for deletion safety, but the explanation
was incomplete.

Hive Mind correctly detected that `konard/Payel-git-ol-Octra` was not a GitHub
fork of `Payel-git-ol/Octra`. The GitHub compare API then returned 404 because
the repositories are not in the same fork network. A local Git history analysis
showed that deleting the replacement repository could remove three branch-only
commits:

- `issue-25-a4e152a216ff` at `aff43e46d445` - `Revert "Initial commit with task details"`
- `issue-87-84fa7bc45fb8` at `2a118eafec73` - `Revert "Initial commit with task details"`
- `issue-9-86efa1403a45` at `7f860d683f30` - `Revert "Initial commit with task details"`

The default branch alone was safe: `replacement/master` had 0 commits ahead of
upstream and upstream had 28 commits that the replacement repository lacked.
The actual risk was in side branches. The old code only checked the default
branch through GitHub compare, so if compare had succeeded it could have deleted
the repository while missing branch-only commits.

## Preserved Data

Raw evidence is stored in [`raw-data/`](raw-data):

| File                                                                          | Purpose                                                                |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `hive-mind-issue-2019.json`                                                   | Source Hive Mind issue metadata and body                               |
| `hive-mind-issue-2019-comments.json`                                          | Source issue comments; none existed at capture time                    |
| `octra-issue-124.json`                                                        | Linked Octra issue metadata and failure comment                        |
| `octra-issue-124-comments.json`                                               | Linked Octra issue comments, including the solver failure log          |
| `Payel-git-ol-Octra-repo.json`                                                | Upstream repository API snapshot                                       |
| `konard-Payel-git-ol-Octra-repo.json`                                         | Existing replacement repository API snapshot                           |
| `Payel-git-ol-Octra-branches.json`                                            | Upstream branch API snapshot                                           |
| `konard-Payel-git-ol-Octra-branches.json`                                     | Replacement branch API snapshot                                        |
| `github-compare-upstream-head-to-konard-head.txt`                             | Reproduced GitHub compare 404                                          |
| `Payel-git-ol-Octra-ls-remote.txt`                                            | Upstream Git refs                                                      |
| `konard-Payel-git-ol-Octra-ls-remote.txt`                                     | Replacement Git refs                                                   |
| `local-git-default-branch-ahead-behind.txt`                                   | Default branch commit count comparison                                 |
| `local-git-default-branch-merge-base.txt`                                     | Default branch merge base                                              |
| `local-git-default-branch-cherry-pick-diff.txt`                               | Default branch left/right diff                                         |
| `local-git-replacement-branch-reachability.txt`                               | All replacement branch reachability analysis                           |
| `local-git-unique-replacement-branch-commits.txt`                             | Details for the three unique branch commits                            |
| `live-helper-branch-safety-result.json`                                       | Output from the new branch-safety helper against the live repositories |
| `octra-pr-10.json`, `octra-pr-26.json`, `octra-pr-88.json`                    | PR metadata for the unique branch names                                |
| `octra-issue-9.json`, `octra-issue-25.json`, `octra-issue-87-fetch-error.txt` | Related issue lookup data                                              |
| `related-merged-prs.json`                                                     | Merged Hive Mind PRs related to fork replacement and fork safety       |
| `external-research.md`                                                        | Online references checked during analysis                              |
| `test-*.log`, `npm-*.log`, `prettier-write.log`                               | Local reproduction, install, format, lint, and default-suite logs      |

## Timeline

| Time (UTC)          | Event                                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| 2026-04-03 12:16:51 | `Payel-git-ol/Octra` was created.                                              |
| 2026-05-13 14:02:20 | `konard/Payel-git-ol-Octra` was created as a non-fork repository.              |
| 2026-07-07 11:57:47 | Octra issue #124 was opened.                                                   |
| 2026-07-07 12:05:20 | Hive Mind solve run started for Octra issue #124.                              |
| 2026-07-07 12:05:35 | Hive Mind entered fork mode and found `konard/Payel-git-ol-Octra`.             |
| 2026-07-07 12:05:37 | Fork parent validation returned `fork: false`, `parent: null`, `source: null`. |
| 2026-07-07 12:05:37 | GitHub compare returned 404 Not Found.                                         |
| 2026-07-07 12:05:37 | Hive Mind stopped before deleting the repository or creating a PR.             |
| 2026-07-07 12:10:54 | Hive Mind issue #2019 was opened to investigate whether the stop was correct.  |

## Requirements

| ID  | Requirement                                                                                                                      | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------ |
| R1  | Download and preserve all related issue, comment, log, and repository data under `docs/case-studies/issue-2019`.                 | Done   |
| R2  | Reconstruct the event sequence.                                                                                                  | Done   |
| R3  | Decide whether the failure was a false positive or false negative.                                                               | Done   |
| R4  | Identify root causes for the confusing message and any unsafe behavior.                                                          | Done   |
| R5  | Search online for relevant external facts and existing tools/components.                                                         | Done   |
| R6  | Add diagnostics or code changes so the next run can identify the root cause instead of stopping with vague compare-404 evidence. | Done   |
| R7  | Add a reproducing automated test before the fix.                                                                                 | Done   |
| R8  | Keep the fix in PR #2020 on branch `issue-2019-51a3704b96d4`.                                                                    | Done   |

## Findings

GitHub repository metadata made the fork relationship unambiguous:

```json
{ "fork": false, "parent": null, "source": null }
```

GitHub's compare endpoint could not answer the replacement safety question
because it only compares across repositories in the same network. The observed
404 was therefore expected for a non-fork repository.

Local Git comparison answered the history question:

```text
upstream/master...replacement/master: 28 0
```

That means `replacement/master` was an ancestor of upstream history, so the
default branch alone did not justify blocking deletion.

The full repository deletion question is broader than default branch history.
The replacement repository had 69 branch heads. The local reachability check
found:

```text
66 reachable branch tips
3 unique branch tips
```

Those three branch tips each had one commit not reachable from upstream branches
or upstream PR head refs. Deleting the repository could remove those branch-only
commits. The stop was therefore not a false positive.

## Root Cause

There were two root causes.

First, the user-facing message preserved only the GitHub compare failure. It did
not explain whether Git history contained actual replacement-only commits.

Second, the safety implementation checked only:

```text
upstream HEAD ... replacement owner HEAD
```

That is not enough for deleting a repository, because repository deletion removes
all branches. In this incident the default branch had no unique commits, while
three side branches did. That made the old check both too vague when compare
failed and too narrow if compare succeeded.

## Solution

The fix keeps the GitHub compare check as a quick default-branch signal, but no
longer treats `ahead_by = 0` as enough to delete a replacement repository.

`src/solve.repository-safety.lib.mjs` now performs a local Git fallback in a
temporary repository:

1. Fetch upstream branches and upstream PR head refs with `--filter=blob:none`.
2. Fetch all replacement repository branch heads with `--filter=blob:none`.
3. For each replacement branch, count commits not reachable from upstream branch
   or PR refs using `git rev-list --count <branch> --not --remotes=upstream --remotes=upstream-pr`.
4. Allow deletion only when every replacement branch tip has zero unreachable
   commits.

`src/solve.repository.lib.mjs` now runs this all-branch safety check when GitHub
compare fails, returns an unclear result, or reports the default branch is clean.
If unique replacement branch commits exist, the failure reason now includes the
exact count and up to three concrete branch examples.

## Existing Components

GitHub compare remains useful for same-network default-branch comparisons, but it
cannot be the only deletion safety check for non-fork repositories.

Native Git is the right component here. It already models reachability across
arbitrary refs and can answer the exact data-loss question without downloading
full blobs. JavaScript wrappers such as `simple-git` or `isomorphic-git` were not
needed because Hive Mind already executes Git through `command-stream`.

No new upstream GitHub issue was filed. The compare 404 and fork metadata match
GitHub's documented behavior, and the related `gh repo fork --fork-name` concern
already has a public GitHub CLI issue.

## Verification

The reproducing test is
`tests/test-issue-2019-fork-replacement-branch-safety.mjs`. It covers:

- default branch safe, side branch unsafe;
- all branches safe;
- repository setup calling the all-branch safety helper before deletion.

Focused regression tests also passed:

- `node tests/test-issue-2019-fork-replacement-branch-safety.mjs`
- `node tests/test-fork-parent-validation.mjs`
- `node tests/test-issue-1976-auto-recovery-message.mjs`
- `node tests/test-issue-2009-fork-divergence-guidance.mjs`

Repository checks also passed:

- `npm run format:check`
- `npm run lint`
- `npm test` (`All 306 selected test file(s) passed.`)

The live helper run against `Payel-git-ol/Octra` and
`konard/Payel-git-ol-Octra` is preserved in
`raw-data/live-helper-branch-safety-result.json`.

## Source Links

- Hive Mind issue #2019: https://github.com/link-assistant/hive-mind/issues/2019
- Hive Mind PR #2020: https://github.com/link-assistant/hive-mind/pull/2020
- Linked Octra issue #124: https://github.com/Payel-git-ol/Octra/issues/124
- GitHub repository API: https://docs.github.com/en/rest/repos/repos#get-a-repository
- GitHub compare API: https://docs.github.com/en/rest/commits/commits#compare-two-commits
- GitHub compare docs: https://docs.github.com/en/pull-requests/committing-changes-to-your-project/viewing-and-comparing-commits/comparing-commits
- GitHub fork-name changelog: https://github.blog/changelog/2022-04-12-you-can-now-name-your-fork-when-creating-it/
- GitHub CLI issue #6329: https://github.com/cli/cli/issues/6329
