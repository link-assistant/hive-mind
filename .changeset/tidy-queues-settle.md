---
'@link-assistant/hive-mind': patch
---

Let AllCommits CI consensus proceed when the pull request head has passed CI and is mergeable, and the only remaining workflow runs have been queued on superseded commits for at least 30 minutes. Verbose output identifies the ignored runs.
