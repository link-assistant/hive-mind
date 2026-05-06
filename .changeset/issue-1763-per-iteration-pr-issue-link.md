---
"@link-assistant/hive-mind": patch
---

Verify the pull request still links to the issue after every work session inside `--watch`, `--auto-restart-until-mergeable`, and `--finalize`, so that an iteration that turns out to be the last one cannot leave the PR un-linked when the AI rewrote the description without a closing keyword.
