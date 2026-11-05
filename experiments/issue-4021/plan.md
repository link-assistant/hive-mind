# Queue work accounting (#4021)

Objective: implement and verify all requirements in PR #4022, without killing vendor services.

- [x] Read the complete issue, all issue/PR comments and reviews, and related #2917. There are no required sub-issues. #2917 is context, not a request to implement its orphan-adoption feature here.
- [x] Confirm root cause: name-only pgrep counts idle services; max(processes, sessions) loses distinct jobs and boolean API accounting double-counts overlaps.
- [x] Classify foreground work for Claude, Codex, Agent, Qwen and Gemini; exclude services, helpers, administrative commands and zombies; collapse wrapper/native process trees.
- [x] Merge live tracked executions (including app-server-backed, Docker and detached work), local jobs and in-flight queue admissions by execution/process identity.
- [x] Use the same accounting for queue display, dispatch, resource and API throttling; retain verbose diagnostics, off by default, without logging prompts or environment values.
- [x] Regression tests: services at 50% and 98%, real jobs, wrapper/native pairs, mixed tools, independent local and Docker jobs, stale records, active app-server tasks and concurrent admission.
- [x] Run focused tests and formatting/lint checks; include regression tests in automatic default/PR-essential suite discovery and a patch changeset. All eight focused queue/session test files pass, including 23 new regression cases; ESLint and Prettier pass for changed files. The offline reproduction confirms the before/after behavior using the pre-fix counter.
- [ ] Review diff, confirm main is included, commit/push only the prepared branch, update PR description and mark ready.
- [ ] Verify CI on the latest SHA. Preserve and read non-passing logs with timestamps; initial action-required run 41866500012 has no available log, while its dispatched workflows succeeded.

CI investigation: run 42068254253 targets implementation commit `580a5eb4f` (2026-11-05 16:48 UTC). Its dependency freshness gate fails before tests: `ci-logs/checks-release-42068254253.log:3953`–`3982` lists inherited stale act, Formal AI, start-command, Sentry, links-notation and transitive lockfile pins. Refresh those declarations and their existing pin-consistency tests in a separate commit, then verify the resulting SHA. Security and broken-link checks passed for the implementation commit.

All checks passed on `1744dbc2b` (Checks and release run 42069703978), including the PR-essential regression suite. Final installed-entrypoint review added Qwen's `cli-entry.js` and runtime services plus tool-specific subcommands; the expanded 23-case regression suite and changed-file lint pass locally. Verify that follow-up in CI before finalizing.
