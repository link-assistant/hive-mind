---
'@link-assistant/hive-mind': minor
---

feat(hive): recheck issue conditions before processing queue items

Added `recheckIssueConditions()` function to validate issue state right before processing,
preventing wasted resources on issues that should be skipped due to changed conditions since queuing.

**Checks performed:**

- **Issue state**: Verifies the issue is still open
- **Open PRs**: Checks if issue has PRs (when `--skip-issues-with-prs` is enabled)
- **Repository status**: Confirms repository is not archived

**Benefits:**

- Prevents processing closed issues
- Avoids duplicate work when PRs already exist
- Stops work on newly archived repositories
- Saves AI model tokens and compute resources

**Performance impact:**
Minimal overhead per issue (~300-500ms for API calls), negligible compared to 5-15 minute solve time.

Fixes #810
