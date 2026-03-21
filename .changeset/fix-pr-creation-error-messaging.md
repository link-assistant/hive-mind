---
'@link-assistant/hive-mind': patch
---

fix: improve PR creation failure error messaging and log upload fallback (Issue #1462)

- Consolidate triple error output into a single clear error message when PR creation fails
- Upload failure logs to the issue as fallback when PR is not available (--attach-logs)
- Capture and log `gh pr create` stdout/stderr in verbose mode for root cause diagnosis
- Add fallback GitHub user detection via `gh auth status` when `gh api user` fails
