# Issue 1856 Case Study: ProverCoderAI/docker-git PR 381

## Summary

Issue #1856 asked what happened in
`https://github.com/ProverCoderAI/docker-git/pull/381`, whether hive-mind could
make its bot messages clearer, what blocked commit publication, why
`--allow-fork-divergence-resolution-using-force-push-with-lease` did not solve the
later blocker, and what UX should improve.

There were three distinct failures, not one:

1. The original PR 381 CI failure was an external Renovate artifact failure. The
   PR updated manifests, but the lockfile still resolved missing `@fedify/*`
   `2.2.5` packages, so every workflow failed in `bun install --frozen-lockfile`.
2. The first hive-mind run stopped during repository setup because the solver-owned
   fork default branch (`konard/ProverCoderAI-docker-git:main`) diverged from the
   upstream default branch.
3. The second hive-mind run fixed that default-branch divergence with
   `--force-with-lease`, then hit the real publication blocker: the authenticated
   account was `konard`, while PR 381's head branch was
   `ProverCoderAI:renovate/all`. GitHub rejected pushes and PR mutations with 403
   / permission errors.

The implemented hive-mind fix addresses a separate UX/logic bug found in the
second run: when continuing an upstream-owned PR through a solver fork, hive-mind
could check out a stale same-named branch from the fork (`origin/renovate/all`)
instead of the actual upstream PR head (`upstream/renovate/all`). The solver now
prefers the upstream remote in that case and logs the selected PR-head remote.
That prevents work from starting on the wrong branch, but it intentionally does
not bypass GitHub write permissions.

## Collected Data

Raw data and logs were preserved under this directory:

- `raw-data/pr-381-view.json`: PR metadata, including `headRefName`,
  `headRepository`, `headRepositoryOwner`, merge state, body, and current head.
- `raw-data/pr-381-issue-comments.json`, `raw-data/pr-381-review-comments.json`,
  `raw-data/pr-381-reviews.json`: PR conversation, inline comments, and reviews.
- `raw-data/pr-381-events.json`, `raw-data/pr-381-commits.json`,
  `raw-data/pr-381-files.json`: timeline events, commits, and changed files.
- `raw-data/pr-381-renovate-all-runs.json` and
  `raw-data/pr-381-renovate-all-runs-20.json`: workflow run snapshots for the
  `renovate/all` branch.
- `raw-data/git-refs.txt`: current upstream and fork branch tips used to diagnose
  the stale same-named fork branch.
- `raw-data/first-failure-comment.md` and
  `raw-data/first-failure-solve-log.txt`: the first hive-mind failure report.
- `raw-data/solution-draft-log-pr-1780846106856.txt`: the full second hive-mind
  session log attached to PR 381.
- `raw-data/ci-logs/*.log`: downloaded GitHub Actions logs for the failing
  historical runs.
- `analysis/*.txt`, `analysis/*.md`, and `analysis/*.log`: bounded extracts with
  the relevant line numbers from the raw data.

The full second-session log and derived large-log extract preserve operational
events, commands, comments, and errors, but opaque `encrypted_content` payloads
were replaced with `<redacted encrypted_content>`. Those payloads are not needed
for the timeline or root-cause analysis.

## External Research

The online research confirmed the boundaries between safe ref rewriting,
fork-syncing, and GitHub authorization:

- Git documents `--force-with-lease` as a push option that only updates a remote
  ref when the remote ref is still at the expected value. It is a safety check for
  ref replacement, not a permission override:
  https://git-scm.com/docs/git-push#Documentation/git-push.txt---force-with-leaseltrefnamegtltexpectgt
- GitHub documents fork syncing as updating a fork from its upstream repository;
  from the command line, upstream commits are fetched into `upstream/BRANCH-NAME`
  and then merged/pushed to the fork:
  https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork
- GitHub's fork PR collaboration docs say commits to fork-created PR branches
  depend on repository/fork permissions. In PR 381 the compare branch was not in
  `konard`'s fork, so the available credentials still could not push to
  `ProverCoderAI:renovate/all`:
  https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/allowing-changes-to-a-pull-request-branch-created-from-a-fork
- Renovate has a documented `artifactErrors` notification category for dependency
  artifact update failures, matching the class of external failure seen here:
  https://docs.renovatebot.com/configuration-options/#artifacterrors

## Timeline

- 2026-06-06 11:37 UTC: Renovate opened/updated PR 381 at head
  `b9961886e00e8413cb355b2037c6a4d2cc93e942`.
- 2026-06-06 11:38 UTC: CI failed across Check, Checking Dependencies, Snapshot,
  and Final Build during `bun install --frozen-lockfile`. The downloaded logs show
  missing `@fedify/webfinger@2.2.5` and `@fedify/vocab-tools@2.2.5` resolutions.
- 2026-06-07 13:42:43 UTC: First hive-mind run started with
  `--attach-logs --verbose`, but without
  `--allow-fork-divergence-resolution-using-force-push-with-lease`.
- 2026-06-07 13:42:52 UTC: PR metadata showed `headRefName: renovate/all` and
  `headRepositoryOwner.login: ProverCoderAI`.
- 2026-06-07 13:43:18 UTC: Fork default-branch sync failed with a
  non-fast-forward push to `konard/ProverCoderAI-docker-git:main`; hive-mind
  stopped and posted the fork-divergence instructions.
- 2026-06-07 14:57:22 UTC: Second run detected the same fork default-branch
  divergence, this time with auto-resolution enabled.
- 2026-06-07 14:57:23 UTC: `--force-with-lease` succeeded for
  `konard/ProverCoderAI-docker-git:main`, aligning the fork default branch with
  upstream `main`.
- 2026-06-07 14:57:24 UTC: hive-mind checked out `origin/renovate/all`, which was
  the stale same-named branch in the solver fork, even though the PR head branch
  belonged to the upstream repository.
- 2026-06-07 14:57:25 UTC: GitHub rejected `ConvertPullRequestToDraft` because
  `konard` did not have permission on PR 381.
- 2026-06-07 15:24:49 UTC: The session attempted
  `git push upstream renovate/all:renovate/all`; GitHub returned 403:
  `Permission to ProverCoderAI/docker-git.git denied to konard`.
- 2026-06-07 15:27:31 UTC: hive-mind commented that it prepared a local lockfile
  fix at `b0e157817fe582a7e146853a573082399ac4a103`, but could not publish it to
  `ProverCoderAI:renovate/all`.
- 2026-06-07 15:28:23 UTC: GitHub also rejected `UpdatePullRequest` for the same
  credentials.
- 2026-06-07 17:42 UTC: Later PR 381 workflow runs on
  `57e5d7919520f25e8367d6239d2ccb3a5361dbdf` completed successfully.
- 2026-06-07 22:12 UTC: The current PR head observed during this case study was
  `4960e3905b6892804dd3c6383a8a08057aabe113`, with newer workflow runs in
  progress/success. The historical failures above are therefore not the state of
  the current head.

## Requirements

Extracted from issue #1856:

1. Research exactly what happened in PR 381.
2. Determine whether bot messages can be clearer.
3. Explain what blocked the system from producing commits.
4. Explain why the force-with-lease flag did not help.
5. Improve UX.
6. Download all available logs and data into `docs/case-studies/issue-1856`.
7. Produce a deep case study with timeline, root causes, requirements, proposed
   solutions, online research, and existing components/libraries where applicable.
8. Add more debug output or verbose mode if the available data is insufficient.
9. If the defect is fixable in hive-mind, create a reproducing test first and then
   implement the fix.

## Root Causes

### External PR CI

The historical failed CI runs were caused by stale dependency artifacts. The
failing logs consistently show `bun install --frozen-lockfile` rejecting missing
`@fedify/webfinger@2.2.5` and `@fedify/vocab-tools@2.2.5` entries. The failure
occurred before the meaningful test/build jobs could run.

### First Hive-Mind Stop

The first run did not reach the PR branch. It cloned the solver fork, reset local
`main` to upstream `main`, and then tried to push that default branch back to the
fork. Git rejected the push as non-fast-forward. Because the run did not include
the explicit force-with-lease opt-in, hive-mind stopped and asked for a human
decision before rewriting the solver fork's `main`.

### Second Hive-Mind Publication Blocker

The second run did use the force-with-lease opt-in and it worked for the fork
default branch. After that, the session found and attempted a lockfile fix, but it
could not publish the commit because the target PR branch was
`ProverCoderAI:renovate/all` and the available GitHub credentials were for
`konard`. GitHub returned 403 for pushing to the upstream branch and GraphQL
permission errors for PR mutations.

### Hive-Mind Checkout Bug

The second run also exposed a hive-mind branch selection bug. In continue mode,
hive-mind cloned `konard/ProverCoderAI-docker-git` because it had no write access
to the upstream repository. The PR head owner was still `ProverCoderAI`, but
checkout preferred `origin/renovate/all`. Since `konard` had a stale same-named
branch, the worktree started from the wrong remote-tracking branch.

## Why `--force-with-lease` Did Not Solve Everything

The flag did help, but only for the problem it controls: rewriting the solver
fork's default branch after verifying the remote ref was still at the expected
value. The logs show it successfully force-updated
`konard/ProverCoderAI-docker-git:main`.

It did not and cannot grant permission to update
`ProverCoderAI/docker-git:renovate/all`. Authorization is enforced by GitHub before
the ref can be updated. A guarded force push to a ref still needs write access to
that repository and branch.

It also would have been unsafe for hive-mind to force-push
`konard/ProverCoderAI-docker-git:renovate/all` as a substitute. That branch was
not PR 381's head branch and contained unrelated/divergent commits.

## Implemented Fix

This PR implements the hive-mind-side fix for the stale same-named branch hazard:

- `src/solve.mjs` records the PR head repository owner from GitHub PR metadata.
- When continuing an upstream-owned PR while operating through a solver fork, it
  passes `upstream` as the preferred PR-head remote.
- `src/solve.branch.lib.mjs` threads that preferred remote to the repository
  checkout helper.
- `src/solve.repository.lib.mjs` now fetches and checks out the preferred remote
  before falling back to the old origin/upstream/PR-ref behavior, and logs the
  selected preferred PR-head remote.
- `tests/test-issue-1856-pr-head-remote-preference.mjs` creates an upstream repo
  and a fork with divergent same-named `renovate/all` branches, then proves
  checkout lands on the upstream PR head instead of the stale fork branch.

## UX Improvements

Implemented now:

- The solver logs when it deliberately prefers the upstream PR-head remote, making
  branch selection auditable in verbose logs.
- Same-named stale fork branches no longer silently win over the actual upstream
  PR head in this continue-mode case.

Recommended follow-up UX work:

- Add a publication preflight that reports whether the current token can push to
  the PR head repository/branch before starting a long model session.
- Split bot messages into separate blockers: fork default-branch sync, PR-head
  checkout source, and PR-head publication permissions.
- When `--allow-fork-divergence-resolution-using-force-push-with-lease` succeeds,
  state explicitly that the flag only applied to the solver fork's default branch.
- Include the selected checkout remote and target push remote in failure comments.
- If the PR head is not writable, offer explicit next steps: grant write access,
  let Renovate rebase/retry, or authorize a replacement branch/PR owned by the
  solver account.

## Existing Components And Libraries

- Git already provides the safe ref-rewrite primitive used here:
  `git push --force-with-lease`.
- GitHub's fork model and PR branch permissions are the relevant platform behavior;
  no third-party library can bypass those permissions.
- Renovate already classifies dependency artifact update failures with
  `artifactErrors`; PR 381's stale `bun.lock` failure fits that category.
- hive-mind already had verbose logs and fork-divergence handling. The missing
  component was a PR-head-aware remote preference during branch checkout.

## Verification

The reproducing test is `tests/test-issue-1856-pr-head-remote-preference.mjs`.
Before the implementation, `checkoutPrBranch()` ignored the preferred upstream
remote and would select the stale fork branch in the reproduced topology. With the
fix, the same topology checks out the upstream PR head and logs
`Preferred PR head remote`.

## Upstream Reporting

No external issue was opened. The external CI failure was a Renovate artifact
update/lockfile problem that later moved on to passing workflow runs, and the
GitHub 403/GraphQL errors are expected permission enforcement. The actionable
hive-mind defect was the wrong remote preference during checkout, which is fixed
in this PR.
