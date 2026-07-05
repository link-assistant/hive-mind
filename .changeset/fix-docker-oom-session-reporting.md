---
"@link-assistant/hive-mind": patch
---

Handle Docker `oomKilled` status markers as terminal Telegram work-session failures, delay Docker backend-gone killed notifications long enough for start-command to publish a real terminal status or log footer, pace queued task startups at a minimum 10-minute interval, and cap system resource cache freshness at 1 minute.
