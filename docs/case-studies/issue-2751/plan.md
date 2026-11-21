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

## Fresh CI failure investigation

- [x] List the latest runs with timestamps and head SHAs; identify the failure on `5ba4ccc9` after its commit timestamp.
- [x] Download Checks and release run `37759757893` to `ci-logs/` and preserve it in the case study.
- [x] Read the failing log section: three Box base pins are stale; all other declarations resolve.
- [x] Verify the new upstream release, reproduce the freshness failure locally with authentication, and record a failing pin regression.
- [x] Refresh the three pins and the existing pin/runtime test expectations.
- [x] Recheck freshness and all five affected test files; preserve the successful local logs.
- Verify fresh CI on the follow-up commit using the PR finalization procedure above.

## Follow-up review

- [x] Collect the edited PR description and latest issue/PR comments.
- [x] Audit every original requirement against implementation and tests.
- [x] Resolve the Docker comment conflicts using the current default branch; retain both case-study formatting exclusions.
- [x] Expand Telegram coverage to seven reporting choices and add seven cases through the production hive argument forwarder.
- [x] Revisit primary-source research and reproduce the new Sentry freshness failure.
- [x] Refresh the Sentry packages and validate before/after dependency-pin checks.
- [x] Preserve the final default-suite and local-check evidence in `review-validation.json` (581/581 test files passed after the Sentry refresh).
- [x] Preserve the default-branch merge and expanded reporting regression coverage in separate commits.
- Commit the validated dependency refresh and case study, push the prepared branch, and update the PR description using the finalization procedure above.
- Verify fresh CI for the latest SHA, mark the PR ready, and confirm the working tree is clean using the finalization procedure above; retain the results in the PR timeline.
