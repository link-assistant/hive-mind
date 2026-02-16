---
'@link-assistant/hive-mind': patch
---

Comprehensive CI/CD status handling for --auto-restart-until-mergeable mode

- Detect when CI failures are caused by billing/spending limits via check run annotations
- For private repositories: Post an explanatory comment and stop (requires human intervention)
- For public repositories: Apply exponential backoff and wait (unusual case)
- Distinguish between CI failure, cancelled, pending, queued, and billing limit states
- Automatically re-trigger cancelled CI/CD workflow runs instead of restarting AI
- Only restart AI when genuine code failures occur (not for cancelled/pending/billing)
- Wait for all CI/CD checks to complete before deciding on AI restart
- New functions: getDetailedCIStatus(), rerunWorkflowRun(), rerunFailedJobs(), getWorkflowRunsForSha()
- Expanded test coverage: 45 tests covering all CI/CD status scenarios and decision logic
