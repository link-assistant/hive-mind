---
'@link-assistant/hive-mind': patch
---

Memory checks and prompts use the container's cgroup limit instead of host RAM (#2838):

- `solve` startup checks, resource diagnostics and the "System resources" lines read the cgroup v2 or v1 memory limit and usage, so a 4 GiB container on a 64 GiB host is reported and checked as 4 GiB.
- The AI tool prompts state the memory budget of the task's container and ask for builds and tests that fit in it (fewer parallel jobs, no memory-heavy commands in parallel).
- `hive` lowers `--concurrency` when the container memory limit cannot give each worker `--min-memory-per-worker` MB (default 2048, env `HIVE_MIND_MIN_MEMORY_PER_WORKER`, `0` disables), and says so at startup.
