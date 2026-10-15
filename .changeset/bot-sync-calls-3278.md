---
'@link-assistant/hive-mind': patch
---

The Telegram bot no longer blocks its event loop on file or process I/O while it serves commands: the state lock, model catalogue cache, sidecar and CLI-refresh state, session snapshots, router session drain, session-monitor log scans, Formal AI attribution and the Docker launch path (host path probes, host-path preparation, push-guard install) now use async, timeout-bounded calls, and the bot's docker and gh `$` calls are bounded with an AbortSignal. The `hive/require-exec-timeout` lint rule now checks command-stream `$` calls and reports a `timeout` option that command-stream ignores, both lint baselines record the reason for every remaining entry with an exact count, and a new watchdog test runs every bot command against slow stubbed dependencies and fails when the event loop is blocked past its budget.
