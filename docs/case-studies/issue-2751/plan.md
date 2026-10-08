# Issue #2751 work plan

- [x] Read the complete issue, all PR comment types, branch state, and contributing guidelines.
- [x] Check recent CI timestamps and commit SHAs; distinguish the earlier agent failure from CI results.
- [x] Collect issue and PR context, inspect the dependency-update implementation and recent related work, and research primary upstream documentation.
- [x] Document every requirement, the root cause, existing components, alternatives, and the selected solution in the case study.
- [x] Add minimal regression tests and record their failures before implementing the solution.
- [x] Add a separately controllable reporting option, dependency-update default, generated issue instructions, and shared solve prompt behavior.
- [x] Preserve explicit opt-outs through CLI, Telegram, generated-issue, and solve handoffs.
- [x] Update user documentation and add a Changeset release trigger.
- [x] Run focused tests, the complete default test suite, and repository quality checks; preserve large logs and investigate failures.
- [x] Review the local diff for regressions and unintended removals, merge the latest default branch, and preserve the implementation in an atomic verified commit.

## PR finalization procedure

1. Commit the case study, evidence, translated documentation and example after local validation.
2. Push only to `issue-2751-3b566158eaa0` and update the title and description of PR #2754.
3. Review `gh pr diff 2754` for consistency with the issue and unintended feature removals.
4. Verify CI timestamps and head SHAs against the final commit; download any failed-run logs, identify actual errors, and fix them before completing the PR.
5. Mark PR #2754 ready, confirm a clean working tree, and report its URL.

Local verification is recorded in [validation.json](validation.json). The PR
timeline and checks retain the results of the remote finalization procedure.
