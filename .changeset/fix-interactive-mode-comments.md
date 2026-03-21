---
"@link-assistant/hive-mind": patch
---

Fix interactive mode PR comment output: use stdin for GitHub API calls to prevent shell quoting corruption, flush comment queue before tool result timeout to prevent stuck "Waiting for result..." comments, and guard against duplicate session started comments from late system.init events
