---
'@link-assistant/hive-mind': patch
---

Fix CI/CD changelog formatting when multiple PRs merge before a release (Issue #1452). The merge-changesets script now keeps each changeset as a separate file (only harmonizing bump types) instead of merging descriptions into one, so @changesets/cli produces separate bullet items. Also enhances release notes PR detection to find all related PRs via tag-range merge commit lookup.
