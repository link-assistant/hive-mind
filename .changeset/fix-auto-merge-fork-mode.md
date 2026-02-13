---
'@link-assistant/hive-mind': patch
---

Fix auto-merge failure in fork mode with permission pre-check (Issue #1226)

- Add fork-mode guard in `startAutoRestartUntilMergable()` to detect when `--auto-merge` cannot work
- Add `checkMergePermissions()` function to verify write/push/admin/maintain access before merge attempts
- Add permission pre-check in `attemptAutoMerge()` to fail fast when user lacks write access
- Post "Ready to merge" comment to PR when auto-merge cannot be performed due to permissions
- Prevent silent failures and infinite restart loops in fork mode scenarios
