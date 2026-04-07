---
'@link-assistant/hive-mind': patch
---

Fix false positive error detection when Agent CLI emits verbose log messages as error events (Issue #1541). Add filtering for verbose informational messages wrapped in error events, and track agent's own hasError field from exit log event to avoid misreporting errors.
