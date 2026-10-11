---
'@link-assistant/hive-mind': patch
---

`/solve <repository-url>` on a repository with exactly one open issue now solves that issue directly, as if its URL had been given, instead of creating a combined issue whose only sub-issue is that same issue. The Telegram bot shows and launches the issue URL in that case (#3108).

Docker images install start-command 0.37.1; lino-objects-codec is 0.9.1.
