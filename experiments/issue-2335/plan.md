# Issue 2335 work plan

- [x] Read issue 2335 and every comment; read PR 2336 conversation, reviews, and inline comments.
- [x] Preserve referenced agent issue 322, PR 326, timelines, comments, diffs, and accessible work-session logs in docs/case-studies/issue-2335/data.
- [x] Read contribution and release guidance; inspect recent related merged PRs and linking history.
- [x] Trace every linking, repository-wide solve, prompt, goal, completion, and merge path; identify proven root causes.
- [x] Research primary documentation and existing goal / requirement-checking components.
- [x] Create minimal automated reproductions before implementation; preserve finite experiments here.
- [x] Implement consistent issue-reference repair for every required issue and fail-closed merge guards.
- [x] Reinforce complete requirement fulfillment across tools/prompts and supported goal APIs.
- [x] Cover critical success, failure, fork, multi-issue, restart, and continuation paths with tests.
- [x] Document requirements, evidence timeline, root causes, solutions, and remaining limits in the case study.
- [x] Add a patch changeset and run required local CI checks and all default tests, saving large logs.

## Publication protocol

1. Commit useful atomic steps, keep history, merge current main if needed, and push only issue-2335-d92d19d37a1b.
2. Update PR 2336 title/body with reproduction, validation, scope, and closing reference; review the full PR diff.
3. Verify latest CI runs against the latest commit SHA/timestamp; save and analyze failed logs, then fix failures.
4. Confirm all checks pass and the working tree is clean, then mark PR 2336 ready.

The final full local run passed all 523 default test files. The implementation, pin refresh and placeholder cleanup are committed. The remaining publication/check steps are verified against the final pushed SHA; their live status is on PR #2336.
