---
'@link-assistant/hive-mind': patch
---

After the post-merge check closes an issue, Hive Mind now walks up its parent issues and closes each one whose work is complete (issue #3359). A parent is closed only when four things hold. First, every sub-issue is closed as completed; one closed as not planned or as a duplicate counts only if the parent description says so. Second, the description has no unchecked task-list item and no open "Done when" item. Third, nothing blocks it. Fourth, nobody reopened it after its last sub-issue closed. Otherwise, the parent gets one status comment with the reasons, which is updated instead of repeated. Sub-issues are never closed because their parent closed. This is on by default; turn it off with `--no-close-completed-parents` or `HIVE_MIND_CLOSE_COMPLETED_PARENTS=false`.
