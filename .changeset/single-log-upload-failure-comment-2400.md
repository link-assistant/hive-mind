---
'@link-assistant/hive-mind': patch
---

Post one "Log Upload Failed" comment per failed log (#2400): the `--attach-logs` safety net no longer repeats the report already on the pull request when another comment landed in between. In Docker isolation, the comment and console now say the log path is inside the session's container, that the container is removed on success, and how to reach the log (`docker cp`, `/log <session>`, `$ --status <session>`), instead of claiming it is on the host. Language keywords and literals assigned to sensitive-named variables (`fileTokens = await …`, `…Tokens: false`) are no longer masked as credentials. The Secretlint profiler is disabled, so each credential scan no longer retains memory for the life of the process.
