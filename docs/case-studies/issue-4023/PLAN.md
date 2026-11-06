# Issue 4023 work plan

Objective: implement and verify the complete location-privacy request in PR 4024.
The issue and all three PR comment surfaces were read on 2026-11-06. There are
no required sub-issues and no review requests in the captured data.

| Requirement                                       | Implementation and verification plan                                                                                                                             | Status                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Default location privacy for every supported tool | Audit Claude, Codex, Gemini, Qwen, OpenCode and Agent; apply supported configuration and a shared location instruction; cover embedded and agent-commander paths | Implemented; focused checks pass                                       |
| Optional location sharing                         | Add an explicit, default-false CLI option and preserve it through hive forwarding and resumes; test both modes                                                   | Implemented; focused checks pass                                       |
| Collect issue-related data in this directory      | Preserve issue, comments, reviews, sub-issues, relevant source excerpts and experiment results without credentials or actual user locations                      | Evidence collected in `data/`                                          |
| Deep case study, including online facts           | Record sources, root cause, scope, limits and alternatives per requirement; inspect existing components before choosing implementation                           | Completed in `README.md`                                               |
| Implement and verify in one PR                    | Add focused regression coverage, a Changeset release trigger, documentation and current-head CI evidence; review the final diff and mark ready                   | Local validation complete; final CI and readiness recorded on PR #4024 |

Verification order: draft implementation, then focused regression tests and a
local mock-server Codex experiment (no upstream requests), formatting and lint
on changed files, then existing CI for full suites and image builds. Avoid
local full builds because this container has a 2.92 GiB memory limit.

CI investigation: compare recent run timestamps and SHAs with the PR head;
preserve and read logs for non-passing current runs; distinguish old
approval-required runs from dispatched checks. The initial five runs are in
`data/ci-runs-4024.json`; the four dispatched checks on the initial head passed.
Final run links and the verified head SHA belong in the PR validation record,
so results remain associated with the commit that was actually checked.
