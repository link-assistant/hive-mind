---
'@link-assistant/hive-mind': patch
---

Add retry logic for fork validation network errors (Issue #1311). The validateForkParent function now retries up to 3 times with exponential backoff for transient network errors like TCP timeouts. Network errors now show a distinct error message with helpful retry suggestions instead of incorrectly reporting a fork parent mismatch.
