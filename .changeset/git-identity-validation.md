---
'@link-assistant/hive-mind': patch
---

Add git identity validation to prevent commit failures

- Added `checkGitIdentity()` and `validateGitIdentity()` functions to validate git user configuration
- Added git identity check to `performSystemChecks()` that runs before any work begins
- Added `gh-setup-git-identity` utility to configure git identity from GitHub CLI account
- Added unit tests for identity validation

This fix prevents the "fatal: empty ident name" error that occurs when git user.name and user.email are not configured. When git identity is missing, users now see a clear error message with instructions for fixing it.
