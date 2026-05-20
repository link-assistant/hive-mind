# Case Study: Issue #1817 - Push rejection reported as unclear divergence

- Issue: https://github.com/link-assistant/hive-mind/issues/1817
- Pull request: https://github.com/link-assistant/hive-mind/pull/1818
- Branch: `issue-1817-686e45442e7f`
- Related incident: https://github.com/ideav/crm/issues/2746#issuecomment-4500248720
- Date investigated: 2026-05-20

## Summary

The reported run stopped before creating a pull request for `ideav/crm#2746`.
`git push -u origin issue-2746-7b9af1dbec7d` returned a remote rejection:
GitHub could not lock `refs/heads/issue-2746-7b9af1dbec7d` because the reference
already existed. The solver then fetched `origin/issue-2746-7b9af1dbec7d` and
measured the local branch as `0` commits ahead and `0` commits behind the remote
branch.

That was not a normal diverged-history state. The branch already matched local
`HEAD`, so the safe behavior was to continue with PR creation. Instead, the old
diagnostic collapsed every rejected push into "Branch has diverged from remote",
then printed a second "PR creation failed" block and a third main-catch
"Error executing command" block.

The fix is to classify push rejections, include exact repository/branch/compare
links, recover when the remote branch equals local `HEAD`, and suppress generic
error wrappers once a detailed user-facing push error has already been logged.

## Timeline

All times UTC on 2026-05-20.

| Time     | Event                                                                                                          | Evidence                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 16:00:00 | `ideav/crm#2746` is opened.                                                                                    | `raw/linked-issue-ideav-crm-2746.json`                        |
| 16:00:30 | Solver run starts for `https://github.com/ideav/crm/issues/2746` with `--attach-logs --verbose`.               | `raw/linked-comment-4500248720.md`, line 23                   |
| 16:00:46 | Existing PRs for the issue are skipped because their branches do not match `issue-2746-*`.                     | `raw/linked-comment-4500248720.md`, lines 1049-1055           |
| 16:00:49 | The solver creates local branch `issue-2746-7b9af1dbec7d` from `main`.                                         | `raw/linked-comment-4500248720.md`, lines 1070-1077           |
| 16:00:49 | The solver creates bootstrap commit `198c7516` on the issue branch.                                            | `raw/linked-comment-4500248720.md`, lines 1093-1102           |
| 16:00:51 | `git push` reports `remote rejected` because `refs/heads/issue-2746-7b9af1dbec7d` already exists.              | `raw/linked-comment-4500248720.md`, lines 1111-1119           |
| 16:00:51 | The solver fetches the remote branch and prints `0` ahead and `0` behind.                                      | `raw/linked-comment-4500248720.md`, lines 1120-1131           |
| 16:00:51 | The solver incorrectly reports "Branch has diverged from remote".                                              | `raw/linked-comment-4500248720.md`, lines 1125-1131           |
| 16:00:51 | The solver prints duplicate generic failures: `FATAL ERROR: PR creation failed` and `Error executing command`. | `raw/linked-comment-4500248720.md`, lines 1153-1178           |
| 16:35:26 | The branch is later visible on PR #2747.                                                                       | `raw/linked-branch-prs.json`                                  |
| 16:42    | Captured compare data shows `main...issue-2746-7b9af1dbec7d` is ahead by 4 and includes `198c7516`.            | `raw/linked-branch-compare-main-issue-2746-7b9af1dbec7d.json` |

## Requirements

1. Save issue, comment, branch, PR, CI, and related incident data under
   `docs/case-studies/issue-1817`.
2. Reconstruct the event sequence and identify what was divergent, if anything.
3. Replace the generic "branch has diverged" message with a classification that
   distinguishes remote-ref collisions, non-fast-forward pushes, and other
   remote rejections.
4. Include links to the relevant repository, branch, base branch, head branch,
   and GitHub compare page in both terminal output and attached failure comments.
5. Emit only one user-facing error block for the same push failure.
6. Continue safely when a rejected push leaves `origin/<branch>` equal to local
   `HEAD`.
7. Add a regression test for the reported incident.
8. Check whether the issue belongs upstream and document the result.

## Root Cause

The immediate Git error was a remote ref collision, not the divergence message
shown to the user. Git distinguishes `rejected`, where the client refuses to send
an update, from `remote rejected`, where the remote end refuses it. The incident
was the latter, with GitHub reporting that the remote branch ref already existed.

The solver already had `getRemoteBranchDivergenceSnapshot()`, which fetched the
remote branch and counted both sides with `git rev-list --count`. The old push
handler ignored the semantic meaning of `ahead=0` and `behind=0`, so it treated
an already-synchronized branch as a conflict that required manual resolution.

The duplicate output had two causes:

1. `handleAutoPrCreation()` logged a push-specific block, then threw a plain
   `Error`. The outer auto-PR catch saw it as an ordinary PR creation failure and
   logged a second block.
2. The main execution catch then logged `Error executing command:` for the same
   already-explained error.

The attached failure comment could also fall back to a generic action section
instead of preserving the branch-specific remediation.

## Solution

- Added `classifyPushRejection()` to distinguish:
  - `remote-ref-already-exists`
  - `non-fast-forward`
  - other `remote-rejected` / `rejected` output
- Added `shouldTreatPushRejectionAsRemoteSynchronized()` so `remoteExists=true`,
  `ahead=0`, and `behind=0` is handled as a recoverable push race.
- Added `buildBranchSubjectLinks()` and branch-specific failure action text with:
  - repository URL
  - base branch ref
  - remote/head branch ref
  - remote branch URL
  - compare URL
- Updated auto-PR push handling so:
  - synchronized rejected pushes continue into PR creation
  - genuinely different branch histories print one detailed diagnostic
  - failure errors carry `hiveMindUserFacingLogged` and a custom
    `failureActionSection`
- Updated outer error handling so a detailed push rejection is not wrapped again
  as a generic PR creation failure or main execution failure.
- Updated pre-PR failure comments to keep push-rejection remediation
  branch-specific when no full log is attached.
- Added `tests/test-issue-1817-push-rejection-diagnostics.mjs`.

## Existing Components and References

- Existing hive-mind component reused: `getRemoteBranchDivergenceSnapshot()`
  already performs the needed `git fetch` and ahead/behind counts.
- Git's own push rules explain why normal branch pushes are accepted only when
  the destination can fast-forward, and why non-fast-forward updates are blocked
  to avoid losing history: https://git-scm.com/docs/git-push
- GitHub's compare API accepts `BASE...HEAD` and fork-aware forms, which is the
  right user-facing link for inspecting base/head differences:
  https://docs.github.com/en/rest/commits/commits#compare-two-commits
- GitHub's Git refs API exposes branch refs as `heads/<branch name>`, matching
  the `refs/heads/issue-2746-7b9af1dbec7d` object in the incident:
  https://docs.github.com/en/rest/git/refs#get-a-reference

No upstream Git or GitHub issue is warranted from this data. The bug was in
hive-mind's classification, recovery decision, and duplicate error wrapping.

## Saved Data

- `raw/issue-1817.json` - issue body and metadata.
- `raw/issue-1817-comments.json` - issue comments at investigation time.
- `raw/pr-1818.json` - prepared pull request metadata.
- `raw/pr-1818-review-comments.json` - PR inline review comments at investigation time.
- `raw/pr-1818-reviews.json` - PR review records at investigation time.
- `raw/pr-1818-ci-runs.json` - recent CI runs for the prepared PR branch.
- `raw/linked-issue-ideav-crm-2746.json` - related external issue metadata.
- `raw/linked-comment-4500248720.json` - related failure comment metadata.
- `raw/linked-comment-4500248720.md` - full failure comment body with the solver log.
- `raw/linked-branch-ref-issue-2746-7b9af1dbec7d.json` - current GitHub ref data for the incident branch.
- `raw/linked-branch-compare-main-issue-2746-7b9af1dbec7d.json` - current compare data for `main...issue-2746-7b9af1dbec7d`.
- `raw/linked-branch-prs.json` - pull requests that currently use the incident branch.
