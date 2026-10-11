---
'@link-assistant/hive-mind': minor
---

Keep the Telegram solve queue across bot and container restarts. Every queue
change is saved to a links triple store in the bot state directory
(`HIVE_MIND_STATE_DIR`, default `~/.hive-mind/state`): a link-cli binary store
archive, an atomic `.lino` projection and, when `clink` is installed, a clink
database. On launch the bot puts the items back in their original order, hands
starts that are still running to the session monitor, queues lost starts again
(at most 3 interrupted starts per item) and tells each chat what was restored.
When the stores are gone, the queue is read from an optional pinned `.lino`
backup in Telegram (`HIVE_MIND_QUEUE_BACKUP_CHAT_ID`) or rebuilt from the bot
logs (`HIVE_MIND_QUEUE_RECOVERY_LOG`). The Docker docs and deploy examples now
mount the state and logs directories on the host.
