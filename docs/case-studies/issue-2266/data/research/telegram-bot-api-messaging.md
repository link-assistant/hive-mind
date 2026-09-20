# Telegram Bot API messaging

- Source: <https://core.telegram.org/bots/api#sendmessage>
- Accessed: 2026-09-20
- Publisher: Telegram (primary documentation)

The Bot API provides `sendMessage` for a direct textual response and supports
replying to a specific message. A normal text message may contain 1–4096
characters after entity parsing, which is far more than the short no-work
notice needed here.

The existing bot abstraction (`safeReply`) already implements this primitive,
so no third-party component is necessary. The response can be sent before
queue reservation and isolated-session startup.
