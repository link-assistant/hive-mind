---
'@link-assistant/hive-mind': patch
---

Fix `solve` to skip fork mode when the upstream repository is private and the
user has direct write access — even when the existing PR was created from a
fork (issue #1716).

Previously, when a PR was originally created from a fork (e.g. the upstream
repo was public and the user without write access used `--auto-fork`), but
the upstream is now private and the user has direct write access, `solve`
still tried to clone the fork. If the fork had been renamed, deleted, or was
otherwise inaccessible (which is common after a public→private flip), repo
setup failed with `Fork not accessible`.

The auto-fork path already handled this correctly (logging
_"Auto-fork: Write access detected to private repository, working directly on
repository"_ and leaving `forkOwner = null`). The bug was that **continue
mode** — both the auto-continue path and the direct PR-URL path — re-set
`forkOwner` from the existing PR's head repository unconditionally,
overriding the auto-fork bypass.

Fix: in [`src/solve.mjs`](./src/solve.mjs):

- Hoist `detectRepositoryVisibility(owner, repo)` out of the
  `if (argv.autoCleanup === undefined)` block so `isRepoPublic` is
  unconditionally available.
- Compute one bypass flag,
  `skipForkForPrivateUpstream = !isRepoPublic && !argv.fork && hasWriteAccess`.
- Gate both fork-from-PR-data branches behind it. When set, log
  _"Issue #1716: Working directly on the private upstream repository"_ and
  leave `forkOwner = null` so the regular non-fork code path runs.
- Gate the maintainer-modify auto-toggle on `forkOwner` being non-null so it
  doesn't fire when the bypass triggered.

Explicit `--fork` still wins (the bypass requires `!argv.fork`), and users
with no write access on a private repo still hit the existing auto-fork
private-repo guard (the bypass requires `hasWriteAccess`).

Tests: [`tests/test-issue-1716-private-repo-skip-fork.mjs`](./tests/test-issue-1716-private-repo-skip-fork.mjs)
locks the flag declaration, the exact condition formula, both
fork-detection paths, and four scenario simulations
(private+writeAccess → bypass; public → no bypass; explicit `--fork` → no
bypass; no writeAccess → no bypass).

Documentation: [`docs/case-studies/issue-1716/`](./docs/case-studies/issue-1716/README.md)
contains the timeline reconstructed from the user's failure log, the
distilled facts, the per-symptom root-cause analysis, and the implementation
plan.
