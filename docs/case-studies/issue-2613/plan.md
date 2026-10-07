# Issue #2613 investigation and implementation plan

1. Completed: read issue #2613, every PR #2614 comment/review, referenced PR #2592 discussions and repository contribution instructions.
2. Completed: preserve source material, failure logs and initial CI metadata; review large logs in bounded chunks and identify unavailable evidence.
3. Completed: reconstruct the timeline and enumerate requirements, warnings, errors and limits of causal evidence.
4. Completed: trace both execution failures, upload and development-log paths; review recent related PRs and authoritative documentation.
5. Completed: create failing bounded regressions before fixes and retain reusable experiments.
6. Completed: implement shared fixes and optional diagnostic tracing; add one patch changeset. The independent Formal AI recipe defect remains upstream.
7. Completed: pass 563 default test files, nine focused regressions and local quality gates; preserve sanitized captures.
8. Completed: commit atomic implementation/evidence steps and push only the issue branch. Current main is already an ancestor.
9. Completed: update the PR title/body. External findings are reported in gh-upload-log #47 and formal-ai #1189.
10. In progress: verify final-head CI timestamps/SHAs, inspect non-passing logs, review the final diff and confirm a clean worktree. The 15:33 run failed on ten stale dependency declarations; complete logs are preserved, release compatibility is reviewed, pins are refreshed and local freshness passes 168/168. Rerun local tests and quality gates before pushing the CI repair, then verify its new run.
11. Pending: mark PR #2614 ready after validation and report its URL with the concrete result.
