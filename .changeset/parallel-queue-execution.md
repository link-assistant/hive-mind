---
'@link-assistant/hive-mind': patch
---

fix: allow parallel queue execution when no limits exceeded

Previously, "Claude process is already running" was treated as a blocking reason on its own, preventing parallel execution even when all system and API limits were within thresholds.

Changes:

- `claude_running` is now tracked as a metric, not a blocking reason
- Commands can run in parallel as long as actual limits are not exceeded
- When any limit >= threshold, allow exactly one claude command to pass
