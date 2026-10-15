---
'@link-assistant/hive-mind': patch
---

The post-session link repair and the pre-merge guard now add or require `Fixes` lines only for issues the pull request is meant to close (issues #3174 and #3282). They skip sub-issues that are already closed, sub-issues created after the pull request was opened (a plan's output), and sub-issues another open pull request closes, including PRs stacked on another branch that GitHub does not link. They also skip a primary issue that the description marks with "Part of #N", "Towards #N" or "#N stays open", together with its sub-issues, so a tracking umbrella can be solved one sub-issue at a time. Issues listed in a repository-mode block and issues with an explicit closing keyword stay required. The repair removes `Fixes` lines that an earlier repair added for such issues, and the merge guard refuses a merge that GitHub would use to close them.
