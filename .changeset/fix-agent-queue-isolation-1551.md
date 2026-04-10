---
'@link-assistant/hive-mind': patch
---

Fix agent queue not isolated from claude queue in bot entry point. The start decision and position display now use tool-specific queue counts instead of the total across all tools, so items in one tool's queue don't block or mislead the other.
