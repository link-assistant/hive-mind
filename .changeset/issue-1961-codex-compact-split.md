---
"@link-assistant/hive-mind": patch
---

Reconstruct precise Codex compact sub-session token splits from per-request `response.completed` debug telemetry instead of fabricating them by even-splitting the cumulative `turn.completed` total. Sub-session input now shows the measured peak restored context per request between compaction events (rendered without the `~` estimate prefix); when per-response telemetry is unavailable, an honest unsplit-compaction notice is shown and the exact Total line is always preserved.
