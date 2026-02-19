---
'@link-assistant/hive-mind': patch
---

fix: add no-checks timeout to prevent infinite auto-restart loop (Issue #1335)

When `--auto-restart-until-mergeable` is used on a repository with no CI/CD workflows,
the `watchUntilMergeable` loop was permanently stuck on "CI/CD checks have not started yet"
with no exit condition. This fix adds a configurable timeout (`HIVE_MIND_AUTO_RESTART_NO_CHECKS_TIMEOUT_MS`,
default 30 minutes) after which the monitor exits, treating the PR as mergeable from a CI perspective.
An optional hard cap on total loop runtime (`HIVE_MIND_AUTO_RESTART_MAX_RUNTIME_MS`) is also added.
