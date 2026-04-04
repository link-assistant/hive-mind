---
'@link-assistant/hive-mind': patch
---

Auto-recover from non-fork repositories during fork validation (Issue #1518)

- When a repository exists but is NOT a proper GitHub fork (or has wrong parent), safely auto-recover by comparing commits against upstream first — only delete and re-fork if no additional commits would be lost
- Add verbose logging of fork commands for debugging non-fork creation scenarios
- Add post-creation fork validation to detect non-fork repos immediately after `gh repo fork`
- Report non-fork creation to Sentry for monitoring
- Add `--allow-force-non-fork-repository-deletion` flag to force deletion even when additional commits would be lost
- Add case study documenting the root cause analysis of konard/MixaByk1996-elements-app
- Document all previously undocumented solve options in CONFIGURATION.md (12 options including --allow-force-non-fork-repository-deletion)
- Add CI/CD test to verify documentation stays in sync with code options (prevents drift)
