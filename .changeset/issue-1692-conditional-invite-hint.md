---
'@link-assistant/hive-mind': patch
---

Improve the repository-not-accessible error message in `/solve` (issue #1692). The headline drops the redundant "not found or" wording and the technical "(GitHub returns 404 for private repos without permissions)" parenthetical, leads with the most-actionable hypothesis ("Repository may be private — ensure the bot has been granted access"), and only suggests `--auto-accept-invite` when that flag is _not_ already active. The Telegram bot surface picks up the same suppression so users do not see the hint echoed back when they already passed the flag.
