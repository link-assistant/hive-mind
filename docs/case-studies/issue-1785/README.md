# Issue 1785 Case Study: Empty Repository With Unborn Default Branch

## Summary

Issue: https://github.com/link-assistant/hive-mind/issues/1785

Prepared PR: https://github.com/link-assistant/hive-mind/pull/1786

The solver failed while creating an issue branch for `glsfull/med` issue #2. The repository was empty, but after cloning Git still reported the current branch as `main`. Hive Mind treated that branch name as a usable default branch and later ran:

```bash
git checkout -b issue-2-d076d5c85a4f origin/main
```

That failed because `origin/main` did not point to a commit. The branch error handler already recognized the empty-repository pattern, but the solver reached that handler too late. Empty repositories must be detected during repository setup, before normal branch creation begins.

## Data Preserved

Raw investigation artifacts are stored under `docs/case-studies/issue-1785/data/`.

- `issue-1785.json`: Hive Mind issue report.
- `issue-1785-comments.json`: Hive Mind issue comments.
- `pr-1786-before.json`: prepared PR metadata before this fix.
- `0738d83f-d18b-4993-9357-0955363dc53a.log`: full failing solve log from the linked gist.
- `key-log-lines.txt`: extracted log lines for the branch failure.
- `external-glsfull-med-repo.json`: external repository metadata.
- `external-glsfull-med-issue-2.json`: external issue metadata.
- `external-glsfull-med-issue-2-comments.json`: external issue comments.
- `external-comment-4428699753.json`: specific failure comment linked from issue #1785.
- `research-sources.json`: official Git and GitHub documentation used during analysis.

## Timeline

- 2026-05-11 21:08:05 UTC: `glsfull/med` was created.
- 2026-05-11 21:55:17 UTC: `glsfull/med` issue #2 was opened.
- 2026-05-12 01:23:13 UTC: an earlier solver run posted a branch-operation failure comment.
- 2026-05-12 08:29:40 UTC: the failing run captured in the linked log started.
- 2026-05-12 08:29:51 UTC: the solver cloned `glsfull/med`; Git warned that the repository was empty.
- 2026-05-12 08:29:51 UTC: `git branch --show-current` returned `main`, and Hive Mind logged it as the default branch.
- 2026-05-12 08:29:51 UTC: `git checkout -b issue-2-d076d5c85a4f origin/main` failed because `origin/main` was not a commit.
- 2026-05-12 08:29:53 UTC: the failure log was attached to `glsfull/med` issue #2 as comment `4428699753`.
- 2026-05-12 09:48:46 UTC: Hive Mind issue #1785 was opened from the failure.

## Failure Evidence

The key log sequence is:

```text
warning: You appear to have cloned an empty repository.
main
Default branch: main
Creating branch: issue-2-d076d5c85a4f from main (default)
fatal: 'origin/main' is not a commit and a branch 'issue-2-d076d5c85a4f' cannot be created from it
```

The external repository metadata also showed no concrete default branch ref:

```json
{
  "nameWithOwner": "glsfull/med",
  "defaultBranchRef": {
    "name": ""
  }
}
```

## Root Cause

`verifyDefaultBranchAndStatus()` used `git branch --show-current` as both the current branch name and the proof that a usable default branch existed. That assumption is false for empty repositories.

Git can have an unborn branch: `HEAD` points at a branch name, but that branch has no commit yet. In this case, `git branch --show-current` returned `main` because `HEAD` was symbolically on `main`, while `git rev-parse --verify HEAD` would fail because there was no commit object.

The previous empty-repository support from issue #1230 was present, but it was gated behind a missing or ambiguous default branch name. The issue #1785 repository produced a non-empty branch name, so the setup path skipped empty-repository handling and reached normal branch creation.

## Online Research

Official Git documentation confirms the model behind the failure:

- `git branch --show-current` prints the current branch name and says nothing in detached HEAD; it does not say the branch has a commit: https://git-scm.com/docs/git-branch
- Git's glossary defines an unborn branch as a HEAD that points at a branch that does not yet exist and has no commit: https://git-scm.com/docs/gitglossary/2.44.0.html
- `git rev-parse --verify HEAD` is the documented probe for checking that HEAD resolves to a valid object: https://git-scm.com/docs/git-rev-parse/2.39.3.html
- `git checkout -b <new_branch> [<start_point>]` creates a branch from a start point, so `origin/main` must resolve to a usable object: https://git-scm.com/docs/git-checkout/2.19.2.html
- GitHub's repository contents API can create a file from Base64 content on the default branch, which supports the existing `--auto-init-repository` README initialization path: https://docs.github.com/en/rest/repos/contents

## Reproduction

A minimal local reproduction follows the same Git state:

```bash
tmp=$(mktemp -d)
git init --bare --initial-branch=main "$tmp/remote.git"
git clone "$tmp/remote.git" "$tmp/clone"
cd "$tmp/clone"

git branch --show-current
# main

git rev-parse --verify HEAD
# fatal: Needed a single revision

git checkout -b issue-2-d076d5c85a4f origin/main
# fatal: 'origin/main' is not a commit and a branch 'issue-2-d076d5c85a4f' cannot be created from it
```

The regression test `tests/test-issue-1785-empty-repo-default-branch.mjs` mocks exactly this state: `git branch --show-current` returns `main`, `git rev-parse --verify HEAD` fails, and normal status checks must not run.

## Fix

`src/solve.repo-setup.lib.mjs` now validates commit existence immediately after reading the current branch name:

1. Run `git branch --show-current` to keep the existing branch-name behavior.
2. Run `git rev-parse --verify HEAD 2>&1`.
3. If HEAD does not resolve to a commit with a known no-commit error, treat the repository as empty even when a branch name was printed.
4. If HEAD resolves to a commit, return `false` immediately from empty-repository detection. This avoids classifying a valid local checkout as empty just because remote branches are absent.
5. Only after the repository is known to be non-empty does the setup path treat a missing current branch as a default-branch detection failure.

This preserves the existing `--auto-init-repository` behavior:

- With `--auto-init-repository`, the solver initializes the empty repository with the existing GitHub API README path, fetches the new commit, checks out the remote branch, and continues.
- Without `--auto-init-repository`, the solver stops before branch creation, logs the empty-repository guidance, and posts the existing tracked issue comment when an issue URL is available.

The branch-creation error handler remains useful as defense in depth for unexpected call paths, but normal issue solving should no longer reach branch creation for this empty-repository state.

## Alternatives Considered

- Fix only `handleBranchCreationError()`: rejected because the error handler already had useful diagnosis, but the solver still failed after setup and produced a generic top-level branch-operation failure.
- Treat any non-empty `git branch --show-current` result as valid: rejected because that is the bug. A branch name can exist without a commit.
- Use only `git branch -r` to detect emptiness: rejected because a valid local repository may not have remote branches. HEAD verification is the direct signal that branch creation has a commit base.

## Verification

Targeted checks used while developing this fix:

```bash
node tests/test-issue-1785-empty-repo-default-branch.mjs
node tests/test-auto-init-repository.mjs
node tests/test-issue-1772-proactive-base-sync.mjs
node tests/test-issue-1772-fork-custom-base-branch.mjs
```

Final local validation:

```bash
npm run format:check
npm run lint
npm test
npm run check:duplication
git diff --check
```

All 205 selected test files passed. `npm run check:duplication` exited successfully while reporting existing repo-wide clone metrics in its standard report output. `npm ci` completed under Node.js v20.20.2 with the repository's Node.js `>=24.0.0` engine warning.

## External Reporting

No new issue was filed in `glsfull/med`. The root cause is in Hive Mind's repository setup flow, and the external issue already contains the original failure comments for traceability.
