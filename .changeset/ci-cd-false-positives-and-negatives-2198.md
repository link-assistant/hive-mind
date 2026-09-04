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
- Every workflow now declares the narrowest default `permissions` that still
  allows checkout, instead of `read-all`, clearing zizmor's
  `excessive-permissions` findings.
- secretlint was installed on every build but never run as a linter and had no
  config; `npm run check:secrets` now runs it in the lint job, fail-closed,
  with a narrow `.secretlintignore` for the fixtures that hold fake secrets on
  purpose.
- A Broken Link Checker workflow (lychee, with a Wayback Machine fallback) and
  an offline relative-link test now cover documentation links. They catch the
  `docs/FREE_MODELS.md` case-study link that had pointed at a file which never
  existed in any commit, in all four translations.
- All eight Docker jobs booted buildx through a bare
  `docker/setup-buildx-action`, so a transient registry outage failed the
  publish; they now go through a `setup-buildx-resilient` composite action that
  pre-pulls the pinned BuildKit image with backoff and falls back to a
  pull-through mirror.
- actionlint is pinned to 1.7.12 instead of 1.7.7.
