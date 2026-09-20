# Case Study: Issue #2072 — `/merge` was not cancelled immediately on Cancel button click

- **Issue:** [#2072](https://github.com/link-assistant/hive-mind/issues/2072) (bug, opened by @konard)
- **Pull request:** [#2073](https://github.com/link-assistant/hive-mind/pull/2073)
- **Related prior work:** [#1588](https://github.com/link-assistant/hive-mind/issues/1588) (cancel button reappears), [#1807](https://github.com/link-assistant/hive-mind/issues/1807) (auto-resolve, one PR at a time), [#1574](https://github.com/link-assistant/hive-mind/issues/1574) / [#1823](https://github.com/link-assistant/hive-mind/issues/1823) (SIGINT/SIGTERM-aware sleep)

## Summary

Pressing **🛑 Cancel** during `/merge` set a flag, but the queue kept running for up to a full
polling interval afterwards. The reported screenshot (`screenshot.png`) captures the contradiction
exactly: the status message reads **"🛑 Cancelling..."** while, on the same screen, the queue is
still reporting **"⏱️ Waiting for 1 CI run(s) on target branch to complete (0m 38s)..."** — the
timer counting _up_ well past the point of cancellation.

This was not an artificial delay anyone added deliberately. It was a structural consequence of how
every wait loop was written: cancellation was checked at the **top of each poll iteration**, but the
poll delay itself was an **uninterruptible `setTimeout`**. Once the loop entered the sleep, nothing
could shorten it. The cancel flag was only observed when the sleep finished on its own.

The worst case was not the 30 seconds in the screenshot. `waitForPRReady` polls at
`ciPollIntervalMs`, which defaults to **5 minutes** — so a cancel could sit unobserved for five
minutes.

## Timeline

| When             | Event                                                                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-11 03:34 | #1588 filed: cancel button reappears, impossible to stop the queue.                                                                                                                                                                                        |
| 2026-04-11 04:56 | #1588 closed. Fix added `isCancelled` checks to the CI wait loops and stopped `onProgress` re-adding the button. The checks were placed at the top of each iteration; the sleeps were left as raw `setTimeout`.                                            |
| 2026-05-16       | #1807 adds `MergeQueueProcessor.cancellableSleep()` — a deadline loop that wakes every 1s to re-check cancellation. It fixed the auto-resolve wait, but was a _second, separate_ sleep helper rather than a change to the primitive every other wait used. |
| 2026-07-16       | #2072 filed with the screenshot: "🛑 Cancelling..." shown while the target-branch CI wait is still counting (0m 38s).                                                                                                                                      |

The gap between #1588 and #2072 is the interesting part. #1588 _was_ a cancellation fix, and it
shipped tests. It did not prevent #2072 because of how those tests assert — see
[Why the existing tests didn't catch this](#why-the-existing-tests-didnt-catch-this).

## Requirements (from the issue)

| #   | Requirement                                                                                                               | Status                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | In any stage of `/merge` it must be possible to cancel immediately.                                                       | Done — every wait now aborts within ~100ms.                                                                                                                       |
| R2  | Every process not yet cancellable in `/merge` must become cancellable.                                                    | Done — audited; `waitForAllRepoActions` was the last holdout.                                                                                                     |
| R3  | No artificial delays.                                                                                                     | Done — no delay was removed, because none was artificial; the delays are legitimate poll intervals that are now interruptible. See [note](#on-artificial-delays). |
| R4  | Download logs/data to `./docs/case-studies/issue-2072`, do deep analysis: timeline, requirements, root causes, solutions. | This document.                                                                                                                                                    |
| R5  | Search online for additional facts; check existing components/libraries.                                                  | See [Existing components and prior art](#existing-components-and-prior-art).                                                                                      |
| R6  | If data is insufficient for root cause, add debug output / verbose mode.                                                  | Not needed — root cause was established directly from the source; see [Root cause](#root-cause-analysis).                                                         |
| R7  | Report issues to other repositories if related.                                                                           | Not applicable — see [Upstream issues](#upstream-issues).                                                                                                         |
| R8  | Apply the fix across the entire codebase, not just one place.                                                             | Done — see [Every site that was fixed](#every-site-that-was-fixed).                                                                                               |

## Root Cause Analysis

### Primary root cause: cancellation was checked, but the sleep could not be interrupted

Every merge wait loop had this shape:

```js
while (Date.now() - startTime < timeout) {
  if (isCancelled?.()) return { ...cancelled }; // checked here...
  const status = await checkSomething();
  if (done(status)) return { ...success };
  await new Promise(resolve => setTimeout(resolve, pollInterval)); // ...but blocked here
}
```

The `isCancelled()` check is real and correct. The defect is that it is only _reachable_ once per
`pollInterval`. Pressing Cancel at the start of a sleep means waiting out the whole interval before
the loop can notice. Worst-case cancellation latency therefore equalled the poll interval:

| Wait                                        | Config key (`src/config.lib.mjs`)         | Default       | Worst-case cancel latency (before)  |
| ------------------------------------------- | ----------------------------------------- | ------------- | ----------------------------------- |
| PR mergeability (`waitForPRReady`)          | `ciPollIntervalMs` (line 807)             | **5 minutes** | 5 minutes                           |
| Target-branch CI (`waitForBranchCI`)        | `targetBranchCIPollIntervalMs` (line 829) | 30 seconds    | 30 seconds                          |
| Post-merge CI (`waitForCommitCI`)           | `postMergeCIPollIntervalMs` (line 854)    | 30 seconds    | 30 seconds                          |
| Auto-resolve                                | `autoResolvePollIntervalMs` (line 863)    | 60 seconds    | 60s → 1s after #1807                |
| Repo-wide actions (`waitForAllRepoActions`) | hardcoded default                         | 5 minutes     | 5 minutes (no `isCancelled` at all) |

The 30-second target-branch row matches the screenshot: the queue was 38 seconds into a 30-second
poll cycle, still counting, with "Cancelling..." already on screen.

### Contributing cause: two sleep helpers instead of one primitive

#1807 introduced `MergeQueueProcessor.cancellableSleep()` alongside the existing
`MergeQueueProcessor.sleep()`. That made cancellability **opt-in per call site**. Any wait that
called `sleep()` — the obvious, default-looking choice — silently got the uninterruptible
behaviour. A new wait added later would default to being uncancellable. The bug class was
guaranteed to recur.

### Secondary cause: cancel racing the timeout path

Two loops, on timeout expiry, performed a final API round-trip before returning. A cancel landing at
that moment produced an extra `gh` call and a `timeout`/failure result rather than a `cancelled`
one — the user sees the queue still doing work after cancelling.

### Secondary cause: a cancelled mergeability check was read as "unmergeable"

`checkPRMergeable` retries while GitHub reports `UNKNOWN` mergeability, sleeping 5s between
attempts. It had no cancellation input at all, and a cancel arriving mid-retry would surface as a
_failed_ PR rather than a _skipped_ one — misreporting cancellation as a merge failure.

### Why the existing tests didn't catch this

#1588 shipped `tests/test-merge-queue-cancel-1588.mjs`, which asserts things like:

```js
const source = fs.readFileSync(new URL('../src/github-merge.lib.mjs', import.meta.url), 'utf8');
assert.ok(source.includes('isCancelled') && source.includes('waitForBranchCI'));
```

These are **source-string assertions**. `source.includes('isCancelled')` was true before this fix
and true after it — it was true _during the entire lifetime of the bug_. The tests verify that the
word appears in the file, not that cancellation has any effect. No timing is measured, so a wait
that honours cancellation only every 5 minutes passes identically to one that honours it instantly.

This is the reason the regression survived a dedicated cancellation fix and its test suite.

### On "artificial delays"

The issue asks that there be no artificial delays. Worth stating precisely: **no artificial delay
was found, and none was removed.** Every delay in the merge path is a legitimate poll interval —
the code must wait _some_ amount between GitHub API calls or it would hammer the rate limit. The
defect was never the existence of the delay; it was that the delay was **uninterruptible**. The fix
keeps the intervals exactly as they were and makes them abortable. Poll intervals are unchanged, so
API call volume is unchanged.

## Solution

### The primitive: `cancellableSleep`

Added to the existing `src/interruptible-sleep.lib.mjs` (rather than a new module — that file
already existed for exactly this concern, per #1574/#1823):

```js
export async function cancellableSleep(ms, isCancelled = null, options = {}) {
  const { stepMs = 100 } = options;
  if (!isCancelled) {
    const { interrupted } = await interruptibleSleep(ms);
    return { interrupted, cancelled: false };
  }
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (isCancelled()) return { interrupted: false, cancelled: true };
    const { interrupted } = await interruptibleSleep(Math.min(stepMs, deadline - Date.now()));
    if (interrupted) return { interrupted: true, cancelled: isCancelled() };
  }
  return { interrupted: false, cancelled: isCancelled() };
}
```

It sleeps in 100ms steps, polling the predicate between them, and composes with the existing
`interruptibleSleep` so SIGINT/SIGTERM handling is inherited rather than reimplemented.

### The structural fix: one cancellable primitive, not an opt-in helper

The important change is not the new function — it is making `MergeQueueProcessor.sleep()` _itself_
cancellable:

```js
sleep(ms) {
  return cancellableSleepUntil(ms, () => this.isCancelled);
}
```

Every wait in the queue already routed through `sleep()`. Making the primitive cancellable fixes all
of them at once, and — more importantly — makes cancellability the **default** for any wait added in
future. The separate `cancellableSleep` helper from #1807 became a redundant alias and was removed.
This directly addresses the contributing cause: there is now one way to sleep, and it is the correct
one.

This also preserved every existing test seam. Several suites stub `processor.sleep = async () => {}`
to collapse long delays; because the fix lands _on_ `sleep` rather than beside it, those stubs keep
working untouched.

### Every site that was fixed

| File                                    | Change                                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/interruptible-sleep.lib.mjs`       | New `cancellableSleep` primitive.                                                                                                             |
| `src/telegram-merge-queue.lib.mjs`      | `sleep()` made cancellable; redundant `cancellableSleep` helper removed; cancelled mergeability check now skips the PR instead of failing it. |
| `src/telegram-merge-wait.lib.mjs`       | `waitForPRReady` — the 5-minute worst case.                                                                                                   |
| `src/github-merge-ci.lib.mjs`           | `waitForCommitCI` (3 sleeps) + cancel guard before the timeout round-trip.                                                                    |
| `src/github-merge-ci-wait.lib.mjs`      | `waitForCI`, `waitForBranchCI` (5 sleeps) + cancel guard before the timeout round-trip.                                                       |
| `src/github-merge.lib.mjs`              | `checkPRMergeable` accepts `isCancelled`; UNKNOWN-retry delay aborts early.                                                                   |
| `src/github-merge-repo-actions.lib.mjs` | `waitForAllRepoActions` — found by audit (R2/R8). Had **no** cancellation support and a 5-minute poll.                                        |

`src/github-merge-ci-wait.lib.mjs` is new: `github-merge.lib.mjs` was sitting at exactly the
1500-line ESLint `max-lines` cap, so `waitForCI`/`waitForBranchCI` moved out and are re-exported for
existing importers. This follows the precedent already set by `github-merge-ci.lib.mjs` ("Split from
github-merge.lib.mjs to maintain file size limits"). The resulting import cycle is safe — an
identical one already exists between `github-merge.lib.mjs` and `github-merge-issue-close.lib.mjs`
— and is verified at runtime by `experiments/issue-2072-import-cycle-smoke.mjs`.

### Result

Worst-case cancellation latency drops from **5 minutes to ~100ms**, across every stage.

## Reproducible example

Before the fix, with the uninterruptible sleep in place:

```js
const processor = new MergeQueueProcessor({ owner: 'o', repo: 'r' });
setTimeout(() => processor.cancel(), 150);
const t = Date.now();
await processor.sleep(30_000);
console.log(Date.now() - t); // before: ~30000   after: ~150
```

This is encoded as a real regression test in `tests/test-merge-cancel-latency-2072.mjs`, which
measures **elapsed wall-clock time** rather than grepping the source — the specific weakness that
let this bug through #1588. It covers the primitive, `processor.sleep`, the `waitForPRReady`
5-minute case from the screenshot, and the cancelled-mergeability-check path.

The tests were verified to genuinely fail against the pre-fix code: restoring the raw
`setTimeout` sleep makes the `sleep aborts on cancel` case sleep the full 30 seconds, and makes the
`waitForPRReady` case hang on its 5-minute poll interval until the test runner times out.

## Existing components and prior art

- **`src/interruptible-sleep.lib.mjs` (in-repo, #1574/#1823)** — the closest existing component, and
  the one reused. It already solved "don't block on a timer when a signal arrives"; #2072 is the
  same problem with a different trigger (a flag instead of a signal), so `cancellableSleep` was
  added there and composed with it rather than duplicating the logic.
- **`AbortController` / `AbortSignal` (Node.js core, web standard)** — the idiomatic modern answer.
  `timers/promises.setTimeout(ms, value, { signal })` clears the timer and rejects with `AbortError`
  the instant the signal fires, giving true 0ms latency with no polling. This would be a cleaner
  design than a 100ms step loop.

  It was **not** adopted here, deliberately. The codebase's cancellation contract is already a
  synchronous `isCancelled()` predicate plus a `processor.isCancelled` boolean, threaded through
  many call sites and stubbed by several test suites. Switching to signal-based cancellation means
  changing that contract everywhere and converting abort into a rejection path that every wait would
  need to catch — a large refactor with real regression risk, to buy ~100ms on an operation whose
  poll intervals are 30s–5min. The step loop reuses the existing contract and existing test seams.

  Recorded as the natural follow-up if cancellation is ever reworked: adopt `AbortSignal` end to
  end, and `cancellableSleep` becomes a thin wrapper over `timers/promises.setTimeout`.

- **`p-cancelable`, `delay` (npm)** — solve the same shape (cancellable promises / abortable delays).
  Not worth a dependency: the in-repo primitive is ~15 lines and must integrate with the existing
  SIGINT handling anyway.

Sources: [Using AbortSignal in Node.js (OpenJS Foundation)](https://openjsf.org/blog/using-abortsignal-in-node-js),
[Node.js Timers documentation](https://nodejs.org/api/timers.html),
[Managing Asynchronous Operations in Node.js with AbortController (AppSignal)](https://blog.appsignal.com/2025/02/12/managing-asynchronous-operations-in-nodejs-with-abortcontroller.html),
[AbortSignal (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal).

## Upstream issues

**None filed.** Per R7, this was checked rather than assumed. The root cause is entirely within this
repository's own wait loops — an uninterruptible `setTimeout` in code we own. No third-party library
misbehaved: `gh`, Node's timers, and Telegram's API all behaved as documented. There is no upstream
project with a defect to report, so filing an issue anywhere would be noise.

## Lessons

1. **A cancellation check is worthless if it isn't reachable.** `isCancelled()` was present, correct,
   and unreachable for up to 5 minutes at a time. Presence of the check says nothing about latency.
2. **Test the property, not the source text.** `source.includes('isCancelled')` passed throughout the
   bug's entire life. Asserting on elapsed time would have caught it on day one.
3. **Make the safe behaviour the default, not an opt-in.** #1807 added a _second_ sleep helper; the
   uncancellable one stayed the path of least resistance, so the bug class survived. Fixing the
   primitive fixes the call sites that exist and the ones not yet written.

## Files in this case study

- `README.md` — this analysis.
- `screenshot.png` — the reported evidence: "🛑 Cancelling..." shown while the target-branch CI wait
  is still counting up (0m 38s).
- `data/issue-2072.json` — the issue as filed (body, metadata; no comments).
