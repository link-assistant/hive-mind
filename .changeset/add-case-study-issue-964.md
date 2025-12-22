---
'@link-assistant/hive-mind': patch
---

Add case study for issue #964: Discussion comments not loaded to AI context

This case study documents the root cause analysis of why the AI solver failed to see and respond to repository owner feedback on PR #13 in the eg0rmaffin/vapor-rice-i3 repository. The investigation revealed two independent root causes:

1. The feedback system tells the AI the count of new comments but not their content
2. The AI used an incomplete API command that only fetches conversation comments, missing review comments

The case study includes proposed solutions to fix this issue.
