# Issue 1772 Case Study: Fork Missing Custom Base Branch

## Summary

Issue: https://github.com/link-assistant/hive-mind/issues/1772

Prepared PR: https://github.com/link-assistant/hive-mind/pull/1773

The solver was run for https://github.com/lefinepro/kefine/issues/56 with `--base-branch feat/lefine-quote-description` in fork mode. The upstream repository had that custom base branch, but the existing fork only had `release` and older issue branches. `createOrCheckoutBranch()` tried to create the issue branch from `origin/feat/lefine-quote-description`, so Git failed before any work could start.

The fix has two layers:

1. **Proactive sync (primary):** when `--base-branch` is passed in fork mode and `origin/<baseBranch>` is missing, the solver fetches `upstream`, verifies `upstream/<baseBranch>`, creates or updates the local base branch from upstream, and pushes that base branch to the fork — all _before_ attempting to create the issue branch. The system stays smart and reliable: the failure no longer occurs in the first place.
2. **Reactive recovery (defense in depth):** if the proactive path was skipped (no upstream remote configured) or raced with a concurrent worker, the same recovery still kicks in when `git checkout -b ... origin/<baseBranch>` fails with the missing-ref error.

## Data Preserved

All raw issue data gathered during investigation is stored under `docs/case-studies/issue-1772/raw/`.

- `raw/logs/6334e5ef-3331-4b6a-91fd-91fa3d43017e.log`: original failing solver execution log.
- `raw/github/hive-mind-issue-1772.json`: local issue report.
- `raw/github/hive-mind-issue-1772-comments.json`: local issue comments.
- `raw/github/hive-mind-pr-1773.json`: prepared pull request metadata.
- `raw/github/hive-mind-pr-1773-conversation-comments.json`: prepared pull request conversation comments.
- `raw/github/hive-mind-pr-1773-review-comments.json`: prepared pull request review comments.
- `raw/github/hive-mind-pr-1773-reviews.json`: prepared pull request reviews.
- `raw/github/lefinepro-kefine-issue-56.json`: external issue that triggered the run.
- `raw/github/lefinepro-kefine-issue-56-comments.json`: comment containing the failed run log.
- `raw/github/lefinepro-kefine-pr-53.json`: upstream PR that created `feat/lefine-quote-description`.
- `raw/github/lefinepro-kefine-pr-57.json`: later draft PR for issue 56.
- `raw/git/lefinepro-kefine-target-refs.txt`: upstream branch refs relevant to the failure.
- `raw/git/konard-lefinepro-kefine-target-refs.txt`: fork branch refs relevant to the failure.
- `raw/research/sources.md`: online references used during analysis.

## Timeline

- 2026-05-05 14:51 UTC: `lefinepro/kefine` PR #53 was merged. Its head branch was `feat/lefine-quote-description` and its base branch was `release`.
- 2026-05-10 12:18:21 UTC: `lefinepro/kefine` issue #56, "Code review refactoring", was opened.
- 2026-05-10 12:20:34 UTC: The solver command started with `--base-branch feat/lefine-quote-description`.
- 2026-05-10 12:20:51 UTC: auto-continue inspected the fork `konard/lefinepro-kefine` and found only `issue-50-ba307d4acdd3`, `issue-54-d703f1f1891b`, and `release`.
- 2026-05-10 12:20:56 UTC: `git fetch upstream` fetched `feat/lefine-quote-description` into `upstream/feat/lefine-quote-description`.
- 2026-05-10 12:20:57 UTC: branch creation failed because `origin/feat/lefine-quote-description` did not exist.
- 2026-05-10 12:20:59 UTC: the failure log was attached to `lefinepro/kefine` issue #56.
- 2026-05-10 12:27:41 UTC: `link-assistant/hive-mind` issue #1772 was opened from the failure.
- 2026-05-10 12:28:34 UTC: `lefinepro/kefine` PR #57 was created later from `issue-56-b16c6ee6a912` to `feat/lefine-quote-description`.

## Reproduction

The failed command was:

```bash
solve https://github.com/lefinepro/kefine/issues/56 --base-branch feat/lefine-quote-description --model opus --tool claude --attach-logs --verbose --no-tool-check --disable-report-issue --language en
```

The key log sequence:

```text
Fetching upstream...
From https://github.com/lefinepro/kefine
 * [new branch]      feat/lefine-quote-description -> upstream/feat/lefine-quote-description
Default branch synced: with upstream/release
Creating branch: issue-56-9a838972a26b from feat/lefine-quote-description (custom)
fatal: 'origin/feat/lefine-quote-description' is not a commit and a branch 'issue-56-9a838972a26b' cannot be created from it
```

The branch refs confirm the state:

```text
lefinepro/kefine:
e51e822b3e0b6da792aa85d14b235fc62a030d75 refs/heads/feat/lefine-quote-description
1402ad916f2fe5a6c07d4bceb85c91fa4b685c4c refs/heads/release

konard/lefinepro-kefine:
1402ad916f2fe5a6c07d4bceb85c91fa4b685c4c refs/heads/release
```

## Root Cause

`src/solve.repository.lib.mjs` correctly added and fetched `upstream`, and it synced the default branch `release` to the fork. It did not sync the requested custom base branch.

`src/solve.branch.lib.mjs` then created new issue branches with:

```bash
git checkout -b <issue-branch> origin/<baseBranch>
```

That assumption is valid for direct repository work and for forks whose base branch already exists in the fork. It breaks when a custom base exists only in upstream. The failing run had exactly that shape: `upstream/feat/lefine-quote-description` existed, but `origin/feat/lefine-quote-description` did not.

A second problem made the report harder to understand: the branch error handler interpreted Git's missing-start-point error as an empty repository and suggested `--auto-init-repository`. The repository was not empty; the start point was just the wrong remote namespace for this fork state.

## Fix

The fix is in `createOrCheckoutBranch()` (`src/solve.branch.lib.mjs`), shared between a proactive pre-checkout sync and a reactive post-checkout recovery via the `ensureBaseBranchInFork()` helper.

New behavior when `--base-branch` is set:

1. **Proactive sync.** If an `upstream` remote exists and the requested base branch differs from the default branch, run a quick `git show-ref` for `refs/remotes/origin/<baseBranch>`. If origin does not yet have it, fetch `upstream`, verify `upstream/<baseBranch>`, create or update local `<baseBranch>` from `upstream/<baseBranch>`, then push to `origin`.
2. **Fast path.** Run `git checkout -b <issue-branch> origin/<baseBranch>` as before.
3. **Reactive recovery.** If the fast path still fails because `origin/<baseBranch>` is not a commit (e.g. no proactive sync ran, or a race), execute the same sync helper and retry.
4. **Idempotent and narrow.** The proactive path is a no-op when `baseBranch == defaultBranch` (already synced by `setupUpstreamAndSync`), when origin already has the ref, or when no upstream remote is configured (no-fork mode).

This mirrors the online fork-sync guidance: the fork branch must be synced from upstream before fork-based work can depend on it. The implementation uses Git directly rather than shelling out to `gh repo sync` so it works with the existing remotes, logs, and local checkout state.

## Alternatives Considered

- Sync every upstream branch during fork setup. This is too broad for large repositories and changes more fork state than the requested solve needs. The proactive sync we ship is targeted at exactly the requested `--base-branch`.
- Sync the requested custom base branch during repository setup (`setupUpstreamAndSync`). Branch creation is the better seam because that is where we know the resolved `baseBranch`, the temp directory, the same logger, and the exact retry loop. We still get coverage even when callers reuse a pre-cloned working tree.
- Create the issue branch directly from `upstream/<baseBranch>` without pushing the base branch to the fork. This would fix checkout but leave later PR creation and ahead/behind checks vulnerable because other code compares against `origin/<targetBranch>`.
- Improve only the error message. That would reduce confusion but leave the solver unable to start work.

### Note on `gh repo fork`

`gh repo fork` already creates forks with **all** upstream branches by default (it requires `--default-branch-only` to opt out), so freshly created forks already satisfy the requirement to "fork with all branches" stated in the PR feedback. The remaining gap was _existing_ forks that pre-date a custom branch added later to upstream; the proactive sync covers that.

## Regression Tests

`tests/test-issue-1772-fork-custom-base-branch.mjs` creates a local upstream repository with `feat/lefine-quote-description`, clones a fork repository, deletes the custom base branch from the fork, fetches upstream, then calls `createOrCheckoutBranch()`.

The test verifies:

- the issue branch is created;
- the issue branch starts at the upstream custom base commit;
- the custom base branch is pushed to fork origin;
- the proactive sync path logs that origin lacks the base branch and that the fork was updated.

`tests/test-issue-1772-proactive-base-sync.mjs` covers idempotency and scope boundaries:

- no proactive sync runs when no `upstream` remote is configured (no-fork mode);
- no proactive sync runs when the requested base branch equals the default branch (already covered by `setupUpstreamAndSync`);
- no proactive sync runs when origin already has the base branch (idempotent fast path).

## External Reporting

No new external issue was filed in `lefinepro/kefine`. The root cause is in Hive Mind's fork branch creation flow, and the external repository now has PR #57 for the originally requested issue. The relevant upstream data is preserved in this case study for traceability.
