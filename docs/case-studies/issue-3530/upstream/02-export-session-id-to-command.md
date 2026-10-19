## Summary

The command started by `$` is not told its own session or execution id. `env` inside the command shows no variable holding either (verified on 0.37.8 for direct runs and `--isolated screen`; Docker isolation only gets what the caller passes with `-e`).

A task that knows its id can reuse it in the layers below. For example, `claude --session-id <uuid>` can make the AI session id equal to the start-command execution id, so one task has one id everywhere. A task can also print the id in its own comments, or name its artifacts after it.

Found in [link-assistant/hive-mind#3530](https://github.com/link-assistant/hive-mind/issues/3530).

## Reproduction

```bash
V=$(cat /proc/sys/kernel/random/uuid)
$ --session-id "$V" -- env | grep -cE "^[A-Za-z_][A-Za-z0-9_]*=.*$V"   # 0
```

## Expected

Every backend (direct, screen, tmux, docker, ssh) exports, for example:

- `START_EXECUTION_ID=<execution uuid>`
- `START_SESSION_NAME=<--session value>`
- `START_ATTEMPT=<n>` (1 for the first run, n for the n-th `--resume`), next to the existing `START_COMMAND_RECOVERY_ATTEMPT` for kill recovery.

## Workaround used in hive-mind

The supervisor sets the variable itself: `-e HIVE_MIND_TASK_SESSION_ID=<uuid>` for Docker, and a `HIVE_MIND_TASK_SESSION_ID=<uuid> ` prefix on the shell command for screen/tmux ([hive-mind PR #3531](https://github.com/link-assistant/hive-mind/pull/3531)). This has to be done per backend, and `$ --resume <uuid> -- <new command>` would lose the prefix unless the caller repeats it.

## Suggested fix

Where the child environment is built for each backend, add the variables to the env passed to `spawn`. For Docker add `-e START_EXECUTION_ID=…`, and for ssh prepend `export …;` to the remote command. On `--resume`, set `START_ATTEMPT` to the new attempt number. A test: `$ --session-id X -- sh -c 'echo $START_EXECUTION_ID'` prints `X` for each backend.
