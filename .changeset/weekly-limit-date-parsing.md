---
'@link-assistant/hive-mind': patch
---

fix: Support weekly limit date parsing in extractResetTime and parseResetTime

- Added Pattern 0 to extractResetTime() to handle date+time formats like "resets Jan 15, 8am"
- Updated parseResetTime() to parse date+time strings with month name and day
- This ensures weekly limit messages are displayed with the "Usage Limit Reached" format
