---
'@link-assistant/hive-mind': patch
---

Fix misleading "Retry after: 0s" message in /limits command when Claude Usage API returns 429. Now shows "Try again later." for zero/missing retry-after values, or proper reset time format (e.g., "Resets in 5m (Mar 19, 8:00pm UTC)") for meaningful values. Also caches 429 errors to prevent repeated requests to rate-limited endpoint, and adds full request/response verbose logging for debugging.
