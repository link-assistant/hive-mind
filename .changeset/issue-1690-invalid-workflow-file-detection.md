---
'@link-assistant/hive-mind': patch
---

Fix `/merge` and `--auto-restart-until-mergeable` getting stuck forever waiting for check-runs that never arrive when a target repo's GitHub Actions workflow file is invalid (e.g. YAML syntax error or `Unrecognized named-value` expression error). GitHub creates a `status=completed, conclusion=failure` workflow run with zero jobs and zero check-runs in this case; the new `getWorkflowRunJobsCount` helper detects the zero-jobs signal and surfaces the broken workflow as a `ci_failure` blocker so the auto-restart loop fires and the AI solver receives the actionable error (workflow file path + run URL) instead of looping silently. See `docs/case-studies/issue-1690/`.
