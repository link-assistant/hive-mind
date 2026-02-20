---
'@link-assistant/hive-mind': patch
---

fix: escape '...' ellipsis in MarkdownV2 and retry on UNKNOWN merge state (Issue #1339)

Two root causes fixed:

1. **MarkdownV2 escaping**: In `formatProgressMessage()`, literal '...' was appended in PR titles, error messages, and overflow lines. Telegram's MarkdownV2 requires '.' to be escaped as '\.' - unescaped periods caused 400 Bad Request errors on every message update during CI wait.

2. **UNKNOWN merge state**: GitHub computes PR mergeability asynchronously, so initial queries may return `mergeStateStatus: 'UNKNOWN'`. The old code immediately skipped PRs in this state. Fixed by adding retry logic to `checkPRMergeable()` that retries up to 3 times with 5-second delays before giving up.
