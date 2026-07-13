---
'@link-assistant/hive-mind': patch
---

Add dequeue-decision diagnostics to the Telegram solve queue so global FIFO ordering across the per-tool queues can be audited in production (issue #2051). The oldest startable task still wins the single, globally-paced startup slot; when an older task is skipped because it cannot start, the queue now logs a concise, deduplicated "FIFO queue-jump" line naming the older task and the exact reason it is blocked (Claude/Codex limits, RAM/CPU/disk, min-interval, or one-at-a-time), and records it on `stats.lastQueueJump`. Verbose mode additionally prints a per-tool head snapshot each cycle. No change to ordering, pacing, or the minimum start interval.
