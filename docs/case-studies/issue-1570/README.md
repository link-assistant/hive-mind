# Case Study: Issue #1570 — Always Notify User About Usage Limit Reached

## Issue Summary

When the auto-restart-until-mergeable watch loop (`watchUntilMergeable()`) encounters a usage limit, it silently waits for the limit to reset without posting a GitHub comment. This makes it appear to the user as if the process is stuck/hung, since there is no visible feedback on the PR.

## Timeline of Events

1. AI solver starts working on a PR with `--auto-restart-until-mergeable` flag
2. During execution, the Anthropic Claude Code usage limit is reached
3. The system detects the limit via `isUsageLimitReached(toolResult)`
4. Instead of posting a GitHub comment (like `attachLogToGitHub()` does in other paths), it:
   - Logs a console message: "Silently waiting then resuming — no GitHub comment posted"
   - Waits for `resetTime + 10min buffer + random jitter` (e.g., ~40 minutes)
   - Resumes the session after the wait
5. The user sees no activity on the PR for ~40+ minutes and assumes the process is stuck

## Root Cause

In `src/solve.auto-merge.lib.mjs` lines 995-1025, the usage limit handler was intentionally designed to NOT post a GitHub comment. The comment at line 997-999 explicitly states:

```
// When usage limit is reached, silently wait for limitResetTime + buffer + jitter,
// then resume the session using --resume <sessionId> with a "Continue" prompt.
// No GitHub comment is posted — only log output.
```

This was likely an oversight or initial simplification. Other code paths (e.g., `solve.watch.lib.mjs`, `github.lib.mjs`) properly post usage limit comments to PRs using `attachLogToGitHub()` with `isUsageLimit: true`.

## Evidence

- **Screenshot 1** (`screenshot-1-silent-waiting.png`): Shows the console output with "Silently waiting then resuming — no GitHub comment posted"
- **Screenshot 2** (`screenshot-2-stuck-appearance.png`): Shows the PR appearing stuck with no recent activity
- **Reference comment**: https://github.com/link-assistant/hive-mind/pull/1568#issuecomment-4227338716 shows what a proper usage limit comment looks like

## Requirements from Issue

1. **Always post a GitHub comment** when usage limit is reached (never silently wait)
2. **Include when exactly execution will be resumed** (not just limit reset time, but reset + buffer + jitter = actual resume time)
3. **Follow the existing standard comment format** (as seen in PR #1568 comment)

## Solution

1. Import `formatResetTimeWithRelative` from `usage-limit.lib.mjs` into `solve.auto-merge.lib.mjs`
2. After detecting usage limit in `watchUntilMergeable()`, post a GitHub comment to the PR using `attachLogToGitHub()` (same pattern as `solve.watch.lib.mjs`)
3. Include the actual resume time (reset + buffer + jitter) in the comment so the user knows when to expect activity

## Existing Components Used

- `attachLogToGitHub()` from `github.lib.mjs` — already supports `isUsageLimit: true` with formatted comments
- `formatResetTimeWithRelative()` from `usage-limit.lib.mjs` — formats reset time with relative display
- `sanitizeLogContent` from `github.lib.mjs` — already imported in `solve.auto-merge.lib.mjs`
- `getLogFile()` from `lib.mjs` — already imported and used in the same file
