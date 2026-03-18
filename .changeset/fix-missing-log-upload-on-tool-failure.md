---
'@link-assistant/hive-mind': patch
---

Fix missing log upload on tool failure in auto-restart-until-mergeable (Issue #1439)

When `--attach-logs` is enabled and the tool execution fails during an auto-restart session, the failure log was not being uploaded to GitHub. This meant users had no visibility into what happened.

Now, if `--attach-logs` is set and a PR number is available, the current log file is attached to the PR before stopping on both tool execution failure paths (resume failure and initial execution failure).
