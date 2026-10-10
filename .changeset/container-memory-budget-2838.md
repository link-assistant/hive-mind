---
"@link-assistant/hive-mind": minor
---

Make the memory preflight and the "System resources" log lines container-aware: inside a cgroup with a limit, available memory is `min(host available, memory.max - memory.current)`, swap follows `memory.swap.max` (0 when the container may not swap), and the log says which limit applied. Every tool, not only Codex, now gets the container memory budget in its prompt (real limit, free/top show the host, sequential low-parallelism builds, no builds alongside sub-agents, OOM kills so far). `hive` caps `--concurrency` when the cgroup limit per worker is below the new `--min-memory-per-worker` (default 2048 MB, 0 disables).
