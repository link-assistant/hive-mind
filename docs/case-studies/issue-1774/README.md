# Issue 1774 Case Study: Auto-PR Creation Failure on Forked Repositories

## Summary

When `solve` runs against an issue in a repository that is itself a fork (e.g.
`glsfull/saas` is a fork of `nuxt-ui-templates/saas`) and the user has direct
write access (so `--auto-fork` does not enable fork mode), auto-PR creation
fails with:

```
PR creation failed - no commits between branches:
GraphQL: Head sha can't be blank, Base sha can't be blank,
No commits between main and issue-1-34958134dada,
Head ref must be a branch (createPullRequest)
```

The branch and the commit are pushed correctly to the fork. The failure is in
`gh pr create`, which without `--repo` resolves the base repository through git
remotes. Because `gh repo clone <fork>` automatically adds an `upstream` remote
pointing at the parent repository, `gh pr create` resolves the base to the
parent (`nuxt-ui-templates/saas`) instead of the fork (`glsfull/saas`). The
parent repository does not contain the head branch, so GitHub responds with the
`No commits between` GraphQL error.

The fix is to always pass `--repo ${owner}/${repo}` to `gh pr create` and to
the assignee-fallback retry path, so the PR is always created in the
repository the user explicitly targeted, regardless of how the local clone is
configured.

## Reproduction

The failure can be reproduced in seconds with a fresh clone:

```sh
mkdir /tmp/repro-1774 && cd /tmp/repro-1774
gh repo clone glsfull/saas .
git checkout issue-1-34958134dada
gh pr create --draft --title "Test" --body "Test" \
  --base main --head issue-1-34958134dada
# pull request create failed: GraphQL: Head sha can't be blank, ...
```

Adding `--repo glsfull/saas` makes the same call succeed:

```sh
gh pr create --draft --title "Test" --body "Test" \
  --base main --head issue-1-34958134dada --repo glsfull/saas
# https://github.com/glsfull/saas/pull/2
```

## Evidence Collected

All evidence is preserved under `docs/case-studies/issue-1774/evidence/`.

- `full-log.log.gz` - the full screen-session log that the issue links from
  GitHub Gist, captured during the failing `solve` run (gzipped because
  `.gitignore` excludes `*.log`).
- `issue-comment.json` - the `glsfull/saas#1` issue comment posted by the
  failure handler, including the `Click to expand failure log (17KB)` block.
- `issue-1774.json` - issue metadata for `link-assistant/hive-mind#1774`.
- `glsfull-saas-repo.json` - GitHub API repository metadata showing
  `fork: true` and `parent.full_name = "nuxt-ui-templates/saas"`.
- `glsfull-saas-branches.json` - branches present on the fork at investigation
  time, confirming `issue-1-34958134dada` exists on the fork (and not on
  upstream).

## Timeline

All times are UTC.

- `2026-05-10T15:29:12.622Z` - User runs `solve https://github.com/glsfull/saas/issues/1 --tool codex --attach-logs --verbose --no-tool-check --disable-report-issue --language en` in a screen session (`beea6385-2c5d-42ee-9b0f-942195a2b207`).
- `2026-05-10T15:29:20.088Z` - `solve.mjs` v1.69.3 begins logging.
- `2026-05-10T15:29:26.561Z` - URL validation classifies the input as an issue URL.
- `2026-05-10T15:29:27.219Z` - `--auto-fork` checks for pending invitations (none).
- `2026-05-10T15:29:27.904Z` - `--auto-fork` sees `permissions.push = true` on the public repo and decides to work directly: `Auto-fork: Write access detected to public repository, working directly on repository`. (This is the key branching point - fork mode is _not_ enabled, even though the repo is itself a fork.)
- `2026-05-10T15:29:28.263Z` - Repository write access confirmed.
- `2026-05-10T15:29:30.206Z` - No existing PRs for issue #1, fresh PR will be created.
- `2026-05-10T15:29:30.543Z` - `gh repo clone glsfull/saas /tmp/gh-issue-solver-1778426970207` runs.
- `2026-05-10T15:29:31.643Z` - Clone reports `From https://github.com/nuxt-ui-templates/saas` and `[new branch] main -> upstream/main`. `gh repo clone` automatically created an `upstream` remote because the cloned repo is a fork.
- `2026-05-10T15:29:31.658Z` - Local remotes show `origin = glsfull/saas`, `upstream = nuxt-ui-templates/saas`.
- `2026-05-10T15:29:31.740Z` - Branch `issue-1-34958134dada` created from `main`.
- `2026-05-10T15:29:31.796Z` - Initial `.gitkeep` commit `e80eb00` created.
- `2026-05-10T15:29:32.948Z` - `git push -u origin issue-1-34958134dada` succeeds; new branch on `glsfull/saas`.
- `2026-05-10T15:29:35.406Z` - Compare API on `glsfull/saas` returns `1 commit ahead of main`.
- `2026-05-10T15:29:36.057Z` - Remote commit SHA confirmed: `e80eb00...`.
- `2026-05-10T15:29:37.337Z` - `git rev-list --count origin/main..HEAD` returns `1`.
- `2026-05-10T15:29:37.339Z` - PR creation prepared with `--base main --head issue-1-34958134dada --assignee konard` and **no `--repo` flag**.
- `2026-05-10T15:29:38.272Z` - `gh pr create` returns `pull request create failed: GraphQL: Head sha can't be blank, Base sha can't be blank, No commits between main and issue-1-34958134dada, Head ref must be a branch (createPullRequest)`.
- `2026-05-10T15:29:38.273Z` - `solve.auto-pr.lib.mjs:1440` rewraps the message as `PR creation failed - no commits between branches: ...` and emits the consolidated FATAL ERROR block (Issue #1462 wording).
- `2026-05-10T15:29:38.277Z` - `solve.mjs:545` re-throws and the run exits via the auto-PR handler.
- `2026-05-10T15:29:40Z` - Failure handler posts `glsfull/saas#1` comment `id=4415652624` with the failure log attached because `--attach-logs` is enabled.
- `2026-05-10T15:29:40.902Z` - Process exits with code 1.

## Root Cause

`solve.auto-pr.lib.mjs` builds and runs:

```js
command = `cd "${tempDir}" && gh pr create --draft --title "..."` + ` --body-file "${prBodyFile}" --base ${targetBranch} --head ${branchName}`;
```

(see `src/solve.auto-pr.lib.mjs:1121` and the assignee-fallback rebuild at
`src/solve.auto-pr.lib.mjs:1165`).

When `argv.fork && forkedRepo`, the command already includes
`--repo ${owner}/${repo}` (lines 1119, 1163). When fork mode is _not_ active,
the command intentionally omits `--repo`, relying on `gh pr create` to derive
the base repository from git remotes.

This relies on a hidden assumption: the local clone has only an `origin` that
points at the target repo. That assumption breaks when:

1. `solve` clones a repository that is itself a GitHub fork (i.e. the
   target repo's `fork` property is `true`).
2. `gh repo clone` notices the fork relationship and automatically adds an
   `upstream` remote pointing at the parent.
3. `gh pr create` resolves the base repository through the
   `gh-resolved`/`remoteResolution` rules and selects `upstream`
   (`nuxt-ui-templates/saas`) as the base repo.
4. The push happened to `origin` (`glsfull/saas`), so the head branch does
   not exist on `upstream`.
5. GitHub's GraphQL API returns four overlapping errors at once: missing head
   SHA, missing base SHA, "No commits between" comparing across two
   unrelated repositories, and "Head ref must be a branch" because the head
   ref cannot be located in the resolved base repo.

The combined error message is technically accurate but very confusing - the
error says "No commits between `main` and `issue-1-34958134dada`" even though
the user can see in the previous log lines that the compare API on
`glsfull/saas` reported 1 commit ahead. The mismatch is explained entirely by
the silent base-repo switch.

The same omission exists in two places in `solve.auto-pr.lib.mjs` (the
initial command at line 1121 and the assignee-fallback rebuild at line 1165),
so both must be patched.

`gh repo clone`'s upstream-on-fork behavior is documented and intentional. See:

- GitHub CLI docs: <https://cli.github.com/manual/gh_repo_clone> -
  "Cloning a fork (a repository with a parent) will add a git remote called
  `upstream`."
- GitHub CLI docs: <https://cli.github.com/manual/gh_pr_create> -
  `gh pr create` "will choose the base repository from one of the following
  options" and includes the `gh-resolved` git config and the
  `remoteResolution` rules.

## Other Requirements From the Issue

The issue text asked for several follow-ups beyond the root-cause fix.

- **Make output more user-friendly, both in terminal and GitHub comments.**
  The fatal error block already exists (Issue #1462), but for the specific
  "no commits between branches" case it does not name the underlying cause.
  We add a fork-aware diagnostic block that:
  - Names the actual failure ("base repository resolved to upstream parent
    instead of fork").
  - Shows the resolved `origin` and `upstream` remotes.
  - Tells the user which `--repo` flag would make the manual command work.
  - Confirms that the fix is automatic in the new version.
- **Download all logs and data related to the issue and compile to
  `docs/case-studies/issue-{id}`.** Done in `evidence/`.
- **Reconstruct timeline.** Done above.
- **List of each and all requirements.** This section.
- **Find root causes of each problem.** Single root cause covered above.
- **Propose possible solutions and solution plans for each requirement.** See
  the "Fix" section below.
- **Check known existing components/libraries that solve similar problems.**
  GitHub CLI itself supports `--repo` precisely for this scenario; no extra
  library is needed. The fix is a one-line change applied in two places.
- **If issue related to any other repository/project, please report.** This is
  a `solve` bug, not an upstream `gh` bug. `gh pr create`'s base-repo
  resolution is documented behavior. No upstream report is warranted; the
  comment instead documents how to invoke `gh` correctly.
- **If there is not enough data to find actual root cause, add debug output
  and verbose mode.** Existing verbose mode logs the full command. The new
  diagnostic block makes the verbose information visible without `--verbose`.

## Fix

`src/solve.auto-pr.lib.mjs` is updated so the non-fork-mode `gh pr create`
calls always include `--repo ${owner}/${repo}`. This is done in both branches
of the assignee-fallback path (lines 1115-1122 and 1160-1167).

This pins the base repository to the explicit target chosen by `solve`, so
`gh pr create` no longer falls back to the parent repo through the auto-added
`upstream` remote when the target is itself a fork.

To make the failure self-explanatory if it ever happens again (for example
inside a different agent process where remotes were edited by hand), the
fatal-error block in `handleAutoPrCreation` now detects the
"No commits between" GraphQL error, inspects the local remotes, and prints a
fork-aware diagnostic with the resolved remotes, the suggested `--repo` flag,
and a pointer to this case study.

## Regression Test

`tests/test-issue-1774-auto-pr-fork-repo-flag.mjs` exercises the fixed
command-builder logic directly:

- The original repro of bare `--head <branch>` (without `--repo`) is
  documented as the failure mode.
- The non-fork-mode command must include `--repo <owner>/<repo>`.
- The fork-mode command continues to include `--repo <owner>/<repo>` (no
  regression).
- The assignee-fallback rebuild also includes `--repo <owner>/<repo>` in both
  branches.
- The fork-aware diagnostic message is emitted when the
  "No commits between" GraphQL error is observed.

## References

- Issue: <https://github.com/link-assistant/hive-mind/issues/1774>
- Failing run log (gist): <https://gist.githubusercontent.com/konard/3d91da6b886cec3dafb847f4ac2395ea/raw/455e3720c5960539db38117a67d8e7ec15e52af5/beea6385-2c5d-42ee-9b0f-942195a2b207.log>
- Failing comment posted by the solver: <https://github.com/glsfull/saas/issues/1#issuecomment-4415652624>
- GitHub CLI `gh repo clone`: <https://cli.github.com/manual/gh_repo_clone>
- GitHub CLI `gh pr create`: <https://cli.github.com/manual/gh_pr_create>
- Related `gh` discussion of base-repo resolution from forks: <https://github.com/cli/cli/issues/2691>
