---
'@link-assistant/hive-mind': patch
---

Add GitHub Actions billing limit detection for --auto-restart-until-mergeable mode

- Detect when CI failures are caused by billing/spending limits via check run annotations
- For private repositories: Post an explanatory comment and stop (requires human intervention)
- For public repositories: Apply exponential backoff and wait (unusual case)
- Prevents infinite AI restart loops when billing limits are reached
- New functions: checkForBillingLimitError(), getCheckRunAnnotations(), getRepoVisibility()
- Adds comprehensive test coverage for billing limit detection
- Documents the billing limit in case study for issue #1314
