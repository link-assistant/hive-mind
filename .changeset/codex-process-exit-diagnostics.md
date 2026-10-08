---
"@link-assistant/hive-mind": patch
---

Report Codex process exit codes, signals, plain CLI errors, and fresh cgroup OOM evidence in failure messages. Preserve termination metadata for existing SIGKILL recovery and provide the container memory budget to Codex before execution.

Refresh the regular, DinD and Coolify Box base images to 2.10.3 to satisfy dependency freshness after its release during validation.
