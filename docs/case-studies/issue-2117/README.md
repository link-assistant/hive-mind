# Issue 2117 case study: merged pull request reported as failed

## Executive summary

The report combines two real events: Hive Mind successfully merged
`link-foundation/use-m#69`, then its container exited with code 1. The Docker
entrypoint and detached-session monitor preserve the inner process status, so
the exit code was not fabricated. GitHub independently records the merge at
`2026-07-30T06:38:12Z`, and Hive Mind posted its auto-merge success comment one
second later.

The exact statement that threw after the merge is not present in the retained
artifact. The attached solve log is an interim snapshot ending at `06:35:36Z`,
almost three minutes before the merge. The original container, final
start-command log/footer, and Docker state were no longer retained when this
investigation began. Naming a specific exception would therefore be
speculation.

The root lifecycle defect is nevertheless concrete and reproducible: Hive Mind
did not persist the durable merge success in process state. Any later internal
exception could still reach an exit-1 path and override the already-completed
goal. `solve` also installed two competing pairs of process-error handlers, and
its finalizer awaited housekeeping steps without independent failure
boundaries.

The fix closes that entire failure class:

- latch the successful terminal outcome immediately when GitHub reports or
  performs the merge, before any post-merge `await`;
- convert later _internal_ failure exits to exit 0 while retaining the error in
  the log;
- skip failure comments, failure auto-close, and pre-exit failure notifications
  after a confirmed merge;
- use only `solve`'s richer process-error handlers instead of racing a duplicate
  global pair;
- make final cleanup, log-reference, Sentry, and active-handle steps independent
  best-effort operations;
- retain the split-outcome Telegram message for old deployments and genuinely
  external terminations that application code cannot prevent (for example
  SIGKILL or OOM).

## Visual comparison

| Before: contradictory failure                           | After: both outcomes reported                                 |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| ![Original Telegram message](data/issue-screenshot.png) | ![Expected Telegram message after the fix](after-message.png) |

## Evidence and timeline

All times are UTC on 2026-07-30.

| Time      | Event                                        | Confidence and source                                                                                     |
| --------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 06:14:58  | Work session starts                          | Solve log header and Telegram session metadata.                                                           |
| 06:35:31  | Codex completes successfully                 | `turn.completed`, `✅ Codex command completed`, clean worktree, and healthy resource snapshot in the log. |
| 06:35:34  | Hive Mind posts its working summary to PR 69 | GitHub conversation comment `5127479150`.                                                                 |
| 06:35:36  | Attached solve-log snapshot ends             | Last timestamp in `data/session.log.txt`; this proves the artifact is not the final runner log.           |
| 06:35:45  | The 2.5 MB log snapshot is posted to PR 69   | GitHub conversation comment `5127481018`.                                                                 |
| 06:38:12  | PR 69 is merged                              | GitHub `mergedAt`; merge commit `15cb68541a93bde3ba9b621651d6c841f4b21d1d`.                               |
| 06:38:13  | Hive Mind posts its merge-complete comment   | GitHub conversation comment `5127503934`; proves the solver reached its merge-success branch.             |
| ~06:38:56 | Telegram reports the container's exit code 1 | Screenshot duration and completion notification.                                                          |

Additional findings:

- The only command error in the retained inner trace is a missing `jq` binary
  returning 127. Codex recovered with `gh --jq`, completed its turn, and Hive
  Mind continued successfully; this is not the terminal exit 1.
- After the agent finished, 10.4 GB of memory and 153.7 GB of disk remained.
  The evidence does not support OOM or disk exhaustion.
- The `konard/box-dind:2.3.5` entrypoint hands off through `exec`, the standard
  Box entrypoint also ends with `exec "$@"`, and start-command stores Docker's
  real `State.ExitCode`. None maps success to code 1.
- PR 69's head remains `dd7b034`. The expected `.gitkeep` cleanup commit was
  never pushed, even though normal ordering performs that cleanup after
  auto-merge. This confines the interruption to the post-merge lifecycle.

The retained evidence does **not** contain the outer exception, stack, final
start-command footer/status payload, or Docker `State` record. Those are needed
to identify the historical triggering statement.

## Root-cause analysis

### Confirmed lifecycle root cause

Before this fix, GitHub merge success was only a return value from
`startAutoRestartUntilMergeable()`. It was not durable process state.
Post-merge work still followed:

1. final log reconciliation;
2. `.gitkeep` cleanup and push;
3. development-log finalization;
4. work-session shutdown;
5. temporary-directory cleanup, Sentry close, active-handle diagnostics, and
   `safeExit(0)`.

An exception in that tail entered `handleMainExecutionError()` or an
uncaught-exception/unhandled-rejection listener, all of which unconditionally
requested exit 1. Thus the code allowed this invalid transition:

```text
GitHub merge confirmed → post-merge internal error → process exit 1
```

Two independently registered process-error listener pairs could also race:
`installGlobalExitHandlers()` was registered first, while `solve` later added
handlers that preserve work and attach diagnostics. The global listener could
terminate the process before the richer handler completed.

The historical exception that selected one of these paths is unavailable, but
the missing success invariant—not the wording of the notification—is the root
cause that made the contradictory terminal result possible.

### Presentation root cause

The Telegram formatter classified the whole task only from runner status. It
did not query the already-resolved pull request's terminal GitHub state, so a
real runner failure overwrote the equally real completed goal.

### Why no upstream issue was filed

No retained trace attributes the internal exception to start-command, Docker,
GitHub CLI, or Box, and each audited boundary faithfully propagates status.
Without a minimal upstream reproduction, filing against one of those projects
would not be actionable. The new guard and completion-evidence trace make a
future external termination diagnosable without guessing.

## Solution and guarantee boundary

`solve-terminal-outcome.lib.mjs` stores the first confirmed merge with its
repository and PR identity. Every auto-merge success/detection path records it
before logging, comments, issue closing, or other awaited work.

Internal exits then follow one invariant:

```text
before merge: requested exit 1 → exit 1
after confirmed merge: requested internal exit 1 → log warning + exit 0
```

Post-merge exceptions are still sent to the available log and Sentry on a
best-effort basis, but they do not post a misleading failure notification or
close a completed PR. The finalizer continues after each housekeeping failure
and always reaches the selected exit path. `solve` disables the redundant
global process-error listeners while retaining global signal handling.

This prevents Hive Mind's own post-merge code from producing the reported exit
code 1. No Node.js code can convert an uncatchable SIGKILL, kernel OOM kill,
host crash, or forced container removal into a clean exit; those events
intentionally remain observable, and the Telegram split-outcome fallback
reports both facts.

## Reproduction and verification

The root regression starts a real Node child, confirms PR 69 as merged, and
calls `safeExit(1, "simulated post-merge failure")`. Before the fix no terminal
outcome guard existed. After the fix the child:

- logs that the internal exit 1 was suppressed after the confirmed merge;
- exits with process status 0;
- preserves exit 1 before a merge;
- reaches `safeExit(0)` even when cleanup, Sentry close, and handle diagnostics
  all throw.

The notification regression separately supplies runner status `executed`, exit
code 1, and a GitHub-verified merged PR. It verifies the fallback message:

> ⚠️ Pull request merged, but the work session exited with code: 1

Run:

```sh
node tests/test-issue-2117-post-merge-exit-guard.mjs
node tests/test-issue-2117-merged-pr-exit.mjs
npm test
npm run lint
npm run format:check
```

## Follow-up investigation protocol

If a split outcome recurs, it must now be an external termination or a
deployment predating this fix:

1. preserve the final start-command execution log, not only the mid-run PR
   attachment;
2. capture `$ --status <session-id>` as JSON before cleanup;
3. capture `docker inspect <container>` fields `State.Status`,
   `State.ExitCode`, `State.Error`, `State.OOMKilled`, `State.FinishedAt`, and
   health state;
4. correlate those timestamps with the completion-evidence line and GitHub's
   `merged_at`;
5. file upstream only when a minimal command shows that component returning an
   incorrect status.

## Sources

- GitHub REST pull-request API:
  <https://docs.github.com/en/rest/pulls/pulls>
- Docker run exit status:
  <https://docs.docker.com/engine/containers/run/#exit-status>
- Docker inspect:
  <https://docs.docker.com/reference/cli/docker/inspect/>
- Node child-process exit semantics:
  <https://nodejs.org/api/child_process.html>
- Box DIND handoff at the deployed tag:
  <https://github.com/link-foundation/box/blob/v2.3.5/ubuntu/24.04/dind/dind-entrypoint.sh>
- Box standard entrypoint at the deployed tag:
  <https://github.com/link-foundation/box/blob/v2.3.5/scripts/entrypoint.sh>
- Related start-command sentinel report (exit `-1`, not this exit `1`):
  <https://github.com/link-foundation/start/issues/136>
- Related Hive Mind post-merge lifecycle fixes:
  <https://github.com/link-assistant/hive-mind/pull/1348>,
  <https://github.com/link-assistant/hive-mind/pull/1432>,
  <https://github.com/link-assistant/hive-mind/pull/1517>

## Archived artifacts

`data/` contains the issue snapshot and comments, the initial PR 2118 snapshot
and its three comment/review streams, the linked use-m issue and PR snapshots
with their comment/review streams, the exact log comment, authenticated raw
gist, successful use-m CI metadata and log, and issue screenshot. PR 2118
continued to receive feedback after that initial archive; the live streams were
re-read before this follow-up. `SHA256SUMS` protects the archived data files
from accidental modification.
