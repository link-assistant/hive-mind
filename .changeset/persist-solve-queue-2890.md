---
'@link-assistant/hive-mind': patch
---

The Telegram bot's solve queue survives a bot or root container restart (#2890):

- Every queue change is saved to `~/.hive-mind/state/` (or `HIVE_MIND_STATE_DIR`): an atomic `queue.json`, a human-readable `queue.lino` projection and, when the link-cli `clink` tool is installed, a `queue.links` doublets database. Each copy can restore the queue alone. `HIVE_MIND_QUEUE_CLINK=0` disables the link-cli copy and `HIVE_MIND_CLINK_PATH` points to the binary.
- Queue events are also written to the bot log, so the queue can be rebuilt from the log (and from the older `Enqueued:` / `Starting:` / `raw text:` lines) when every store is gone.
- On launch the bot puts the queued tasks back in their original order with their chat, requester and message ids, restarts a task that was being launched only when no container or tracked session runs it, and tells each chat what was restored.
- The Docker docs describe the `/root/.hive-mind/state:/home/box/.hive-mind/state` volume that keeps the queue across `docker rm` and redeploys.
