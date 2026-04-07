---
'@link-assistant/hive-mind': patch
---

Retry on network issues and minimize terminal/log output differences (#1536): add ghRetry/ghCmdRetry utilities with exponential backoff for transient network errors (TCP reset, TLS timeout, connection refused, unexpected EOF). Apply retry to critical gh CLI calls: accept-invite, repository setup, auto-fork permission check, visibility detection, write permission check. Log stderr to log file on command failure for terminal/log parity. Add 'unexpected eof' to transient error detection patterns.
