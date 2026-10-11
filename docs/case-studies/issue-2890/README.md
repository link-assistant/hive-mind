# The solve queue did not survive a root container restart

[Issue #2890](https://github.com/link-assistant/hive-mind/issues/2890) reports
that a host dockerd OOM kill took the root `hive-mind` container down with it,
and that the 32 commands queued in the Telegram bot were lost.
[PR #2896](https://github.com/link-assistant/hive-mind/pull/2896) makes the solve
queue durable. It is kept in a links triple store on a host volume. The PR also
adds a pinned Telegram copy and the bot log as fallbacks. On launch, the bot
restores the queue by itself and tells each chat what came back.

## Evidence and scope

- [data/issue.json](data/issue.json) is a snapshot of the issue; it has no
  comments ([data/issue-comments.json](data/issue-comments.json)).
- All three PR comment surfaces were collected:
  - [conversation](data/pr-conversation-comments.json);
  - [inline review comments](data/pr-review-comments.json);
  - [reviews](data/pr-reviews.json).

  The only PR comments are a failure report from an earlier session and the
  work-session notice. The failure was
  `File not found: /tmp/gh-issue-solver-1791558797807/e.g`, an agent execution
  error rather than a defect in the software.

- [data/lost-items.txt](data/lost-items.txt) is the list of lost items taken from
  the issue: 32 items, 27 codex and 5 claude.
- The related kill-recovery issues from the same incident are saved as
  [#2887](data/issue-2887.json), [#2888](data/issue-2888.json) and
  [#2889](data/issue-2889.json).
- The issue that caused the OOM is saved as
  [data/upstream-disk-space-saviour-22.json](data/upstream-disk-space-saviour-22.json)
  (closed).

The production state directory is not part of this case study. It holds the
router signing secret (`router-sidecar.json`), so all evidence here was
produced from synthetic queues.

**Scope.** This case study covers the solve queue and the bot state it depends
on. Kill recovery of the tasks themselves is tracked in #2887–#2889. The other
queues in the codebase rebuild themselves from GitHub, so they need no local
state:

- `hive.mjs` fills its `IssueQueue` (`src/hive.issue-queue.lib.mjs`) from the
  issue listing on every cycle.
- `/merge` (`src/telegram-merge-queue.lib.mjs`) reads the PRs with the `ready`
  label.

So the solve queue was the one piece of state that existed nowhere but in
memory.

## Timeline

All times are UTC.

| Time                     | Event                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-08 20:48:59      | The oldest of the lost items is queued (`solve-1791492539982-n8kgdbr`, from the timestamp in its id).                                                                                                                                                                                                 |
| 2026-10-09 09:45:39      | The newest lost item is queued (`solve-1791539139024-ej3vmmv`). The last `/limits` shows `claude (pending: 5, processing: 1)` and `codex (pending: 27, processing: 4)`.                                                                                                                               |
| 2026-10-09, before 12:11 | A disk-space-saviour `npm test` inside the root container runs about 22 concurrent `docker diff` calls on that container through the host socket. The host dockerd grows to 7.3 GB RSS on an 11.7 GB host ([disk-space-saviour#22](https://github.com/link-foundation/disk-space-saviour/issues/22)). |
| 2026-10-09 12:11:39      | The kernel OOM-kills the host dockerd. systemd restarts it. `live-restore` is disabled, so every container is killed (exit 137): the root container and the four codex tasks router#724, #725, #727 and #728.                                                                                         |
| 2026-10-09 12:11 – 13:31 | The bot is down. The queue lived only in the dead process. `sessions.json` and the logs lived in the container's writable layer.                                                                                                                                                                      |
| 2026-10-09 13:31         | The root container is started again by hand. Kill recovery resumes the tasks (#2887–#2889). `/queue` shows `Completed: 0, Failed: 0`, and every queue shows `pending: 0`.                                                                                                                             |
| later                    | An external script (`auto-recovery.mjs`) replays the 32 items from the `Enqueued:`, `Starting:` and `raw text:` lines that the old container log still had.                                                                                                                                           |

**Unknown.** The incident notes do not say why `--restart unless-stopped` did
not bring the root container back when dockerd restarted.

## Requirements and solutions

| #   | Requirement (from the issue)                                                                                                                                                                             | Solution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Verified by                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Persist every item (command, args, requester, chat and message ids, tool, status, timestamps) and the rest of the state: sessions, recovery attempts, throttling and start interval, edited message ids. | **`SolveQueue.notifyStateChange()`** fires on enqueue, restore, start, session assignment, message edit, finish, cancel, reject and start record.<br>**`createSolveQueuePersistence()`** writes a snapshot on every change, coalesced into one save at a time. The snapshot holds every queued, waiting and starting item, the per-tool and global start times, and the statistics.<br>**`sessions.json`** already held the tracked sessions and the kill-recovery counters (`killRecoveryAttempts`, `killRecoveryOfSession`). It now sits on the same volume.                                                                                                                                                                                                                                                 | `test-issue-2890-solve-queue-persistence.mjs`, `test-issue-2890-solve-queue-kill.mjs`                                               |
| 2   | Triple storage on the associative stack: binary doublets via link-cli, an atomic `.lino` projection, and a link-cli database. Each must be able to rebuild the others.                                   | **`src/solve-queue-store.lib.mjs`** stores three copies:<br>- `solve-queue.links-archive`, a link-cli store archive (binary links notation, two packets: doublets and names);<br>- `solve-queue.lino`;<br>- `solve-queue-db/solve-queue.links`, rebuilt with `clink --import-binary --transactions` when `clink` is installed.<br>The two files are written atomically: temp file, fsync, rename, then a directory fsync. Every store carries the revision. On load the bot keeps the newest valid copy and repairs the others.                                                                                                                                                                                                                                                                                | `test-issue-2890-solve-queue-store.mjs` (round trips, corrupt or stale or missing stores repaired, byte-compatibility with `clink`) |
| 3   | Keep the database on a host volume (`/root/.hive-mind/state` → `/home/box/.hive-mind/state`). Document it in the Docker docs and deploy examples.                                                        | The store lives in `resolveBotStateDir()` (`HIVE_MIND_STATE_DIR`, default `~/.hive-mind/state`), and the queue files are mode `0600`.<br>Documentation and deploy files:<br>- [DOCKER.md](../../DOCKER.md#keeping-the-solve-queue-across-restarts-issue-2890) and the README run examples mount `state` and `logs`;<br>- `coolify/docker-compose.yml` does too;<br>- `helm/hive-mind/values.yaml` notes that its `/home/box` PVC already covers both;<br>- [CONFIGURATION.md](../../CONFIGURATION.md) lists the variables.<br>Translations were updated as well.                                                                                                                                                                                                                                               | `tests/test-docs-language-sync.mjs`, [evidence/docker-kill-experiment.log](evidence/docker-kill-experiment.log)                     |
| 4   | On startup, re-enqueue in the original order, reconcile `starting` and `processing` items with `$ --list` and the running containers, and tell the chat.                                                 | **`createSolveQueueDurability().start()`** runs before `bot.launch()`. It sets the executor first. Items are restored by `createdAt`; on a tie, the item that was starting goes first, because the consumer always starts the head of a tool queue. Every item keeps its args, card message and topic.<br>For an item that was **starting**, `createSessionReconciler()` checks three things:<br>- the sessions already resumed from `sessions.json`;<br>- `$ --status <uuid>`;<br>- an active session for the URL.<br>A live session goes to the session monitor; a dead start is queued again. After 3 interrupted starts the item is dropped and the chat is told. Waiting through ordinary restarts never costs an item its place.<br>Each chat and topic gets one plain-text notice in the item's locale. | `test-issue-2890-solve-queue-recovery.mjs`, `test-issue-2890-solve-queue-kill.mjs`                                                  |
| 5   | If both link stores are lost, fall back to Telegram, then to the bot log.                                                                                                                                | **Telegram:** the Bot API cannot read chat history (see Research). So with `HIVE_MIND_QUEUE_BACKUP_CHAT_ID` set, the bot keeps the `.lino` projection as a pinned document in that chat, at most once a minute, replacing the previous copy. It reads it back through `getChat().pinned_message`.<br>**Logs:** every change is also logged as `EVENT queue_item_<event>` with the full record. `loadQueueFromLogs()` folds those events and also reads the legacy `Enqueued:`, `Starting:` and `raw text:` lines, across rotated files and cut-off lines. It reads the bot log directory and the files in `HIVE_MIND_QUEUE_RECOVERY_LOG`, for example a saved `docker logs`.                                                                                                                                   | `test-issue-2890-solve-queue-recovery.mjs` (the incident's own log line formats)                                                    |
| 6   | Kill the bot process and the container with items queued, processing and in recovery, then check that everything continues.                                                                              | **`test-issue-2890-solve-queue-kill.mjs`** SIGKILLs a child bot process holding:<br>- a queued item, a waiting item, and an item for a second tool;<br>- a start whose container is alive and a start that never reached a container;<br>- a session in kill recovery.<br>A new process restores everything and drains the queue: each item runs exactly once, in order, and a second restart restores nothing. Three more rounds kill the process in the middle of saves.<br>**`experiments/issue-2890-docker-kill.mjs`** does the same with `docker kill` and `docker rm` of a real container.                                                                                                                                                                                                               | [evidence/docker-kill-experiment.log](evidence/docker-kill-experiment.log)                                                          |

**Debug output.** With `--verbose`, the store, persistence, backup and restore
layers trace what they do; the prefixes are `[VERBOSE] /queue-store:`,
`/queue-backup:` and `/queue-restore:`. Every change is logged as an `EVENT`
line, and the restore result as `EVENT queue_restored` with its source,
revision and counts. Warnings for unreadable stores and failed uploads are
always printed.

## Root causes

1. **The queue was in memory only.** `SolveQueue` held `queues`, `processing`,
   `completed` and `failed` in the bot process
   ([telegram-solve-queue.lib.mjs at 790c18d](https://github.com/link-assistant/hive-mind/blob/790c18dec9ec0dd2281de05a48f2047690a60415/src/telegram-solve-queue.lib.mjs#L159-L180)).
   Any end of the process, graceful or not, dropped it.
2. **The persisted state was in the container layer.** `sessions.json` and the
   bot log lived under `/home/box/.hive-mind` inside the container. The
   documented run examples mounted only credentials. So `docker rm` plus
   `docker run` (a redeploy) also lost tracked sessions and kill-recovery
   counters.
3. **The logs were the only record, by accident.** The queue could be
   rebuilt only because the old container still existed and its log still
   had the human-readable lines. No structured record existed, and no restore
   path read it.
4. **The trigger** was outside hive-mind. A test suite ran real `docker diff`
   calls against the host daemon and drove it to an OOM kill
   (disk-space-saviour#22, fixed). Docker's default `live-restore: false` then
   turned a daemon restart into the loss of every container.

## Design and alternatives

- **Why a document snapshot and not an event log.** The queue is small (tens
  of items). Writing the whole document atomically means a SIGKILL leaves
  either the old version or the new one, never a half-applied log. The churn
  rounds of the kill test check this. The bot log keeps the event stream for
  the last-resort rebuild.
- **Why the archive and `.lino` are written synchronously, and clink
  asynchronously.** The two files need only Node and
  [links-notation](https://github.com/link-foundation/links-notation). Its
  binary packets are byte-compatible with
  [link-cli](https://github.com/link-foundation/link-cli)'s store archive.
  `clink` is a .NET tool and may be missing; when present, its database is
  rebuilt in a temporary directory and swapped in. It is never on the write
  path of a queue change.
- **Telegram as a source of truth.** The issue suggests rebuilding from the
  bot's own messages. The Bot API has no method to read chat history, and
  `getUpdates` holds only undelivered updates for 24 hours. So the Telegram
  fallback is a pinned `.lino` document the bot writes itself. It is opt-in,
  because it needs a chat where the bot may pin.
- **Restore limit.** A task that crashes the bot while starting would
  otherwise loop forever. Only interrupted starts count toward the limit (3),
  so a queued item survives any number of ordinary restarts.
- **Rejected alternatives.**
  - SQLite or LevelDB: the issue asks for the associative stack, and both
    add a native dependency.
  - Redis: an extra service that would itself need persistence.
  - Docker `live-restore: true` alone: it does not help on `docker rm`, a
    redeploy or a host reboot. It is still worth enabling.

## Research

- **Docker live restore.** "By default, when the Docker daemon terminates, it
  shuts down running containers"; with `"live-restore": true` in
  `/etc/docker/daemon.json`, containers keep running when the daemon is
  unavailable. Only patch upgrades are supported, and it is reloaded with
  `systemctl reload docker`
  (<https://docs.docker.com/engine/daemon/live-restore/>). With it, the
  2026-10-09 dockerd OOM kill would not have killed the containers.
  Recommended for hosts running hive-mind, together with the state mount.
- **Telegram Bot API.** Incoming updates "will not be kept longer than 24
  hours", and no method returns chat history. `getChat` returns
  `ChatFullInfo.pinned_message`, "the most recent pinned message (by sending
  date)" (<https://core.telegram.org/bots/api>). The bot launches with
  `dropPendingUpdates: true`, so commands sent while it was down are dropped,
  and that stays a limitation.
- **link-cli 4.0.0** (`dotnet tool install --global clink`):
  - `--import-binary` and `--export-binary` round-trip a store archive, names
    included;
  - `--transactions` adds an fsynced transitions log.
- **links-notation** provides `LinksPacket`, `PacketReader` and `External`
  for the binary links notation, as well as the `.lino` parser and formatter.
- **Associative tech stack**
  (<https://github.com/link-assistant/formal-ai/blob/main/docs/associative-tech-stack.md>):
  doublets as the storage model, Links Notation as the text form, link-cli as
  the query tool, matching the three stores above.

## Upstream reports

- [link-foundation/link-cli#112](https://github.com/link-foundation/link-cli/issues/112):
  `clink --out` writes a point named `"1"` the same as address 1, so the LiNo
  export does not round-trip through `--import`. Three links and one name come
  back as one link and no names. The binary archive is exact.
  - Reproduction:
    [experiments/issue-2890-clink-numeric-names.mjs](../../../experiments/issue-2890-clink-numeric-names.mjs)
    ([evidence/clink-numeric-names.log](evidence/clink-numeric-names.log)).
  - hive-mind is not affected: it syncs clink only through the binary archive
    and writes its own `.lino`.
- [link-foundation/disk-space-saviour#22](https://github.com/link-foundation/disk-space-saviour/issues/22):
  the trigger of the incident, already reported and closed.

## Reproduction and validation

```sh
node tests/test-issue-2890-solve-queue-store.mjs        # triple store: round trips, repair, atomic writes
node tests/test-issue-2890-solve-queue-persistence.mjs  # queue <-> document, order, reconciliation, restore limit
node tests/test-issue-2890-solve-queue-recovery.mjs     # bot launch, notices, Telegram and log fallbacks
node tests/test-issue-2890-solve-queue-kill.mjs         # kill -9 the bot with queued, starting and recovering work
node experiments/issue-2890-docker-kill.mjs             # docker kill + docker rm of a real container
node examples/solve-queue-restart-demo.mjs              # what is stored and what the chat is told
```

**Before the change.** No stored queue existed. A restarted bot started with
empty queues: the incident's `/queue` showed `Completed: 0, Failed: 0`.

**After the change.**

- [evidence/docker-kill-experiment.log](evidence/docker-kill-experiment.log):
  the container exits with 137 and is removed. A new process restores 4 items
  (the interrupted start first, then the rest in order) and keeps 1 item
  running. The kill-recovery counter of the recovering session (2) survives,
  and the chat topic gets one notice.
- [evidence/solve-queue-restart-demo.log](evidence/solve-queue-restart-demo.log)
  shows the stored `.lino` document.

**A bug found while building the demo.** Items queued in the same millisecond
were restored with the interrupted start last. The fix and its test are in the
persistence test: "an interrupted start goes back to the head, even with equal
timestamps".

## Limitations

- **Commands sent while the bot is down are not received**
  (`dropPendingUpdates`), and they must be sent again.
- **Tasks inside the root container die with it.** This covers screen and
  tmux isolation, and `--isolation docker` containers of an inner DinD daemon.
  Kill recovery handles them (#2887–#2889) and reads its attempt counters from
  the same state volume.
- **The Telegram copy can lag the volume by up to a minute.** It is meant for
  a lost volume, not for a lost process.
- **Without the mounts nothing changes.** Without the `state` mount, a
  `docker rm` still loses the queue; the bot log fallback then needs the old
  `docker logs` saved and passed in `HIVE_MIND_QUEUE_RECOVERY_LOG`.
