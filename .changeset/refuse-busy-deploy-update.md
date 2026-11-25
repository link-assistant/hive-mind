---
'@link-assistant/hive-mind': minor
---

`hive-manager deploy apply|update` no longer replaces an instance that is running tasks. It lists the running start-command executions and non-isolated task processes, then exits with status 75, unless `--wait SECONDS` lets the work finish first or `--force` replaces the instance anyway. The new `--no-rollback` option, or `keep-rollback=false` in a profile, removes the replaced container, any older `.rollback` container and their unused images instead of keeping a rollback.
