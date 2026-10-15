---
'@link-assistant/hive-mind': patch
---

The issue-link repair now respects the agent's decisions (issue #3174). Wording such as "#236 to #246 stay open", "#2 and #3 stay open" or "#2, #3 remain open" keeps every listed issue open, not only the first one. The repair checks the pull request's description history and no longer re-adds a sub-issue closing line that the session removed after an earlier repair added it. It logs the conflict instead, and the merge guard keeps the merge blocked until someone decides. A negated keyword such as "does not close #N" now gets a warning, because GitHub still closes #N. The repair and post-merge closing treat that issue as kept open, and the guard refuses a merge that GitHub would use to close it.
