---
"@link-assistant/hive-mind": patch
---

Add experimental /top command to Telegram bot

- Added /top command to show live system monitor in Telegram
- Displays auto-updating `top` output in a single message (updates every 2 seconds)
- Owner-only access with chat authorization checks
- Session isolation per chat using GNU screen
- Clean stop button to terminate monitoring session
- Marked as EXPERIMENTAL feature with user warnings
- Not documented in /help as requested
- Requires GNU screen to be installed on the system

Fixes #500
