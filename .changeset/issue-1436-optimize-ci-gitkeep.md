---
'@link-assistant/hive-mind': patch
---

Optimize CI/CD to skip checks for .gitkeep-only changes and harden .gitkeep cleanup logic (Issue #1436).

CI/CD jobs `version-check` and `helm-pr-check` now skip when only `.gitkeep` files changed, saving ~21 seconds of runner time per PR on the initial commit. The `detect-code-changes.mjs` script now excludes `.gitkeep` files from code change detection and outputs a `gitkeep-only` flag.

The `.gitkeep` cleanup logic in `solve.results.lib.mjs` is hardened with: (1) full commit message body detection (`%B` instead of `%s`) so `.gitkeep` references in commit body are found, (2) fallback file detection via `git diff-tree`, and (3) post-cleanup verification with direct removal fallback to prevent leftover `.gitkeep` files.

Also removes the leftover `.gitkeep` file from the repository that was left behind by PR #1420.
