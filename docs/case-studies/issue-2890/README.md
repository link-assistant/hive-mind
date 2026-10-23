# Case study: issue #2890, the solve queue is lost when the root container restarts

## Data

- [data/issue-2890.md](data/issue-2890.md): the issue text, with the 32 lost queue items (27 codex, 5 claude).
- Related: #2887, #2888, #2889 (kill recovery after the same incident), #2917 (the processing count of docker tasks).
- [The associative tech stack](https://github.com/link-assistant/formal-ai/blob/main/docs/associative-tech-stack.md), the storage model the issue asks for.
- [link-foundation/link-cli](https://github.com/link-foundation/link-cli): the `clink` tool, published on NuGet as `clink` (4.0.2 checked here).

## Timeline (2026-10-09, UTC)

1. 12:11:39: the kernel OOM-kills the host `dockerd` (7.3 GB RSS, about 22 parallel `docker diff` calls; link-foundation/disk-space-saviour#22). systemd restarts it and every container gets SIGKILL (exit 137): the root `hive-mind` container and four `/codex` tasks.
2. The bot's last `/limits` before the crash: `claude (pending: 5, processing: 1)`, `codex (pending: 27, processing: 4)`.
3. 13:31: the root container is started again by hand. `/queue` shows `Completed: 0, Failed: 0` and every queue is at `pending: 0`. The 32 queued tasks are gone.
4. An external script rebuilds the list from the old container log (`Enqueued:` / `Starting:` / `raw text:` lines) and replays it.

## Requirements

| #   | Requirement                                                                                                  | Status                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Persist every queue item (command, args, requester, chat and message ids, tool, status, times) and the state | Done for the queue: items, the launched and failed history, the start-interval state and the stats. Tracked sessions and recovery attempts were already in `sessions.json` (same state directory).                                                                                                   |
| R2  | Triple storage: a binary doublets store, a `.lino` projection and a link-cli database                        | Partly. Stores: an atomic `queue.json`, an atomic `queue.lino` and the `clink` doublets database `queue.links` (binary and queryable with `clink --db`). Each restores the queue alone. The `clink` copy needs the .NET tool, which the images do not ship, so it is off when the binary is missing. |
| R3  | Keep it on a host volume and document the mount                                                              | Done: `~/.hive-mind/state/` (`HIVE_MIND_STATE_DIR`), and `docs/DOCKER*.md` describe `-v /root/.hive-mind/state:/home/box/.hive-mind/state`.                                                                                                                                                          |
| R4  | On startup re-enqueue in order, reconcile `starting` items with `$ --list` and containers, tell the chat     | Done. An interrupted launch goes back to the head of its queue unless a container, a `$ --list` record or a tracked session already runs it. Each chat gets one message listing what came back.                                                                                                      |
| R5  | Fall back to Telegram messages, then to the bot log                                                          | The log fallback is done (`EVENT queue_item_*` lines plus the older `Enqueued:` / `Starting:` / `raw text:` lines). The Telegram fallback is not possible: the Bot API cannot read chat history or fetch an old message by id.                                                                       |
| R6  | Tests: kill the bot and the container with items queued, processing and in recovery                          | A kill simulation in `tests/issue-2890-queue-persistence.test.mjs`: queue A persists, dies without a final flush, queue B restores and runs each task once. No test kills a real container.                                                                                                          |

## Root causes

1. `SolveQueue` kept `queues`, `processing`, `completed` and `failed` in memory only.
2. The bot state directory lived in the container's writable layer unless the operator mounted it, so a `docker rm` or a redeploy lost `sessions.json` too.
3. Nothing at startup read old state back into the queue. The only durable trace was the bot log, and only an external script read it.

## Solution

- `src/solve-queue-store.lib.mjs` serializes items without the Telegraf context. It writes `queue.json` and `queue.lino` atomically (temporary file plus rename) after each change, with a short debounce, and `flushSync()` runs in the exit handler. `load()` tries json, then lino, then clink, then the bot log.
- `src/solve-queue-clink.lib.mjs` projects the snapshot onto named doublets (one link per queried field plus a lossless `.record` link) and imports it into a fresh database that replaces the old one only after a successful import.
- `src/solve-queue-log-recovery.lib.mjs` rebuilds the queue from the bot logs (newest files first, up to 64 MiB).
- `src/solve-queue-restore.lib.mjs` hooks the queue (`enqueue`, `cancel`, `executeItem`, rejections, message ids), writes `EVENT queue_item_*` log lines, and restores on launch: it rebuilds the Telegram context from the stored chat and requester ids, reconciles interrupted launches and sends the restore notice.
- `src/solve-queue-bot-wiring.lib.mjs` connects all of this to `src/telegram-bot.mjs` with a few calls: set up at start, restore after `resumeSessionsOnLaunch()`, stop and flush on exit.

## clink feasibility

- `dotnet tool install --global clink` installs link-cli 4.0.2. With it (`HIVE_MIND_CLINK_PATH=/path/to/clink`), the test "the link-cli database restores the queue when both text stores are gone" passes. One import or export takes about a second.
- clink 4.x drops a backslash inside a quoted name and keeps the links of a failed import. Values with a backslash, a newline or both quote kinds are therefore stored as base64, and every write goes to a new database first.
- The Docker images have no .NET runtime, so in production the clink copy is off until the images ship it. The json and lino copies carry the queue alone. `HIVE_MIND_QUEUE_CLINK=0` turns it off explicitly.

## Upstream reports

Both link-cli bugs were reproduced with clink 4.0.2 (`4.0.2+7f5dc4b4fd76c4b09ea783db81f801cc757cb4fb`) before filing:

- [link-foundation/link-cli#128](https://github.com/link-foundation/link-cli/issues/128): `--import` drops a backslash inside a quoted name. `(a: a 'x\y')` is exported as `(a: a xy)`. Workaround: values that contain a backslash, a newline or both quote kinds are stored as base64. Suggested fix: keep `\` literally, or define and document the escapes.
- [link-foundation/link-cli#129](https://github.com/link-foundation/link-cli/issues/129): `--import` is not atomic. A malformed line 3 exits 1, but the links from lines 1–2 stay. Workaround: every write imports into a fresh database first. Suggested fix: parse the whole file before writing, or use one transaction.

Not filed: link-assistant/hive-mind images could ship the .NET runtime and `clink`, so the doublets store is on by default. That needs a decision on image size, not a bug report. Workaround: install it in a derived image and set `HIVE_MIND_CLINK_PATH`.

## Limits

- No Telegram-history fallback (not possible with the Bot API).
- No end-to-end test that kills a real bot container.
- The binary doublets store is optional (see clink feasibility).
