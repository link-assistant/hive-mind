---
'@link-assistant/hive-mind': minor
---

Add configurable queue threshold strategies (reject, enqueue, dequeue-one-at-a-time)

- Add three handling strategies for each queue threshold:
  - `reject`: Immediately reject the command, no queueing
  - `enqueue`: Block and wait in queue until metric drops
  - `dequeue-one-at-a-time`: Allow one command, block subsequent

- Support configuration via `HIVE_MIND_QUEUE_CONFIG` environment variable (links notation format)
- Support individual strategy env vars (e.g., `HIVE_MIND_DISK_STRATEGY`)

**Breaking change:** Disk threshold default strategy changed from `dequeue-one-at-a-time` to `reject`
because the queue is lost on server restart. To restore old behavior: `HIVE_MIND_DISK_STRATEGY=dequeue-one-at-a-time`
