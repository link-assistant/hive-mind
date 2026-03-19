---
'@link-assistant/hive-mind': patch
---

Treat ENOSPC as immediate failure and fix false positive SUCCESS message (issue #1212)

When disk space runs out during execution, ENOSPC is now treated as a hard failure
(not partial success). The tool detects ENOSPC errors at all stages with actionable
guidance, always shows log upload failures, and attempts to attach failure logs to
the PR or issue even on ENOSPC failure.
