---
'@link-assistant/hive-mind': patch
---

fix(clone): detect interrupted clones that exit 0, retry them, and explain the failure instead of the bare "Failed to get current branch" (#1957)

A `/solve` run crashed with the unactionable message `Failed to get current branch`.
Root cause: `gh repo clone` (and the `git clone` it wraps) **exited 0 even though the
transfer was interrupted** mid-stream (`fetch-pack: unexpected disconnect while reading
sideband packet`), leaving **no `.git` directory** (`size=0 B`). The solver trusted the
exit code, logged `✅ Cloned to:`, then every subsequent git command failed with
`fatal: not a git repository`; the first to propagate it (`git branch --show-current` in
`verifyDefaultBranchAndStatus`) threw the bare error with no clue about what went wrong
or how to recover.

Defense-in-depth fix applied across the codebase:

- `cloneRepository()` (`src/solve.repository.lib.mjs`) no longer trusts the exit code:
  after `gh repo clone` it validates the result with `git rev-parse --is-inside-work-tree`
  and only treats the clone as successful when the exit code is 0 **and** a real working
  tree exists. In `--verbose` mode it logs why a 0-exit clone was rejected.
- New exported helper `cleanPartialClone()` empties the target directory before each
  retry so a partial clone does not make `gh repo clone <dir>` fail with "directory
  exists and is not empty".
- `classifyCloneError()` now classifies the interrupted-transfer vocabulary
  (`unexpected disconnect`, `sideband`, `early eof`, `the remote end hung up`,
  `rpc failed`, `fetch-pack`, `index-pack failed`, `transfer closed`) as a retryable
  `NETWORK` error, so the existing 3× exponential-backoff retry loop recovers from it.
  404 / ENOSPC / auth failures stay non-retryable.
- `isTransientNetworkError()` (`src/lib.mjs`, shared by many gh/git retry call sites)
  gains the same vocabulary, so the fix propagates everywhere — not just the clone path.
- Both failure points now print concrete, root-cause-obvious guidance: the clone-failure
  path adds NETWORK causes/fixes, and `verifyDefaultBranchAndStatus()`
  (`src/solve.repo-setup.lib.mjs`) detects `not a git repository` and logs an
  `INCOMPLETE CLONE DETECTED` block (What happened / Error details / How to fix:
  check network·VPN·proxy, re-run — clones auto-retry, verify access, check GitHub
  status) instead of the bare message.

Adds `tests/test-issue-1957-incomplete-clone.mjs` (26 assertions) and a deep case study
in `docs/case-studies/issue-1957/`.
