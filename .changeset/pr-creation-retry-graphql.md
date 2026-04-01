---
'@link-assistant/hive-mind': patch
---

Add retry logic for transient GraphQL errors during PR creation

When creating cross-fork pull requests shortly after accepting a repository invitation and creating a new fork, GitHub's GraphQL API may return transient errors due to eventual consistency. This change adds:

- Retry logic with exponential backoff (up to 5 attempts) for `gh pr create` when transient GraphQL errors occur
- Re-evaluation of fork mode after invitation acceptance, disabling unnecessary fork mode when write access is available
- `isTransientGraphqlError()` helper to detect retryable error patterns (GraphQL errors, rate limiting, 502/503)
- Case study documentation with timeline, root cause analysis, and solution proposals
