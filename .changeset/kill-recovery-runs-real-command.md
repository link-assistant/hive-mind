---
'@link-assistant/hive-mind': patch
---

Fix kill recovery of tasks started with a Telegram alias (`/codex`, `/claude`, `/agent` …) (#2887). The in-place resume ran the alias as the program (`sh -c "/codex …"` → `sh: 1: /codex: not found`, exit 127) after a 10–35 minute `docker commit`, and the task was then dropped. `buildResumeCommand` now returns a shell-quoted executable form (`shell`, always `solve …`) next to the chat-only `display` form. The in-place resume and the PR "Manual resume" block use `shell`, and a command whose first word is a Telegram command is refused before start-command is called. A resumed container that exits 127/126 is reported as "command not found" / "command not executable" and recovered again with a fresh run that keeps the tool's `--resume` session id. The failed attempt does not count against the limit. The executed command and the start failure are logged and persisted for diagnosis.
