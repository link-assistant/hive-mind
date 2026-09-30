# Issue #2324 work plan

- [x] Read the complete issue, related requirements (#2323/#2325), PR #2321, and all issue/PR #2329 comment types; verify the prepared branch and repository instructions.
- [x] Inspect existing dependency freshness, credential handling, draft automation, e2e runner, cleanup, and Formal AI sidecar implementations. Compare recent related PRs and current upstream contracts/releases.
- [x] Preserve failed CI logs, match timestamps and head SHAs, and identify specific errors before changing code.
- [x] Add minimal regression tests that fail for the unmet requirements; keep experiments here and use mocks for GitHub operations.
- [x] Update task image pins and package/lockfile minimums to latest stable releases; enforce freshness across every dependency source with verified open-issue exceptions.
- [x] Use the shared layered token resolver throughout workflows; provide checks-only dispatch and remove secret-dependent skips.
- [x] Implement branch-isolated e2e tasks, optional repository isolation, per-model keys, real workflow verification/approval/act fallback, artifact evidence, and cleanup/keep support.
- [x] Schedule e2e on Hive Mind releases and daily only for untested Formal AI tags, using downloadable success artifacts.
- [x] Grant workspace prerequisite installation to task-container Formal AI sidecars and address Links Notation duplication from #2325.
- [x] Clean the historical Hello World branches using the authorized cleanup workflow and record results.
- [ ] Run targeted tests and all local CI checks/default tests; save large output in files. Add a changeset and update the #2320 case study with the first matrix run and precise per-row evidence/upstream issues.
- [ ] Commit useful atomic changes, merge current main, push only issue-2324-6664a8331822, and update PR #2329 title/body with reproduction and verification.
- [ ] Review the complete PR diff for regressions, inspect fresh CI logs for any failures, resolve actionable failures, ensure a clean worktree, and mark PR #2329 ready.

All commands and delegated work must finish before completion. Stress experiments use finite inputs and resource limits. No routine implementation approvals are needed. Preserve forward-moving commit history.
