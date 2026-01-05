---
'@link-assistant/hive-mind': patch
---

feat: Add --base-branch to /help and implement option typo suggestions

- Added --base-branch option to Telegram bot /help command
- Implemented intelligent option name suggestions using Levenshtein distance
- Added --base-branch to README.md solve options section
- Enhanced error messages with helpful suggestions for typos (e.g., --branch → --base-branch)
