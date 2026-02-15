---
'@link-assistant/hive-mind': patch
---

Add exponential backoff retry when bot launch fails with 409 Conflict error (e.g., due to restart overlap, stale connections, or network issues). Retry schedule: 1s, 2s, 4s, ... up to 10 minutes max. Non-retryable errors (401 Unauthorized) still cause immediate exit.
