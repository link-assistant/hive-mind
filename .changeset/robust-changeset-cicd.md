---
'@link-assistant/hive-mind': minor
---

Improve changeset CI/CD robustness for multiple concurrent PRs

- Update validate-changeset.mjs to only check changesets ADDED by the current PR (not pre-existing ones)
- Add merge-changesets.mjs script to combine multiple pending changesets during release
- Merged changesets use highest version bump type (major > minor > patch) and combine descriptions chronologically
- Update release workflow to merge multiple changesets before version bump
- This prevents PR failures when multiple PRs merge before a release cycle completes
