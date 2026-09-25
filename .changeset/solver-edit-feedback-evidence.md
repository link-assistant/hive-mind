---
'@link-assistant/hive-mind': patch
---

Stop reporting the solver's own pull request and issue edits as "description/title edited" feedback (#2293). Edits are now read from GitHub's edit history, and edits made during solver sessions or by bots are ignored. Every restart reason is posted with evidence: failing checks with run URLs, comment links, and edit diffs. Consecutive restarts caused by the same failing checks are flagged.
