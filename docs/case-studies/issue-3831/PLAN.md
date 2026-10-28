# Issue 3831 work plan

Objective: implement and verify every issue requirement in PR 3832, preserving task context across temporary Codex and Claude failures.

- [x] Read the complete issue, comments, PR conversation, inline comments, reviews, and linked incident evidence; identify any required sub-issues.
- [x] Preserve incident logs and source metadata locally; reconstruct the event timeline.
- [x] Inspect existing transient classification, provider event handling, session continuation, backoff, budgets, and verbose diagnostics across every execution path.
- [x] Research official provider documentation, related provider issues, recent Hive Mind PRs, and reusable retry components.
- [x] Inventory requirements and map each to code and verification evidence in the case study.
- [x] Add minimal automated reproductions and record failures before implementation.
- [x] Implement all required transient detection and context-preserving retry fixes, retaining permanent-error behavior.
- [x] Add diagnostics only where evidence shows a gap; keep verbose output off by default.
- [x] Report reproducible upstream defects with workaround and suggested code fix where supported by evidence.
- [x] Complete case study with timeline, root causes, alternatives, proposed solutions, and verification.
- [x] Add a patch changeset; run focused tests and local quality checks sequentially within container memory limits; save large outputs to logs.
- [x] Review the complete PR diff for regressions and scope; merge current main if needed; commit atomic work and push only the prepared branch.
- [x] Update PR title/body with reproduction, tests, case-study links, and Fixes #3831.
- [x] Inspect latest CI timestamps and SHAs; download all failed-run logs, fix actual failures, and verify every check at the latest commit.
- [x] Re-read all latest issue/PR feedback, verify clean working tree and complete requirement mapping, then mark PR ready without merging.

CI follow-up completed: preserved run timestamps/SHAs and full failed-run logs, corrected the freshness gate's stale pins/lockfile, reran relevant local checks, and verified the complete implementation pipeline. All 694 default files pass locally and in CI; both GitHub integration files and Docker/DinD verification pass. The final documentation commit uses the existing incremental CI policy; its check results remain attached to PR 3832.
