# Root causes — Issue #1716

The failure has a single root cause but it surfaces in two execution paths in
`src/solve.mjs`. Both are addressed by the same fix.

## Root cause (one sentence)

**Continue-mode fork detection sets `forkOwner` from the existing PR's head
repository unconditionally, ignoring the same "private upstream + write
access" bypass that `--auto-fork` already honours.**

## Walkthrough

### 1. The auto-fork path already does the right thing

`src/solve.mjs` contains a block (around the auto-fork detection) that probes
visibility + permissions, and when:

```text
visibility === 'private'  &&  push: true
```

it logs:

> Auto-fork: Write access detected to private repository, working directly on repository

and **does not** set up fork mode — it leaves `forkOwner = null`.

Concretely, the failing run's log shows this happening (line 59):

```
✅ Auto-fork: Write access detected to private repository, working directly on repository
```

So far so good.

### 2. Continue-mode then re-introduces a fork from the PR data

A few hundred lines later in `solve.mjs`, when continue mode parses the
existing PR (`gh pr view 12 --json …`), it has two near-identical branches:

- **Auto-continue path** — runs when `processAutoContinueForIssue` finds an
  existing PR for the issue. Reads `prCheckData.headRepositoryOwner.login` /
  `prCheckData.headRepository.name`.
- **Direct PR-URL path** — runs when the user passes a PR URL directly (this
  issue's scenario). Reads `prData.headRepositoryOwner.login` /
  `prData.headRepository.name`.

Both branches **unconditionally** set:

```js
forkOwner = detectedForkOwner;
forkRepoName = detectedForkRepoName;
```

even when:

1. `argv.fork` is **false** (no explicit fork request),
2. the upstream is **private**, and
3. the user has **push** on it.

That assignment overrides the auto-fork bypass from step 1.

### 3. Downstream: setupRepository tries to clone the fork

`setupRepository` (in `src/solve.repository.lib.mjs`) sees `forkOwner !== null`
and enters its "Priority 2" branch where it:

1. Constructs `standardForkName = '${forkOwner}/${headRepoName}'` (or the
   prefixed form `${forkOwner}/${owner}-${headRepoName}`),
2. Calls `gh repo view <forkName>`,
3. On 404, fails the whole run with **"Fork not accessible"**
   (`solve.repository.lib.mjs:898`).

In the failing run the fork is at `konard/anti-corruption` (different repo
name — same shape as #1332). The tool tried `konard/xlabtg-anti-corruption`
and got a 404. **But this whole branch should have been skipped: the upstream
is private, and the user has direct write access.**

### 4. Why `--auto-cleanup`'s visibility detection didn't help

The existing `detectRepositoryVisibility` call sat **inside** the
`if (argv.autoCleanup === undefined)` block. That meant `isRepoPublic` was
only computed when the user had not pinned `--auto-cleanup` explicitly, and
even when computed it was scoped to that block — invisible to the
fork-detection branches that ran later.

## Citations (post-fix line numbers)

- `src/solve.mjs` — `detectRepositoryVisibility` is now hoisted above the
  `if (argv.autoCleanup === undefined)` block so `isRepoPublic` is
  unconditionally available.
- `src/solve.mjs` — `const skipForkForPrivateUpstream = !isRepoPublic && !argv.fork && hasWriteAccess;`
  is computed once.
- `src/solve.mjs` — auto-continue path: `if (skipForkForPrivateUpstream) { … }
else { forkOwner = detectedForkOwner; forkRepoName = detectedForkRepoName; }`.
- `src/solve.mjs` — direct PR-URL path: same shape.
- `src/solve.mjs` — `if (forkOwner && argv.allowToPushToContributorsPullRequestsAsMaintainer && argv.autoFork)`
  now requires `forkOwner` so it doesn't fire under the bypass.
- `src/solve.repository.lib.mjs:898` — unchanged; this is where the
  pre-fix failure surfaced.

## Why the fix is safe

| Concern                                      | Mitigation                                                                                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User explicitly passed `--fork`              | Bypass requires `!argv.fork`, so explicit fork mode wins.                                                                                                                        |
| User has no write access on private upstream | `hasWriteAccess` is `false`, so bypass does not trigger; auto-fork's "no fork for private" rule applies and the run still fails clearly.                                         |
| Public upstream where fork is correct        | `isRepoPublic === true` → bypass does not trigger; existing behaviour preserved.                                                                                                 |
| Maintainer-modify auto-toggle                | The `argv.allowToPushToContributorsPullRequestsAsMaintainer && argv.autoFork` block is now also gated on `forkOwner` being non-null, so it is a no-op when the bypass triggered. |
