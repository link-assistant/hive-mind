---
'@link-assistant/hive-mind': minor
---

feat: add --auto-accept-invite option to solve command

Adds a new `--auto-accept-invite` boolean option to the `solve` command that automatically accepts the pending GitHub repository or organization invitation for the specific repository/organization being solved, before checking write access.

Unlike the `/accept_invites` Telegram command (which accepts ALL pending invitations), this option is scoped to the target repo/org only, making it safer and more targeted. Useful when you've just been invited to a repository and want to run `solve` without manually accepting the invitation first.
