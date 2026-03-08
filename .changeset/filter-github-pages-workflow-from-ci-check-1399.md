---
'@link-assistant/hive-mind': patch
---

fix: filter GitHub Pages deployment workflows from PR CI check (Issue #1399)

`getActiveRepoWorkflows()` included the `pages-build-deployment` workflow (path: `dynamic/pages/pages-build-deployment`) as if it were a PR CI workflow. This workflow is auto-created by GitHub for GitHub Pages and only runs on the default branch after merge — it never creates check-runs on PR branches. As a result, `--auto-restart-until-mergeable` got stuck in an infinite loop waiting for CI checks that would never appear.

The fix filters out workflows with the `dynamic/pages/` prefix from `getActiveRepoWorkflows()`. These are GitHub Pages internal workflows, not user-defined CI pipelines.

Affected scenario: repositories with GitHub Pages enabled but no `.github/workflows/` files (e.g., `konard/links-visuals`).
