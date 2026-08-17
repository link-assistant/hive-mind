# Technical analysis — issue 2160

Every finding below was reproduced by a test before it was fixed. Line references point at the
current state of the branch for [PR #2162](https://github.com/link-assistant/hive-mind/pull/2162);
log line numbers refer to the decompressed run log in [`data/run-logs/`](./data/run-logs/).

## Census of everything the run reported

Counted mechanically over the 259 311 log lines (`grep -c`), then each group was read in context:

| Count | Line                                                                     | Verdict                                                                  | Defect |
| ----- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------ |
| 4     | `❌ Insufficient disk space: 10047MB available, 10240MB required`        | Real condition, wrong consequence                                        | P1     |
| 4     | `❌ System checks failed` / `solve exited with code 1`                   | Environment failure counted as task failure                              | P1     |
| 4     | `⚠️ Could not rename log file: getLogFile is not a function`             | Real bug                                                                 | P2     |
| 2     | `⚠️ WARNING: .gitkeep still exists after cleanup`                        | False positive                                                           | P3     |
| 26    | `⚠️ Tool result error detected`                                          | False positive                                                           | P4     |
| 1     | `📁 Keeping directory (--no-auto-cleanup)` reason text                   | Misleading (flag never passed)                                           | P5     |
| 10    | `⚠️ Log comment too long (N chars)`                                      | Wrong severity                                                           | P5     |
| 6     | `(no PR found)` + `0/6 issues have open PRs`                             | False negative                                                           | P6     |
| —     | `--auto-cleanup` cleanup path (not exercised, and unsafe if it had been) | Latent bug                                                               | P7     |
| 10    | `⚠️ Skipped N duplicate entries` (13–86 each)                            | Wrong severity + upstream finding                                        | P8     |
| 9     | `⚠️ Merge conflicts detected`                                            | Correct — the restart loop resolves them                                 | —      |
| 2     | `❌ CI/CD checks are failing`                                            | Correct — real failures in the target repo                               | —      |
| 10    | `⚠️ Security warning: --attach-logs`                                     | Correct — the operator opted in                                          | —      |
| 1     | `❌ {error}`                                                             | Not Hive Mind output: a Rust source snippet inside a tool-result payload | —      |

## P1 — an exhausted host disk was reported as four task failures

**Symptom.** `❌ 4 task(s) failed (completed: 6)`, exit 1, and four "🚨 Solution Draft Failed /
Reason: System checks failed" comments on router #192–#195.

**Chain of causes.**

1. `router` is a public repository, and `solve` defaults `--auto-cleanup` to off for public
   repositories. Each finished task therefore left its `/tmp/gh-issue-solver-*` clone in place.
   The run's own numbers: 74 935 → 57 507 → 42 391 → 25 673 → 18 624 → 10 047 MB free, i.e. about
   10.8 GB per completed task, 65 GB across six.
2. Hive measured free space once, in start-up validation (log line 86), and never again. The
   producer/consumer loop had no notion of a resource that shrinks while it dequeues.
3. Reaching 10 047 MB free, each of the last four tasks failed `solve`'s `--min-disk-space 10240`
   pre-flight check, exited `1` ~7 s after start, and reported through the _task-failure_ path —
   the only outcome the worker loop had besides success.
4. Because a worker that cannot start still had to produce an outcome, the issue was moved to
   `failed`, never retried, and a failure comment was published to the target repository.

The distinguishing evidence that this is not a task problem at all: a later run solved all four
issues in [router PR #202](https://github.com/link-assistant/router/pull/202) (created
2026-08-17T04:49:33Z, merged 06:07:57Z) without any change to the issues.

**Fix.** A new module, `src/disk-guard.lib.mjs`, gives the orchestrator a third outcome:

- `getFreeDiskSpaceMB()` — `df -Pk` (POSIX-portable single-line output), `null` when unavailable.
- `listSolverWorkspaces()` — every `/tmp/gh-issue-solver-*` directory, oldest mtime first.
- `findBusySolverWorkspaces()` — workspaces that are some process's `/proc/<pid>/cwd`. When `/proc`
  cannot be read, **every** workspace is reported busy (`src/disk-guard.lib.mjs:100-121`); refusing
  to guess is the only safe answer when deleting would destroy live work.
- `reclaimSolverWorkspaces()` — removes idle workspaces oldest-first until the requirement is met,
  skipping in-flight (`in_flight`), busy (`process_cwd`) and recently touched (`recently_modified`,
  default 5 min) ones.
- `ensureDiskSpaceForWorker()` — reclaim, then poll while other work is in flight, then answer
  `{ ok: false, reason: 'insufficient_disk_space' }`.

`src/hive.mjs` uses it per task (`src/hive.mjs:709-723`): it tracks each worker's workspaces in
`workerWorkspaces` and passes `getProtectedWorkspacePaths()` so a running worker's clone can never be
reclaimed; it waits up to `DISK_SPACE_WAIT_MS` (10 min) **only** when another worker is still
running (waiting when nothing can release space would just stall); and on failure it calls
`issueQueue.requeue(issueUrl)` and counts a deferral instead of a failure. After
`MAX_DISK_SPACE_DEFERRALS` (3) with nothing in flight, `diskSpaceHalt` is set and hive exits with
`EXIT_CODE_INSUFFICIENT_DISK_SPACE` (75 = `EX_TEMPFAIL`) and the message `… — N task(s) completed,
M left queued (no task failures)` (`src/hive.mjs:1412-1413`).

`solve` now exits 75 as well when its own pre-flight check fails on disk space
(`src/solve.mjs:229-231`), with `skipPreExit: true` so it does not publish a "Solution Draft Failed"
comment for something the issue is not responsible for; `src/hive.mjs:875` recognises that exit code
and treats it as a deferral even when the worker was spawned before space ran out.

Choosing 75 rather than a bespoke code matters for the callers of `hive` (CI, cron, supervisors):
sysexits defines `EX_TEMPFAIL` as "temporary failure, indicating something that is not really an
error … the request should be reattempted later", which is exactly the retry contract wanted here.

**Test.** `tests/disk-guard-2160.test.mjs` — 15 cases with injected `df`/`readdir`/`readlink`/`rm`/
clock/sleep, including the reproduction of this run's exact sequence (six workspaces, 10 047 MB free,
requirement 10 240 MB) which asserts the task is deferred and requeued rather than failed.

## P2 — `⚠️ Could not rename log file: getLogFile is not a function`

`src/solve.restart-shared.lib.mjs` passed no-op `getLogFile`/`setLogFile` stubs to five tool
executors and omitted them entirely for `executeClaude`, so every restart/watch/auto-merge iteration
threw a `TypeError` inside the rename block and left the session log unnamed. Fixed by extracting the
logic into `src/session-log-rename.lib.mjs` — which never throws and returns
`{ ok: false, reason: 'missing_accessors' | 'missing_session_id' | … }` — and forwarding the real
accessors from `src/lib.mjs` at every call site. Test: `tests/session-log-rename-2160.test.mjs`.

## P3 — `⚠️ WARNING: .gitkeep still exists after cleanup`

`cleanupClaudeFile` warned first and only then checked whether the file predated the session, so a
`.gitkeep` that belongs to the repository produced a warning immediately followed by
`ℹ️ .gitkeep existed before this session — keeping pre-existing file`. The pre-existence check
(`git cat-file -e <commit>~1:<file>`) now runs first and the warning is emitted only for a real
leftover (`src/solve.results.lib.mjs:485-500`). Test:
`tests/gitkeep-cleanup-warning-2160.test.mjs`.

## P4 — 26 × `⚠️ Tool result error detected`

All 26 were the AI's own command failing _inside_ the session, after which the AI read the result and
continued: 11 harness-blocked `sleep`s (`Blocked: sleep 240 followed by: …`), 9 Bash timeouts
(`Exit code 143`, the SIGTERM of the tool's own timeout), 4 × `Exit code 1`, 2 × `Exit code 127`.
Two consequences: the run log looked degraded, and each such result overwrote "the last thing the
assistant said", so a truncated stream could be reported as having failed _after_
`Blocked: sleep 240 …` instead of after the AI's actual last message.

`classifyToolResultError()` (`src/claude.stream-events.lib.mjs:40-51`) returns
`{ benign, category }` for harness blocks, command timeouts and bare exit codes; benign results are
logged as `ℹ️` and no longer replace `lastText`. Anything unrecognised keeps its previous treatment,
so the change cannot hide a new class of error. Prompt guidance in all four locales now tells the AI
to poll with an `until` loop instead of a long foreground `sleep`, removing the most common trigger.
Test: `tests/tool-result-error-classification-2160.test.mjs` (16 cases, including the exact strings
from this run).

## P5 — messages that described something that did not happen

- `📁 Keeping directory (--no-auto-cleanup)` — the flag was never passed; auto-cleanup was _defaulted_
  off because the repository is public. The line now names the actual reason via
  `argv.autoCleanupSource` (`src/solve.repository.lib.mjs:1338-1346`). This is the single line that
  would have made P1 diagnosable from the log alone.
- `⚠️ Log comment too long (N chars)` (10×) — the expected route for a long log, which
  `gh-upload-log` then handles. Downgraded to `ℹ️` and it now names the fallback
  (`src/github.lib.mjs:579-584`).

Test: `tests/misleading-messages-2160.test.mjs`.

## P6 — six merged solution drafts reported as `(no PR found)`

`listSolutionDrafts` called `batchCheckPullRequestsForIssues`, whose GraphQL/REST timeline walk kept
only pull requests in state `OPEN`. With `--auto-merge` every draft was already merged by the time
the summary ran, so the summary of a successful run claimed no work existed — the most misleading
line in the report, because a human reads it to decide whether the run was useful.

`batchCheckPullRequestsForIssues` and `extractLinkedPullRequestsForIssue` now take
`includeStates` (default `['OPEN']`, so no existing caller changes behaviour) and `openPRCount`
still counts only open ones, which keeps `--skip-issues-with-prs` correct
(`src/github.batch.lib.mjs:25-35,70-74,152-198`). The listing asks for
`['OPEN','MERGED','CLOSED']` and prints the state for non-open drafts
(`src/list-solution-drafts.lib.mjs:11,38-44`). Both consumers of the batch checker were audited so
the fix is complete, per R6. Test: `tests/solution-draft-listing-2160.test.mjs`.

## P7 — `--auto-cleanup` was a no-op in one branch and `rm -rf /tmp/*` in the other

Two defects in the same feature, neither visible in this run because the flag was off:

1. `src/hive.mjs` called `cleanupTempDirectories()` with no arguments in its non-`--once` branch,
   while the function begins `if (!argv || !argv.autoCleanup) return;` — a silent no-op that could
   never clean anything, even with `--auto-cleanup`. Fixed at `src/hive.mjs:1335`.
2. The cleanup ran `sudo rm -rf /tmp/* /var/tmp/*`, which also destroys the workspaces, lock
   directories and logs of any _concurrent_ hive/solve run on the same host — and the run doing the
   cleanup is rarely the only tenant of `/tmp`. In this very run two workers shared `/tmp`, so
   cleanup fired by worker 1 would have deleted worker 2's live clone. It now goes through
   `listCleanableTempEntries()` (`src/disk-guard.lib.mjs:137-169`), which enumerates entries and
   keeps anything a live process sits in, anything the caller protects, and the run's own log file,
   logging each kept entry with its reason.

The array interpolation used for the narrowed command (`` $`sudo rm -rf ${remove}` ``) was verified
empirically to expand to one argv entry per path, with spaces and quotes preserved:
[`experiments/issue-2160-command-stream-array-probe.mjs`](../../../experiments/issue-2160-command-stream-array-probe.mjs).
Test: `tests/temp-cleanup-2160.test.mjs`, which also asserts by source inspection that no executed
command template deletes a whole temp root and that every `cleanupTempDirectories` call forwards
`argv`.

## P8 — duplicate JSONL entries logged as a warning (and an upstream finding)

`src/claude.lib.mjs` deduplicates transcript entries by `entry.message.id` before summing tokens, and
then warned about having done so. Ten sessions in this run skipped between 13 and 86 duplicates
each. The line already cited the upstream cause but was emitted as `⚠️`; since dedup has already
made the totals correct by the time it prints, nothing is wrong at that point. It is now `ℹ️` and
says so explicitly (`src/claude.budget-stats.lib.mjs:362-363`):

```
ℹ️  JSONL deduplication: skipped 13 duplicate entries so token totals stay correct
    (known upstream behaviour: anthropics/claude-code#87303)
```

The duplication itself is not a Hive Mind defect. It was reported upstream as
[anthropics/claude-code#6805](https://github.com/anthropics/claude-code/issues/6805) ("[BUG] Token
Usage Statistics Duplicated in stream-json Mode Causing Massive Cost Inflation", opened 2025-08-29,
closed 2026-02-14 as inactive, locked 2026-02-21), so per that issue's own closing message a fresh
report was needed. Investigating it produced first-hand evidence of the mechanism:

```
$ node experiments/issue-2160-claude-jsonl-usage-duplication.mjs <session>.jsonl
records: 521, distinctMessageIds: 323, duplicatedRecords: 198,
idsWithDuplicates: 188, idsWhoseDuplicatesAreIdentical: 188, maxEntriesPerMessageId: 3
inflation: input 1.21x, cache_creation 1.92x, cache_read 1.59x, output 1.86x
```

One API response whose content has several blocks is written as one `assistant` entry **per block**
(`text | tool_use | tool_use`, `thinking | tool_use`, …), and each entry repeats the whole `usage`
object byte-identically — so a naive sum inflates by 1.2–1.9x on a tool-using session. Filed as
[anthropics/claude-code#87303](https://github.com/anthropics/claude-code/issues/87303) with
reproduction, workaround (dedup by `message.id`) and two concrete fix options; the submitted text is
preserved in
[`upstream/claude-code-jsonl-usage-duplication.md`](./upstream/claude-code-jsonl-usage-duplication.md),
and the measurement script is
[`experiments/issue-2160-claude-jsonl-usage-duplication.mjs`](../../../experiments/issue-2160-claude-jsonl-usage-duplication.mjs).

## Findings that were correct behaviour

- **9 × `⚠️ Merge conflicts detected`** — genuine conflicts against a moving `main`; the restart loop
  resolves them and the affected PRs merged. No change.
- **2 × `❌ CI/CD checks are failing`** — real failures in the target repository's checks, which is
  what that message is for. No change.
- **10 × `⚠️ Security warning: --attach-logs`** — the operator passed `--attach-logs`; warning once
  per task is intentional. No change.
- **`❌ {error}`** — a literal line inside a Rust source snippet in a tool-result payload, not Hive
  Mind output. No change.

## Diagnostics added (R4)

Insufficient data was the reason P1 needed reconstruction from disk arithmetic rather than being
readable in the log. The run now records, without needing `--verbose`:

- free space **before every task**, not only at start-up (`ensureDiskSpaceForWorker`);
- every reclaim decision with its reason (`in_flight`, `process_cwd`, `recently_modified`,
  `remove_failed`) and the space recovered;
- each deferral with its counter (`deferral N/3, not a task failure`) and, on halt, how many tasks
  completed and how many remain queued;
- the real reason a workspace is being kept (`auto-cleanup is off by default for public
repositories`), which is what makes the disk growth self-explanatory next time;
- each temp entry the cleanup keeps and why (verbose).
