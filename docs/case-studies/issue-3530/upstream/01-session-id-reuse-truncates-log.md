## Summary

A new launch with `--session-id <uuid>` for an execution id that already exists silently replaces that execution: its record is overwritten (the earlier attempts disappear from `$ --status`), and **its log file is truncated**, so the output of every earlier attempt is lost. There is no warning and the exit code is 0.

`--session-id` is the only way for a supervisor to give a task one id across start-command, its log file and its container, and it is exactly the id a supervisor wants to keep when it has to relaunch a task (for example after an OOM kill, when an in-place `$ --resume` is not possible). Today the only safe choice is a new id per relaunch, which splits one task across several executions and log files.

Found in [link-assistant/hive-mind#3530](https://github.com/link-assistant/hive-mind/issues/3530) (start-command 0.37.8, Linux 6.8).

## Reproduction

```bash
U=$(cat /proc/sys/kernel/random/uuid)
LOG=/tmp/start-command/logs/isolation/screen/$U.log

# 1. one id for session, execution and log
$ --isolated screen --detached --session "$U" --session-id "$U" -- sh -c 'echo first-run-output'
sleep 3; grep -c first-run-output "$LOG"     # 2

# 2. an in-place resume keeps the id and appends attempt 2 — good
$ --resume "$U"
sleep 3; grep -c first-run-output "$LOG"     # 3

# 3. a new launch that reuses the execution id
$ --isolated screen --detached --session "other-$U" --session-id "$U" -- sh -c 'echo second-launch-output'
sleep 3; grep -c first-run-output "$LOG"     # 0  <- earlier attempts are gone
$ --status "$U"                              # only the second launch; attemptHistory is gone
```

Full script and its output: [experiments/issue-3530-start-session-id-reuse.sh](https://github.com/link-assistant/hive-mind/blob/issue-3530-6f80c2bef5a1/experiments/issue-3530-start-session-id-reuse.sh).

## Expected

Either of these, never silent data loss:

1. **Refuse** (preferred as the default): exit non-zero with `execution <uuid> already exists; use $ --resume <uuid> -- <command> to continue it, or pass --append-attempt`.
2. **Append** a new attempt, the way `$ --resume` already does: keep the record, add an `attemptHistory` entry with the new command, and append to the same log after an attempt boundary (`logOffset`), so `$ --status`, `--upload-log` and the log file cover every attempt.

## Workaround used in hive-mind

Hive-mind launches each task with `--session U --session-id U` (one id for session, execution, log and container), keeps the same id for in-place `$ --resume`, and uses a **new** id whenever it has to relaunch fresh. It records the chain (`previousExecutionUuids`, `rootSessionName`) in its own append-only audit log, and its Telegram `/log` command joins all attempts' logs into one file ([hive-mind PR #3531](https://github.com/link-assistant/hive-mind/pull/3531)).

## Suggested fix

In the code that creates the execution record for a launch with an explicit `--session-id`: look the id up first. If a record exists, either fail with the message above, or reuse it like the resume path does: push the old attempt to `attemptHistory`, write an attempt header and set `logOffset`. Write the new header with the existing `appendLogFile` instead of `writeLogFile` (`lib/isolation-log-utils.js`, which calls `fs.writeFileSync(logPath, …)` and truncates the earlier attempts). A regression test: launch twice with the same `--session-id` and assert that the first run's output is still in the log, or that the second launch fails.

## Status

Fixed in start-command 0.38.0 (issue closed 2026-10-19): a reused `--session-id` is refused unless `--append-attempt` is given, which archives the previous attempt and appends to the same log. hive-mind now relaunches a recovery in a new container as `--session <new container> --session-id <task uuid> --append-attempt` (see `experiments/issue-3530-append-attempt.sh`).
