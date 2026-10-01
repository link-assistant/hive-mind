---
'@link-assistant/hive-mind': patch
---

Post one "Log Upload Failed" comment per failed log (#2400): the `--attach-logs` safety net no longer repeats the report already on the pull request when another comment landed in between. In Docker isolation, the comment and console now say the log path is inside the session's container, that the container is removed on success, and how to reach the log (`docker cp`, `/log <session>`, `$ --status <session>`), instead of claiming it is on the host. Language keywords and literals assigned to sensitive-named variables (`fileTokens = await …`, `…Tokens: false`) are no longer masked as credentials. The Secretlint profiler is disabled, so each credential scan no longer retains memory for the life of the process.

Includes #2398 (not yet merged on its own): Post a single failure comment per failure (#2397). The exit handler no longer repeats a failure already reported by the "Log Upload Failed", "Automation stopped" or "Auto-restart limit reached" comment. Codex's "model is not supported when using Codex with a ChatGPT account" is reported as a plan problem with renewal and daemon-update guidance. Logs containing `token => …` or a short known env value are no longer blocked from publication, env tokens are masked in logs, and a blocked publication now names the failed check, rule ids and log block.
