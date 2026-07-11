---
'@link-assistant/hive-mind': patch
---

Commit the `--development-log` artifacts before signalling pull request readiness (issue #2048), so the development-log commit is part of the diff that CI and `--auto-restart-until-mergeable` evaluate. Previously the log commit landed after the "Ready to merge" signal and could break CI (e.g. a missing changeset) with no readiness re-evaluation.
