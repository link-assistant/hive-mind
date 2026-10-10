---
'@link-assistant/hive-mind': patch
---

`--auto-restart-until-mergeable` no longer spends every restart on a CI failure the pull request did not cause (#2839). The no-progress check between AI sessions now compares only the commit and the working tree, so a model that rewords the same final message no longer counts as progress. When every failing CI check also fails on the head of the base branch or on the solver's placeholder commit, the next session is told so once. If those checks are still the only blocker after that session, the loop stops and posts a "needs human: CI fails on the base branch too" comment with links to the evidence.
