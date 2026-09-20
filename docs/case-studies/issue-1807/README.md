# Case Study: Issue #1807 — `/merge --auto-resolve` should resolve PRs one at a time

- Issue: https://github.com/link-assistant/hive-mind/issues/1807
- PR: https://github.com/link-assistant/hive-mind/pull/1808
- Date reported: 2026-05-16
- Reporter: @konard
- Related prior work:
  - #1805 / #1806 (initial `--auto-resolve` implementation that this PR
    fixes — added the loop, but did not actually serialise it)
  - #1143 (initial `/merge` command and the merge queue scaffolding)
  - #1341 (post-merge CI wait — the same wait the auto-resolve pass must
    now reuse between resolutions)
  - #1307 (target-branch CI wait at queue start)
  - #1407 / #1588 (cancellation hardening for long-running waits)
  - #1190 (`--auto-merge` flag on `solve`, which is what each resolution
    session uses)

## Summary

`/merge … --auto-resolve` was shipped in #1806 as a follow-up pass that
spawns `solve <pr> --auto-merge` for every PR the queue skipped because
of merge conflicts. The pass _iterates_ the conflict PRs in a `for` loop,
but each iteration only awaits `spawnSolveSession()` — which returns as
soon as the GNU `screen` session has been launched. Real conflict
resolution happens _inside_ the screen session (Claude editing files,
re-running CI, calling `gh pr merge`) and the queue moves on to the next
PR before any of that finishes.

The user-visible result, captured in
[`data/issue-screenshot.png`](data/issue-screenshot.png), is the
formal-ai run where the merge queue skipped 10 PRs and the bot then
launched all ten `solve --auto-merge` sessions in quick succession.

That is exactly what the issue forbids:

> we should do `/solve <pull request> --auto-merge` for the first one
> (created earliest) — after that we should wait for all CI/CD to
> complete after the merge completed, and only after that do resolution
> and merge for next one — always one at a time, never in parallel, as
> it is critical to preserve resources and release all versions one by
> one.

## Reported observations (verbatim)

From the issue body:

> Now with `--auto-resolve` for `/merge` command we get 8 task to be
> auto-resolved at the same time, that is not safe, and can waste
> resources, as we cannot guarantee, that after resolving conflicts with
> main branch, we will not have conflicts between pull requests
> themselves, so once we tried to find all pull requests with no
> conflicts, and merged these, we know have only pull requests with
> conflicts, and we should do `/solve <pull request> --auto-merge` for
> the first one (created earliest) after that we should wait for all
> CI/CD complete after the merge completed, and only after that do
> resolution and merge for next one always one at time, never in
> parallel as it is critical to preserve resources and release all
> versions one by one.

The attached screenshot
([`data/issue-screenshot.png`](data/issue-screenshot.png)) reproduces
the bug on `link-assistant/formal-ai`: the merge queue ran through 10
ready PRs, skipped all 10 with `PR has merge conflicts`, then the
auto-resolve pass spawned every solve session in quick succession.

## Requirements (extracted from the issue)

1. **R1** — Conflict-resolution sessions dispatched by `--auto-resolve`
   must run strictly one at a time, in PR-creation order
   (earliest first).
2. **R2** — After each conflict PR is _actually merged_ by its
   `solve --auto-merge` session, the queue must wait for that PR's
   post-merge CI/CD pipeline to finish before kicking off the next
   resolution. This is the same back-pressure rule #1341 already
   applies to the regular merge loop.
3. **R3** — Cancellation must still work. If the user cancels the
   `/merge` operation while an auto-resolve session is running, the
   queue must stop scheduling more sessions; it cannot abort the
   already-running screen session, but it must not start a new one.
4. **R4** — The fix must be observable in the existing Telegram status
   message: the user should see which PR is currently being resolved
   _and_ be able to tell when the queue is waiting for that PR's CI
   between resolutions (same UX language as the existing post-merge CI
   wait line).
5. **R5** — If `solve --auto-merge` fails to merge a PR (timeout, fork,
   permissions), the queue must record the failure and move on to the
   next conflict PR rather than getting stuck.
6. **R6** — Compile a case-study folder at
   `./docs/case-studies/issue-1807/` covering observations, timeline,
   requirements, root cause, reusable components, solution candidates,
   and the chosen plan.
7. **R7** — Cross-check known components/libraries that already solve
   the sub-problems (waiting for a PR to be merged, waiting for
   post-merge CI, polling GitHub) before writing anything new.
8. **R8** — Deliver everything inside this single pull request (#1808).

## Timeline

Reconstructed from the recent commits on `main` and the existing PRs:

| Event                                                                                                                | When       |
| -------------------------------------------------------------------------------------------------------------------- | ---------- |
| #1143 introduces `/merge` + the `MergeQueueProcessor` (sequential PR merging).                                       | 2026-03    |
| #1341 adds the post-merge CI wait between PRs (the back-pressure rule).                                              | 2026-04    |
| #1805 filed: original screenshot of `/merge` skipping 3 conflicting PRs without help.                                | 2026-05-15 |
| #1806 lands `--auto-resolve`. The loop iterates conflict PRs but `await`s only the spawn — sessions run in parallel. | 2026-05-15 |
| #1807 filed with screenshot of formal-ai showing 10 conflict PRs fan-out.                                            | 2026-05-16 |
| PR #1808 opened to serialise the resolution pass (this PR).                                                          | 2026-05-16 |

## Where the bug lives

`src/telegram-merge-queue.lib.mjs#runAutoResolve` (file/line:
`telegram-merge-queue.lib.mjs:550`):

```js
for (const item of conflicted) {
  if (this.isCancelled) break;
  item.status = MergeItemStatus.RESOLVING;
  this.autoResolveCurrent = item.pr.number;
  // ...
  const result = await this.spawnSolveSession({ url: item.pr.url, ... });
  // ^ resolves as soon as `screen -dmS …` exits, NOT when solve finishes
  // ...
}
```

`spawnSolveSession` is wired to `spawnAutoResolveSolve()` in
`telegram-merge-command.lib.mjs`, which calls
`executeStartScreen('solve', […, '--auto-merge'])`. `executeStartScreen`
runs the `start-screen` binary, which uses `screen -dmS <name> bash -c
'<cmd>; exec bash'` (`start-screen.mjs:285`). That command exits the
moment the screen session is _launched_. The actual `solve` invocation
keeps running inside the screen.

So the `await` in `runAutoResolve` only blocks for a few hundred
milliseconds — long enough to start the session, not long enough for
Claude to even read the PR. The loop continues immediately and spawns
the next session.

The case study for #1805 itself said the implementation was meant to
serialise: "The merge command runs each PR's solve session
sequentially, gated on the previous session's screen disappearing, so
we don't fan out unbounded Claude usage." The gate was never added.

## Root cause

The auto-resolve pass conflates _dispatching_ a session with _finishing_
the work that session does. `spawnSolveSession()` is a non-blocking
fire-and-forget; the loop assumed it was blocking. There is no signal
plumbed back from the spawned session — no PR-state polling, no screen
existence check, no event hook — so the loop has nothing to wait for.

Two facts compound the bug:

1. The default `executeStartScreen` path keeps the screen alive
   (`exec bash` is appended) so the user can re-attach to inspect logs.
   This means even if we tried to wait for the screen to terminate, we
   wouldn't get a signal — the screen lives forever.
2. The existing merge queue's post-merge CI wait
   (`waitForPostMergeCI`) lives between merges _inside_ the main `for`
   loop. The auto-resolve pass runs after that loop, so it has none of
   that machinery in scope unless we explicitly call it again.

## Reusable components already in the repo

| Need                                             | Existing helper                                                                                                                               | File                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Wait for a PR's post-merge CI to finish          | `waitForPostMergeCI(item)` (instance method on `MergeQueueProcessor`)                                                                         | `src/telegram-merge-queue.lib.mjs`                                             |
| Get the merge commit SHA for a merged PR         | `getMergeCommitSha(owner, repo, prNumber, verbose)`                                                                                           | `src/github-merge.lib.mjs`                                                     |
| Poll a PR's state (`OPEN` / `MERGED` / `CLOSED`) | `gh pr view <n> --repo o/r --json state,mergeStateStatus` (used by `checkPRMergeable` and `solve.preparation.lib.mjs`)                        | `src/github-merge.lib.mjs:439`                                                 |
| Sleep with cancellation support                  | `this.sleep(ms)` (`setTimeout`) and the existing `isCancelled` check pattern                                                                  | `src/telegram-merge-queue.lib.mjs`                                             |
| Render the "waiting for PR's CI" line            | Same status-line machinery `waitForPostMergeCI` already uses (`waitingForPostMergeCI`, `postMergeCIStatus`, `currentPostMergePR`)             | `src/telegram-merge-queue.lib.mjs`                                             |
| Spawn an isolated `solve --auto-merge` session   | `spawnAutoResolveSolve(target, verbose)` → `executeStartScreen('solve', [url, '--auto-merge'])`                                               | `src/telegram-merge-command.lib.mjs`, `src/telegram-command-execution.lib.mjs` |
| Identify "PR has conflicts" skip                 | `checkPRMergeable()` returns `{ mergeable:false, reason:'PR has merge conflicts' }`, and `MERGE_CONFLICT_SKIP_REASON` exports the same string | `src/github-merge.lib.mjs`, `src/telegram-merge-queue.lib.mjs`                 |

**No new npm dependency needed.** Every piece is already in-tree.

External components surveyed for completeness:

- **GitHub `merge_queue` API** — overlaps in intent (sequential merging
  with CI gating) but requires repo admins to enable and migrate; this
  bot has to work on any user repo, often without that feature on.
- **Mergify / Bulldozer / Kodiak** — external services that do
  serialised merging. Same blocker: needs install + repo-level config.
  Out of scope for this PR.
- **`p-queue` / `p-limit`** — generic concurrency-limiting libs.
  Overkill here: we already have a single queue, we just need to
  actually `await` the right signal.

## Solution candidates

### A. Block in the spawner until the screen session terminates

Use `screen -ls` polling after `spawnSolveSession()` returns, then move
on once the named session is gone.

- ✗ The default `start-screen` keeps the screen alive (`exec bash`).
  The screen never terminates on its own, so this would hang forever.
- ✗ Forcing `--auto-terminate` would change the UX (user can no
  longer re-attach to inspect logs) and still wouldn't give us the
  post-merge CI back-pressure the issue requires.

### B. Poll PR state after spawning until it becomes `MERGED`

After the spawn returns, poll `gh pr view <n> --json state` every N
seconds. When the state becomes `MERGED`, run the existing
`waitForPostMergeCI(item)` (capturing the merge commit SHA), then
continue. If the PR stays `OPEN` beyond a configurable timeout, log it
as `RESOLVE_TIMEOUT`, mark the item, and move on.

- ✓ Reuses the existing post-merge CI wait verbatim — same UX, same
  cancellation hooks, same timeout knobs.
- ✓ Same gh-CLI pattern as `checkPRMergeable` already uses.
- ✓ Cancellation works because every poll iteration checks
  `isCancelled` (matches the queue's existing pattern).
- ✓ Works regardless of whether the screen stays alive afterwards —
  the signal is the PR state, not the session lifecycle.

### C. Replace `executeStartScreen` with an in-process call

Drop the screen layer and call `startAutoRestartUntilMergeable()`
directly from the auto-resolve pass.

- ✗ Blocks the bot's event loop on long Claude calls.
- ✗ Loses the per-session log/watch UX users rely on from
  `/log` and `/watch`.
- ✗ Massively larger diff: have to reproduce all of `solve.mjs`'s
  bootstrap.

**Decision:** **(B).** Minimal, reuses every wait/cancel helper we
already have, and matches the language of the existing post-merge CI
wait exactly.

## Solution plan

1. **Case study** (this folder) — first commit.
2. **`MergeQueueProcessor`**:
   - Add `waitForAutoResolveCompletion(item)` instance method that
     polls `gh pr view <n> --json state,mergeStateStatus` every N
     seconds. Resolves with `{ status: 'merged' | 'closed' |
'timeout' | 'cancelled' }` and captures the merge commit SHA on
     success (so the next step can reuse `waitForPostMergeCI`).
   - Update `runAutoResolve()` so each loop iteration:
     1. Spawns the solve session (unchanged).
     2. Awaits `waitForAutoResolveCompletion(item)`.
     3. If the PR ended `MERGED`, awaits the existing
        `waitForPostMergeCI(item)` between resolutions.
     4. Records the outcome (`autoResolved`, `autoResolveFailed`,
        plus a new `autoResolveTimedOut` counter) and continues.
   - Surface a new "Waiting for resolution of #N…" / "Waiting for
     post-merge CI of #N…" line in `formatProgressMessage()` while
     the wait is in progress, mirroring the existing post-merge CI
     line.
3. **Config** (`src/config.lib.mjs`):
   - Add `autoResolveWaitTimeoutMs` (default: 4 h) and
     `autoResolvePollIntervalMs` (default: 60 s). Environment-variable
     overridable like the rest of `MERGE_QUEUE_CONFIG`.
4. **`telegram-merge-command.lib.mjs`** — no functional change
   needed; the existing `onProgress` callback already re-renders the
   message on every update, and the new wait emits progress updates.
5. **Tests** (`tests/test-merge-auto-resolve-sequential-1807.mjs`):
   - Spawner is called for the second PR only _after_ the first PR's
     wait helper resolves (timing assertion via a deferred promise).
   - When the first PR's wait resolves with `merged`, `waitForPostMergeCI`
     is invoked before the second spawn fires.
   - When `isCancelled` is set during the wait, no further spawn fires.
   - When the wait times out (`status: 'timeout'`), the item is
     marked `RESOLVE_FAILED` and the loop proceeds.
6. **PR #1808** — set ready, update title/body, point at this case
   study.

## Why this is safe

- The original `--auto-resolve` happy path (sequential dispatch +
  per-PR tracking) is preserved; the only added behaviour is the
  _wait_ between dispatches.
- All new waits respect `isCancelled` and emit progress updates on
  every poll, so the user is never left guessing.
- A spawned session that never merges its PR no longer wedges the
  queue: the configurable timeout records a `RESOLVE_FAILED` and the
  loop moves on. We surface the count to the user in the final
  message.
- The post-merge CI wait between resolutions reuses the exact same
  helper the regular merge loop uses, so the user sees the same
  "Waiting for post-merge CI of #N" message regardless of whether the
  PR was merged by the main loop or the auto-resolve pass.
- No new external dependency; the GitHub CLI path is identical to
  what's already in `checkPRMergeable`.

## Manual verification plan

1. `node tests/test-merge-auto-resolve-1805.mjs` — must still pass
   (no regressions in the existing #1805 surface).
2. `node tests/test-merge-auto-resolve-sequential-1807.mjs` — new
   tests covering R1–R5.
3. `node tests/test-merge-queue.mjs` — must still pass.
4. `bash scripts/check-file-line-limits.sh` — clean.
5. `npx eslint src/telegram-merge-queue.lib.mjs
src/telegram-merge-command.lib.mjs` — clean.
6. Manual: run `/merge https://github.com/<owner>/<repo>
--auto-resolve` in a Telegram staging chat against a repo with at
   least two conflicting PRs and verify (a) the second resolution
   does not start until the first PR is merged, and (b) the
   "Waiting for post-merge CI of #N" status appears between
   resolutions.

## Implementation outcome (delivered in this PR)

- `src/github-merge-ci.lib.mjs`: added `getPRStatus(owner, repo,
prNumber)` — returns `{ state, mergeStateStatus, mergeable }` from
  `gh pr view`. Re-exported from `src/github-merge.lib.mjs`.
- `src/config.lib.mjs`: added `mergeQueue.autoResolveWaitTimeoutMs`
  (default **4h**, env `HIVE_MIND_MERGE_QUEUE_AUTO_RESOLVE_WAIT_TIMEOUT_MS`)
  and `mergeQueue.autoResolvePollIntervalMs` (default **60s**, env
  `HIVE_MIND_MERGE_QUEUE_AUTO_RESOLVE_POLL_INTERVAL_MS`). Exposed as
  `AUTO_RESOLVE_WAIT_TIMEOUT_MS` / `AUTO_RESOLVE_POLL_INTERVAL_MS` on
  `MERGE_QUEUE_CONFIG`.
- `src/telegram-merge-queue.lib.mjs`:
  - New `waitForAutoResolveCompletion(item)` instance method —
    polls `getPRStatus` until the PR is `MERGED`/`CLOSED`, the user
    cancels, or the timeout fires. Tolerates up to 5 consecutive
    polling errors before bailing out.
  - New `cancellableSleep(ms)` helper — same wall time as `sleep`
    but breaks out on `isCancelled`.
  - `runAutoResolve()` rewritten as strict sequential pipeline
    `spawn → await waitForAutoResolveCompletion → (if merged) await
waitForPostMergeCI → next item`. Counters now reflect _actual_
    merges (`autoResolved` is only bumped after a successful merge),
    and the previously-`SKIPPED` count is decremented as conflict
    PRs flip to `MERGED`. Honours
    `MERGE_QUEUE_CONFIG.STOP_ON_POST_MERGE_CI_FAILURE` to break the
    pass on CI failure, matching the main loop's behaviour.
  - Introduces `autoResolvePhase` (one of `spawning`,
    `awaiting-resolution`, `awaiting-ci`, or `null`) and
    `autoResolveWaitStartedAt` so the progress message can render
    phase-aware status lines.
  - Constructor now accepts injectable `getPRStatus` and
    `getMergeCommitSha` for tests.
- `tests/test-merge-auto-resolve-sequential-1807.mjs` — 10 new
  tests covering the requirements above. The two existing #1805
  tests that touched `runAutoResolve()` were updated to inject
  `getPRStatus` stubs and to reflect the new merge-counter
  semantics.

### What this means for the operator

When `/merge --auto-resolve` runs against the formal-ai screenshot
scenario (10 conflict PRs), the bot now:

1. Picks the earliest-created conflict PR.
2. Spawns `solve <pr> --auto-merge` (status line: `🛠️ Auto-resolving
#N: dispatching solve session…`).
3. Polls `gh pr view #N --json state` every 60 s for up to 4 h
   (status line: `🛠️ Auto-resolving #N: waiting for resolution
(Xm Ys)…`).
4. When `state` flips to `MERGED`, fetches the merge commit SHA and
   awaits `waitForPostMergeCI()` (status line: `🛠️ Auto-resolving
#N: waiting for post-merge CI (Xm Ys)…`).
5. Only then loops to PR #N+1.

The user can cancel at any point — the next polling tick (or the next
`waitForPostMergeCI` poll, both at 30–60 s cadence) drops out cleanly.
