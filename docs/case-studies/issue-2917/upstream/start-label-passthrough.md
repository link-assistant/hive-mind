## Problem

`$ --isolation docker` gives callers no way to put **labels** on the task container. `--env` exists, `--label` does not (start-command 0.36.0, `src/lib/args-parser.js`, `src/lib/docker-runtime-args.js`). The container's identity is only its name (the `--session` value, or `<name>-resume-<n>` after `$ --resume`).

A supervisor that launches many tasks through `$` (here the hive-mind Telegram bot) therefore cannot attribute running containers with `docker ps --filter label=…`. It matters exactly when the execution store is unreliable, as in #193: a resumed container keeps running while `$ --status` / `$ --list` report the previous attempt (`executed 137`). In link-assistant/hive-mind#2917, four running `/codex` task containers were counted as **0** by the bot's queue and `/limits`. The bot's in-memory registry had already reported them finished, and `pgrep` cannot see a sibling container's processes. The bot then kept dispatching new tasks onto a host that had just OOM-killed dockerd.

## Reproduction

```sh
$ --version                                   # 0.36.0
$ --isolation docker --image alpine:3.20 --session demo-1 --detached \
    --label hive-mind.tool=codex -- sleep 600
# → Unknown wrapper option: --label (the task never starts)

# Without the label it starts, but nothing on the container says what it is:
$ --isolation docker --image alpine:3.20 --session demo-1 --detached -- sleep 600
docker inspect -f '{{json .Config.Labels}}' demo-1
# → only the image's labels; no session, uuid or caller-provided attribution
```

## Workaround (used by hive-mind#2917)

Pass the attribution as environment variables with the existing `--env`, then read them back with `docker inspect`:

```sh
$ --isolation docker --session "$UUID" --detached \
    -e HIVE_MIND_TOOL=codex -e HIVE_MIND_TASK_URL=https://github.com/o/r/issues/1 -- solve …
docker ps -q --no-trunc | xargs docker inspect --format '{{.Name}} {{json .Config.Env}}'
```

This works across `$ --resume`. `docker commit` copies the container's `Config.Env` (and `Config.Labels`) into the snapshot image config, so `<name>-resume-<n>` inherits them; this was checked with docker 29.8.0. It is still a workaround. Env cannot be filtered server-side (`docker ps --filter env=` does not exist), so every running container must be inspected. The values are also visible to the task's own processes.

## Suggested fix

1. Add a repeatable `--label <KEY=VALUE>` (docker only), parsed like `--env`. Push `['--label', value]` in `buildDockerRuntimeArgs()`, so both `docker run` and the snapshot resume path in `execution-resume.js` (which already calls `buildDockerRuntimeArgs({ ...opts, resourceLimits })`) apply it. Store the labels in the execution record next to `env`, so `$ --resume` re-applies them even if the image config is replaced.
2. Always add start-command's own labels, for example:
   - `start-command.session=<session name>`
   - `start-command.root-session=<name without -resume-<n> suffixes>`
   - `start-command.uuid=<execution uuid>`
   - `start-command.resume-count=<n>`

   `docker ps --filter label=start-command.root-session=<uuid>` would then find the live container of a session chain, even when the execution record is stale (#193).

3. Optionally, let `$ --status <name>` fall back to `docker inspect` liveness for a docker execution whose record is terminal while a `<name>-resume-*` container is running.

Related: #193 (resume starts the container but fails to save the record), link-assistant/hive-mind#2917.
