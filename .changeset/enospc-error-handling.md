---
'@link-assistant/hive-mind': patch
---

Add ENOSPC error detection and fix false positive SUCCESS message (issue #1212)

When disk space runs out during execution, the tool now shows "PARTIAL SUCCESS"
instead of misleading "SUCCESS", detects ENOSPC errors specifically with actionable
guidance, and always shows log upload failures (not just in verbose mode).
