# Case study — Issue #3552: "Push rejected for konard/G-Ivan-A-mango_ba_prompts:issue-375-57d02718cf74"

> A `solve` run created its issue branch and made the "Initial commit with task
> details". GitHub answered the first `git push -u origin issue-375-57d02718cf74`
> with `remote: fatal error in commit_refs` and
> `! [remote rejected] … (failure)`. Hive Mind did **not** retry the push
> (`$git (push): not retrying [transient=no]`). It then reported
> **"Local and remote branch histories differ"** and told the user to
> `git pull` and merge, for a branch that did not exist on the remote.
> Rerunning the same task 20 minutes later pushed fine (PR
> [G-Ivan-A/mango_ba_prompts#379](https://github.com/G-Ivan-A/mango_ba_prompts/pull/379)).
> The failure was on GitHub's side and transient; the user could not have acted
> on the diagnosis they were given.

- **Issue:** https://github.com/link-assistant/hive-mind/issues/3552
- **PR:** https://github.com/link-assistant/hive-mind/pull/3553
- **Failure comment:** https://github.com/G-Ivan-A/mango_ba_prompts/issues/375#issuecomment-6268580958
- **Raw data** (in [`raw/`](./raw)):
  - [`failure-comment-6268580958.md`](./raw/failure-comment-6268580958.md): the failure comment with the full 23 KB solve log. Line numbers below refer to this file.
  - [`mango-issue-375-comments.json`](./raw/mango-issue-375-comments.json), [`mango-issue-375.json`](./raw/mango-issue-375.json): the raw API payloads.
  - [`mango-prs-for-375.json`](./raw/mango-prs-for-375.json): the PR created by the successful rerun.
  - [`issue-3552.json`](./raw/issue-3552.json): this issue.
  - [`githubstatus-incidents-2026-10.json`](./raw/githubstatus-incidents-2026-10.json): public GitHub incidents for October 2026, fetched on 2026-10-19.
- **Version:** `solve v2.39.2` (line 26), node v26.12.0, Docker container.

---

## 1. Timeline (UTC, 2026-10-19)

| Time         | Event                                                                                                                                                                                                   | Evidence                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 13:37:34.880 | `solve https://github.com/G-Ivan-A/mango_ba_prompts/issues/375 --tool claude --attach-logs --verbose …` starts                                                                                          | lines 21–28              |
| 13:38:23–25  | Fork `konard/G-Ivan-A-mango_ba_prompts` is synced with upstream `main` (`a6f89b8a`); `git push` of `main` → `Everything up-to-date`. Pushes to this fork work at this point.                            | lines 140–151            |
| 13:38:25.981 | Branch `issue-375-57d02718cf74` created from `main`                                                                                                                                                     | line 167                 |
| 13:38:26.362 | `278a01e4 [origin/main: ahead 1] Initial commit with task details`                                                                                                                                      | line 207                 |
| 13:38:26.367 | `git push -u origin issue-375-57d02718cf74`                                                                                                                                                             | line 210                 |
| 13:38:27.507 | GitHub: `remote: fatal error in commit_refs` / `! [remote rejected] issue-375-57d02718cf74 -> issue-375-57d02718cf74 (failure)`                                                                         | lines 211–214            |
| 13:38:27.518 | **`$git (push): not retrying [transient=no] attempt=1/5 exit=1`**: the retry wrapper gives up after one attempt                                                                                         | line 215                 |
| 13:38:27.991 | `git fetch origin refs/heads/issue-375-57d02718cf74` exits 128, because the branch is not on the remote                                                                                                 | line 221                 |
| 13:38:27.998 | **`❌ PUSH REJECTED: Local and remote branch histories differ`**. It also says "The remote branch changed after the local branch state used for this push" and later prints "couldn't find remote ref". | lines 223–234            |
| 13:38:28.066 | Suggested fix: "Merge the remote branch state … `git pull origin issue-375-57d02718cf74`"                                                                                                               | lines 249–250            |
| 13:38:28.181 | The failure comment posts the same diagnosis plus "Diverged-history path: merge or resolve …"                                                                                                           | comment header           |
| 13:58:48     | Rerun: a new branch `issue-375-083f56cec782` pushes normally; PR #379 is created at 13:58:58 and merged at 14:54:05                                                                                     | `mango-prs-for-375.json` |
| 15:03:19     | Issue #3552 is opened                                                                                                                                                                                   | `issue-3552.json`        |

At the time of writing, the failed branch still does not exist on the fork:
`gh api repos/konard/G-Ivan-A-mango_ba_prompts/branches/issue-375-57d02718cf74` returns 404. GitHub's public status feed shows **no**
incident on 2026-10-19; the closest Git Operations incidents were on 2026-10-07 (see
[`raw/githubstatus-incidents-2026-10.json`](./raw/githubstatus-incidents-2026-10.json)).
So this was a short, unannounced, per-request server fault. That is the kind of failure a retry is meant to absorb.

## 2. Requirements from the issue

| #   | Requirement                                                                          | Where it is addressed                                             |
| --- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| R1  | Find the root cause of the rare push failure                                         | §3                                                                |
| R2  | Fix it, because the user cannot manage this themselves                               | §4: retry, correct classification, correct user-facing remedy     |
| R3  | Download all logs and data into `docs/case-studies/issue-3552`                       | [`raw/`](./raw)                                                   |
| R4  | Deep case study: timeline, requirements, root causes, solutions, existing components | this document                                                     |
| R5  | Search online for additional facts                                                   | §5                                                                |
| R6  | Add debug output or verbose mode if the data is insufficient                         | §4.4                                                              |
| R7  | Report to other projects if they are related                                         | §6                                                                |
| R8  | Apply the fix across the entire codebase                                             | §4.5: solver pushes, release version push, Helm `gh-pages` pushes |
| R9  | Everything in one PR                                                                 | PR #3553                                                          |

## 3. Root causes

### RC1: `fatal error in commit_refs` was not recognised as transient

Every `git push`/`fetch`/`pull`/`ls-remote` issued through the solver's `$` is
already wrapped with `gitCmdRetry` (5 attempts, exponential backoff;
`src/git-retry.lib.mjs`, `src/github-rate-limit.lib.mjs:481`). Whether a failure
is retried depends only on the shared vocabulary in
`src/transient-errors.lib.mjs`. That list knew HTTP 5xx, GraphQL internal
errors and pack-protocol faults, but not this receive-pack failure. The output
contains none of the known strings: the HTTP exchange succeeds and the error
arrives inside the git protocol as `remote:` text plus a `(failure)` ref status.
The wrapper therefore logged `transient=no` and returned the first failure.

`fatal error in commit_refs` comes from GitHub's server side (inferred from the `remote:` prefix and the sources in §5; GitHub does not document it). It means GitHub
could not commit the ref update on its side. The client sent a valid pack and the
ref update was legal, which is why the identical push succeeded later.

### RC2: every `[remote rejected]` was treated as a history divergence

`classifyPushRejection` (`src/solve.branch-divergence.lib.mjs:253`) knew
`non-fast-forward`, `remote-ref-already-exists` (issue #1817) and a catch-all
`remote-rejected`. The catch-all went down the same path as a real divergence:

- the "What happened" text was hard-coded to "The remote branch changed after
  the local branch state used for this push". The same block then printed
  "couldn't find remote ref", which contradicts it;
- the "How to fix" steps and the failure comment told the user to `git pull` and
  merge a branch that did not exist.

So beyond the missed retry, the solver gave a wrong diagnosis and an impossible
remedy. That is why the issue says the failure "does not look like something
user can manage himself".

### RC3: the release scripts had the same blind spot

- `scripts/version-and-commit.lib.mjs` `pushWithRebaseRetry` retried only
  non-fast-forward rejections. Any other failure, including a GitHub server
  fault, failed the release immediately.
- `scripts/helm-release.lib.mjs` pushed `gh-pages` twice with no retry at all.

Neither caused this incident, but both would fail on the same GitHub response.

## 4. Solution

### 4.1 Retry the push (fixes RC1)

`'fatal error in commit_refs'` is added to `GITHUB_SERVER_TRANSIENT_PATTERNS`.
Every git network command that goes through the wrapped `$` now retries it with
the existing backoff, and the log shows why:
`transient git error … category=github-server pattern="fatal error in commit_refs"`.
Genuine rejections are still not retried: non-fast-forward, permission denied,
ruleset violations, and `cannot lock ref … reference already exists`.

### 4.2 Classify it correctly if retries are exhausted (fixes RC2)

- `classifyPushRejection` returns a new class, `github-server-error`, for any
  output matched by `isGitHubServerError`. It is checked before the generic
  `remote-rejected`.
- `handleRejectedPushForAutoPr` still inspects the remote first. If the ref
  landed despite the error (which GitHub community discussion #49593 reports
  happening), the run recovers exactly like issue #1817. Otherwise it stops
  with `GitHub server error while pushing <ref>`. The log section reads
  `GITHUB SERVER ERROR`, shows GitHub's raw output, and says the failure is not
  a branch divergence. The remedy is to check githubstatus.com and rerun, with no
  merge, rebase or force-push.
- `buildPushRejectionExplanation` no longer says "the remote branch changed"
  when the remote branch does not exist, for any classification.
- The pre-PR failure comment (`src/solve.pre-pr-failure-notifier.lib.mjs`)
  recognises the new failure reason and posts the GitHub-server remedy
  instead of the "Diverged-history path".

### 4.3 Alternatives considered

| Option                                          | Verdict                                                                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Treat every `(failure)` ref status as transient | Rejected: the status is generic, and the `remote:` line is the reliable signal.                                  |
| Retry inside `handleRejectedPushForAutoPr`      | Rejected: it would duplicate `gitCmdRetry`. One shared vocabulary keeps all call sites consistent (issue #2168). |
| Force-push or recreate the branch               | Rejected: the project never force-pushes, and nothing needed overwriting.                                        |

### 4.4 Debug output (R6)

- `handleRejectedPushForAutoPr` now logs, in verbose mode, the rejection
  classification and whether the remote branch exists (with ahead/behind counts)
  or why it could not be inspected.
- On the server-error path, GitHub's raw `remote:` lines are always logged.
- The retry wrapper already logs the matched pattern and category for every
  retry decision.

### 4.5 Whole-codebase sweep (R8)

| Call site                                                  | Before             | After                                                        |
| ---------------------------------------------------------- | ------------------ | ------------------------------------------------------------ |
| All solver `git push`/`fetch`/`pull` via wrapped `$`       | not retried        | retried (shared pattern)                                     |
| `scripts/version-and-commit.lib.mjs` `pushWithRebaseRetry` | failed immediately | transient faults retried **without** rebase                  |
| `scripts/helm-release.lib.mjs` (2 `gh-pages` pushes)       | single attempt     | `pushWithTransientRetry` (3 attempts, transient faults only) |

`git clone` stays deliberately excluded from automatic retry (issue #2168: a
partial clone makes a retry misleading).

### 4.6 Verification

[`tests/push-github-server-error-3552.test.mjs`](../../../tests/push-github-server-error-3552.test.mjs)
replays the verbatim incident output. Before the fix, 8 of its 10 original
cases failed. After the fix, all 11 cases pass, including the Helm case. They
cover classification, retry through both `$` wrappers, no retry for genuine
rejections, the handler diagnosis, recovery when the ref landed, the failure
comment, and both release scripts.

## 5. Online research (R5)

- [velog.io: "[Git] 에러: fatal error in commit_refs"](https://velog.io/@jungmyeong96/Git-에러-fatal-error-in-commitrefs):
  the same `remote: fatal error in commit_refs` + `[remote rejected] main -> main (failure)`.
  The write-up attributes it to an abnormal state on GitHub's servers; the fix
  was to wait and push again.
- [sPHENIX software list, 2023-03](https://lists.bnl.gov/sympa/arc/sphenix-software-l/2023-03/msg00017.html):
  the same error, treated as a GitHub-side problem, with advice to check githubstatus.com.
- [GitHub community discussion #49593](https://github.com/orgs/community/discussions/49593):
  sudden push failures attributed to GitHub. One commenter notes the commit
  **did** land despite the error, which is why the handler still checks the remote
  before failing.
- [GitHub Status](https://www.githubstatus.com): no incident covers
  2026-10-19 13:38 UTC, so the fault was too short or too local to be announced.

## 6. Upstream reporting (R7)

The faulty component is GitHub's server-side receive-pack, which has no public
issue tracker. `git` itself behaved correctly: it printed the server's message
and exited non-zero. No other open-source dependency (`command-stream`,
`gh`) was involved, so there is no GitHub repository to file a reproducible
report against. If the error recurs while GitHub reports no incident, the
solver's log now tells the operator to contact
[GitHub Support](https://support.github.com) with the attached log. That is the
only channel that can act on it.

## 7. Existing components reused

- `src/transient-errors.lib.mjs`: the single transient-failure vocabulary (issue #2168).
- `gitCmdRetry`, `wrapDollarWithGitRetry`, `wrapDollarWithGhRetry`: existing retry/backoff.
- `getRemoteBranchDivergenceSnapshot` and `shouldTreatPushRejectionAsRemoteSynchronized`
  (issue #1817): detect a ref that landed despite the error.
- `scripts/run-command.lib.mjs` `CommandFailedError`: unchanged failure type for the release scripts.
