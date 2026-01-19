---
'@link-assistant/hive-mind': patch
---

Prevent duplicate URLs from being added to the /solve queue (Issue #1080)

- Added `findByUrl()` method to SolveQueue to detect existing items by URL
- Updated /solve command handler to check for duplicates before queueing
- Uses normalized URLs for consistent comparison
- Returns informative error message when duplicate is detected
