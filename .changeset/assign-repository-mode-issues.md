---
'@link-assistant/hive-mind': minor
---

Repository mode (`/solve <repository-url>`) now assigns the current GitHub user to the combined issue and every issue it covers, so it is clear which issues are in progress, and moves issues left over from an earlier, closed combined issue to the new one instead of failing to attach them.

Also refreshes the CI-enforced dependency pins (use-m 8.16.4, command-stream 1.1.0, links-notation 0.21.3, secretlint 13.0.6) and adapts command result handling to command-stream 1.x, whose `stdout`/`stderr` are always-truthy stream objects.
