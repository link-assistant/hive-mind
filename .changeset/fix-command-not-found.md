---
'@link-assistant/hive-mind': patch
---

fix: detect "command not found" errors to prevent false success

When the `claude` CLI command is not found (not installed or not in PATH), the tool was incorrectly reporting "Claude command completed" instead of detecting the failure. This fix adds "not found" to the stderr error detection pattern to properly detect when commands fail to start.
