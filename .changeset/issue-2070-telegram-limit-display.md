---
"@link-assistant/hive-mind": patch
---

Make the Telegram Bot API section of `/limits` report real usage instead of near-permanent zeroes. Every Bot API call is now counted (not just sends), each documented flood-control window is tracked separately, and the section shows a single bar for the window closest to refusing the next request. Limits are learned from Telegram's own answers: a success proves capacity, a 429 proves a ceiling, and an active `retry_after` shows a full bar with the countdown.
