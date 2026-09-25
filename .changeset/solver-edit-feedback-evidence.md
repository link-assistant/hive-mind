---
'@link-assistant/hive-mind': patch
---

Stop reporting the solver's own pull request and issue edits as "description/title edited" feedback (#2293). Edits are now read from GitHub's edit history, and edits made during solver sessions or by bots are ignored. Every restart reason is posted with evidence: failing checks with run URLs, comment links, and edit diffs. Consecutive restarts caused by the same failing checks are flagged.

Also refreshes the CI-enforced dependency pins (use-m 8.16.4, command-stream 1.1.0, links-notation 0.21.3, secretlint 13.0.6) and adapts command result handling to command-stream 1.x, whose `stdout`/`stderr` are always-truthy stream objects: empty output now correctly falls back to the next error source instead of producing an empty message.
