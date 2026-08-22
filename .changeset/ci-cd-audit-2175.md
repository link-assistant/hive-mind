---
'@link-assistant/hive-mind': patch
---

Fix every error and warning reported by CI/CD (issue #2175).

- The release job now lands the version bump through a pull request when a
  repository ruleset rejects the direct push to `main` (GH013), instead of
  retrying it as a lost race and failing the release.
- The release gate asks the npm registry, not the `.changeset` folder, whether
  the current version is published, so an interrupted release self-heals on the
  next push instead of being silently skipped.
- Release assets are uploaded with the `gh` CLI, removing the last action
  pinned to the deprecated Node 20 runtime.
- Eight source files that had drifted into the 1350-line warning band were
  reduced by extracting cohesive modules; behaviour is unchanged.
