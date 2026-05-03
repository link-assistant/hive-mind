---
"@link-assistant/hive-mind": patch
---

Add `/stop <UUID>` and reply-to-message-with-UUID modes to the Telegram bot (#524). Sending `/stop <uuid>` (or replying with `/stop` to a message containing a UUID) forwards CTRL+C to the matching isolated `/solve` or `/hive` session via `$ --stop <uuid>` from link-foundation/start (link-foundation/start#112), so individual screen/tmux/docker sessions can be cancelled from Telegram. Mirrors the existing `/log` and `/terminal_watch` UUID-resolution pattern. Bare `/stop` retains its existing chat-pause behaviour (#1081).
