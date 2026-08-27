# Issue #2182: A draft pull request kept an auto-merge task alive for 4½ days

## Summary

A `/claude <issue> --auto-merge` task reported "Processing" for 4d 12h 13m 35s. The work had been finished within nine minutes: the AI fixed the CodeQL failure, pushed `401020c`, and all 31 checks went green. What ran for the remaining four and a half days was the monitoring loop, merging a pull request it was not allowed to merge — 2692 times, every 120 seconds, with the same three lines each time:

```
✅ PR IS MERGEABLE!
🔀 Auto-merging PR...
  ⚠️ Auto-merge failed:      GraphQL: Pull Request is still a draft (mergePullRequest)
   Will continue monitoring...
```

The loop was right that CI was green and wrong about everything else. Four independent defects had to line up for that, and each one of them is enough to keep a task alive forever on its own.

## Problem statement

From the issue (`--status` of the container, taken while it was still running):

```
  status executing
  startTime   "2026-08-22T18:53:30.799Z"
  currentTime "2026-08-27T07:25:02.131Z"
```

![Telegram task](assets/img1.png)
![Telegram queue](assets/img2.png)

The `/queue` view shows `Processing (1): …#141 (▶ 4d 12h 13m 35s)` against `Completed (66)` — one task pinning a queue slot for four days while the rest of the queue drained around it.

## The data

The full run log (65 MB, 102 244 lines) was retrieved from the private log store referenced in the issue. Excerpts that carry the argument are committed under [`log-excerpts/`](log-excerpts/); the full file is deliberately not, because it is 65 MB and contains third-party API payloads.

| Excerpt                                                                                                   | What it shows                                                       |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [`01-start-command-header.log`](log-excerpts/01-start-command-header.log)                                 | the exact command, image `konard/hive-mind-dind:2.12.5`, start time |
| [`02-watch-loop-header.log`](log-excerpts/02-watch-loop-header.log)                                       | the monitoring loop's own banner — note the missing timeout line    |
| [`03-restart-and-draft-conversion.log`](log-excerpts/03-restart-and-draft-conversion.log)                 | the single draft conversion in the entire run                       |
| [`04-check-2-mergeable-then-draft-failure.log`](log-excerpts/04-check-2-mergeable-then-draft-failure.log) | check #2: CI consensus, "PR IS MERGEABLE!", draft merge failure     |
| [`05-check-2693-identical.log`](log-excerpts/05-check-2693-identical.log)                                 | check #2693, 4½ days later, byte-for-byte the same                  |

Counts over the full log, all reproducible with `grep -c`:

| Pattern                                          | Count                                                      |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `🔍 Check #`                                     | 2693                                                       |
| `✅ PR IS MERGEABLE!`                            | 2692                                                       |
| `Pull Request is still a draft`                  | 5384 (2692 × 2: the verbose line and the user-facing line) |
| `is converted to "draft"`                        | 1                                                          |
| `is marked as "ready for review"` (by hive-mind) | 0                                                          |

That last pair is the whole bug in two rows.

## Timeline

All times are from the log; the run's clock is UTC, the `Check #N` lines print local time.

| Time (UTC)          | Event                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-22 18:53:30 | `solve … --auto-merge --tool claude` starts in a detached docker container                                                                                                                                                  |
| 18:55–18:58         | First AI session solves issue #141, opens PR #142 as a draft, then runs `gh pr ready 142` itself                                                                                                                            |
| 18:59:29            | CodeQL posts a review comment: "Incomplete string escaping or encoding"                                                                                                                                                     |
| 19:00:28            | Session ends, logs attached. PR is **ready for review**, CI has 1 failure of 31                                                                                                                                             |
| ~19:00:30           | `--auto-merge` enters `watchUntilMergeable`, initial cooldown 120 s                                                                                                                                                         |
| 19:02:29            | **Check #1** — CI `failure`, `mergeable: true, state: UNSTABLE` → `🔄 RESTART TRIGGERED: CI failures detected (1/5)`                                                                                                        |
| 19:02:43            | `executeToolIteration` converts PR #142 **to draft** (issue #2123 behaviour). This is the last draft transition in the log                                                                                                  |
| 19:02–19:07         | The restart session fixes the CodeQL finding and pushes `401020c`; all 31 checks pass. The session ends — **nothing converts the PR back to ready**                                                                         |
| 19:07:17            | **Check #2** — new commit detected, CI `success`, all four CI mechanisms agree, `mergeable: true, state: CLEAN` → `PR IS MERGEABLE!` → `gh pr merge` fails: _Pull Request is still a draft_ → `Will continue monitoring...` |
| 19:09:40 → 07:23:31 | **Checks #3 … #2693** — identical. 2691 more merge attempts over 4 d 12 h                                                                                                                                                   |
| 2026-08-27 07:09    | Issue #2182 filed; the container is still `executing`                                                                                                                                                                       |

The restart budget was never the safeguard anyone thought it was: `Max restart iterations: 5` bounds AI sessions, and only one was ever used. Nothing bounded the monitoring itself.

## Requirements

Taken verbatim from the issue and tracked individually.

| #   | Requirement                                                               | Where it is addressed                                          |
| --- | ------------------------------------------------------------------------- | -------------------------------------------------------------- |
| R1  | Download all logs and data into `./docs/case-studies/issue-2182`          | this folder: `log-excerpts/`, `assets/`                        |
| R2  | Deep case-study analysis, including searching online for additional facts | this document, [External findings](#external-findings)         |
| R3  | Reconstruct the timeline/sequence of events                               | [Timeline](#timeline)                                          |
| R4  | List each and all requirements from the issue                             | this table                                                     |
| R5  | Find root causes of each problem                                          | [Root causes](#root-causes)                                    |
| R6  | Propose possible solutions and solution plans for each requirement        | [Solutions](#solutions)                                        |
| R7  | Check known existing components/libraries that solve a similar problem    | [Existing components](#existing-components)                    |
| R8  | If data is insufficient, add debug output and verbose mode                | [Diagnostics](#diagnostics)                                    |
| R9  | Report the issue upstream if another repository is involved               | [Upstream](#upstream)                                          |
| R10 | Apply the fix to the entire codebase — every place the problem exists     | [Every merge call site](#every-merge-call-site)                |
| R11 | Plan and execute everything in one pull request                           | [#2183](https://github.com/link-assistant/hive-mind/pull/2183) |

## Root causes

### RC-A — the draft conversion had no counterpart

Issue #2123 made every restart/resume iteration convert the PR to draft, so reviewers can see an AI is working on it. `executeToolIteration` in `src/solve.restart-shared.lib.mjs` got the `ensurePullRequestIsDraft` call; it never got the matching `ensurePullRequestIsReady`. `startWorkSession`/`endWorkSession` are paired correctly, but restart iterations do not go through them — that is exactly why #2123 had to touch `executeToolIteration` in the first place.

So the PR entered the loop as a draft and stayed one. The AI session that pushed the fix had no reason to mark it ready: from its point of view it had already done that in the first session.

### RC-B — a draft pull request reports itself as mergeable

`checkPRMergeable` asked for `mergeable,mergeStateStatus` and returned `mergeable = (pr.mergeable === 'MERGEABLE')`. For PR #142 that answered `MERGEABLE` / `CLEAN` on all 2692 checks — while the PR was a draft.

This contradicts the documented meaning of `mergeStateStatus: DRAFT` ("the merge is blocked due to the pull request being a draft"). It reproduces on demand: PR #2183 of this repository, while a draft, answers

```
$ gh api graphql -f query='{repository(owner:"link-assistant",name:"hive-mind"){pullRequest(number:2183){isDraft mergeable mergeStateStatus}}}'
{"data":{"repository":{"pullRequest":{"isDraft":true,"mergeable":"MERGEABLE","mergeStateStatus":"UNSTABLE"}}}}
```

`UNSTABLE` there because CI was still running; with CI green the same query answers `CLEAN`. In neither case does `DRAFT` appear. The draft flag is only ever visible in `isDraft`, which the query did not ask for.

`mergeStateStatus` is also documented as computed on a background job, and GitHub's own note is that `DRAFT` is being deprecated in favour of `isDraft` — which is the field that is actually reliable here.

### RC-C — every merge failure was treated as retryable

`mergePullRequest` returned `{ success: false, error }` and `watchUntilMergeable` printed:

```js
await log(formatAligned('⚠️', 'Auto-merge failed:', mergeResult.error, 2), { level: 'warning' });
await log(formatAligned('', 'Will continue monitoring...', '', 2));
```

There was no third option. "Pull request is closed", "Resource not accessible by integration" and "still a draft" all produced the same sentence and the same 120-second wait. Nothing counted failures, so no number of them ever meant anything.

### RC-D — the monitoring loop had no wall-clock bound

`watchUntilMergeable` bounded restart iterations (`--auto-restart-max-iterations`, default 5) and limit resumes, but not time. A loop that never restarts and never merges is unbounded, which is precisely the state PR #142 reached at check #2. The container had `keepAlive: false` and would have exited the moment the loop returned; it simply never did.

## Solutions

### Fixes implemented in [#2183](https://github.com/link-assistant/hive-mind/pull/2183)

| Root cause | Fix                                                                                                                                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RC-A       | `executeToolIteration` calls `ensurePullRequestIsReady` after the tool run, mirroring the draft conversion it already did on entry                                                                                                                        |
| RC-B       | `checkPRMergeable` requests `isDraft` and delegates the verdict to `evaluatePullRequestMergeability()`, which never reports a draft as mergeable and returns `isDraft` to the caller                                                                      |
| RC-C       | `classifyMergeError()` maps a failure to a category with `terminal`/`recoverable` flags and a resolution hint. Recoverable draft failures self-heal (bounded); terminal ones stop the run; anything else stops after `MAX_CONSECUTIVE_MERGE_FAILURES = 3` |
| RC-D       | `--auto-restart-until-mergeable-timeout-hours` (default 24, `0` = unlimited) ends the loop with a `watch_timeout` report                                                                                                                                  |

Both decisions live in one pure module, `src/merge-error-classification.lib.mjs`, so the three merge call sites cannot drift apart. It has no I/O, which is what makes the regression test able to assert on the exact API payload observed in production.

Defence in depth was the point: any one of the four fixes alone would have ended this run. RC-A stops it happening, RC-B notices it, RC-C recovers from it, RC-D bounds it regardless of cause.

### Every merge call site

R10 asked for the whole codebase, not the one file that produced the log. Every place that can merge or wait for mergeability now handles drafts:

| Call site                                                              | Behaviour after the fix                                                                               |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/solve.auto-merge.lib.mjs` — `watchUntilMergeable`                 | draft blocker → mark ready (max 3 attempts) → re-check; classified merge failures; wall-clock timeout |
| `src/solve.auto-merge-attempt.lib.mjs` — `attemptAutoMerge`            | one draft self-heal and a single retry before reporting, with the category in the report              |
| `src/solve.auto-merge-helpers.lib.mjs` — `getMergeBlockers`            | dedicated `draft` blocker, emitted in the `no_checks` branch too — it owns several early returns      |
| `src/telegram-merge-queue.lib.mjs` / `src/telegram-merge-wait.lib.mjs` | a draft is skipped immediately instead of waiting out the full mergeability timeout                   |
| `src/bidirectional-interactive.lib.mjs`                                | consumes `blockers` generically, so it reports the draft blocker without changes                      |

### Diagnostics

The verbose line that ran 2692 times said everything except the one thing that mattered:

```
[VERBOSE] /merge: PR #142 mergeable: true, state: CLEAN
```

It now reads `mergeable: false, state: CLEAN, isDraft: true`, and merge failures add a category line (`terminal=…, recoverable=…`). The watch banner prints the timeout it is running under. Anyone reading this log four days in would have had the answer in the first screen.

## Existing components

| Project                                        | How it handles this                                                                                                                      | What we took                                                                                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kodiak                                         | "Draft pull requests will also prevent a pull request from merging" — a draft is a first-class blocking condition, never a merge attempt | the `draft` blocker type; a blocker is cheaper than a failed merge                                                                                                              |
| Mergify                                        | Draft state is part of queue rules; failures are classified and retried a bounded number of times (`max_checks_retries`)                 | bounded retries with an explicit budget rather than an open loop                                                                                                                |
| GitHub's own auto-merge (`gh pr merge --auto`) | GitHub queues the merge and performs it when conditions clear; a draft simply never satisfies them                                       | considered and not adopted: it needs the repo to enable auto-merge and gives no reason string back to the task                                                                  |
| `p-retry`, `cockatiel`                         | Retry libraries with `AbortError` / circuit-breaker semantics                                                                            | the shape (classify → terminal vs retryable → bounded budget), not the dependency: the classification here is over `gh` stderr strings, which no generic library can categorise |

The retry libraries were the closest fit and still the wrong one. What was missing was never the retry mechanism — it was a predicate saying which failures are worth retrying, and that predicate is domain-specific.

## External findings

- GitHub's `MergeStateStatus` enum documents `DRAFT` as "the merge is blocked due to the pull request being a draft", and `CLEAN` as "mergeable and passing commit status". Observed behaviour on both PR #142 and PR #2183 is that a draft PR with no other blockers reports `CLEAN`/`UNSTABLE`, never `DRAFT`. Any tool that reads `mergeStateStatus` without `isDraft` inherits this bug.
- `mergeable`/`mergeStateStatus` are computed asynchronously and can be `UNKNOWN` on first read — hive-mind already retries that (issue #1339), which is why the `UNKNOWN` path was left untouched here.

## Upstream

No upstream issue was filed. All four root causes are in this repository. The one externally-owned behaviour — `mergeStateStatus` answering `CLEAN` for a draft — is a documentation/API mismatch on GitHub's side rather than in a repository that accepts issues, and it is already worked around by reading `isDraft`, which is the field GitHub itself is steering clients toward. If it is ever filed, the reproduction is the two-line GraphQL query in [RC-B](#rc-b--a-draft-pull-request-reports-itself-as-mergeable).

## What this does not do

- **It does not stop a session from leaving a PR in draft.** RC-A fixes the known path (`executeToolIteration`); the draft self-heal in the watch loop exists precisely because there may be others — a crash between the draft conversion and the tool run leaves the same state, and no `finally` block survives a killed container.
- **It does not shorten anything but the failure case.** A healthy `--auto-merge` run waiting on a slow CI suite is unaffected; the 24-hour default is far above any real CI.
- **It was not reproduced end-to-end against a live GitHub repository.** The regression test asserts on the exact API payload observed in production and on the wiring at each call site; recreating a 4½-day run to watch it stop would take 4½ days.
