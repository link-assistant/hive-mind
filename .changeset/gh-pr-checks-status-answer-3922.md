---
'@link-assistant/hive-mind': patch
---

A successful Claude session no longer counts as failed when its last command is `gh pr checks` on a pull request without CI ("no checks reported", exit 1) or with pending checks (exit 8). A genuine final-command failure is now reported as "Claude reported success, but its last command `<command>` exited with code N: <error line>" instead of the flattened raw output, and the full output stays in the log.

Fork pull requests now have their workflow files read at the head SHA, so the lookup no longer fails with HTTP 404. When a lookup does fail, the wait message gives the reason instead of an empty "()" list. Commit SHAs that the log itself links as commits are no longer masked as tokens. `--auto-restart-until-mergeable` no longer announces "Auto-merge mode enabled - will attempt to merge".

Also refreshes the dependency pins flagged by the CI freshness gate: Formal AI 0.355.27 in every image and the bootstrap constant, nektos/act v0.2.94, eslint 10.14.0, lino-objects-codec 0.9.4, and the lockfile entries `npm update` moves.
