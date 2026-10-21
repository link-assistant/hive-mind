---
'@link-assistant/hive-mind': patch
---

Docker tasks are no longer OOM-killed while most host RAM is free, and an OOM kill takes the build, not the AI CLI (#3125):

- The default RAM limit for a Docker task is now a 60% hard limit with a 25% soft limit (`docker update --memory-reservation`), instead of a 25% hard limit. Under host memory pressure the kernel reclaims from tasks above their reservation first. Set it with `--container-memory-reservation` / `TELEGRAM_CONTAINER_MEMORY_RESERVATION`; an explicit `--container-memory` drops the default reservation, and `unlimited` opts out of either limit. The reservation is applied behind the fail-closed start gate and kept on resume and restart.
- Each bash shell the AI tool runs commands in raises its own `oom_score_adj` to 500 through a `BASH_ENV` hook, so the kernel kills a build or test run before the AI CLI. No privileges are needed. `HIVE_MIND_TOOL_SHELL_OOM_SCORE_ADJ` changes the value or disables it (`off`).
