# Case Study: Usage Limit Handling Across Tools (Issue #719)

## Summary
- Problem: When usage limits are reached for AI tools (Claude, Codex, OpenCode), the run was surfaced as a success comment with exit code 0, confusing users. PR comments also lacked a clear “limit reached” message and reset-time guidance.
- Impact: Users had to dig into logs to discover rate/usage limits. Comment formatting did not distinguish usage-limit from generic failures.
- Resolution: Detect usage-limit results and post a dedicated PR comment with reset time and resume instructions; mark the run as failure for CI clarity; attach logs when `--attach-logs` is used.

## Timeline
- 2025-11-12 11:47:04Z: Session starts. Error: "You've hit your usage limit... try again at 12:16 PM." (see issue body)
- 2025-11-13 03:54:27Z: Claude returns a result with `subtype: success` but `is_error: true` and text "Weekly limit reached ∙ resets 5am" (see related comment logs). The harness detected an error, but exit code remained 0 and comment formatting looked like success.
- 2025-11-13 03:58:40Z: Maintainer notes missing proper handling for weekly limit and missing reset-time in PR comment.

## Data
- Issue JSON: issue-719.json
- Linked comment (ideav-local-associative-js): link-foundation-ideav-local-associative-js-pr2-comment-3521528245.json (+ .txt)
- Linked comment (hh-questions): konard-hh-questions-pr30-comment-3525165717.json (+ .txt)

## Root Cause
- The tool libraries (Claude, Codex, OpenCode) already detect usage limits and expose `limitReached` and `limitResetTime`.
- The main driver (`solve.mjs`) attached PR logs on failure but always used the generic failure template, never activating the dedicated usage-limit template available in `attachLogToGitHub`.
- In some sessions, the underlying CLI reported `is_error: true` with exit code 0. The harness treated it as error internally, but the PR comment still resembled a success log.

## Fix Implemented
- In `src/solve.mjs`, when a tool run fails, pass `isUsageLimit`, `limitResetTime`, `toolName`, and a `resumeCommand` to `attachLogToGitHub`. This triggers a dedicated "Usage Limit Reached" comment with reset-time and clear resume instructions. Generic `errorMessage` is sent only when not a usage-limit case.
- Exit remains non-zero on failure, ensuring CI and status reflect failure rather than success.

## Proposed Additional Improvements
- Ensure the error-handlers also pass usage-limit context if an exception is thrown after a limit condition was previously detected.
- Expand `extractResetTime` patterns if new vendor messages emerge.
- Consider adding unit tests for formatting functions in `usage-limit.lib.mjs` and comment template activation in `github.lib.mjs`.

## How to Resume
- The PR comment now includes a ready-to-run resume command when a session ID is available, e.g.:
  - `node src/solve.mjs <issue-url> --resume <session-id>`

