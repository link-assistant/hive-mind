# Queue work accounting (#4021)

Objective: implement and verify all requirements in PR #4022, without killing vendor services.

- [x] Read the complete issue, all issue/PR comments and reviews, and related #2917. There are no required sub-issues. #2917 is context, not a request to implement its orphan-adoption feature here.
- [x] Confirm root cause: name-only pgrep counts idle services; max(processes, sessions) loses distinct jobs and boolean API accounting double-counts overlaps.
- [x] Classify foreground work for Claude, Codex, Agent, Qwen and Gemini; exclude services, helpers, administrative commands and zombies; collapse wrapper/native process trees.
- [x] Merge live tracked executions (including app-server-backed, Docker and detached work), local jobs and in-flight queue admissions by execution/process identity.
- [x] Use the same accounting for queue display, dispatch, resource and API throttling; retain verbose diagnostics, off by default, without logging prompts or environment values.
- [x] Regression tests: services at 50% and 98%, real jobs, wrapper/native pairs, mixed tools, independent local and Docker jobs, stale records, active app-server tasks and concurrent admission.
- [x] Run focused tests and formatting/lint checks; include regression tests in automatic default-suite discovery and a patch changeset. All seven focused test files pass, including 21 new regression cases; ESLint and Prettier pass for changed files. The offline reproduction confirms the before/after behavior using the pre-fix counter.
- [ ] Review diff, confirm main is included, commit/push only the prepared branch, update PR description and mark ready.
- [ ] Verify CI on the latest SHA. Preserve and read non-passing logs with timestamps; initial action-required run 41866500012 has no available log, while its dispatched workflows succeeded.
