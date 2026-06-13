---
"@link-assistant/hive-mind": patch
---

Fix `/task` issue creation when replying to a message: combine the inline command (e.g. the repository URL) with the replied-to message (the issue text) instead of dropping the reply, so replying with `/task <repository-url>` now creates the GitHub issue (issue #1916).
