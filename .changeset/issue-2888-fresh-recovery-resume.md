---
'@link-assistant/hive-mind': patch
---

Fresh kill recovery resumes only tool sessions it can reach (#2888). Codex rollouts of the repository-scoped `CODEX_HOME` are now kept on the mounted `~/.codex/sessions` volume, a rollout left in a killed container is restored with `docker cp`, and a fresh recovery run drops `--resume` (falling back to `--auto-continue`) when the tool session is not reachable: in Docker for agent, gemini, qwen and opencode, and on screen/tmux for the working-directory-bound gemini, qwen and opencode. A recovery session refused by the disk preflight (exit 75) no longer spends a recovery attempt; it is relaunched once enough disk space is free (`HIVE_MIND_SESSION_KILL_DISK_RETRIES`, `HIVE_MIND_SESSION_KILL_DISK_RETRY_DELAY`, `HIVE_MIND_SESSION_KILL_DISK_RETRY_PATH`).

Docker images install Bun 1.4.3 (was 1.4.2), as the pull-request dependency-freshness gate requires.
