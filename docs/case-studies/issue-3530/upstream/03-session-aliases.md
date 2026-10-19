## Summary

An execution cannot be given another name after it starts, and two executions of one task cannot be linked. Supervisors therefore end up with several ids per task, and users have to know which one to pass to `$ --status` / `--upload-log`.

Two related requests:

1. **Aliases.** Let a session or execution be renamed (or given an extra name) while it runs, and keep every earlier name as an alias, so `$ --status <any alias>` and `$ --upload-log <any alias>` resolve to it. Use case: start with a random UUID, and once the AI tool reports its own session id, add that as an alias. Then the AI session, the start-command session and the Docker container can all be found under the same UUID.
2. **Continuation.** Let a new launch declare that it continues an earlier execution (`--continues <uuid>`), so that `$ --status` lists the chain and `--upload-log <any id of the chain>` uploads the whole log, every attempt oldest first. This is what a supervisor needs when it has to relaunch fresh rather than `$ --resume` in place (see #229 on reusing `--session-id`).

Found in [link-assistant/hive-mind#3530](https://github.com/link-assistant/hive-mind/issues/3530). start-command 0.37.8 already has the storage for (1): `options.sessionNameHistory` (#162) is filled when `$ --resume` has to give a session a new name, and `--status` resolves through it. But no option lets a caller add a name, and an execution UUID cannot have an alias. (2) does not exist.

## Reproduction

```bash
U=$(cat /proc/sys/kernel/random/uuid); A=$(cat /proc/sys/kernel/random/uuid)
$ --isolated screen --detached --session "$U" --session-id "$U" -- sleep 30
# no command or option adds "$A" as a second name for this execution:
$ --status "$A"     # Error: No execution found with UUID or session name
```

## Expected

```bash
$ --alias "$U" "$A"           # or: $ --rename "$U" "$A" (keeps "$U" as an alias)
$ --status "$A"               # same execution; `aliases: [U, A]`
$ --isolated docker --detached --session "$B" --session-id "$B" --continues "$U" -- cmd
$ --upload-log "$B"           # one file: attempt 1 (U), attempt 2 (B)
```

## Workaround used in hive-mind

Hive-mind launches with `--session U --session-id U`, passes the task id into the task so that `claude --session-id U` makes the AI session match, and keeps the chain of relaunches in its own append-only audit log. Its `/log` command joins the logs of every attempt, and its Telegram messages show only the latest id ([hive-mind PR #3531](https://github.com/link-assistant/hive-mind/pull/3531)).

## Suggested fix

1. Reuse `options.sessionNameHistory` (already resolved in `lib/execution-store.js`): `$ --alias <id> <new>` appends `<new>` to it, and `$ --rename <id> <new>` moves the current name there and sets the new one. Both reject a name that already resolves to another execution. Also allow a UUID-shaped alias to resolve wherever an execution UUID is accepted (`--status`, `--upload-log`, `--resume`, `--stop`).
2. Add `continues: <uuid>` to the record. `--status` walks the chain and prints it; `--upload-log` concatenates the logs with attempt headers (the format `$ --resume` already writes).

## Status

Fixed in start-command 0.38.0 (issue closed 2026-10-19): `--alias`, `--rename` and `--continues <id>`, with `aliases` and `chain` in `$ --status`. hive-mind does not need them for new recoveries, which stay one execution through `--append-attempt` (`sessionNameHistory` keeps the earlier container names); its local chain and `/log` join remain for sessions recovered by an older start-command.
