---
'@link-assistant/hive-mind': patch
---

Apply the shared Telegram resource and tool queues to /fix, /split, /task --split, /organize, and /merge --auto-resolve. Preserve queued commands, isolation, locale and session tracking, and cancel merge tasks that are still awaiting admission.

Refresh the Box and Box DinD base-image pins to 2.10.3 so the repository dependency-freshness gate passes.
