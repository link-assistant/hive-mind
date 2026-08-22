# Case Study: Issue #1957 — `Failed to get current branch`

## Summary

Issue #1957 reported that a `/solve` run **crashed** with the bare, unactionable
message:

```
Failed to get current branch
```

The run was solving an _unrelated_ task — [`G-Ivan-A/mango_ba_prompts#141`](https://github.com/G-Ivan-A/mango_ba_prompts/issues/141)
("docs: создать ADR по Mango Taxonomy") — and the failure was reported to that issue as
a generic "🚨 Solution Draft Failed" comment that told the user nothing concrete.

The **root cause is in Hive Mind itself**, not in `mango_ba_prompts`. The `gh repo clone`
command (and the `git clone` it wraps) **exited 0 even though the underlying transfer
was interrupted** mid-stream:

```
[11:40:23.661] Cloning into '/tmp/gh-issue-solver-1781955620326'...
[11:40:37.289] fetch-pack: unexpected disconnect while reading sideband packet
[11:40:37.341] ✅ Cloned to: /tmp/gh-issue-solver-1781955620326   ← exit code trusted
[11:40:37.357] fatal: not a git repository (or any of the parent directories): .git
...
[11:40:37.571] 📊 [DISK] phase=after_clone bytes=0 ... size=0 B   ← clone produced nothing
[11:40:37.593] Error: Failed to get current branch
   at verifyDefaultBranchAndStatus (.../src/solve.repo-setup.lib.mjs:70:11)
```

The clone left **no `.git` directory** (0 bytes on disk), yet the solver logged
`✅ Cloned to:` because it trusted the exit code. Every subsequent `git` command failed
with `fatal: not a git repository`, and the first one that propagated its failure was
`git branch --show-current` inside `verifyDefaultBranchAndStatus`, which threw the bare
`Failed to get current branch`.

Three distinct requirements come out of the issue, all fixed in PR #1958:

1. **Root cause — a `gh repo clone` that exits 0 on an interrupted transfer was trusted,
   producing a corrupt/empty working directory and a downstream crash with no
   explanation.** The fix verifies the clone actually produced a usable git repository
   (`git rev-parse --is-inside-work-tree`) instead of trusting the exit code.
2. **Make the interrupted-transfer error retryable.** `fetch-pack: unexpected disconnect
…`, `early EOF`, `the remote end hung up`, `RPC failed`, `index-pack failed`, etc. are
   all transient and are now classified as retryable NETWORK errors, so the existing
   clone retry-with-backoff loop recovers from them instead of failing.
3. **Give concrete, root-cause-obvious error messages.** Both the clone-failure path and
   the downstream `verifyDefaultBranchAndStatus` crash now explain _what happened_
   (interrupted clone, no `.git`), show the underlying git error, and give a numbered
   _How to fix_ list (check network/VPN/proxy, re-run — clones auto-retry, verify repo
   access, check GitHub status).

## Captured Evidence

All evidence lives under [`raw/`](./raw/):

| File                                     | Purpose                                                     |
| ---------------------------------------- | ----------------------------------------------------------- |
| `raw/issue-1957.json`                    | Issue title, body, labels, timestamps                       |
| `raw/issue-1957-body.md`                 | Issue body (verbatim requirements)                          |
| `raw/mango-issue-141-comments.json`      | Full comment thread on the external issue (API capture)     |
| `raw/mango-issue-141-failure-comment.md` | The "🚨 Solution Draft Failed" comment posted to mango #141 |
| `raw/solve-failure-log.excerpt.txt`      | The full 192-line failure log (the smoking gun)             |
| `raw/research-sources.json`              | Primary/online sources on the git sideband-disconnect error |

## Timeline (UTC, 2026-06-20)

| Time         | Event                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 11:40:05.526 | `solve v2.0.8` starts on `mango_ba_prompts#141` with `--tool codex --think max --attach-logs --verbose`.                                    |
| 11:40:14–22  | Access checks, fork mode enabled (no write access), fork `konard/G-Ivan-A-mango_ba_prompts` validated.                                      |
| 11:40:20.327 | Temp dir created: `/tmp/gh-issue-solver-1781955620326`.                                                                                     |
| 11:40:23.661 | `Cloning into '/tmp/gh-issue-solver-1781955620326'...` — `gh repo clone` begins.                                                            |
| 11:40:37.289 | **`fetch-pack: unexpected disconnect while reading sideband packet`** — the transfer is interrupted ~14s in.                                |
| 11:40:37.341 | **`✅ Cloned to:`** — the solver trusts the exit code and reports success despite the disconnect.                                           |
| 11:40:37.357 | `fatal: not a git repository (or any of the parent directories): .git` — first git command after "success" fails. Repeats for remote setup. |
| 11:40:37.571 | `📊 [DISK] phase=after_clone bytes=0 ... size=0 B` — the clone produced **zero bytes**; there is no repository.                             |
| 11:40:37.593 | **`Error: Failed to get current branch`** thrown at `verifyDefaultBranchAndStatus (solve.repo-setup.lib.mjs:70:11)`.                        |
| 11:40:37.621 | Recovery auto-commit also fails (`not a git repository`); failure log is attached to mango #141 as a "🚨 Solution Draft Failed" comment.    |

The decisive contradiction: the log shows `fetch-pack: unexpected disconnect` and
`size=0 B` **before** the `✅ Cloned to:` success was acted upon — the exit code said
success while the filesystem said the clone never happened.

## Root-Cause Analysis

### 1. Why a failed clone looked like a success

`gh repo clone` shells out to `git clone`. When the pack transfer is interrupted
(`fetch-pack: unexpected disconnect while reading sideband packet`), the process can
still exit 0 in some environments — and even where `git` itself would exit non-zero, the
`gh` wrapper is known to mask failures (cf. [cli/cli#9398](https://github.com/cli/cli/issues/9398),
where `gh` returns exit 0 on failure). The solver's clone check was:

```js
if (cloneResult.code === 0) {
  /* treat as success */
}
```

So a 0 exit code with **no `.git` directory** sailed through as success.

### 2. Why the downstream message was useless

The first git command to actually propagate the corruption was
`git branch --show-current` in `verifyDefaultBranchAndStatus`. The old code threw a bare
`new Error('Failed to get current branch')` with no context — the user could not tell
this was a network/clone problem, nor what to do about it.

### 3. Why the error was not retried

`classifyCloneError` and the shared `isTransientNetworkError` helper did not recognise
git's fetch-pack/sideband/early-EOF/RPC vocabulary, so even when the failure _was_
surfaced it would have been classified `UNKNOWN` / non-retryable. Per the external
research (below), this family of errors is universally transient and the recommended fix
is exactly retry-with-backoff.

## The Fix (defense-in-depth, applied across the whole codebase)

| #   | Layer                             | File                                                                      | Change                                                                                                                                                                                                                                                                                |
| --- | --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Detect** the bad clone          | `src/solve.repository.lib.mjs` (`cloneRepository`)                        | After `gh repo clone`, verify with `git rev-parse --is-inside-work-tree`; only treat the clone as successful when `code === 0` **and** a real working tree exists.                                                                                                                    |
| 2   | **Clean** partial artifacts       | `src/solve.repository.lib.mjs` (`cleanPartialClone`, new exported helper) | Empty the target directory before each retry so `gh repo clone <dir>` does not fail with "directory exists and is not empty".                                                                                                                                                         |
| 3   | **Classify** as retryable         | `src/solve.repository.lib.mjs` (`classifyCloneError`)                     | The interrupted-transfer vocabulary (`unexpected disconnect`, `sideband`, `early eof`, `the remote end hung up`, `rpc failed`, `fetch-pack`, `index-pack failed`, `transfer closed`) is classified `NETWORK` / retryable, so the existing 3× exponential-backoff retry loop recovers. |
| 4   | **Classify** in the shared helper | `src/lib.mjs` (`isTransientNetworkError`)                                 | Same vocabulary added to the shared transient-error helper used by many `gh`/git retry call sites, so the fix applies everywhere, not just the clone path.                                                                                                                            |
| 5   | **Explain** at the clone path     | `src/solve.repository.lib.mjs` (clone-failure message)                    | NETWORK-type causes/fixes: "Connection dropped mid-transfer…", "Check your network connection / VPN / proxy, then re-run…".                                                                                                                                                           |
| 6   | **Explain** at the crash path     | `src/solve.repo-setup.lib.mjs` (`verifyDefaultBranchAndStatus`)           | Detect `not a git repository` → log an `INCOMPLETE CLONE DETECTED` block (What happened / Error details / How to fix) and throw a descriptive error instead of the bare `Failed to get current branch`.                                                                               |

### Verbose diagnostics

When `--verbose` is on, `cloneRepository` now logs _why_ a 0-exit clone was rejected
(`git rev-parse failed despite exit 0 — …`), so the next iteration has the root-cause
evidence inline rather than having to reconstruct it from disk-size telemetry.

## Existing components / libraries reused

- **`classifyCloneError` + retry-with-backoff loop** already existed in
  `cloneRepository` (added for ENOSPC #1211 and transient/rate-limit handling). The fix
  extends its vocabulary rather than inventing a new mechanism.
- **`isTransientNetworkError`** (`src/lib.mjs`) is the shared transient-error classifier
  used across `gh` retry helpers; extending it propagates the fix to every caller.
- **`reportError`** is reused for non-fatal `cleanPartialClone` failures so they are
  observable without crashing.
- No new third-party dependency is required — `git rev-parse --is-inside-work-tree` is
  the standard, cheap way to validate a working tree.

## External research

The `fetch-pack: unexpected disconnect while reading sideband packet` error is
consistently documented as a **transient network / interrupted-transfer** failure, with
**retry** as the primary recommended remedy (plus optional `http.postBuffer` /
`core.compression` tuning). See [`raw/research-sources.json`](./raw/research-sources.json):

- shorebirdtech/shorebird#2397 — recommends wrapping `git clone` in retry logic that
  catches this exact error.
- microsoft/Windows-Containers#320, Gitea forum, Atlassian community — same error, same
  transient-network root cause.
- cli/cli#9398 — documents that `gh` can return **exit code 0 on failure**, which is why
  the exit code alone cannot be trusted and the working tree must be validated.

## Should we file an issue on another repository?

**No.** `mango_ba_prompts` is the _victim_ (it merely received the failure comment); the
bug is entirely in Hive Mind. The underlying `gh repo clone` exit-0-on-failure behaviour
is an upstream GitHub CLI characteristic already tracked in
[cli/cli#9398](https://github.com/cli/cli/issues/9398); our defense-in-depth fix
(validate the working tree, retry, clean, explain) is the correct local mitigation
regardless of upstream behaviour.

## Regression test

`tests/test-issue-1957-incomplete-clone.mjs` (26 assertions) covers:

1. `classifyCloneError` marks sideband/early-EOF/RPC/index-pack/remote-hung-up as
   retryable NETWORK, while 404 / ENOSPC / auth stay non-retryable (no over-broad match).
2. `isTransientNetworkError` recognises the same patterns and still ignores 404.
3. `cleanPartialClone` empties a directory in place, keeps the directory itself, and
   tolerates a missing directory.
4. `verifyDefaultBranchAndStatus` turns the `not a git repository` symptom into an
   actionable `INCOMPLETE CLONE DETECTED` error (with a "How to fix" / "Re-run" section)
   while a genuine, unrelated branch failure keeps the generic message.

## Requirements checklist (from the issue)

- [x] **Find the exact root cause** — `gh repo clone` exited 0 on an interrupted transfer; no `.git` was created; downstream `git branch --show-current` failed with the bare message.
- [x] **Tell the user/admin what to do** — actionable "How to fix" blocks at both failure points (network/VPN/proxy, re-run, verify access, GitHub status, ask admin to inspect terminal log).
- [x] **Download all logs/data to `docs/case-studies/issue-1957`** — issue JSON/body, the external comment thread, the full 192-line failure log, research sources.
- [x] **Deep case study** — timeline, requirements, per-problem root cause, solution plans, reused components/libraries (this document).
- [x] **Search online for additional facts** — see External research + `raw/research-sources.json`.
- [x] **Add debug output / verbose mode for next-iteration root-causing** — verbose log of why a 0-exit clone was rejected.
- [x] **Report to another repo if relevant** — analysed; not warranted (mango is the victim; upstream gh behaviour already tracked in cli/cli#9398).
- [x] **Apply the fix across the entire codebase** — both the dedicated clone classifier (`solve.repository.lib.mjs`) and the shared `isTransientNetworkError` helper (`lib.mjs`), plus the downstream crash site (`solve.repo-setup.lib.mjs`).
- [x] **Single PR (#1958)** — all changes + this case study committed to `issue-1957-3996d3ed760a`.
