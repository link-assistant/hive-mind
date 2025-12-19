# Timeline

- 2025-11-12T11:47:04Z — Usage-limit error observed in external logs (see ci-logs/issue-719.json:1):
  - Message: "You've hit your usage limit… try again at 12:16 PM."
  - Impact: Command appeared as success while actually failing due to usage limits.

- 2025-11-13T03:54:27Z — Local run reproduction and enhanced tracing (see ci-logs/pr-722.details.txt:1):
  - Output: "Weekly limit reached ∙ resets 5am"
  - Exit: Reported failure path detected (CLI previously exited with code 0, now surfaced via PR comment formatting and failure branch).
  - Session: Captured a session ID for resumption.

- 2025-11-13T04:17Z–04:34Z — CI validation on branch issue-719-a653aae7d4d5 (see ci-logs/gh-run-list.branch.json:1):
  - Multiple runs succeeded, confirming the new usage-limit handling and PR comment behavior are stable.
  - Latest successful head SHA: 419e64bc6c6ac88b8660d2cd44dba0dd2a833f4e

# Root Causes

- Usage-limit errors were not treated as a first-class failure mode across all tools.
- Reset time and resume instructions were not consistently surfaced to the user.
- PR comment formatter lacked a dedicated usage-limit variant; some flows showed generic success/failed formatting.

# Fix Summary

- Added detect-and-format path for usage limits in claude, codex, and opencode libs.
- Propagated limitResetTime and resumeCommand into attachLogToGitHub with a dedicated usage-limit comment.
- Made gist fallback prefer usage-limit formatting whenever isUsageLimit=true.
- solve.mjs now assigns global.limitResetTime from tool results for auto-continue-limit and PR comments.

