---
'@link-assistant/hive-mind': patch
---

A closing reference to an issue in another repository that the pull request author wrote in the description (above any repair block) no longer blocks the merge, and the issue is closed explicitly after the merge, because GitHub does not close it (issue #3358). Foreign references that the link repair appended, or that come from a sub-issue tree, still block the merge, as in issue #3276. A sidebar-only foreign link still blocks it too. `--no-allow-cross-repository-closing` or `HIVE_MIND_ALLOW_CROSS_REPOSITORY_CLOSING=false` restores the previous rule, which blocks every foreign closing reference.
