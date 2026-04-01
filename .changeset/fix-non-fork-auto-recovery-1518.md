---
'@link-assistant/hive-mind': patch
---

Auto-recover from non-fork repositories during fork validation (Issue #1518)

- When a repository exists but is NOT a proper GitHub fork (or has wrong parent), automatically delete it and create a fresh fork instead of failing with an error
- Add verbose logging of fork commands for debugging non-fork creation scenarios
- Add post-creation fork validation to detect non-fork repos immediately after `gh repo fork`
- Report non-fork creation to Sentry for monitoring
- Add case study documenting the root cause analysis of konard/MixaByk1996-elements-app
