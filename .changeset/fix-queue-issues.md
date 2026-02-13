---
'@link-assistant/hive-mind': patch
---

Fix queue issues: rejection, display, and formatting

- Fix disk rejection not blocking queue placement when threshold exceeded
- Restore "used" label on progress bars when below threshold
- Show per-queue breakdown in /limits command
- Group queue items by tool and use human-readable time in /solve_queue
