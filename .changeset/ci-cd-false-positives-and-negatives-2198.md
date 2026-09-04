---
'@link-assistant/hive-mind': patch
---

Fix the release failure and the CI/CD gaps behind issue #2198.

- `changeset version` no longer resolves `bun` from a stale root `bun.lock`:
  the lockfile is removed and `devEngines.packageManager` declares npm, so
  `@changesets/format` cannot spawn a package manager the runner does not have.
- New `scripts/check-package-manager.mjs` guard, run in the lint job, fails
  loudly if a foreign lockfile or a missing package manager declaration comes
  back.
- Lockfile changes now count as package changes in `detect-code-changes.mjs`,
  so the guard cannot be gated out.
