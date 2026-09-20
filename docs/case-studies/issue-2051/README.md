# Issue 2051: Ensure global First-In-First-Out (FIFO) across all tool queues

## Summary

Issue #2051 reports that, in the Telegram solve queue, **multiple `/codex` tasks
run while a single `/claude` task keeps waiting**, and asks us to double-check
that dequeue order across the separate per-tool queues really uses task
_creation time_ to decide who leaves the queue first, so that a lone task does
not wait longer than necessary. The reporter is explicit that they may be wrong
about the algorithm and that the **minimum start interval stays the same** — the
goal is to _verify_ correct global ordering and, if the current data is
insufficient to prove a root cause, to **add debug output / verbose mode** so the
next occurrence can be diagnosed.

This case study reconstructs the queue's ordering algorithm, evaluates it against
the reported symptom, identifies the root cause, and adds the missing
observability. The conclusion is that the cross-queue selection is already
**global-FIFO-correct by design** (the oldest _startable_ task always wins the
single, globally-paced startup slot), but the system previously had **no way to
observe why an older task was skipped**. We added a dequeue-decision diagnostic —
including an always-on "FIFO queue-jump" line that names the exact reason the
older task is blocked — so operators can distinguish a legitimate resource/limit
block from an ordering defect.

## Preserved data

- `logs/issue-2051.json`: the issue body, author, labels, and comments as
  fetched from the GitHub API at the time of investigation.
- `logs/issue-2051-comments.json`: issue comments (empty — the issue had no
  comments when this study was written).

## Requirements (extracted from the issue)

1. Double-check that dequeue ordering across the different per-tool queues uses
   task time to decide which task leaves the queue first (global FIFO).
2. Ensure correct order of dequeue so a single queued task does not wait too
   long; minimize user wait.
3. Keep the minimum start interval unchanged.
4. Download all logs/data about the issue into
   `docs/case-studies/issue-2051/`.
5. Produce a deep case-study analysis: timeline/sequence of events, full list of
   requirements, root cause of each problem, proposed solutions/plans, and a
   survey of existing components/libraries that solve a similar problem.
6. Search online for additional relevant facts/data.
7. If there is not enough data to find the actual root cause, add debug output
   and a verbose mode so the root cause can be found on the next iteration.
8. If the issue relates to another repository/project where issues can be filed,
   report it there with a reproducible example, workaround, and fix suggestion.
9. Apply the fix across the entire codebase (fix every place if it occurs in
   multiple places).

## Sequence of events / timeline

Because the issue arrived without attached logs, the timeline below is
reconstructed from the code path a queued task travels, using the reported
symptom (many `/codex` runs vs. one waiting `/claude`).

1. Users enqueue several `/codex` tasks and one `/claude` task via the Telegram
   bot. Each task is appended to its **tool-specific** queue
   (`this.queues[tool]`), preserving per-tool FIFO order
   (`enqueue()` → `toolQueue.push(item)`).
2. The consumer loop (`runConsumer`) wakes on each poll
   (`CONSUMER_POLL_INTERVAL_MS`, default 60s) and calls `findStartableItems()`.
3. `findStartableItems()` inspects the **head** of every tool queue, asks
   `canStartCommand({ tool })` whether it may start, collects the startable
   heads, sorts them by `createdAt`, and returns **only the oldest** (`slice(0, 1)`).
4. The single global startup interval (`MIN_START_INTERVAL_MS`, ≥ 10 min, issue
   #2015) then blocks _every_ tool until it elapses, so at most one task starts
   per interval regardless of tool.
5. If the `/claude` head is blocked by a Claude-specific limit (5-hour session
   or weekly usage over threshold, `dequeue-one-at-a-time` while a Claude task is
   already processing) or by system resources, it is **not startable**, so the
   oldest _startable_ head — a `/codex` task — wins the slot instead. Repeat, and
   several `/codex` tasks run while the `/claude` task keeps waiting.

## Root-cause analysis

**The cross-queue ordering is already correct by design.** Global FIFO is
implemented in `findStartableItems()` (added for issue #2015): all tool-queue
heads that can start are gathered, sorted by `createdAt`, and the oldest is
selected for the one globally-paced startup slot. A younger task from another
tool queue is only chosen when the older task **cannot start right now**.

The reported symptom — many `/codex` runs while one `/claude` waits — is the
_expected_ outcome when the `/claude` head is genuinely blocked. Claude limits
(5-hour session ≥ 65% with `dequeue-one-at-a-time`, weekly ≥ 97%) and
system-resource thresholds apply only to the tasks they govern, so blocking a
`/codex` task merely because an unrelated, currently-unstartable `/claude` task
is older would _increase_ total user wait — the opposite of the issue's goal.
Letting the younger startable task proceed is the behavior that "minimizes wait
for the users."

**The actual gap was observability, not ordering.** Before this change the queue
logged nothing about _why_ the older task was skipped, so it was impossible to
tell from production data whether a long-waiting `/claude` task was:

- blocked legitimately (Claude 5-hour/weekly limit, RAM/CPU/disk threshold, or
  the global min-start interval), or
- skipped due to an ordering defect.

Without that data the issue's own core question — "may be our algorithm is
wrong, we should double check" — cannot be answered from a live incident. Per
requirement 7, the fix adds that data.

## Fix / changes in this PR

1. **Dequeue-decision diagnostics** (`src/telegram-solve-queue.lib.mjs`,
   `findStartableItems()` + new `logDequeueDecision()`):
   - In **verbose** mode, log a per-tool head snapshot each cycle: how long each
     head has waited, whether it is `STARTABLE`, and — if not — the exact
     blocking reasons (min-interval, Claude/Codex limits, RAM/CPU/disk,
     one-at-a-time), plus which task was selected.
   - **Always-on** (independent of verbose), emit a concise **`FIFO queue-jump`**
     line whenever the globally-oldest queued head is skipped in favor of a
     younger startable head, naming the older task's URL, how long it has waited,
     and the reason it is blocked. This is the precise data issue #2051 needs to
     confirm whether a long wait is legitimate.
   - The queue-jump notice is **deduplicated** by `(task id + block reasons)` so a
     task that stays blocked across many 60s polls is reported only when its
     situation changes — avoiding log spam.
   - The most recent jump is also recorded on `stats.lastQueueJump` (surfaced via
     `getStats()`) and counted under `throttleReasons.fifo_queue_jump`.
2. **Regression test** (`tests/test-issue-2051-fifo-diagnostics.mjs`): asserts
   the oldest startable head still wins (FIFO preserved), that a queue-jump is
   recorded with the block reason when the older head is blocked, and that the
   always-on notice is deduplicated across repeated cycles.

No behavioral change to ordering, pacing, or the minimum start interval
(requirement 3) — the selection algorithm is untouched; only observability was
added.

## Existing components / libraries considered

- **Node `worker_threads` / `p-queue` / `better-queue`**: general concurrency
  queues with priority and rate limiting. They do not model the domain
  constraints here (per-tool API limits, host RAM/CPU/disk thresholds, a global
  minimum spacing between _starts_), so adopting one would not simplify the
  resource-aware `canStartCommand()` logic. The existing bespoke queue is the
  right fit; the missing piece was diagnostics, which no library provides.
- **Priority-queue by timestamp**: the current sort-by-`createdAt` over startable
  heads is already an O(n) equivalent for the small number of tool queues (5);
  a heap adds no value at this scale.

## Verification

- `node tests/test-issue-2051-fifo-diagnostics.mjs` — new test, passes.
- `node tests/test-issue-2015-queue-stability.mjs` — global pacing + FIFO,
  passes.
- `node tests/solve-queue.test.mjs` — full solve-queue suite (71 tests), passes.

## Upstream / related repositories

The queue logic lives entirely in this repository (`link-assistant/hive-mind`);
the ordering and limits are hive-mind concerns, not `link-foundation/start`
behavior. No upstream issue is warranted for the ordering question. If future
diagnostics reveal that `$ --status`/`start-command` under-reports running
sessions (feeding `canStartCommand()` a stale process count and causing a task
to appear startable/blocked incorrectly), that would be an upstream `start`
issue — but the current data does not show that.

## How to reproduce / use the new diagnostics

1. Run the Telegram bot with verbose queue logging enabled to see the per-cycle
   head snapshot (`[VERBOSE] /queue: Dequeue decision ...`).
2. In any environment (verbose or not), when an older task is skipped you will
   see a line like:

   ```
   [solve_queue] FIFO queue-jump: codex task started ahead of an older claude task
   waiting 12m 30s (https://github.com/owner/repo/issues/42) — older task blocked by:
   Claude 5-hour session limit reached
   ```

   which tells you immediately whether the wait is a legitimate limit/resource
   block or an ordering problem to investigate further.
