# Issue 2017: Immediate Solve Starts Bypassed Startup Pacing

## Summary

Issue #2017 reported two Telegram `/codex` tasks that moved to `Executing...`
at the same visible time in the issue screenshot. This violated the requirement
introduced by PR #2016: `MIN_START_INTERVAL_MS` must be a global minimum interval
between all task starts, including starts that do not go through a queued
consumer wait.

The root cause was the Telegram `/solve` fast path. When no queued item existed
for a tool, the handler called `executeAndUpdateMessage()` directly. Queued
starts recorded `lastStartTime`, but direct starts did not, so a second
immediate command could observe an unchanged start timestamp and launch without
waiting.

The fix adds an atomic queue start reservation and makes direct Telegram starts
use it. Direct starts now consume the same global pacing slot as queued starts,
and overlapping direct start attempts are serialized before checking
`MIN_START_INTERVAL_MS`.

## Timeline

- 2026-07-05 21:29:25Z: PR #2016, "Fix Docker OOM reporting and queue startup
  pacing", was merged. It added global queue startup pacing for queued consumer
  starts.
- 2026-07-07 08:25:56Z: Issue #2017 was opened with a screenshot showing two
  `/codex` tasks both marked `Executing...` at 1:54 PM.
- 2026-07-07: The issue data, PR metadata, screenshot, local test logs, and
  related PR metadata were preserved under this case-study directory.
- 2026-07-07: A regression test was added that failed before the fix because
  direct-start reservation behavior did not exist.
- 2026-07-07: The direct-start path was changed to reserve a queue start slot
  before launching immediately.

## Preserved Data

- `raw-data/issue-2017.json`: issue metadata and body.
- `raw-data/issue-2017-comments.json`: issue comments. The issue had no
  comments at investigation time.
- `raw-data/pr-2018.json`: current PR metadata.
- `raw-data/pr-2018-review-comments.json`: PR inline review comments. None were
  present at investigation time.
- `raw-data/pr-2018-conversation-comments.json`: PR conversation comments. None
  were present at investigation time.
- `raw-data/pr-2018-reviews.json`: PR reviews. None were present at
  investigation time.
- `raw-data/pr-2016.json`: metadata for the related merged PR that introduced
  the original queue pacing work.
- `raw-data/pr-2016-files.txt`: file list for PR #2016.
- `images/issue-2017-screenshot.png`: downloaded issue screenshot, verified as
  PNG data before inspection.
- `raw-data/test-issue-2017-before-fix.log`: failing focused regression before
  implementation.
- `raw-data/test-issue-2017-after-fix.log`: passing focused regression after
  implementation.
- `raw-data/solve-queue.log` and `raw-data/solve-queue-tool-tracking.log`:
  passing related queue test logs.
- `raw-data/npm-test.log`: full default test suite log.
- `raw-data/npm-ci.log`, `raw-data/lint-touched.log`,
  `raw-data/prettier-check.log`, and
  `raw-data/check-file-line-limits-after-fix.log`: install and static check
  logs.
- `raw-data/test-telegram-solve-queue.log`: exploratory log for a legacy test
  file marked `@hive-mind-test-suite needs-triage`. It still fails for an
  unrelated missing `await` in that test and is not part of the default suite.

## Requirements

1. Preserve the issue data, comments, screenshot, related PR information, and
   verification logs under `docs/case-studies/issue-2017`.
2. Reconstruct the event sequence and identify why two tasks could start
   immediately.
3. Apply `MIN_START_INTERVAL_MS` no matter whether tasks are currently executing
   or queued.
4. Ensure the interval is global, so metrics and resource pressure have time to
   settle between task starts.
5. Search for known components or libraries that solve similar rate-limiting
   and pacing problems.
6. Add a reproducing automated test.
7. Fix every affected code path in this repository.
8. Run local verification and update the pull request with the result.

## Findings

`SolveQueue.canStartCommand()` already checked both resource limits and
`lastStartTime`. `SolveQueue.runConsumer()` also recorded start time before
launching a queued command. That meant queued starts were paced.

The Telegram `/solve` handler had a separate fast path:

1. It checked whether the command could start.
2. If the target tool had no queued items, it launched the command directly.
3. That path skipped `runConsumer()` and did not update `lastStartTime`.

The bypass was enough to reproduce the issue without any host-resource signal:
after one direct start, another direct start could still see the previous global
start timestamp and pass the interval check.

There was also a concurrency edge case. If two Telegram commands reach the fast
path at the same time, both can read the same old `lastStartTime` unless the
reservation itself is serialized.

No evidence pointed to an external project bug. This was an internal queue
contract gap between the Telegram fast path and the queued consumer path.

## Existing Components

Existing Node rate-limiting libraries solve adjacent problems:

- Bottleneck supports `minTime`, `maxConcurrent`, and reservoirs for spreading
  scheduled jobs over time:
  `https://github.com/SGrondin/bottleneck`
- p-queue supports interval-based rate limiting with `intervalCap` and
  `interval`:
  `https://www.npmjs.com/package/p-queue`

Those libraries are useful references, but this fix keeps the implementation
inside the existing `SolveQueue` abstraction. The repository already had queue
state, resource checks, tool-specific counts, and Telegram progress callbacks;
adding an internal reservation helper was the smaller and safer change.

## Root Cause

The immediate Telegram start path had no single operation that both checked
eligibility and recorded the start. Queued starts used `runConsumer()` as that
single operation; direct starts only called `canStartCommand()`.

Because `canStartCommand()` is read-only, it could not protect the global start
interval once the caller decided to bypass the queue.

## Solution

The implementation adds `reserveStartSlotForQueue()` and exposes it through
`SolveQueue.reserveStartSlot()`.

The reservation helper:

- serializes overlapping reservations per queue instance;
- calls the existing `canStartCommand()` logic;
- records the global and per-tool start timestamp only when the command may
  start;
- returns the usual check result with `startReserved` metadata.

`SolveQueue.runConsumer()` now records starts through `recordStart()`, so queued
and direct starts share the same write path.

The Telegram `/solve` handler now:

- uses `reserveStartSlot()` only when there are no pending queue items;
- launches immediately only when `check.startReserved` is true;
- otherwise enqueues the command and lets the queue consumer enforce pacing.

## Verification

Before the fix, the focused regression failed because
`queue.reserveStartSlot()` did not exist. The failure is saved in
`raw-data/test-issue-2017-before-fix.log`.

After the fix:

- `node tests/test-issue-2015-queue-stability.mjs` passed with 9 tests and 24
  assertions, including direct-start and concurrent reservation coverage.
- `node tests/solve-queue.test.mjs` passed with 71 assertions.
- `node tests/solve-queue-tool-tracking.test.mjs` passed with 11 assertions.
- `bash scripts/check-file-line-limits.sh` passed.
- `npm run lint -- --no-warn-ignored src/telegram-solve-queue.lib.mjs src/telegram-bot.mjs src/queue-start-reservation.lib.mjs`
  passed.
- `npx prettier --check` for the touched source, test, and raw JSON artifacts
  passed.
- `npm test` passed all 305 selected default test files.

Local `npm ci` emitted expected engine warnings because this workspace runs
Node 20.20.2 while the package declares Node `>=24.0.0`.

## Source Links

- Hive Mind issue #2017:
  `https://github.com/link-assistant/hive-mind/issues/2017`
- Hive Mind PR #2018:
  `https://github.com/link-assistant/hive-mind/pull/2018`
- Related Hive Mind PR #2016:
  `https://github.com/link-assistant/hive-mind/pull/2016`
- Bottleneck:
  `https://github.com/SGrondin/bottleneck`
- p-queue:
  `https://www.npmjs.com/package/p-queue`
