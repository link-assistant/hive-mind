---
'@link-assistant/hive-mind': patch
---

feat: add GitHub API rate limit logging to solve command

Adds logging of GitHub API rate limit usage at key points during solve command execution to help identify expensive operations that consume the most API limits.

Features:

- Logs rate limit status at session start, after repository setup, after PR setup, after AI tool execution, and provides a summary at session end
- Shows delta tracking to identify how many API calls each operation consumes
- Configurable via `--github-rate-limits-logging` flag (enabled by default)
- Can be disabled with `--no-github-rate-limits-logging`
- New `github-rate-limit-logger.lib.mjs` module for reusable rate limit tracking

Example output:

```
📊 GitHub API: 751/5000 used (15%) (resets in 32m) [session start]
📊 GitHub API: 780/5000 used (16%) [+29 since last check] (resets in 31m) [after repository setup]
📊 GitHub API: 785/5000 used (16%) [+5 since last check] (resets in 30m) [after PR setup]

📊 GitHub API Rate Limit Summary:
   Total API calls this session: 34
   Final usage: 785/5000 (16%)
   Remaining: 4215 requests
   Resets in: 29m
```
