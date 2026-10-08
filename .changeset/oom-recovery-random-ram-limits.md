---
"@link-assistant/hive-mind": minor
---

Recover from OOM kills of the AI tool and spread RAM limits (#2803): solve resumes a SIGKILLed primary session in-process after stopping the processes it left behind, the bot resumes `/fix` sessions as the solve they handed off to, and reports name the AI tool the OOM killer took and include the cgroup OOM counters. Docker task RAM limits accept random percentage ranges: `--container-memory` defaults to `90%-100%`, and the new `--container-memory-after-oom` (`TELEGRAM_CONTAINER_MEMORY_AFTER_OOM`, default `70%-80%`) is applied when a task is restarted after an OOM kill.
