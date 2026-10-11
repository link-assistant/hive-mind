---
'@link-assistant/hive-mind': patch
---

Make Docker task cleanup discover resume containers and snapshot images reliably, report retained/removable bytes, and support failed-container retention by finish time. Recheck active sessions and container state before removal, use Docker's non-force deletion safeguards, surface discovery failures, and retain cleanup logs in the XDG state directory.
