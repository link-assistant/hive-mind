---
'@link-assistant/hive-mind': patch
---

`/fix --update-all-dependencies` and `/task --update-all-dependencies` no longer leave conflicting Dependabot pull requests open (issue #3863). Mergeability that GitHub has not computed yet is re-read before merging, "the merge commit cannot be cleanly created" counts as a conflict instead of triggering a pointless `--admin` retry, a conflicting pull request is closed when the base branch already pins every dependency it bumps at the same or a newer version, and otherwise Dependabot is asked to `@dependabot recreate` it and the recreated pull request is merged within a bounded wait. The issue section is now headed "Open Dependabot pull requests handled before this issue was created" and lists merged, closed and still-open pull requests separately, without claiming that Dependabot closes them by itself.
