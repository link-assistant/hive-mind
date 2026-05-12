---
'@link-assistant/hive-mind': patch
---

feat: add opt-in GitHub API rate-limit usage logging

Adds optional logging of current GitHub API rate-limit usage through the centralized `gh` retry wrapper so every wrapped GitHub CLI call can report quota usage while debugging.

Features:

- Disabled by default for backward compatibility
- Enable with `--github-rate-limits-logging` when debugging API usage
- Logs current `core`, `graphql`, and `search` rate-limit buckets after each centralized wrapped `gh` attempt
- Keeps the logging probe non-fatal so quota logging cannot break solve workflows

Example output:

```
📊 GitHub rate limits after $gh (gh api repos): core: 780/5000 used (+29 since last check), 4220 remaining, resets 2026-05-12T10:30:00.000Z; graphql: 10/5000 used (no change), 4990 remaining, resets 2026-05-12T10:30:00.000Z
```
