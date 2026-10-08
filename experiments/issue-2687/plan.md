# Issue 2687 work plan

- [x] Verify prepared branch and clean tree; read contributing guidance and issue/PR comments.
- [x] List recent CI runs with timestamps and head SHA; distinguish pending approval from test failures.
- [x] Preserve issue, related PR comments, all available linked Gist logs, and unavailable-log evidence in the case-study directory.
- [x] Read logs in chunks of at most 1500 lines; reconstruct the event sequence and trace terminal-tool-result handling throughout the codebase.
- [x] Search primary online sources and recent related PRs for protocol semantics and existing solutions.
- [x] Add a minimal automated regression that fails before the fix; keep finite local experiments under experiments/issue-2687.
- [x] Implement the root-cause fix across affected paths, keeping diagnostics off by default and preserving real session failures.
- [x] Document requirements, evidence, root causes, alternatives, upstream-report assessment, and remaining limits in the case study.
- [x] Add a patch changeset and remove the initial PR placeholder.
- [ ] Run targeted tests, full local default tests, lint, format, and relevant CI checks; save large output to log files.
- [ ] Commit atomic work on the prepared branch after local checks; merge the latest default branch and resolve conflicts if necessary.
- [ ] Push only issue-2687-cdf77e59ffa9; update PR 2690 title/description with reproduction and validation.
- [ ] Review the complete PR diff for unintended regressions; verify fresh CI on the latest SHA, download every failed-run log, and resolve failures.
- [ ] Mark PR 2690 ready, verify a clean working tree, and report the PR URL with any concrete limitations.
