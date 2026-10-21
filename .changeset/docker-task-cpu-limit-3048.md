---
'@link-assistant/hive-mind': patch
---

One busy Docker task no longer blocks every tool queue (#3048):

- Docker tasks are limited to 50% of the host CPUs by default (`--container-cpu`, `TELEGRAM_CONTAINER_CPU`; `unlimited` opts out). The bot warns at startup when Docker tasks run without a CPU limit.
- The queue's CPU gate treats the CPU a capped task uses as reserved for it and compares the remaining load with the CPUs capped tasks cannot use, so a task busy up to its cap does not hold back other tools. Uncapped load still blocks as before.
- The queue's `Starting:` log line shows the limits each task starts with, for example `[limits: CPU=50% (3 CPUs), RAM=60% (7.2 GiB), reservation=25% (3.0 GiB), disk=unlimited]`.
