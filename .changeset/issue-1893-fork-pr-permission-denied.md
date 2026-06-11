---
"@link-assistant/hive-mind": patch
---

Continue fork PRs with "Allow edits by maintainers" instead of halting on a misclassified fork divergence (#1893).

When the solver continues a cross-repository PR opened from another contributor's fork, it
synced the upstream default branch and then tried to push it back to `origin` — the
contributor's fork, which the operating maintainer does not own. GitHub rejected the push
with `! [remote rejected] main -> main (permission denied)`, and the solver misclassified
that permission error as a fork divergence (the heuristic matched the substring `rejected`),
halting with `Repository setup halted - fork divergence requires user decision` and advising
`--allow-fork-divergence-resolution-using-force-push-with-lease` — a flag that cannot help,
since force-push also requires fork write access.

- src/solve.branch-divergence.lib.mjs: add two pure helpers —
  `shouldPushDefaultBranchToFork({currentUser, forkedRepo})` (skip the push when the user does
  not own the fork; fail-open when owner/user is unknown) and `isPermissionDeniedPushError()`
  (recognize a permission-denied rejection so it is never treated as divergence).
- src/solve.fork-sync.lib.mjs: new module holding `setupUpstreamAndSync` (extracted from
  solve.repository.lib.mjs to stay under the 1500-line limit, re-exported unchanged). It now
  resolves the current user, skips the fork's default-branch push when the user is not the fork
  owner, and on a permission-denied push warns and continues on the PR branch instead of
  halting. Genuine non-fast-forward divergence still triggers the original guidance. Adds
  verbose diagnostics explaining each skip/continue decision.
- tests/test-issue-1893-fork-pr-permission-denied.mjs: regression coverage (9 cases) using the
  exact failure output from the run log.
- docs/case-studies/issue-1893: deep case study with downloaded logs/data, timeline, root
  causes, fix, codebase-wide audit, and existing-components review.
