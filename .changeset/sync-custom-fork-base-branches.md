---
'@link-assistant/hive-mind': patch
---

Sync custom fork base branches proactively. When a user passes `--base-branch` in fork mode, the solver now copies the requested branch from `upstream` to the user's fork before creating the issue branch, and falls back to the same recovery if branch creation still trips on a missing `origin/<baseBranch>`. This prevents the `fatal: 'origin/<baseBranch>' is not a commit` failure that surfaced for issue #1772 when an existing fork pre-dated upstream's custom branch.
