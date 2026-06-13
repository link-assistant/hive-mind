---
'@link-assistant/hive-mind': patch
---

fix(telegram): never re-execute a forwarded command (`/task`, `/stop`, `/tokens`, `/log`, `/terminal_watch`) (#1922)

Forwarding a message that starts with a bot command (for example the bot's own
`/task <url>` reply, or any `/task https://github.com/owner/repo`) caused the
Telegram bot to execute the command again — creating a brand-new GitHub issue or
spawning a session the user never intended. `/task` and `/split` only checked
`isOldMessage` and never rejected forwarded messages, unlike `/help`, `/solve`,
`/hive`, `/merge`, etc.

Root cause: the existing `isForwardedOrReply` filter rejects *both* forwards and
replies, so commands that use the reply feature (`/task` issue creation, `/solve`
URL extraction, targeted `/stop`) could not use it without breaking replies — and
were therefore left without any forwarded check at all.

Fix: a new dedicated `isForwarded(ctx)` filter detects *only* forwarded messages
(new `forward_origin` API + legacy `forward_*` fields) and intentionally ignores
replies. It is now applied to every command that previously lacked a forwarded
guard — `/task`, `/split`, `/stop` (including targeted `/stop <uuid>`), `/tokens`,
`/log`, `/terminal_watch`/`/watch` — and `/solve` was refactored to reuse it
instead of its ad-hoc inline check. Genuine user replies keep working.

Added unit tests for `isForwarded` and for forwarded `/task`/`/split` rejection,
plus a full case study with timeline and per-command audit under
`docs/case-studies/issue-1922`.
