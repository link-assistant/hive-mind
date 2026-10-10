---
'@link-assistant/hive-mind': patch
---

Post kill-recovery notices, intermediate session logs and completion links on
the pull request the session itself created or continued, not on the first PR
GitHub links to the issue. A parent plan PR on `issue-720-…` whose description
says "Fixes #724" no longer receives the notices of the #724 session: the bot
first takes the PR solve announced in the session log (`📍 PR URL:`, `PR URL:`,
`📍 URL:`), then only a linked PR whose branch (or first closing reference)
belongs to the issue. `/merge` prefers the issue's own PR the same way.
