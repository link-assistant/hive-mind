# Solution plans — Issue #1716

This document records the plan adopted in PR #1717 and the alternatives that
were considered and rejected.

## Plan A (adopted) — single bypass flag, gated at fork-detection points

Compute one flag once, reuse it at the two existing fork-detection branches.

```js
const { isPublic: isRepoPublic } = await detectRepositoryVisibility(owner, repo);
// (was previously inside the autoCleanup default block)

if (argv.autoCleanup === undefined) {
  argv.autoCleanup = !isRepoPublic;
}

// Issue #1716: when upstream is private and the user has direct write access,
// skip fork mode regardless of the PR's head repository — work directly on
// the upstream repository using regular branches.
const skipForkForPrivateUpstream = !isRepoPublic && !argv.fork && hasWriteAccess;
```

Then in each fork-from-PR-data branch:

```js
if (skipForkForPrivateUpstream) {
  await log(`   Issue #1716: Working directly on the private upstream repository (skipping fork ${detectedForkOwner}/${detectedForkRepoName ?? ''})`);
} else {
  forkOwner = detectedForkOwner;
  forkRepoName = detectedForkRepoName;
}
```

…and gate the maintainer-modify auto-toggle on `forkOwner` so it doesn't fire
when the bypass triggered:

```js
if (forkOwner && argv.allowToPushToContributorsPullRequestsAsMaintainer && argv.autoFork) {
  // …
}
```

### Why this plan

- **Minimal blast radius.** The change is local to `src/solve.mjs`. No
  signature changes in `setupRepositoryAndClone` or `setupRepository`.
- **Reuses existing detection.** `detectRepositoryVisibility` and
  `hasWriteAccess` are already computed by the auto-fork path; we just lift
  visibility a few lines so it is in scope where we need it.
- **Composes with `--fork`.** The bypass requires `!argv.fork`, so users who
  explicitly want fork mode keep it.
- **Composes with `--auto-fork`.** The bypass shares the same intent as the
  existing private-upstream branch in auto-fork — they reach the same
  conclusion (`forkOwner = null`).

## Plan B (considered, rejected) — push the bypass into `setupRepository`

Move the visibility check into `src/solve.repository.lib.mjs` and have
`setupRepository` ignore `forkOwner` when the upstream is private and the
user has write access.

**Rejected because:** `setupRepository` is also reused by paths that may
legitimately want the fork even on private repos in the future
(e.g. cross-org workflows). Keeping the bypass in `solve.mjs` keeps the
contract of `setupRepository` honest — when it receives a `forkOwner`, that's
what it operates on.

## Plan C (considered, rejected) — refuse to run + tell user to retry without continue mode

Detect the situation and ask the user to re-run without the PR URL. This is
strictly worse UX: the tool already has all the information it needs to do
the right thing.

## Verbose output (R4)

`--verbose` already logs:

- visibility (line 58 of the failing log: `Repository visibility: private`),
- write-access probe (line 56),
- the auto-fork decision (line 59),
- continue-mode fork detection (line 74).

The new bypass branch adds one more log line:

```
   Issue #1716: Working directly on the private upstream repository (skipping fork konard/anti-corruption)
```

This makes the decision visible **without** extra flags, satisfying R4.

## Upstream reports (R5)

None applicable. The bug is entirely inside `src/solve.mjs`'s fork-detection
logic. The GitHub CLI and Anthropic API both behaved correctly in the failing
run (`gh repo view <fork>` correctly returned 404; the failure is that we
asked the question at all).
