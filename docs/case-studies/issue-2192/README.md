# Case study — issue #2192: `Reason: Repository setup failed`

- **Issue**: <https://github.com/link-assistant/hive-mind/issues/2192>
- **Failing run**: <https://github.com/G-Ivan-A/hybrid-Intelligence-lab/pull/548#issuecomment-5522309917>
- **Hive Mind version in the failing run**: v2.15.1
- **Fix**: PR <https://github.com/link-assistant/hive-mind/pull/2193>

## 1. What happened

A `solve` run in continue mode ended after 47 seconds with:

```
Reason: Repository setup failed
```

Three clone attempts, all rejected by GitHub with the same sentence
(`docs/case-studies/issue-2192/log-excerpts/clone-failure.log`):

```
fatal: remote error: GitHub is temporarily limiting some unauthenticated downloads
to protect the stability of the platform. Please retry later or authenticate.
failed to run git: exit status 128
```

Hive Mind reported `⚠️ Clone failed: Unknown error` each time, waited 2s and 4s,
and then exited with generic advice ("Check authentication: gh auth status") that
did not describe the actual problem.

## 2. Timeline (all timestamps from the attached log, 2026-09-03)

| Time (UTC)        | Event                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 07:39:55          | `solve https://github.com/G-Ivan-A/hybrid-Intelligence-lab/pull/548 --tool claude --attach-logs --verbose` starts (v2.15.1, in Docker)                        |
| 07:40:17–07:40:23 | GitHub API calls all succeed: invitations listed, permissions read (`{"admin":false,…,"pull":true}`), visibility `public`, PR #548 details, linked issue #547 |
| 07:40:20          | No write access → auto-fork mode enabled                                                                                                                      |
| 07:40:27–07:40:28 | Fork `konard/G-Ivan-A-hybrid-Intelligence-lab` found and its parent validated — more successful authenticated API calls                                       |
| 07:40:29.494      | Clone attempt 1: `Cloning into '/tmp/gh-issue-solver-1788421223964'...`                                                                                       |
| 07:40:29.854      | GitHub: _temporarily limiting some unauthenticated downloads_                                                                                                 |
| 07:40:29.922      | Classified as **`Unknown error`**, retry in 2s                                                                                                                |
| 07:40:33.5        | Attempt 2 — identical refusal                                                                                                                                 |
| 07:40:38.6        | Attempt 3 — identical refusal                                                                                                                                 |
| 07:40:38.66       | `❌ CLONE FAILED … Error type: Unknown error (max retries exceeded)`                                                                                          |
| 07:40:38.86       | `❌ Repository setup failed`, failure comment posted to PR #548                                                                                               |

The decisive observation: **every `gh api` call in the same process succeeded**.
The container was authenticated. Only git downloads were refused.

## 3. Root causes

### RC-1 — public git clones are performed anonymously even when a token exists

`gh auth setup-git` installs

```
credential.https://github.com.helper = !gh auth git-credential
```

git consults a credential helper **only after the server answers `401`**.
`github.com` answers `200` for a _public_ repository, so git never asks the
helper and never sends an `Authorization` header. `gh repo clone` shells out to
that same `git clone`, so it inherits the behaviour.

Measured directly with `GIT_TRACE_CURL=1`
(`experiments/issue-2192-anonymous-clone-auth.mjs`, git 2.43.0, gh 2.95.0 —
output stored in `log-excerpts/authorization-header-evidence.log`):

```
1. credential helper only (baseline): Authorization headers sent = 0
2. GIT_CONFIG_* extraheader (the fix): Authorization headers sent = 3
```

Anonymous traffic is exactly what GitHub's limiter counts, so the run was
throttled despite holding a valid token. Notably this also means the
`gh-setup-git-identity` run quoted in the issue **cannot by itself have fixed
this clone**: it restores the git identity and the credential helper, neither of
which is consulted on a `200` response.

### RC-2 — the refusal was not in the transient/classification vocabulary

`classifyCloneError` (`src/solve.repository.lib.mjs`) had no pattern for this
message, so it fell through to `{ type: 'UNKNOWN', retryable: true,
description: 'Unknown error' }`. Consequences:

- the operator-facing diagnosis was wrong ("Repository doesn't exist or is private");
- the remedy shown (`gh auth login`) is useless — gh _was_ logged in;
- the run spent its three attempts on a plain retry, which cannot help, because
  each retry was as anonymous as the first.

### RC-3 — no recovery step between retries

The retry loop only slept. Issue #2192 asks for auto-recovery: "If
gh-setup-git-identity does not require entering credentials we can use it to
recover the git/gh state. Only if token really dead and requires auth we should
fail."

## 4. Requirements from the issue, and how each is addressed

| #   | Requirement (issue text)                                                                                                             | Resolution                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | "clearly we could do auto recovery"                                                                                                  | `cloneRepository` and `gitCmdRetry` now upgrade the transport (and run `gh-setup-git-identity --repair` when no token is reachable) before spending the next attempt                                 |
| R2  | "If gh-setup-git-identity does not require entering credentials we can use it to recover… Only if token really dead… we should fail" | `ensureAuthenticatedGitTransport({ repair: true })` calls `repairGitIdentity()` non-interactively; only a genuinely absent token yields `status: 'no-token'` and the (now accurate) failure guidance |
| R3  | "download all logs and data… compile to `./docs/case-studies/issue-{id}`"                                                            | this folder: `data/` (issue JSON, comments, the failure comment with the full 11 KB log), `log-excerpts/` (clone failure, header evidence)                                                           |
| R4  | "deep case study analysis… timeline, requirements, root causes, solutions, existing components"                                      | sections 2, 3, 4, 5, 6                                                                                                                                                                               |
| R5  | "search online for additional facts and data"                                                                                        | section 7                                                                                                                                                                                            |
| R6  | "If there is not enough data… add debug output and verbose mode"                                                                     | the classification now names the category in the log (`transient=yes category=github-anonymous-rate-limit pattern="…"`), and the transport logs its decision under `--verbose`                       |
| R7  | "If issue related to any other repository/project… report issues on GitHub"                                                          | section 7: `gh repo clone` does not authenticate public clones — reported upstream to `cli/cli`                                                                                                      |
| R8  | "fully apply requirements to entire codebase… fixed in all of them"                                                                  | section 5, table of call sites                                                                                                                                                                       |

## 5. The fix

`src/git-auth-transport.lib.mjs` (new) sends the token **preemptively**, the way
GitHub's own `actions/checkout` does:

```
http.https://github.com/.extraheader = Authorization: Basic base64("x-access-token:<TOKEN>")
```

injected through `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n`
environment variables (git ≥ 2.31) rather than written to `.git/config` or passed
as `-c` arguments. That choice matters:

- the token never lands in a file the AI session can read back;
- it never appears in a process command line visible to `ps`;
- it is inherited by **every** git child process — `git clone`, `git fetch`,
  `git pull`, `git push`, and `gh repo clone` — so all ~36 git call sites are
  covered without touching them;
- pre-existing `GIT_CONFIG_*` entries from the outer environment are preserved
  (the new keys are appended after them).

Call sites wired to authenticate before their first git network call:

| Call site                                                  | Change                                                                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/solve.repo-setup.lib.mjs` → `setupRepositoryAndClone` | `ensureAuthenticatedGitTransport` runs **before** `cloneRepository` (the existing `setupGitCredentialHelper` ran after the clone — too late) |
| `src/solve.repository.lib.mjs` → `cloneRepository`         | new `ANONYMOUS_RATE_LIMIT` classification + transport upgrade with `repair: true` between attempts + accurate "How to fix" guidance          |
| `src/lib.mjs` → `gitCmdRetry`                              | same recovery for `git fetch` / `git pull` / `git push` retries                                                                              |
| `src/review.mjs`                                           | authenticates before `gh repo clone`                                                                                                         |
| `create-test-repo.mjs`                                     | authenticates before `git clone`                                                                                                             |
| `src/transient-errors.lib.mjs`                             | shared vocabulary: `ANONYMOUS_DOWNLOAD_LIMIT_PATTERNS`, `isAnonymousDownloadLimit`, category `github-anonymous-rate-limit`                   |

Escape hatch: `HIVE_MIND_DISABLE_GIT_AUTH_TRANSPORT=1` restores anonymous
downloads. `HIVE_MIND_GIT_AUTH_TRANSPORT` is set as a diagnostic breadcrumb.

Regression coverage: `tests/anonymous-clone-auth-2192.test.mjs` (16 assertions —
classification, env-var construction, idempotency, opt-out, token precedence,
and the wiring order in the clone paths).
Reproduction/evidence: `experiments/issue-2192-anonymous-clone-auth.mjs`.

## 6. Existing components considered

| Component                                                                             | Verdict                                                                                                                                                                      |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actions/checkout` (`persist-credentials`)                                            | Source of the `http.<url>.extraheader` approach; it writes the header into `.git/config`. We use the `GIT_CONFIG_*` env form instead, so the token is not persisted to disk. |
| `gh auth setup-git` / `gh auth git-credential`                                        | Necessary but not sufficient (RC-1). Kept — it is the `401` half (private repos, pushes); `extraheader` is the `200` half. Both are retained.                                |
| `gh-setup-git-identity` (`repairGitIdentity()` in `src/git.lib.mjs`)                  | Reused for R2 as the non-interactive recovery step; cannot invent a token, so it only helps when gh state is broken rather than logged out.                                  |
| `git credential-cache` / `GIT_ASKPASS`                                                | Same limitation as the helper: only reached after a `401`.                                                                                                                   |
| Embedding the token in the remote URL (`https://x-access-token:TOKEN@github.com/...`) | Rejected: the token would be written to `.git/config` and echoed by `git remote -v` into attached logs.                                                                      |
| `src/transient-errors.lib.mjs` (issue #2168)                                          | Extended rather than duplicated — one vocabulary for classification and repair.                                                                                              |
| `src/quiet-probe.lib.mjs` (issue #2130)                                               | Used for `gh auth token` so the token is never mirrored into the attached log.                                                                                               |

## 7. External facts

- GitHub's message is a platform-wide throttle on _unauthenticated_ downloads;
  it is reported across ecosystems (e.g. `odoo/upgrade-util#508`,
  `spantaleev/matrix-docker-ansible-deploy#5580`, numerous Renovate/CI repos),
  always with the same remedy: authenticate the request.
- git's documented behaviour is that credential helpers are invoked on
  authentication _challenges_; `http.<url>.extraheader` is the supported way to
  send credentials preemptively, and it is what `actions/checkout` uses.
- `http.<url>.forceAuth` does **not** exist in git 2.43 (silently ignored), and a
  username-only URL (`https://user@github.com/...`) does not trigger preemptive
  auth either — both were tested and rejected while investigating.
- Upstream: `gh repo clone` of a public repository sends no `Authorization`
  header even though `gh` holds a token, which silently pushes authenticated
  users into the anonymous budget. Reported upstream as
  <https://github.com/cli/cli/issues/14329>, with the reproduction above, the
  `GIT_CONFIG_*` workaround, and a code-level fix suggestion for
  `pkg/cmd/repo/clone`.
