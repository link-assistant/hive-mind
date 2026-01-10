---
'@link-assistant/hive-mind': patch
---

fix(telegram-bot): stop solve queue on SIGINT/SIGTERM for clean exit

The telegram bot was hanging after pressing Ctrl+C because the SolveQueue
consumer loop kept running with active timers that prevented the Node.js
event loop from emptying.

- **Root cause identified**: The SIGINT/SIGTERM handlers only called
  `bot.stop()` (Telegraf) but did not stop the SolveQueue, whose `sleep()`
  timers kept the event loop alive.

- **Solution**: Added `solveQueue.stop()` call in both SIGINT and SIGTERM
  handlers to stop the consumer loop before calling `bot.stop()`.

- **Added verbose logging**: When running with `--verbose`, the bot now
  logs "Solve queue stopped" during shutdown.

- **Case study documentation**: Added detailed analysis in
  `docs/case-studies/issue-1083/` with timeline, root cause investigation,
  and evidence collection.

Fixes #1083
