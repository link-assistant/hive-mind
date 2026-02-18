---
'@link-assistant/hive-mind': patch
---

fix: use headRepository.name from PR data to construct fork name correctly

Previously, when solving a PR from a fork where the fork's repository name
differs from the base repository name, the tool incorrectly built the fork
name using the base repo's name instead of the actual head repo name.

Example failure scenario (Issue #1332):

- Base repo: `konard/MILANA808-Milana-backend` (a fork itself)
- PR head repo: `MILANA808/Milana-backend`
- Tool tried: `MILANA808/MILANA808-Milana-backend` (wrong, 404)
- Should try: `MILANA808/Milana-backend` (correct)

The fix propagates `forkRepoName` (from `headRepository.name` in PR data)
through the call chain: `solve.mjs` → `setupRepositoryAndClone` →
`setupRepository`, where it's used as the correct source of truth for
building fork repo names. Falls back to base repo name if unavailable.

Also improves the error message when a fork cannot be found, clarifying
that the fork name may differ from the base repo name.
