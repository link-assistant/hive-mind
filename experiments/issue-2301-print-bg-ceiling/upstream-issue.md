### Preflight Checklist

- [x] I have searched [existing issues](https://github.com/anthropics/claude-code/issues?q=is%3Aissue+label%3Abug) and this hasn't been reported yet. Related but different: #85066 (headless run exits "success" with orphaned subagents), #95789 (the ceiling kill does not record its cause for the next session), #89495 (auto-backgrounded Bash in `-p`). This report is about **when** the ceiling fires and what `-p` reports afterwards.
- [x] This is a single bug report (please file separate reports for different bugs)
- [x] I am using the latest version of Claude Code (2.1.284)

### What's Wrong?

`claude -p` waits for background tasks only up to `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` (600000 ms by default). That ceiling counts from the **main thread's last message**, not from the background tasks' last progress. So subagents that are actively working (writing files, running tests) are killed exactly 600 s after the main thread went quiet. The run then ends with `result.subtype: "success"`, `terminal_reason: "completed"`, empty `permission_denials` and **exit code 0**. The only signal is one line on stderr and `subagent_stats.killed.system`.

For autonomous use (CI, orchestrators such as [Hive Mind](https://github.com/link-assistant/hive-mind)) this means an expensive run silently loses its work, and the host has to scrape stderr and count `task_notification` events to find out. We hit it three times in production in four days:

| Run (Claude Code)                                             | Main thread idle from | Ceiling line on stderr | Killed                                    | Result            |
| ------------------------------------------------------------- | --------------------- | ---------------------- | ----------------------------------------- | ----------------- |
| 2026-09-25 (2.1.282), 5 background agents                     | 18:43:50.108          | 18:53:50.418           | `killed.system: 5`, 0 completed           | `success`, exit 0 |
| 2026-09-28 (2.1.284), 11 worktree agents, 2 h 32 min, $110.03 | 21:53:55.139          | 22:03:56.680           | `killed.system: 9` (+ stopped Bash tasks) | `success`, exit 0 |
| 2026-09-29 (2.1.284), 3 agents + 1 nested, 44 min, $30.01     | 07:07:55.054          | 07:17:55.202           | `killed.system: 4`, 0 completed           | `success`, exit 0 |

In the third run, the subagents never stopped working. One of them started `pytest` at 07:17:53.016, **2 s before** it was killed. Finished background Bash tasks had woken the main thread twice during the run (06:51:49, 07:07:45), so wake-ups work; only the final 600 s after its last message counted.

`--dangerously-skip-permissions` was set in all runs. No person was present.

Related behaviour seen in the same runs (all in the same wind-down code path; happy to split out if preferred):

1. **Cancellation is worded as a user decision.** Each killed subagent gets `[Request interrupted by user]` and tool results `The user doesn't want to proceed with this tool use…` / `tool_use_result: "User rejected tool use"`. Hosts that treat that text as a real rejection report a false "user rejected" failure.
2. **`result` events are held back until exit.** In the third run, the results of the three main-thread turns that ended at 06:49:45, 07:01:44 and 07:07:55 were all written at 07:17:55, after the sweep. A host cannot tell from the stream that the main thread has been idle for 10 minutes.
3. **Background Bash is not counted.** A background `sleep 90` is stopped about 4 s after the `result`, without the stderr line and with `killed.system: 0`.
4. **`--resume` replays the stale kill.** Resuming the session first emits the old `task_notification status=stopped` and an empty `result` (`num_turns: 0`, `success`) before the real turn. A host that checks the first `result` sees a false "done".

### What Should Happen?

In priority order:

1. **Measure the ceiling from the background tasks' last progress** (tool calls, output, messages), not from the main thread's last message. A subagent that is still running commands should not be killed by an idle timer.
2. **Don't report `success` when work was cancelled.** Use a non-success subtype or a `terminal_reason` such as `background_tasks_terminated`, list the stopped task IDs in `result`, and/or exit non-zero.
3. **Before the sweep, give the main thread one last turn** saying which tasks are about to be stopped, so it can finish them in the foreground or save their state.
4. Use cancellation text that does not mention a user, for example `[Cancelled: print-mode background wait ceiling reached]`.
5. Count stopped `local_bash` tasks in `subagent_stats` (or add a `tasks_killed` count), emit each `result` when its turn ends, and do not replay settled notifications on `--resume`.

### Error Messages/Logs

```shell
# stderr (the only direct signal):
Background tasks still running after 600s; terminating. Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely.

# third run, subagent activity right before the sweep (timestamps from the host log):
07:07:55.054  main thread: "CI is fully green on 741fcc9 … Still running: three background agents …"   <- last main-thread message
07:17:53.016  subagent (Python port): Bash "timeout 600 .venv/bin/pytest tests/unit -q …"                    <- still working
07:17:55.202  stderr: Background tasks still running after 600s; terminating.                           <- 600.1 s after 07:07:55
07:17:55.310  task_notification status=stopped  (x4)
07:17:55.372  result subtype=success num_turns=99 (turn ended 06:49:45) terminal_reason=completed permission_denials=[] subagent_stats.killed.system=4
07:17:55.394  result subtype=success num_turns=55 …   (turn ended 07:01:44)
07:17:55.421  result subtype=success num_turns=2  …   (turn ended 07:07:55)
exit code 0

# inside each killed subagent:
{"type":"user","parent_tool_use_id":"toolu_…","message":{"content":[{"type":"text","text":"[Request interrupted by user]"}]}}
{"type":"user","parent_tool_use_id":"toolu_…","tool_use_result":"User rejected tool use", …}
```

Full logs: [third run](https://gist.githubusercontent.com/konard/97c3a1eb9c57b52512e3a999724cccf8/raw/6e1935a7b02d6a0efc1c6250b4985954debbc32f/tmp-hive-mind-log-upload-zYtTNW-sanitized.log.txt) (16.7 MB), [second run](https://raw.githubusercontent.com/konard/public-logs/main/tmp-hive-mind-log-upload-2nNBS9/08e10c4fbb284728/sanitized.log.txt) (63 MB), and the [case study with line references](https://github.com/link-assistant/hive-mind/blob/issue-2301-1462dcec50ad/docs/case-studies/issue-2301/README.md).

### Steps to Reproduce

Full script: [`repro-ceiling.sh`](https://github.com/link-assistant/hive-mind/blob/issue-2301-1462dcec50ad/experiments/issue-2301-print-bg-ceiling/repro-ceiling.sh), captures in [`captured/`](https://github.com/link-assistant/hive-mind/tree/issue-2301-1462dcec50ad/experiments/issue-2301-print-bg-ceiling/captured). It lowers the ceiling to 8 s so it runs in about a minute:

```bash
mkdir /tmp/repro && cd /tmp/repro && git init -q
CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=8000 claude -p \
  "Launch exactly one Agent (subagent_type general-purpose, run_in_background true) whose prompt is: 'Run the Bash command: for i in 1 2 3 4; do sleep 4; done; echo DONE — then reply with its output.' Then end your turn with the text LAUNCHED plus the agent's reply if you have it." \
  --output-format stream-json --verbose --model haiku --dangerously-skip-permissions > run.jsonl
echo "exit=$?"
grep -o '"status":"stopped"\|"killed":{[^}]*}\|User rejected tool use\|Request interrupted by user\|"subtype":"success"' run.jsonl | sort | uniq -c
```

Observed: the stderr ceiling line, `status: stopped`, `killed.system: 1`, `[Request interrupted by user]` and `User rejected tool use` inside the subagent, `subtype: success`, and `exit=0`. The subagent was running `sleep` the whole time.

Then `claude -p --resume <session-id> "Continue" …` first prints the replayed `stopped` notification and a `result` with `num_turns: 0` before the real turn.

With `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=40000` the same prompt completes: the agent finishes, its notification wakes the main thread, and a second `result` contains `DONE`.

### Workarounds we use

- Raise the ceiling (we use `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=2400000`, 4x the default). We do not use `0`: that waits forever, so one stuck task would hang an unattended run.
- Detect the sweep on the host (the stderr line, or any `task_notification status=stopped` after the last main-thread assistant message) and `--resume` the same session with a prompt that says it was a timeout, not the user, and lists the cancelled tasks and their output files ([hive-mind#2302](https://github.com/link-assistant/hive-mind/pull/2302)). In our live test the resumed turn read the partial output, redid the work in the foreground and finished.
- `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` avoids the problem but removes background work entirely, so we don't consider it a fix.

### Claude Model

Opus (production runs); Haiku (repro)

### Is this a regression?

I don't know

### Claude Code Version

2.1.284 (Claude Code); first seen on 2.1.282

### Platform

Anthropic API

### Operating System

Ubuntu/Debian Linux

### Terminal/Shell

Non-interactive/CI environment

### Additional Information

Reported downstream in [link-assistant/hive-mind#2301](https://github.com/link-assistant/hive-mind/issues/2301). Earlier details on #85066: [comment 1](https://github.com/anthropics/claude-code/issues/85066#issuecomment-5842704259), [comment 2](https://github.com/anthropics/claude-code/issues/85066#issuecomment-5885429221).
