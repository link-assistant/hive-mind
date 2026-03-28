---
'@link-assistant/hive-mind': patch
---

Treat ENOSPC as immediate failure at all stages (issues #1212, #1211)

When disk space runs out during any stage — including git clone, execution, and log
upload — ENOSPC is now treated as a hard failure (not partial success). Added ENOSPC
detection to git clone error classification so disk-full clone failures are not
retried. The isENOSPC utility now detects git-specific patterns like "unable to write
file" and "cannot create directory". Actionable disk cleanup guidance is provided.
