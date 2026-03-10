---
'@link-assistant/hive-mind': minor
---

feat: enable --auto-restart-until-mergeable by default (Issue #1360)

The `--auto-restart-until-mergeable` feature has become stable enough to be enabled by default. Previously, users had to explicitly pass this flag to enable automatic restart until the PR becomes mergeable.

Now the feature is enabled by default, meaning the solver will automatically restart on new comments from non-bot users, CI failures, merge conflicts, or other issues — without requiring any extra flags. Users who want to disable this behavior can pass `--no-auto-restart-until-mergeable`.
