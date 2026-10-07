# Issue #2613 investigation and implementation plan

1. Completed: read issue #2613, every PR #2614 comment/review, referenced PR #2592 discussions and repository contribution instructions.
2. Completed: preserve source material, failure logs and initial CI metadata; review large logs in bounded chunks and identify unavailable evidence.
3. Completed: reconstruct the timeline and enumerate requirements, warnings, errors and limits of causal evidence.
4. Completed: trace both execution failures, upload and development-log paths; review recent related PRs and authoritative documentation.
5. Completed: create failing bounded regressions before fixes and retain reusable experiments.
6. Completed: implement shared fixes and optional diagnostic tracing; add one patch changeset. The independent Formal AI recipe defect remains upstream.
7. Completed: pass 563 default test files, nine focused regressions and local quality gates; preserve sanitized captures.
8. Completed: commit atomic implementation/evidence steps and push only the issue branch. A later main fetch includes merged PR #2626; incorporate it with the shared helpers and preserve history.
9. Completed: update the PR title/body. External findings are reported in gh-upload-log #47 and formal-ai #1189.
10. Local verification completed: investigate the 15:33 freshness failure and preserve complete logs; review release compatibility and refresh pins; pass authenticated freshness (168/168) and 563 tests. Merge main's overlapping fixes, reproduce/fix the unusable-directory and throwing-diagnostic regressions, remove the recovery test's hidden live credential probe, and pass the combined 572 files, ten focused regressions and all local quality gates. Final diff review is complete; publish refreshed sanitized captures and merge main's release metadata before pushing. Latest-head CI timestamps, SHAs and conclusions are verified with the PR checks; any failing logs are investigated before finalization.
11. Pending: mark PR #2614 ready after validation and report its URL with the concrete result.
