---
'@link-assistant/hive-mind': patch
---

fix: narrow "Ready to merge" duplicate check to current session scope (#1584)

- Fix `checkForExistingComment` to only search for duplicate "Ready to merge" comments AFTER the last "Solution Draft Log" comment, not in the entire PR history
- Previously, a "Ready to merge" from a previous working session would suppress the notification for a new session after user feedback
- The fix scopes deduplication to the current working session while maintaining cross-process duplicate detection
