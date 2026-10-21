---
'@link-assistant/hive-mind': patch
---

A failed run no longer marks a placeholder pull request ready for review (#3434). At run end, a pull request left in draft stays a draft when its title still starts with `[WIP]` or its description is still the "Work in Progress" placeholder, and the log gives the reason in one line. If the title and description cannot be read, the pull request also stays a draft and the run does not fail. The placeholder checks now live in `pr-placeholder.lib.mjs`, shared by `verifyResults` and the run-end restore.
