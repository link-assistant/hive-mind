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

| File                                                                                         | Content                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`data/issue.json`](data/issue.json), [`data/issue-comments.json`](data/issue-comments.json) | Issue snapshot. The issue had no comments when the fix was written.                                                                                                                                                                                                                                 |
| [`data/pr-2824-failure-comment.json`](data/pr-2824-failure-comment.json)                     | The published failure comment.                                                                                                                                                                                                                                                                      |
| [`data/solve-pr-2824-sanitized.log.txt.gz`](data/solve-pr-2824-sanitized.log.txt.gz)         | The full sanitized solve log from the [gist](https://gist.githubusercontent.com/konard/63de244f19f96d70c6bcb7c22026b84f/raw/7ab53753185d137f3d37b3a59255be442159533e/tmp-hive-mind-log-upload-BklTWB-sanitized.log.txt), 8 MB gzipped to 2.4 MB. Line numbers below refer to the uncompressed file. |

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

The same comment says `**Model: Claude Opus 5** (claude-opus-5)` although the result's
`modelUsage` says `claude-opus-5-5`. That is [Issue #2840](../issue-2840/README.md),
already fixed in v2.35.0, so it is not part of this fix.

## Requirements from the issue

1. Download all logs and data to `docs/case-studies/issue-3015`. Done, see [Data](#data).
2. Reconstruct the timeline. Done, see Timeline.
3. Find the root cause of each problem. Done, see [Root causes](#root-causes).
4. Propose solutions and check existing components and libraries. Done, see [Fix](#fix) and [Research](#research-existing-components-and-upstream-reports).
5. Add debug output if the root cause is unclear. The root cause is clear. The ignored exit code is still logged in verbose mode.
6. Report issues upstream where applicable. Not needed, see [Upstream](#upstream-reports).
7. Apply the fix across the whole codebase. Done, see [Same pattern elsewhere](#same-pattern-elsewhere).

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

### Why the CLI did not exit

Not exiting after the `result` event is a known Claude Code CLI problem. It is
why the 30 s timeout exists (Issue #1280). In this run the last background task
("Mark PR ready", line 55409) had completed and `subagent_stats` shows no live
sub-agents, so the solver log does not reveal what kept the process alive.
Upstream reports blame lingering child stdio such as MCP servers (see below).
hive-mind does not need to know the cause: the `result` event is the verdict,
and stopping the CLI afterwards is housekeeping.

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
- **Claude Code CLI not exiting after `result`:**
  [anthropics/claude-code#25629](https://github.com/anthropics/claude-code/issues/25629)
  ("CLI hangs indefinitely after sending result event in stream-json mode"),
  [#21099](https://github.com/anthropics/claude-code/issues/21099) and
  [#50777](https://github.com/anthropics/claude-code/issues/50777) (MCP servers not
  cleaned up). The common workaround is the one hive-mind already uses: treat the
  `result` event as final and kill the process after a grace period.
- **POSIX:** `kill(-pgid, 0)` checks that a process group exists without sending
  a signal. `EPERM` means it exists but belongs to another user, so it counts as
  alive. Zombies still count as group members, so on hosts whose PID 1 does not
  reap orphans the SIGKILL may be sent to an already-dead group. That is harmless.

### Upstream reports

None filed:

- The command-stream behavior is correct; the bug was hive-mind's handling of it.
- The Claude Code hang is already reported upstream several times, listed above,
  and hive-mind has a working mitigation.

## Previous attempt on this issue

The first automated attempt on this issue (2026-10-10 11:22, `--tool agent --model formal-ai`,
[dev log](../../../dev/log/issues/3015/pulls/3018/sessions/ses_eda726347ffeIC0wClAGrH2NgC/solve.log))
ended within a minute. The model answered "Let me open e.g and read what it says.",
tried to read the nonexistent file `e.g`, and the run ended with
`AGENT execution failed with Agent reported error: Error: File not found: …/e.g`.
That is a genuine model failure, correctly reported, so it is only recorded here.
