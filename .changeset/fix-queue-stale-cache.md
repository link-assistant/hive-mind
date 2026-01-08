---
'@link-assistant/hive-mind': patch
---

fix(queue): simplify queue logic based on PR feedback

- **Use 5-minute load average for CPU**: Uses `loadAvg5` instead of instantaneous CPU usage,
  providing a more stable metric not affected by transient spikes during claude startup.
  Cache TTL is 2 minutes.

- **Keep RAM threshold with caching**: RAM_THRESHOLD (50%) is still checked but uses cached
  values only (no uncached rechecks) to simplify the logic.

- **Increase MIN_START_INTERVAL_MS to 2 minutes**: Allows enough time for solve command to
  start actual claude process, ensuring running processes are counted when API limits are checked.

- **Increase CONSUMER_POLL_INTERVAL_MS to 1 minute**: Reduces unnecessary system checks.
  One-minute polling is sufficient for queue management.

- **Running processes not a blocking limit**: Commands can run in parallel as long as actual
  limits (CPU, API, etc.) are not exceeded. Claude process info is only supplementary.

Fixes #1078
