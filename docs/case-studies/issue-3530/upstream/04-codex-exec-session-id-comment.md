Another use case for this, from [link-assistant/hive-mind#3530](https://github.com/link-assistant/hive-mind/issues/3530). A supervisor creates one UUID per task and uses it for the process supervisor's session, the log file and the Docker container. With Claude Code it also passes `claude --session-id <uuid>`, so the AI session has the same id and one id finds everything for a task. `codex exec` (checked on codex-cli 0.163.0) has no equivalent: `exec --help` only offers `resume` / `fork` by an existing id. The supervisor therefore has to parse the thread id out of the JSON stream after the fact and keep a mapping.

Reproduction: `codex exec --session-id "$(uuidgen)" "say hi"` → `Error: unexpected argument '--session-id' found`.

Suggested behaviour (same as Claude Code): `codex exec --session-id <uuid>` creates the new thread with that id, and fails if a rollout with that id already exists (`exec resume <uuid>` remains the way to continue it).
