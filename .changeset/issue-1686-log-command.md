---
'@link-assistant/hive-mind': patch
---

Add a `/log` Telegram command that lets a chat owner pull the on-disk log of a `$` isolation session (`screen`, `tmux`, `docker`). The command accepts `/log <UUID>` directly or `/log` as a reply to any session message that contains a session UUID, validates the id with `$ --status`, derives the log path from start-command's `logPath` field, and uploads the file as a reply to the user. Logs from public GitHub repositories are uploaded to the same chat; logs from private (or unknown-visibility) repositories are sent via direct message after forwarding the originating session message into the DM, so private logs never leak into public chats. Access is restricted to the chat owner (Telegram `creator` status), matching the existing `/start`, `/stop`, and `/top` policy.
