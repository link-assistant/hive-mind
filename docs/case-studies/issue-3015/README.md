# A successful session was reported as "Solution Draft Failed" with the AI's own summary as the error

[Issue #3015](https://github.com/link-assistant/hive-mind/issues/3015) reports this
[failure comment on PR #2824](https://github.com/link-assistant/hive-mind/pull/2824#issuecomment-6091706145):

```
CLAUDE execution failed with I fixed the four `/queue` problems from the issue and log, and marked PR
https://github.com/link-assistant/hive-mind/pull/2824 ready for review. CI on the final commit has not run yet. …
```

The text after "failed with" is the AI's final work summary, not an error. The session
had actually succeeded. [PR #3018](https://github.com/link-assistant/hive-mind/pull/3018) fixes it.

## Data

| File                                                                                                                                                                                     | Content                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`data/issue.json`](data/issue.json), [`data/issue-comments.json`](data/issue-comments.json)                                                                                             | Issue snapshot with both comments: the operator's root-cause note with the 4-run table, and the auto-fix report.                                                                                                                                                                                    |
| [`data/pr-2824-failure-comment.json`](data/pr-2824-failure-comment.json)                                                                                                                 | The published failure comment.                                                                                                                                                                                                                                                                      |
| [`data/solve-pr-2824-sanitized.log.txt.gz`](data/solve-pr-2824-sanitized.log.txt.gz)                                                                                                     | The full sanitized solve log from the [gist](https://gist.githubusercontent.com/konard/63de244f19f96d70c6bcb7c22026b84f/raw/7ab53753185d137f3d37b3a59255be442159533e/tmp-hive-mind-log-upload-BklTWB-sanitized.log.txt), 8 MB gzipped to 2.4 MB. Line numbers below refer to the uncompressed file. |
| [`data/solve-pr-2802-sanitized.log.txt.gz`](data/solve-pr-2802-sanitized.log.txt.gz)                                                                                                     | The sanitized solve log from the [PR #3018 comment](https://gist.githubusercontent.com/konard/5df5aa342d42d16447a8c9fff7ae8272/raw/86c680bfd05e9264c351e1c823567a5d9293439c/tmp-hive-mind-log-upload-tiNsm9-sanitized.log.txt): the same failure on solve v2.35.3, 2026-10-11, PR #2802.            |
| [`data/start-command-pr-2853.log.txt.gz`](data/start-command-pr-2853.log.txt.gz), [`…-2894…`](data/start-command-pr-2894.log.txt.gz), [`…-2918…`](data/start-command-pr-2918.log.txt.gz) | start-command task logs of the other three runs in the issue's table ([2853](https://gist.github.com/konard/c0acf29fb2b87158a7a49f0f199711db), [2894](https://gist.github.com/konard/6e6171917e53cd7fa3fde08701963289), [2918](https://gist.github.com/konard/1cdcffaa0e41f552e8c64376f4738c4d)).   |
| [`data/background-tasks-at-result.txt`](data/background-tasks-at-result.txt)                                                                                                             | Output of [`experiments/issue-3015/background-tasks-at-result.mjs`](../../../experiments/issue-3015/background-tasks-at-result.mjs) on all five logs: the Claude Code background tasks still running at the `result` event and at the solver's SIGTERM.                                             |

## Timeline (solve v2.34.0, `--tool claude`, 2026-10-09/10 UTC)

| Time         | Log line | Event                                                                                                                                             |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 22:43:25     | 6        | `solve v2.34.0` starts on issue #2823 (PR #2824). `command-stream` is loaded through use-m at `latest`.                                           |
| 00:36:53     | 55450    | The AI runs `gh pr ready 2824` → `draft=false mergeable=MERGEABLE`.                                                                               |
| 00:37:06.740 | 55763    | Claude emits `type: result`, `subtype: success`, `is_error: false`, `num_turns: 158`, `terminal_reason: completed`, with the summary as `result`. |
| 00:37:06.752 | 55776    | `📌 Result event received, starting 30s stream close timeout (Issue #1280)`. `$6.37` cost and the result summary are captured.                    |
| 00:37:36.799 | 55780    | The CLI has not exited within 30 s: `⚠️ Stream timeout — sending SIGTERM for graceful shutdown`.                                                  |
| 00:37:37.010 | 55781    | `⚠️ Stream exited via force-kill timeout`.                                                                                                        |
| 00:37:37.042 | 55784    | **`❌ Claude command failed with exit code 143`**. 143 = 128 + SIGTERM, i.e. the solver's own signal.                                             |
| 00:37:37.228 | 55804    | `1 process(es) still running … pid 2081: claude --output-format stream-json …`: the CLI outlived the stream.                                      |
| 00:37:38.595 | 55818    | `Converting PR: To draft mode (CLAUDE execution failed with I fixed the four …`. The PR the AI had just marked ready is turned back into a draft. |
| 00:37:58     | —        | The "🚨 Solution Draft Failed" comment is posted with the summary as the error.                                                                   |

In this run, background tasks `bsjy27k7g` ("Wait for final CI run") and
`b4ldmzlfk` ("Wait for CI to start") were still running at line 55775 and at the
SIGTERM (line 55780). See [root cause 4](#4-the-fixed-30-s-close-timer-killed-claude-code-while-print-mode-waited-for-background-tasks).

### Same failure on solve v2.35.3 (PR #2802, 2026-10-11 UTC)

| Time         | Log line | Event                                                                                                                                                                             |
| ------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 08:45:08     | 6        | `solve v2.35.3` starts on PR #2802.                                                                                                                                               |
| 09:10:26     | 27001    | The model starts a **foreground** Bash command, task `bzyssdyux` "Wait for CI runs on latest commit" (`is_backgrounded: false`).                                                  |
| 09:20:23     | 27215    | After about 10 minutes Claude Code moves it to the background: `background_tasks_changed` lists it and `task_updated` sets `is_backgrounded: true`. The model gets its turn back. |
| 09:21:38     | 28521    | The model runs `gh pr ready 2802`.                                                                                                                                                |
| 09:21:51.026 | 28947    | `result`, `subtype: success`, `is_error: false`, `num_turns: 89`. `bzyssdyux` is still running, so print mode keeps waiting for it.                                               |
| 09:21:51.035 | 28956    | `📌 Result event received, starting 30s stream close timeout (Issue #1280)`.                                                                                                      |
| 09:22:21.073 | 28961    | `⚠️ Stream timeout — sending SIGTERM`.                                                                                                                                            |
| 09:22:21.160 | 28965    | `task_notification` `bzyssdyux` `stopped`: our SIGTERM cancelled the CI waiter.                                                                                                   |
| 09:22:21.224 | 28975    | The #2301 tracker blames Claude Code: `Claude Code stopped background tasks when print mode exited`.                                                                              |
| 09:22:21.234 | 28978    | **`❌ Claude command failed with exit code 143`**.                                                                                                                                |
| 09:22:22.404 | 29012    | `Converting PR: To draft mode (CLAUDE execution failed with I resolved the merge conflict. …`.                                                                                    |

The same comment says `**Model: Claude Opus 5** (claude-opus-5)` although the result's
`modelUsage` says `claude-opus-5-5`. That is [Issue #2840](../issue-2840/README.md),
already fixed in v2.35.0, so it is not part of this fix.

## Requirements from the issue

1. Download all logs and data to `docs/case-studies/issue-3015`. Done, see [Data](#data).
2. Reconstruct the timeline. Done, see Timeline.
3. Find the root cause of each problem. Done, see [Root causes](#root-causes).
4. Propose solutions and check existing components and libraries. Done, see [Fix](#fix) and [Research](#research-existing-components-and-upstream-reports).
5. Add debug output if the root cause is unclear. The ignored exit code is logged in verbose mode. The solver now logs which background tasks Claude Code is waiting for, how long it will wait, and which tasks were still running if it stops the CLI.
6. Report issues upstream where applicable. Not needed, see [Upstream](#upstream-reports).
7. Apply the fix across the whole codebase. Done, see [Same pattern elsewhere](#same-pattern-elsewhere).
8. (PR comment) Check the [PR #2802 log](https://gist.githubusercontent.com/konard/5df5aa342d42d16447a8c9fff7ae8272/raw/86c680bfd05e9264c351e1c823567a5d9293439c/tmp-hive-mind-log-upload-tiNsm9-sanitized.log.txt) and make sure every root cause is fixed. Done: it showed [root cause 4](#4-the-fixed-30-s-close-timer-killed-claude-code-while-print-mode-waited-for-background-tasks), which the first version of this fix did not address.

## Root causes

### 1. The exit-chunk branch ignored that the solver itself killed the process

`executeClaudeCommand` (`src/claude.lib.mjs`) reads the exit code from two places:

- **`{ type: 'exit' }` chunks from `execCommand.stream()`**: any non-zero code set
  `commandFailed = true`. The branch dates from 2025-09 (`0ae4454b`) and never
  looked at `forceExitTriggered`.
- **`execCommand.result.code` after the loop**: this branch already skipped forced
  closes (`if (!forceExitTriggered) commandFailed = true`, Issue #1280).

The first branch was dead code until command-stream started yielding exit chunks.
[link-foundation/command-stream#155](https://github.com/link-foundation/command-stream/issues/155)
("stream() async iterator does not yield exit chunks…") was fixed in
[js-v0.12.0](https://github.com/link-foundation/command-stream/releases/tag/js-v0.12.0)
on 2026-06-10. hive-mind loads `command-stream` through use-m at `latest`, so every
install after that date got the exit chunk. From then on, every Claude run that
outlived the 30 s post-result timeout failed, even after a `success` result.

[`experiments/issue-3015/command-stream-exit-chunk.mjs`](../../../experiments/issue-3015/command-stream-exit-chunk.mjs)
shows the current behavior: killing a running command with SIGTERM yields
`stdout`, then `exit` with code 143, and sets `result.code = 143`. Bisecting
releases with the same probe found no exit chunk up to 0.11.1 and an exit chunk
from 0.12.0 on.

The stored logs confirm the regression. In
[`issue-1821` (solve v1.72.5, 2026-05-22)](../issue-1821/ci-logs/solution-draft-log-pr-1779455065770.txt),
the same forced close went `⚠️ Stream timeout — sending SIGTERM` →
`⚠️ Updated exit code from command result: 143` → `✅ Claude command completed`.

### 2. The failure message was the last assistant text

When `commandFailed` is set without a structured error, `errorInfo.message` came
from `lastMessage`, the last assistant text on the stream. After a `success`
result, that text is the work summary. `formatToolExecutionFailure` then
published it as `CLAUDE execution failed with <summary>`. The PR-to-draft
conversion used the same text as its reason.

### 3. (Secondary) The SIGKILL follow-up was skipped while the CLI was alive

`forceExitOnTimeout` sends SIGTERM to the process group and SIGKILL 5 s later,
but only `if (!execCommand.result?.code)`. `result.code` is set as soon as the
wrapping shell exits, while the `claude` process in the same group can keep
running. The log shows pid 2081 still running after the session. The follow-up
SIGKILL never fired.

### 4. The fixed 30 s close timer killed Claude Code while print mode waited for background tasks

The first version of this case study said the log does not show what kept the
CLI alive. That was wrong. Replaying every stream event through a background-task
tracker ([`background-tasks-at-result.mjs`](../../../experiments/issue-3015/background-tasks-at-result.mjs),
output in [`data/background-tasks-at-result.txt`](data/background-tasks-at-result.txt))
shows that in **all five runs** Claude Code had a background task running at
its `result` event and still at our SIGTERM:

| Run                | `result` / SIGTERM line | Background task(s) still running                                        | After SIGTERM     |
| ------------------ | ----------------------- | ----------------------------------------------------------------------- | ----------------- |
| PR #2824 (v2.34.0) | 55775 / 55780           | `bsjy27k7g` "Wait for final CI run", `b4ldmzlfk` "Wait for CI to start" | stream ended      |
| PR #2853 (v2.34.0) | 18786 / 18791           | `bq0splpj9` "Wait for full suite and show summary"                      | `stopped` (18803) |
| PR #2894 (v2.34.0) | 79611 / 79616           | `bxoo6kjks` "Wait for npm test to finish"                               | `stopped` (79628) |
| PR #2918 (v2.34.0) | 80381 / 80386           | `bs0yv2yzy` "Wait for CI poller output"                                 | stream ended      |
| PR #2802 (v2.35.3) | 28955 / 28961           | `bzyssdyux` "Wait for CI runs on latest commit"                         | `stopped` (28973) |

Line numbers are where each JSON event ends, as the scanner prints them.

Each is a CI or test waiter. Some were started with `run_in_background`; others,
like `bzyssdyux`, were foreground commands that Claude Code moved to the
background after about 10 minutes.

In print mode (`-p`), Claude Code does not exit while background tasks run. It
waits until they finish or until `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` passes.
A finished task wakes the model again, which can start another turn and emit
another `result`. hive-mind relies on this. Issue #2301 raised the ceiling to
40 minutes (`claudeCode.printBgWaitCeilingMs`) so that background work is not
cut short. The 30 s close timer from Issue #1280 ignored all of that, so it
killed the CLI 30 s into a wait that hive-mind had configured to last up to
40 minutes. The CLI did not hang; it was working as configured.

The issue comment suspected host load (load 4–11 on 6 cores, cgroup memory
peak at the limit). The logs do not support that: the CLI was not slow to exit,
it was waiting for a task on purpose, and the kill cancelled that task.

In the v2.35.3 run, the #2301 tracker then reported `Claude Code stopped
background tasks when print mode exited` (line 28975). The solver had done
that, not Claude Code.

## Fix

- **`src/claude.process-exit.lib.mjs` (new):** the exit-code rules shared by both
  exit paths.
  - **`interpretClaudeExitCode`:** a non-zero code is ignored, and logged in
    verbose mode, when the post-result close timeout fired after a genuine
    success result (`subtype: success`, `is_error !== true`). Other solver kills
    (startup or activity timeout, loop breaker, base-branch stop) keep their code
    and are still judged by their own flags. Any other non-zero exit still fails.
  - **`selectClaudeFailureMessage`:** when a session still fails after a success
    result, the message is `Claude CLI exited with code N (SIGNAL) after reporting a successful result`
    instead of the summary. This runs before usage-limit and transient-error
    classification, so the summary cannot be misclassified.
  - **`isProcessGroupAlive`:** the SIGKILL follow-up now checks with `kill(-pid, 0)`
    whether the process group is still alive, instead of checking whether the
    shell reported a code.
- **`src/lib.mjs`, `extractToolErrorCore` (all tools):** returns `null` when the
  error text equals `toolResult.resultSummary`. Every failure comment, draft
  reason and auto-restart message goes through this function, so no tool can
  publish its work summary as an error. A summary-only failure renders as
  `CLAUDE execution failed`.
- **`src/solve.restart-shared.lib.mjs`:** the draft-conversion reason after a
  failed restart iteration used `errorInfo.message` directly. It now uses
  `extractToolErrorCore`.
- **`src/claude.result-close.lib.mjs` (new, root cause 4):** owns the
  post-result close timer.
  - **`createClaudeBackgroundTaskTracker`:** follows Claude Code's own stream
    events. `background_tasks_changed` is the authoritative list.
    `task_started` / `task_updated` (`is_backgrounded`, terminal `status`) and
    `task_notification` keep it correct on CLI versions that do not send it.
  - **`planResultCloseTimeout`:** with no background task running, the solver
    waits `HIVE_MIND_RESULT_STREAM_CLOSE_MS` (30 s) as before, so a real hang is
    still stopped quickly. With tasks running, it waits until Claude Code's own
    ceiling (`claudeCode.printBgWaitCeilingMs`, 40 min), counted from the
    result, plus the same 30 s grace. If the ceiling is disabled (0), the stream
    activity timeout bounds the wait, or 1 h when that is disabled too.
  - **`createClaudeResultCloseController`:** arms the timer on the result and
    plans it again when the task set changes. A new main-thread assistant
    message means a finished task woke the model. The timer is then paused until
    the next `result`, and the activity timeout is re-armed. Waiting for tasks is
    logged as a normal line that names the tasks and the wait. If the timer
    still fires while tasks run, a warning names them.
- **`src/claude.lib.mjs`:** uses the controller instead of the inline
  `resultTimeoutId` timer, in both the stream loop and the remaining-buffer path.
- **`src/claude.print-turn.lib.mjs`:** `assessClaudeTurnCompletion` takes
  `solverStopped`. When the solver's timer stopped the CLI while tasks ran, the
  #2301 resume prompt now says so, instead of blaming Claude Code. When Claude
  Code reports the cancelled tasks, the session is still resumed so the model
  can redo the cancelled waiter.

### How the issue's suggested fixes map to the change

| Suggested fix (issue comment)                                                                                        | Done                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A success result followed by our close-timeout SIGTERM/SIGKILL (143/137) must not fail the run; log it as a warning. | `interpretClaudeExitCode` (root cause 1). The ignored code is logged.                                                                        |
| Never use the agent's final result text as a failure reason; say why it failed.                                      | `selectClaudeFailureMessage` and the `extractToolErrorCore` guard for all tools (root cause 2).                                              |
| Do not convert a PR to draft when the agent marked it ready during a successful session.                             | Follows from the first row: a successful session is no longer a failure, so the draft conversion and the failure comment do not run.         |
| Make the close timeout adaptive, and log what the CLI was doing when it was killed.                                  | `claude.result-close.lib.mjs` (root cause 4). The wait follows the background tasks the CLI is actually waiting for, and the log names them. |
| A fake Claude that prints a success result and then sleeps must end as success.                                      | `claude-post-result-kill-3015.test.mjs` and `claude-result-close-background-3015.test.mjs`.                                                  |

The operator still has to mark PRs #2853, #2894 and #2918 ready by hand; they
are drafts as of 2026-10-11. #2824 and #2802 are ready again.

### Tests

- **[`tests/claude-post-result-kill-3015.test.mjs`](../../../tests/claude-post-result-kill-3015.test.mjs):**
  replays the stream through `executeClaudeCommand` with a fake `$`. The stream
  sends the summary and a success result, then hangs until the solver kills it.
  - It covers both command-stream behaviors: with an exit chunk (≥ 0.12.0) and
    without one (≤ 0.11.1).
  - It also checks that a genuine exit 1 after success still fails, but with the
    exit description as the message, and that a clean exit 0 is unaffected.
  - Before the fix, 3 of the 4 tests fail. The exit-chunk case returns
    `success: false`, `exitCode: 143` and the summary as `errorInfo.message`.
- **[`tests/claude-process-exit-3015.test.mjs`](../../../tests/claude-process-exit-3015.test.mjs):**
  unit tests for the helpers, the cross-tool `extractToolErrorCore` guard, and
  `isProcessGroupAlive` against a real process group.
- **[`tests/claude-result-close-background-3015.test.mjs`](../../../tests/claude-result-close-background-3015.test.mjs):**
  unit tests for the tracker, the planner and the controller. It also replays
  streams through `executeClaudeCommand`:
  - A background CI waiter is running at the result. The CLI is not killed after
    30 s; the task finishes, the model takes another turn, and the run ends with
    the latest result summary.
  - The waiter never finishes: the CLI is stopped only after the print-mode
    ceiling, and the resume prompt names the solver as the cause.
  - No background task: a hang is still stopped after the 30 s close timeout.
  - With the old `claude.lib.mjs` and `claude.print-turn.lib.mjs`, 3 of these
    tests fail.

## Same pattern elsewhere

- **`agent`, `codex`, `opencode`, `gemini`, `qwen`:** these runners also set
  `exitCode = chunk.code` on exit chunks. None of them signals its CLI after a
  result event, so a non-zero code there comes from the tool itself, and failing
  on it is correct. The generic `extractToolErrorCore` guard covers the
  summary-as-error symptom for all of them.
- **`session-progress.lib.mjs`:** this prefers `resultSummary` for the final
  progress message, which is correct for progress output.

## Research: existing components and upstream reports

- **command-stream:** since js-v0.12.0, `stream()` yields `{ type: 'exit', code }`,
  and a signal death is reported as 128 + signal. This is documented, intended
  behavior and matches shell conventions. It also exposes `pid` on the runner,
  which `isProcessGroupAlive` uses.
- **Claude Code print-mode background wait:** `claude -p` keeps running after
  the main thread goes idle while background tasks (Bash `run_in_background`,
  auto-backgrounded long commands, Agent) are running. It stops them after
  `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`, with 0 meaning no limit. See
  [Issue #2301](../issue-2301/README.md) for how this was found and why
  hive-mind raised the ceiling. The stream reports the task set through
  `system` events (`task_started`, `task_updated`, `background_tasks_changed`,
  `task_notification`), which is what the new tracker reads. No library wraps
  this, and the Claude Agent SDK exposes the same events, so reading the stream
  is the direct approach.
- **Claude Code CLI not exiting after `result`:**
  [anthropics/claude-code#25629](https://github.com/anthropics/claude-code/issues/25629)
  ("CLI hangs indefinitely after sending result event in stream-json mode"),
  [#21099](https://github.com/anthropics/claude-code/issues/21099) and
  [#50777](https://github.com/anthropics/claude-code/issues/50777) (MCP servers not
  cleaned up). The common workaround is the one hive-mind already uses: treat the
  `result` event as final and kill the process after a grace period. That is
  still right when nothing is pending, but not while print mode is waiting for
  background tasks (root cause 4).
- **POSIX:** `kill(-pgid, 0)` checks that a process group exists without sending
  a signal. `EPERM` means it exists but belongs to another user, so it counts as
  alive. Zombies still count as group members, so on hosts whose PID 1 does not
  reap orphans the SIGKILL may be sent to an already-dead group. That is harmless.

### Upstream reports

None filed:

- The command-stream behavior is correct; the bug was hive-mind's handling of it.
- The Claude Code hang is already reported upstream several times, listed above,
  and hive-mind has a working mitigation.
- Claude Code waiting for background tasks after its result is documented
  behavior that hive-mind configures on purpose (Issue #2301), not a bug. The
  bug was hive-mind's 30 s timer, which did not take that wait into account.

## Previous attempt on this issue

The first automated attempt on this issue (2026-10-10 11:22, `--tool agent --model formal-ai`,
[dev log](../../../dev/log/issues/3015/pulls/3018/sessions/ses_eda726347ffeIC0wClAGrH2NgC/solve.log))
ended within a minute. The model answered "Let me open e.g and read what it says.",
tried to read the nonexistent file `e.g`, and the run ended with
`AGENT execution failed with Agent reported error: Error: File not found: …/e.g`.
That is a genuine model failure, correctly reported, so it is only recorded here.
