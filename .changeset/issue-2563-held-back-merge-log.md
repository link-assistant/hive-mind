---
'@link-assistant/hive-mind': patch
---

A pull request URL whose branch names an issue from another repository (such as `issue-320-…` created while solving `link-assistant/agent#320`) now uses the issue its description closes. Before, every pre-merge gate looked for the missing issue and held back `--auto-merge`. A held-back auto-merge no longer attaches a log that is already attached. AI work that is not attached yet is posted together with the held-back notice in one comment. Every solution draft log comment, for all tools, now shows cost estimation, context and tokens usage and models used (#2563).
