# Case study: issue #4069 — `/after`, `/enqueue` and `--respect-blockers`

- Issue: https://github.com/link-assistant/hive-mind/issues/4069
- Pull request: https://github.com/link-assistant/hive-mind/pull/4070
- Previous work this builds on: multi-link batch (#4067, PR #4068) and `/hive` issue relations
  (#2615, PR #2616)
- Raw data collected for this study: [`raw/`](raw/) (issue, its comments — none at the time of
  writing — PR #4068, PR #4070 and the related issues #1193, #2615, #2890, #3911, #4067)

## 1. The issue

> We should be able to do /enqueue and /after commands, which will only execute one task, after the
> task we reply to finished.
>
> It should use some of /stop, /log, /watch mechanics, yet work as /solve, /claude, /codex
> commands.
>
> So we reply by UUID or issue/pull request urls, and put that task in queue with a condition that
> our new task may be only started after selected task finishes successfully, on fail the pending
> task also should fail, as we treat /after as only on success requirement.
>
> […] We also should add `--respect-blockers` for /solve, /claude, /codex commands, that will mean,
> that if the not all blockers are resolved in GitHub blockers relationships between tasks, we
> don't allow to start that task on its own, but if we have blockers in the queue already, we queue
> our new task like `/after` the blockers (specified on GitHub).
>
> Also in previous https://github.com/link-assistant/hive-mind/pull/4068 we should
> `--respect-blockers` by default, and execute all batch issues in such and order, that we execute
> unblocked already tasks first.
>
> […] Also in /hive command by default, we also should respect order of
> blockers/dependencies/child/parent relationships on GitHub when executed in any specified
> concurrency.
>
> We should also treat not only direct blockers, but also sub-issues as blockers for parent issue.
>
> […] `--respect-blockers` for /solve, /claude, /codex commands is experimental by default (meaning
> it is turned off), but in all other places were it may be important to handle relationships
> between issues, we should enable it by default.

The full text is in [`raw/issue-4069.json`](raw/issue-4069.json).

## 2. Requirements

| #   | Requirement                                                                                                                             | Where it is addressed                                                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `/enqueue` and `/after` run exactly one task after the task they reply to (or name) has finished                                        | `src/telegram-after-command.lib.mjs` (parsing), `src/telegram-solve-dependencies.lib.mjs` (`SolveDependencyTracker`), `SolveQueue.enqueueAfter` in `src/telegram-solve-queue.lib.mjs`                                                                                             |
| R1a | The awaited task is found the way `/stop`, `/log`, `/watch` find it: by UUID or by issue/pull request link, in the command or the reply | `parseDependencyCommand` reuses `extractSessionIdFromText` (`/log`) and the link helpers of the batch; `resolveDependencyTarget` searches the queue, then `findTrackedSessionByIdentifier` (new, `src/session-monitor.queries.lib.mjs`) and `findStoppableSessionByUrl` (`/stop`) |
| R1b | Otherwise they behave like `/solve`, `/claude`, `/codex`                                                                                | They are registered next to `SOLVE_COMMAND_NAMES` and go through the same `handleSolveCommand` → `launchSolveTarget` path: same validation, locked options, isolation, limits and queue                                                                                           |
| R2  | `/after` is success-only: when the awaited task fails the pending task fails too                                                        | `DEPENDENCY_MODE.SUCCESS`; `classifyDependencyOutcome` (killed, failed and cancelled count as failures, "no changes" — #3211/#3215 — counts as success); `failWaitingItem` edits the queued message to "rejected"; failures cascade through chains                                |
| R2b | `/enqueue` starts after the awaited task finishes, whatever the result                                                                  | `DEPENDENCY_MODE.FINISH`                                                                                                                                                                                                                                                          |
| R3  | `--respect-blockers` for the solve commands, experimental and off by default                                                            | `extractRespectBlockersFlag` (also `--no-respect-blockers`, `=true/false`), `planBlockerWait` in `src/telegram-solve-blockers.lib.mjs`; default from `--solve-respect-blockers` / `TELEGRAM_SOLVE_RESPECT_BLOCKERS` (`false`)                                                     |
| R3a | Unresolved GitHub blockers that are not queued: the task may not start on its own                                                       | `planBlockerWait` returns `reject` with the missing blockers; the user gets "it is blocked by … which is neither queued nor running"                                                                                                                                              |
| R3b | Blockers already queued or running: queue the task like `/after` those blockers                                                         | `planBlockerWait` returns `wait` with one `SUCCESS` target per blocker; `planSolveLaunchWait` merges them with an `/after`/`/enqueue` target                                                                                                                                      |
| R4  | The multi-link batch of PR #4068 respects blockers by default and runs unblocked tasks first                                            | `prepareBatchBlockers` + `orderBatchByBlockers` (ready issues first in `/hive` order, then each blocked one after its in-batch blockers, cycles last); `--batch-respect-blockers` / `TELEGRAM_BATCH_RESPECT_BLOCKERS` (`true`); `--no-respect-blockers` per command               |
| R5  | `/hive` respects blockers, dependencies and parent/child relations by default at any concurrency                                        | Already done by #2615: `--respect-issue-relations` defaults to `true` (`src/hive.config.lib.mjs`), `src/hive.mjs` uses `argv.respectIssueRelations !== false`; verified with `tests/hive-issue-relations-2615.test.mjs` (passes)                                                  |
| R6  | Sub-issues are blockers of their parent                                                                                                 | The same `getWaitReasons` as `/hive`: open sub-issues make the parent wait, and a child inherits the open blockers of its ancestors                                                                                                                                               |
| R7  | Double-check every related place; configurable, with the issue's vision as the default                                                  | §5 below; `/hive` on (#2615), batch on, single solve off (experimental), per-command override in both directions                                                                                                                                                                  |
| R8  | Highlight related open issues; close only the ones with the same vision                                                                 | §8: #3911, #2890 and #1193 are related but have a different scope, so the PR lists them without a closing keyword                                                                                                                                                                 |
| R9  | Fix bugs on this topic                                                                                                                  | §6: duplicate detection rejected a task for the link it waits for; waiting items were invisible to `/queue`, `findByUrl` and cancellation; a kill-recovery restart would have looked like a failure                                                                               |
| R10 | Case study with data, online research, requirements, solution plans and existing libraries                                              | This document and [`raw/`](raw/)                                                                                                                                                                                                                                                  |

## 3. How the bot behaved before

- There was no way to say "start this after that". A user who wanted an order had to watch the chat
  and send the next `/solve` by hand when the previous one finished, or start everything at once and
  accept pull requests built on unmerged prerequisites.
- `/solve` (and its aliases) knew nothing about GitHub relations: a parent issue with open
  sub-issues, or an issue "blocked by" another open issue, started immediately.
- The multi-link batch added in #4067 / PR #4068 started the links in the order they were written.
  With `issue B blocked by issue A` written as `/solve B A`, B was queued first and could start
  first.
- `/hive` was already correct: since #2615 it reads the relations, queues only the ready frontier and
  parents after their children (`hive.issue-relations.lib.mjs`).
- The solve queue had only tool queues (`queues[tool]`) and the `processing` map. An item at the head
  of a tool queue holds back every item behind it, so a long wait could not simply be modelled as a
  queued item with a condition.

## 4. Design

### 4.1 Commands

```
/after <task-link> [options]                      (reply to the awaited task's message)
/after <uuid|awaited-link> <task-link> [options]
/after [options]                                  (reply: run the same link again afterwards)
/enqueue …                                        (same forms)
```

- The awaited task is resolved in this order (`resolveDependencyTarget`):
  1. a solve queue item for the link or session (queued, waiting, starting) — the task has not
     started yet, so the wait follows the item and then its session;
  2. a tracked session found by UUID: the tracking key, the start-command session id, the execution
     UUID or the root of a kill-recovery chain (`findTrackedSessionByIdentifier`, the same ids
     `/log` and `/watch` accept);
  3. a running session for the link (`findStoppableSessionByUrl`, the `/stop` lookup).
- When the awaited task already finished, `/after` checks how: success starts the new task at once
  (with a notice), a failure refuses it (as the dependency would fail immediately). `/enqueue`
  starts it at once.
- An unknown UUID or link is refused with a usage message.
- The new task's arguments are passed to solve exactly as `/solve` would pass them; the tool is
  chosen with `--tool` as for `/solve` (Claude by default).

### 4.2 Waiting items

`SolveQueue.enqueueAfter` creates a normal `SolveQueueItem` with status `waiting` and registers it in
the `SolveDependencyTracker` (`queue.dependencies`), **outside** the tool queues. Each entry has a
`mode` and a list of targets (a queue item, a session, or both as the item starts). The tracker:

- reacts to `recordSessionCompletion` events (the same listener that records session outcomes for
  `/queue`, #2823); a completion with `supersededBy` (kill recovery, #2301) is ignored because the
  work continues in the recovery session;
- reacts to launch failures and cancellations;
- rechecks every 30 s (`DEPENDENCY_RECONCILE_INTERVAL_MS`, an unref'd timer that only runs while
  something waits) and treats a target that is neither active nor finished for 2 minutes as finished
  with an unknown result (`DEPENDENCY_MISSING_GRACE_MS`), so a lost event cannot hold a task forever;
- loops until stable, so chains (`A → B → C`) release or fail in one pass.

When every target is done the item is pushed to its tool queue and starts like any other queued
`/solve`: the same limits, ordering and start message. Its chat message is edited to "▶️ The awaited
tasks are done". In `SUCCESS` mode a failed target fails the item with "an awaited task did not
succeed: …"; anything waiting for that item fails in turn.

`/queue` shows a "Waiting for other tasks (N)" section; `getPendingItems`, `findByUrl` and
`cancel` (the queue's cancel button) include waiting items. Cancelling a waiting item counts as a
failure for `/after` tasks waiting on it and as finished for `/enqueue` tasks.

### 4.3 Blockers

`planBlockerWait` reads the issue relations with the same fetcher as `/hive`
(`createIssueRelationsFetcher`, GraphQL `blockedBy`, `subIssues`, `parent`) and the same rules
(`getWaitReasons`):

| Situation                                                    | Result                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------- |
| No open blockers, no open sub-issues                         | start as before                                                   |
| Every open blocker / sub-issue is queued, waiting or running | wait for all of them in `SUCCESS` mode (like `/after`)            |
| An open blocker / sub-issue is neither queued nor running    | refuse, listing what is missing                                   |
| The link is a pull request, or the relations cannot be read  | start as before (missing information never blocks, as in `/hive`) |

An `/after`/`/enqueue` target and blocker targets can be combined; each target keeps its own mode.

### 4.4 Batch ordering

`prepareBatchBlockers` reads the relations of all links of a batch once and `orderBatchByBlockers`
orders them: ready issues first, in the `/hive` order (the ones that unblock the most first), then
each blocked issue after the batch links it waits for (Kahn's algorithm over the in-batch edges),
dependency cycles last. Each link is then launched with `respectBlockers` and the relations already
read, so by the time a blocked link is launched its blockers are queued and it waits for them. Links
whose blockers are outside the batch and not queued are refused and reported in the batch summary.

### 4.5 Options

| Option                                                         | Default | Meaning                                                                                                |
| -------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `--respect-blockers` / `--no-respect-blockers` (in a command)  | —       | Turns blocker handling on or off for that one command                                                  |
| `--solve-respect-blockers` / `TELEGRAM_SOLVE_RESPECT_BLOCKERS` | `false` | Default for a single-link `/solve`, `/claude`, `/codex`, … and for `/after`, `/enqueue` (experimental) |
| `--batch-respect-blockers` / `TELEGRAM_BATCH_RESPECT_BLOCKERS` | `true`  | Default for a solve command with several links                                                         |
| `hive --respect-issue-relations` (#2615)                       | `true`  | `/hive` and the `hive` CLI                                                                             |

## 5. Other places checked

| Place                                                   | Handles relations?                     | Verdict                                                                                           |
| ------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `/hive`, `hive` CLI                                     | yes, by default (#2615)                | correct at any `--concurrency`; covered by `tests/hive-issue-relations-2615.test.mjs`             |
| Multi-link `/solve` batch (#4067)                       | now yes, by default                    | this PR                                                                                           |
| Single-link `/solve`, `/claude`, `/codex`, …            | now with `--respect-blockers` (opt-in) | this PR; off by default as the issue asks                                                         |
| `/after`, `/enqueue`                                    | explicit dependency; blockers opt-in   | this PR                                                                                           |
| `/task`, `/split`, `/fix`, `/organize`                  | no                                     | they create or reorganise issues and do not pick issues to solve, so there is no order to respect |
| Formal AI drafts created from issues                    | no                                     | tracked separately as #3911 (a different path: reuse the `/hive` gate for drafts)                 |
| Post-merge parent closing (`--close-completed-parents`) | yes                                    | already closes parents only when their sub-issues are done (#3354–#3359); unchanged               |

## 6. Bugs found and fixed on the way

1. **Duplicate detection vs. waiting on the same link.** `launchSolveTarget` refused any task whose
   link was already queued or running (#1080, #1567). `/after <uuid>` without a new link ("run the
   same issue again after this one") was therefore always refused. The check now ignores the items
   and sessions the new task waits for (`findLaunchConflict`, `isAwaitedTaskUrl`) and still refuses
   real duplicates, including a second waiting task for the same link.
2. **Waiting items had to be visible everywhere the queue is.** `findByUrl`, `getPendingItems`,
   `getStats` (`waitingForTasks`), `/queue` and `cancel` now include them; without this a waiting
   task could be duplicated or could not be cancelled.
3. **Kill recovery is not a failure.** A session killed by the OOM/limit monitor and continued by a
   recovery session (#2301) emits a completion with `supersededBy`; it is ignored, and the waiting
   task follows the recovery session (matched by `rootSessionName` / `killRecoveryOfSession`).
4. **"No changes" is a success.** A solve that exits with code 2 because there was nothing to change
   (#3211) is not a failure (#3215), so `/after` treats it as a success.

## 7. Existing solutions and libraries

| System                       | Dependency model                                                                                                                                                                                                | Mapping to this issue                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| BullMQ flows                 | Parent jobs wait for children; `failParentOnFailure` fails the parent when a child fails, `continueParentOnFailure` / `ignoreDependencyOnFailure` let it go on (https://docs.bullmq.io/guide/flows/fail-parent) | `/after` ≈ `failParentOnFailure`; `/enqueue` ≈ continue/ignore on failure        |
| Apache Airflow trigger rules | `all_success` (default) runs a task only when every upstream task succeeded; `all_done` when they all finished in any state (https://www.astronomer.io/docs/learn/airflow-trigger-rules)                        | `/after` and blockers = `all_success`; `/enqueue` = `all_done`                   |
| Celery canvas                | `chain` runs tasks in order and stops at the first failure; `link_error` / `on_error` run callbacks on failure (https://docs.celeryq.dev/en/main/userguide/canvas.html)                                         | Hand-built `/after` chains behave like a Celery chain                            |
| GitHub issue dependencies    | REST `GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by` and GraphQL `blockedBy`; sub-issues API (https://docs.github.com/en/rest/issues/issue-dependencies)                              | Source of truth for `--respect-blockers` (GraphQL, the same reader `/hive` uses) |
| p-queue, Bottleneck          | Concurrency, priority and rate limits only; no dependencies between jobs (https://www.npmjs.com/package/p-queue, https://www.npmjs.com/package/bottleneck)                                                      | Not enough on their own; the solve queue already covers this part                |

None of these could be dropped in: the bot's queue has per-tool limits, isolation backends, Telegram
messages and session tracking that live outside a job library, and BullMQ needs Redis. The design
borrows the semantics (success-only vs. finish edges, failure propagation, a reconcile loop for lost
events) and keeps the implementation in the existing queue.

### Solution options considered

| Requirement         | Options                                                                                                                 | Chosen                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Waiting items       | (a) put them in the tool queue with a "not before" flag; (b) a separate waiting area that hands items to the tool queue | (b): (a) would block the head of the queue (or need skip logic in every consumer path) for hours                                        |
| Detecting the end   | (a) poll session state; (b) completion events; (c) both                                                                 | (c): events for speed, a 30 s recheck with a 2-minute grace for lost events and restarts                                                |
| Blockers not queued | (a) queue the blockers automatically; (b) wait until they get queued; (c) refuse                                        | (c): the issue says the task may not start "on its own"; (a) would start work nobody asked for, (b) could wait forever without feedback |
| Batch order         | (a) launch in the written order and let each link wait; (b) sort ready-first, then topological                          | (b): with (a) a blocked link written before its blocker finds the blocker not yet queued and is refused                                 |
| Sub-issues          | (a) only direct `blockedBy`; (b) also open sub-issues and inherited ancestor blockers                                   | (b), shared with `/hive` so both commands agree                                                                                         |

## 8. Related open issues (not closed by this PR)

- **#3911** — reuse `/hive`'s dependency gate for issue-created Formal AI drafts and resume ready work.
  Same relation rules, but a different code path (Formal AI maintenance), so it stays open.
- **#2890** — persist the solve queue and recovery state. Waiting items are kept in memory like the
  rest of the queue, so a bot restart forgets them; persisting them belongs to that issue.
- **#1193** — an orchestrator CLI with an "enqueue solve task" API. `/after` and `/enqueue` are the
  Telegram side of that idea; the CLI is still to be done.
- **#2615** (closed) — `/hive` relations; reused here.

## 9. Known limitations

- Waiting items live in memory (see #2890). After a restart they are gone; the bot does not
  pretend otherwise.
- `--respect-blockers` treats a blocker as resolved only when the GitHub issue is **closed**. A
  blocker whose task finished but whose pull request is not merged yet is reported as "its task
  finished …, but the issue is still open" and the dependent task is refused, which matches the
  `/hive` rule (#2615 R5).
- `tests/test-telegram-solve-queue.mjs` (suite `needs-triage`, not run by default) fails on `main`
  as well, because it calls the async `formatStatus` synchronously; it is unrelated to this change.

## 10. Verification

- `tests/telegram-after-4069.test.mjs` (default suite, 20 tests): parsing, modes, outcome
  classification, tracker (success/finish, per-target modes, kill recovery, missing grace, chains),
  queue integration (`enqueueAfter`, `/queue` section, duplicates, release, cancel cascade),
  blocker planning (sub-issue refusal, queued blocker wait, pull requests, unreadable relations),
  batch ordering and the waiting message.
- Existing suites touching the changed modules (batch #4067, single issue #3108, `/hive` relations
  #2615, queue tests) pass.
- [`examples/issue-4069-after-enqueue.mjs`](../../../examples/issue-4069-after-enqueue.mjs) runs the
  queue, the tracker and the batch ordering with mocks and prints what happens.
