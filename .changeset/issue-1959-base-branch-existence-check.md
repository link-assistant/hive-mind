---
'@link-assistant/hive-mind': patch
---

fix(branch): validate `--base-branch` existence up-front and stop misreporting a missing base branch as an empty repository (#1959)

A `/solve` run from the Telegram bot crashed with the unactionable message
`Branch operation failed`. Root cause: the user passed `--base-branch issue-375-8a4323e580780`
— a **one-character typo** of the real branch `issue-375-8a4323e58078`. The branch did not
exist, but nothing validated that before the run started. The solver cloned 72 MB, then
`git checkout -b … origin/issue-375-8a4323e580780` failed with
`fatal: 'origin/…' is not a commit`. Worse, the branch-creation error handler **misdiagnosed**
this as "the repository appears to be empty (no commits)" and suggested `--auto-init-repository`,
which is wrong for a non-empty repo. The top level then collapsed everything to the bare
`Branch operation failed` comment on GitHub.

Defense-in-depth fix applied across the codebase:

- `validateGitHubEntityExistence()` (`src/github-entity-validation.lib.mjs`) gains a new
  base-branch step: when `--base-branch` is supplied, `checkBaseBranchExists()` verifies it
  via `gh api repos/{owner}/{repo}/branches/{branch}` **before** cloning, in the same fail-fast
  gate that already checks user/repo/issue/PR. A definitive 404 fails the run; transient
  errors fail open so a network hiccup never blocks a valid run.
- New helpers `levenshteinDistance()` and `findClosestBranchName()` power a "did you mean
  '<closest-existing-branch>'?" suggestion built from the repo's actual branch list, so the
  exact real-world typo points the user straight at `issue-375-8a4323e58078`.
- Both entry points share the gate: `src/solve.mjs` (CLI + the GitHub comment path) and
  `src/telegram-bot.mjs` (the bot pre-flight) now pass `baseBranch` in, so a missing base
  branch fails immediately at every level — including in Telegram, before the solve command
  is queued or spawned.
- `handleBranchCreationError()` (`src/solve.branch-errors.lib.mjs`) now receives `baseBranch`
  and `branchSource`. When a custom base branch is the missing ref it reports the real root
  cause instead of the bogus empty-repository advice; the genuine empty-repository path
  (creating from the default branch) is preserved. `createOrCheckoutBranch()`
  (`src/solve.branch.lib.mjs`) threads the base branch and its source into the handler.

Adds `tests/test-base-branch-existence.mjs` (17 offline assertions covering the helpers and
the misdiagnosis fix), `tests/test-base-branch-existence-integration.mjs`
(`@hive-mind-integration`, the real `gh` gate), and a deep case study in
`docs/case-studies/issue-1959/`.
