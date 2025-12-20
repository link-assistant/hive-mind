---
'@link-assistant/hive-mind': minor
---

Add /version command to hive-telegram-bot

Implements a new /version command that displays comprehensive version information including:
- Bot version (package version with git commit SHA in development)
- solve and hive command versions
- Node.js runtime version
- Platform information (OS and architecture)

This helps users and administrators quickly check version information without accessing logs or the server directly.
