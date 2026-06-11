# Case Study — Issue #1893

**`Reason: Repository setup halted - fork divergence requires user decision` at `Maintainers are allowed to edit this pull request.`**

- **Issue:** [link-assistant/hive-mind#1893](https://github.com/link-assistant/hive-mind/issues/1893)
- **Pull Request:** [link-assistant/hive-mind#1894](https://github.com/link-assistant/hive-mind/pull/1894)
- **Reported by:** @konard, 2026-06-11
- **Manifested in:** [link-assistant/formal-ai#405 (failure comment)](https://github.com/link-assistant/formal-ai/pull/405#issuecomment-4675673177)
- **Labels:** bug

Raw data captured for this analysis lives in [`./data/`](./data):

| File                                   | What it is                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `issue-1893.json`                      | The hive-mind issue body and metadata                                            |
| `formal-ai-pr-405.json`                | The fork PR that failed (`isCrossRepository: true`, `maintainerCanModify: true`) |
| `formal-ai-issue-404.json`             | The issue the fork PR closes                                                     |
| `formal-ai-pr405-failure-comment.json` | The solver's failure comment, including the full 34 KB run log                   |

---

## 1. Summary

The solver was asked to continue an **existing pull request opened from a contributor's
fork** (`skulidropek/formal-ai:issue-404` → `link-assistant/formal-ai:main`,
PR #405). The PR has **"Allow edits by maintainers"** enabled, and the operator
(`link-assistant`/`konard`) has **admin/push access to the upstream repository**.

The run halted before any work was done with:

```
Reason: Repository setup halted - fork divergence requires user decision
```

and advised re-running with
`--allow-fork-divergence-resolution-using-force-push-with-lease`.

That advice was wrong. There was **no fork divergence**. The real failure was a
plain **permission-denied** push: the solver tried to push the freshly-synced
`main` branch into a fork it does **not** own, GitHub refused, and the solver
**misclassified the refusal as divergence** and stopped.

The issue's core assertion is correct:

> It should be technically possible to continue working on pull requests created
> by other users in their actual branch as pull request is allowed to be edited.

"Allow edits by maintainers" grants the upstream maintainer push access to the
**PR head branch only** (`issue-404` on the fork) — never to the fork's other
branches such as `main`. So syncing-and-pushing the fork's `main` is both
**unnecessary** and **guaranteed to fail**, and it should never block the run.

---

## 2. Timeline / sequence of events

Reconstructed from `formal-ai-pr405-failure-comment.json` (timestamps are UTC,
from the embedded run log; solver `v1.75.0`):

| Time       | Event                                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `23:28:10` | `solve https://github.com/link-assistant/formal-ai/pull/405 --model opus --tool claude --verbose ...` starts                                                                                                 |
| `23:28:17` | Auto-fork check: **write access to upstream `link-assistant/formal-ai` confirmed** → "working directly on repository" (no new fork created)                                                                  |
| `23:28:18` | Repository write access re-confirmed (`admin:true, push:true`)                                                                                                                                               |
| `23:28:19` | Continue mode: PR #405, cross-repository, head repo `skulidropek/formal-ai`                                                                                                                                  |
| `23:28:27` | `git fetch upstream` succeeds (hundreds of upstream branches fetched)                                                                                                                                        |
| `23:28:28` | `🔄 Syncing default branch...` → default branch resolved to `main`; `git reset --hard upstream/main` → `HEAD is now at fef27cdf chore: release v0.184.0`; **"✅ Default branch synced: with upstream/main"** |
| `23:28:28` | `🔄 Pushing to fork: main branch`                                                                                                                                                                            |
| `23:28:30` | `git push origin main` → **`! [remote rejected] main -> main (permission denied)`**                                                                                                                          |
| `23:28:30` | Solver prints **"⚠️ FORK DIVERGENCE DETECTED"** and the three "Your options" remedies                                                                                                                        |
| `23:28:30` | `safeExit(1, 'Repository setup halted - fork divergence requires user decision')` — run aborts                                                                                                               |

The decisive three log lines:

```
[23:28:28] 🔄 Pushing to fork:          main branch
[23:28:30] To https://github.com/skulidropek/formal-ai.git
           ! [remote rejected]   main -> main (permission denied)
           error: failed to push some refs to 'https://github.com/skulidropek/formal-ai.git'
[23:28:30] ⚠️ FORK DIVERGENCE DETECTED
```

Note the contradiction: the push target is **`skulidropek/formal-ai`** (the
contributor's fork, used as `origin`), but the operator is `link-assistant`. The
rejection reason is literally **`permission denied`**, not `non-fast-forward`.

---

## 3. Requirements extracted from the issue

Every explicit requirement in the issue body, itemized:

| #   | Requirement                                                                                                                                          | Status                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | It must be technically possible to continue working on a fork PR (other user's branch) when "Allow edits by maintainers" is set.                     | **Fixed** — permission-denied fork-sync no longer halts; the run continues on the PR branch.                                                                   |
| R2  | Download all logs/data about the issue into `./docs/case-studies/issue-1893/`.                                                                       | **Done** — see [`./data/`](./data).                                                                                                                            |
| R3  | Deep case-study analysis: reconstruct the timeline, list all requirements, find root causes, propose solutions, check existing components/libraries. | **Done** — this document.                                                                                                                                      |
| R4  | If data is insufficient to find the root cause, add debug/verbose output for the next iteration.                                                     | **Done** — root cause found; added verbose diagnostics anyway (see §6).                                                                                        |
| R5  | If the issue belongs to another repo where we can file issues, report it there with reproducible examples, workarounds, and code-fix suggestions.    | **N/A (documented)** — the bug is in **hive-mind itself**, not in `formal-ai`. `formal-ai` is only where it surfaced. No external report is warranted; see §7. |
| R6  | Apply the fix across the **entire codebase** — fix every place the issue occurs.                                                                     | **Done** — audited all push/divergence sites; see §8.                                                                                                          |
| R7  | Plan and execute everything in the single PR #1894.                                                                                                  | **Done** — all changes are on `issue-1893-8db6a20189f7` / PR #1894.                                                                                            |

---

## 4. Root-cause analysis

There are **two independent bugs** that combine to produce the failure. Either
one alone would have been enough to cause a confusing outcome; together they
produce a hard halt with misleading advice.

### Bug A — pushing a fork's default branch the user does not own

During repository setup the solver syncs the upstream default branch into the
local clone and then **pushes it back to `origin`** so the fork stays current:

```js
// src/solve.fork-sync.lib.mjs  (previously solve.repository.lib.mjs)
const syncResult = await $`git reset --hard upstream/${upstreamDefaultBranch}`;
...
const pushResult = await $`git push origin ${upstreamDefaultBranch} 2>&1`;
```

This is correct **when the solver created the fork itself** (the common case:
the user has no write access to upstream, so a fork is made under the user's
account and `origin` points at it).

But in **continue mode for a cross-repository PR**, `origin` is the **original
contributor's fork** (`skulidropek/formal-ai`). The operator does not own it.
"Allow edits by maintainers" only grants push access to the **PR head branch**
(`issue-404`), _not_ to the fork's `main`. So pushing `main` to that fork is
**always rejected with permission-denied** — and it is also **pointless**,
because the solver works on the PR branch, not the fork's `main`.

### Bug B — permission-denied misclassified as fork divergence

When the push fails, the error is classified with a substring heuristic:

```js
const isNonFastForward =
  errorMsg.includes('non-fast-forward') ||
  errorMsg.includes('rejected') || // ← matches "remote rejected"
  errorMsg.includes('tip of your current branch is behind');
```

The actual git output is:

```
 ! [remote rejected]   main -> main (permission denied)
```

The substring `'rejected'` matches **`remote rejected`**, so a _permission_
problem is treated as _divergence_. The solver then prints "FORK DIVERGENCE
DETECTED" and tells the user to rerun with
`--allow-fork-divergence-resolution-using-force-push-with-lease`.

That recommendation **cannot possibly help**: force-with-lease still requires
**write access to the fork**, which the operator does not have. So even the
escape hatch leads to another permission-denied. The run is dead-ended.

### Why neither existing safeguard caught it

- `src/solve.fork-detection.lib.mjs` has `handleMaintainerForkAccess` /
  `handleAutoForkOption`, but they are gated behind
  `argv.allowToPushToContributorsPullRequestsAsMaintainer && argv.autoFork`,
  neither of which was passed in this run.
- The auto-fork path early in the run correctly decided to "work directly on the
  repository" (because the operator has upstream write access) and **did not
  create a fork**. But the _fork sync_ step later still unconditionally pushed
  to `origin`, which in continue mode is the contributor's fork.

---

## 5. The fix

Two pure, unit-tested helpers were added to
`src/solve.branch-divergence.lib.mjs` and wired into the fork-sync step.

### 5a. `shouldPushDefaultBranchToFork({ currentUser, forkedRepo })` — fixes Bug A

Decides, **before** attempting the push, whether the current user owns the fork.
It returns `{ shouldPush, reason, forkOwner }`:

- `currentUser` ≠ fork owner (case-insensitive) → `shouldPush: false`,
  `reason: 'not-fork-owner'` → **skip the push entirely**, sync `main` locally
  only, and continue on the PR branch.
- `currentUser` === fork owner → `shouldPush: true`, `reason: 'owns-fork'`.
- Owner unparseable (`forkedRepo` has no `owner/repo` shape) → `shouldPush: true`,
  `reason: 'fork-owner-unknown'` (fail-open — preserves old behaviour).
- `currentUser` unknown (`gh api user` failed) → `shouldPush: true`,
  `reason: 'current-user-unknown'` (fail-open).

### 5b. `isPermissionDeniedPushError(errorOutput)` — fixes Bug B

A defensive second line: even if a permission-denied push is somehow attempted
(e.g. the ownership check failed open), this helper recognises the rejection
**before** the divergence heuristic runs. It matches `permission denied`,
`permission to`, `error: 403`, `the requested url returned error: 403`, or
`denied` + `to https://`. On a match the solver logs a non-fatal
"Skipping fork sync: No push access" message, returns to the original branch,
and **continues** instead of halting.

`classifyPushRejection()` (used elsewhere, by `handleRejectedPushForAutoPr`)
still returns `'remote-rejected'` for the same string — the new helper is an
explicit _override_ on the divergence path, so existing callers are unchanged.

### 5c. Wiring

In the fork-sync step (`src/solve.fork-sync.lib.mjs`):

1. After `git reset --hard upstream/<default>` succeeds, resolve `currentUser`
   via `gh api user --jq .login` and call `shouldPushDefaultBranchToFork`. If it
   returns `shouldPush: false`, log the skip, return to the original branch, and
   `return` — **no push attempted**.
2. If a push _is_ attempted and fails, check `isPermissionDeniedPushError(...)`
   **before** the `isNonFastForward` check. On a permission denial: log,
   restore branch, `return` (non-fatal).
3. Only a genuine `non-fast-forward` / `tip is behind` rejection still reaches
   the "FORK DIVERGENCE DETECTED" path — which is the case that advice was
   actually written for.

### 5d. File-size refactor

`setupUpstreamAndSync` was extracted from `src/solve.repository.lib.mjs` into a
new module `src/solve.fork-sync.lib.mjs` and re-exported, because the additions
would have pushed `solve.repository.lib.mjs` past the repo's 1500-line CI limit
(`scripts/check-file-line-limits.sh`, ESLint `max-lines`). The public API is
unchanged — `setupUpstreamAndSync` is still importable from
`solve.repository.lib.mjs`.

---

## 6. Debug / verbose output added (R4)

The new skip/continue paths emit `{ verbose: true }` diagnostics so a future run
log makes the decision explicit, e.g.:

```
ℹ️ Skipping fork push:      main synced locally only
   Reason:                  Fork skulidropek/formal-ai is owned by skulidropek, not konard
   Next:                    Continuing on the PR branch (maintainer edits allowed on the PR head only)
```

and, for the defensive permission-denied path:

```
ℹ️ Skipping fork sync:      No push access to skulidropek/formal-ai
   Reason:                  Fork's default branch is owned by another user; ...
   Push output:             ! [remote rejected]   main -> main (permission denied)
```

---

## 7. Why no external issue was filed (R5)

The issue surfaced in `link-assistant/formal-ai#405`, but `formal-ai` is just a
target repository the solver operated on. The defect — pushing a fork branch the
user doesn't own, and misclassifying the resulting rejection — is entirely in
**hive-mind's** solver code (`src/solve.*.lib.mjs`). There is nothing to fix or
report in `formal-ai`. GitHub's behaviour (maintainer edits cover the PR head
branch only) is correct and documented, not a bug. Hence no upstream/third-party
issue is warranted; the fix belongs here, in PR #1894.

For reference, GitHub's documented behaviour confirms the diagnosis: _"Allow
edits by maintainers"_ grants users with push access to the **base** repository
permission to commit **to the head branch of a cross-fork pull request** — it
does not grant access to any other branch of the contributor's fork. (GitHub
Docs: _"Allowing changes to a pull request branch created from a fork."_)

---

## 8. Codebase-wide audit (R6)

Searched for every place that (a) pushes a fork branch during setup and
(b) classifies push rejections, to ensure the fix is applied everywhere the
issue can occur:

| Location                                                                                       | Role                                                                             | Action                                                                                                                                |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/solve.fork-sync.lib.mjs` → `setupUpstreamAndSync`                                         | The exact failure site: syncs + pushes the default branch to `origin`.           | **Fixed** — ownership pre-check + permission-denied classification.                                                                   |
| `src/solve.branch-divergence.lib.mjs` → `classifyPushRejection`, `handleRejectedPushForAutoPr` | Classifies push rejections for the **auto-PR** path (pushing the _work_ branch). | Reviewed — this path pushes the user's own branch, so permission-denied is not expected; left unchanged. New helpers added alongside. |
| `src/solve.fork-detection.lib.mjs` → `handleMaintainerForkAccess`                              | Opt-in maintainer-fork handling, gated by flags not used here.                   | Reviewed — orthogonal; no change needed.                                                                                              |

The single divergence-detection heuristic that produced the bad "FORK
DIVERGENCE DETECTED" message exists only in `setupUpstreamAndSync`; that is the
only place the misclassification could occur, and it is now guarded.

---

## 9. Existing components / libraries considered

- **GitHub's own "Allow edits by maintainers"** (`maintainerCanModify`) — this
  is the underlying capability the issue relies on. The fix aligns the solver's
  behaviour with what this flag actually grants (PR head branch only).
- **`gh api user`** — used to resolve the current login for the ownership check,
  rather than parsing tokens or guessing. Already a dependency.
- **`git push --force-with-lease`** — already integrated as the opt-in
  divergence-resolution path; the fix ensures it is only _recommended_ for
  genuine divergence, where it can actually work.
- **In-repo helpers** — `parseForkFullNameFromGhOutput`
  (`src/github-repository-names.lib.mjs`) and the existing
  `classifyPushRejection` informed the design of the new owner-parsing and
  rejection-classification helpers, keeping them consistent with current code.

No new third-party dependency was needed; the fix is small, pure, and uses
facilities already present.

---

## 10. Tests

`tests/test-issue-1893-fork-pr-permission-denied.mjs` (9 cases, all passing):

- `isPermissionDeniedPushError` detects the real `permission denied` rejection.
- `isPermissionDeniedPushError` does **not** flag a genuine `non-fast-forward`.
- `isPermissionDeniedPushError` handles empty / `undefined` / `null` safely.
- `classifyPushRejection` still returns `'remote-rejected'` for the same output
  (no regression for existing callers).
- `shouldPushDefaultBranchToFork`: skips when the user ≠ fork owner; pushes when
  the user owns the fork; is case-insensitive; fails open when the user is
  unknown; fails open when the fork owner can't be parsed.

The exact failure output from the run log is used verbatim as the test fixture:

```
 ! [remote rejected]   main -> main (permission denied)
```

---

## 11. Outcome

With the fix in place, the reproduced scenario now:

1. Syncs the upstream default branch into the local clone (unchanged).
2. Detects that `origin` (the contributor's fork) is **not owned** by the
   operator → **skips the pointless push**, logging why.
3. Returns to the PR branch and **continues the run** — the maintainer can edit
   the PR head branch exactly as "Allow edits by maintainers" permits.

The misleading "fork divergence requires user decision" halt no longer occurs
for permission-denied rejections, satisfying the issue's core requirement (R1).
