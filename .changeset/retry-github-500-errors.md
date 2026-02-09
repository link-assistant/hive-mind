---
'@link-assistant/hive-mind': patch
---

Add retry mechanism for GitHub 500 errors during repository clone

This change adds intelligent retry logic with exponential backoff to handle transient GitHub server errors during repository cloning operations.
