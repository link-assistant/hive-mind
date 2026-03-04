---
'@link-assistant/hive-mind': patch
---

Add case study and regression test for issue #1389: no `ready to merge` comment when `--auto-restart-until-mergeable` is enabled

Documents root cause (checkForExistingComment searching all-time PR history in v1.25.7),
timeline reconstruction from log b623ee9f, and confirms the fix from issue #1371 (in-memory
readyToMergeCommentPosted flag) resolves the cross-session notification suppression.
Adds test-ready-to-merge-cross-session-1389.mjs to prevent regression to the old approach.
