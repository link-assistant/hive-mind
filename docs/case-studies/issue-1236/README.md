# Case Study: Issue #1236 - Increase time buffer before auto resume/restart on limit reset

## Issue Reference

- **Issue**: [#1236](https://github.com/link-assistant/hive-mind/issues/1236)
- **Related PR Comments**:
  - [Usage Limit Reached comment](https://github.com/xlabtg/krypton-platform/pull/2#issuecomment-3860860522)
  - [Solution Draft Log with auto-resume log](https://github.com/xlabtg/krypton-platform/pull/2#issuecomment-3860955310)
- **Date of Incident**: 2026-02-06
- **Version**: solve v1.16.0

## Timeline / Sequence of Events

All timestamps are in UTC.

| # | Timestamp (UTC) | Event | Details |
|---|-----------------|-------|---------|
| 1 | 14:44:40 | Session started | `solve v1.16.0` launched with `--auto-resume-on-limit-reset` for `xlabtg/krypton-platform#1` |
| 2 | 14:44:49 | Branch created | `issue-1-39d2d7cb4eaf` from `main` |
| 3 | 14:44:51 | Branch pushed | Initial commit with CLAUDE.md |
| 4 | 14:44:56 | Draft PR created | PR #2 created |
| 5 | ~14:45:17 | Usage limit hit | Claude returned usage limit error with reset time "4:00 PM" (no timezone) |
| 6 | 14:45:18 | Limit detected | System logged: "The limit will reset at: 4:00 PM" |
| 7 | 14:45:20 | PR comment posted | "Usage Limit Reached" comment with **Reset Time: 4:00 PM** (absolute time only, no timezone, no relative time) |
| 8 | 14:45:22 | Auto-resume engaged | "Waiting until in 14m (Feb 6, 3:00 PM UTC) + 5 min buffer" — Wait time: 0:00:19:37 |
| 9 | 14:45:22 → 15:04:22 | Countdown | 1-minute intervals showing remaining time |
| 10 | 15:05:00 | Buffer elapsed | "Limit reset time reached (+ 5 min buffer)! Resuming session..." |
| 11 | 15:05:00 | Resume command | Session resumed with `--resume` and `--working-directory` flags |
| 12 | 15:05:55 | New session started | Auto-resumed session posted "Auto Resume (on limit reset)" comment |
| 13 | 15:07:48 | Work resumed | AI work session started, PR converted to draft |
| 14 | 15:17:56 | Session completed | Draft log uploaded with cost estimation |

## Root Cause Analysis

### Problem 1: Insufficient buffer time (5 minutes)

**Root Cause**: The system uses a fixed 5-minute buffer (`limitReset.bufferMs = 5 * 60 * 1000`) after the limit reset time. This is configurable via `HIVE_MIND_LIMIT_RESET_BUFFER_MS` but defaults to 5 minutes.

**Evidence**: From the logs, the system detected a reset time of "4:00 PM" (which was interpreted as 3:00 PM UTC). With the 5-minute buffer, it resumed at 3:05 PM UTC (15:05:00). In this case it worked, but the 5-minute buffer is risky because:

1. **Clock drift**: Server clocks may differ by several minutes
2. **Thundering herd**: When multiple instances resume simultaneously after the same limit reset time, they all hit the API at once, potentially causing cascading failures
3. **API propagation delay**: Limit resets may not propagate instantly across all API servers

**Impact**: If the limit hasn't fully reset when the buffer expires, the resumed session immediately hits the limit again, wasting compute resources and creating unnecessary PR comments.

### Problem 2: Missing relative time in PR comments

**Root Cause**: The `attachLogToGitHub()` function in `github.lib.mjs` (lines 457-458, 650-651) displays the reset time as-is without relative time formatting:

```javascript
logComment += `\n- **Reset Time**: ${limitResetTime}`;
```

The `limitResetTime` comes from `extractResetTime()` in `usage-limit.lib.mjs` which returns absolute times like "4:00 PM" or "Jan 15, 8:00 AM" — without timezone context or relative time.

**Evidence**: The PR comment showed:
```
- **Reset Time**: 4:00 PM
```

A user in a different timezone cannot determine when the limit actually resets without knowing the server's timezone. The user has to mentally calculate "4:00 PM in what timezone? How long from now?"

Meanwhile, the console output already uses `formatResetTimeWithRelative()` which produces clear output like "in 14m (Feb 6, 3:00 PM UTC)".

### Problem 3: Missing relative time in waiting comment

**Root Cause**: The "waiting" comment posted to PRs at `solve.mjs` line 1082 uses `global.limitResetTime` directly:

```javascript
`**Reset time:** ${global.limitResetTime}`
```

This displays "4:00 PM" without relative time or UTC conversion, same issue as Problem 2.

## Proposed Solutions

### Solution 1: Increase buffer + add random jitter

Change the default buffer from 5 minutes to 10 minutes, and add a random jitter of 0-300 seconds (0-5 minutes) to distribute load.

**Implementation**:
- In `config.lib.mjs`: Change default from `5 * 60 * 1000` to `10 * 60 * 1000`
- In `solve.auto-continue.lib.mjs`: Add random jitter `Math.floor(Math.random() * 5 * 60 * 1000)` (0-5 minutes)
- New env var: `HIVE_MIND_LIMIT_RESET_JITTER_MS` (default: `5 * 60 * 1000`)

**Rationale**: This is a well-established pattern for avoiding the [thundering herd problem](https://medium.com/@avnein4988/mitigating-the-thundering-herd-problem-exponential-backoff-with-jitter-b507cdf90d62). AWS, Google Cloud, and other major cloud providers [recommend](https://betterstack.com/community/guides/monitoring/exponential-backoff/) adding jitter to retry/backoff strategies. The total wait after reset becomes 10-15 minutes, which provides a comfortable margin for:
- Clock synchronization differences
- API propagation delays
- Load distribution across concurrent instances

### Solution 2: Use relative time + UTC in all user-facing time displays

Apply `formatResetTimeWithRelative()` to all places where reset time is shown to users:

1. **PR "Usage Limit Reached" comment** (`github.lib.mjs` lines 457-458, 650-651)
2. **PR "Waiting" comment** (`solve.mjs` line 1082)

**Before**: `- **Reset Time**: 4:00 PM`
**After**: `- **Reset Time**: in 14m (Feb 6, 3:00 PM UTC)`

**Rationale**: The console already uses this format (line 947-948 of `solve.mjs`). Making PR comments consistent with console output ensures users always know both when the reset happens in absolute UTC time and how long they need to wait.

## Related Patterns / Prior Art

- **AWS Exponential Backoff with Jitter**: [AWS Architecture Blog](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- **Google Cloud Retry Strategy**: Recommends full jitter: `sleep = random_between(0, min(cap, base * 2 ** attempt))`
- **Atlassian Rate Limiting**: [Developer Guide](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/) recommends multiplying delay by random factor 0.7-1.3
- **Node.js Libraries**:
  - [`p-retry`](https://github.com/sindresorhus/p-retry) - Popular retry library with jitter support
  - [`bottleneck`](https://github.com/SGrondin/bottleneck) - Rate limiter with reservoir support
  - [`limiter`](https://github.com/jhurliman/node-rate-limiter) - Token bucket rate limiter

## Files Modified

| File | Changes |
|------|---------|
| `src/config.lib.mjs` | Increase default buffer to 10 min, add jitter config |
| `src/solve.auto-continue.lib.mjs` | Add random jitter to wait time |
| `src/github.lib.mjs` | Use `formatResetTimeWithRelative()` for reset time in PR comments |
| `src/solve.mjs` | Use `formatResetTimeWithRelative()` for reset time in waiting comment |

## Logs

See the `raw-data/` directory for the raw comment data:
- `comment-3860860522-usage-limit-reached.md` - The "Usage Limit Reached" PR comment
- `comment-3860955310-solution-draft-log.md` - The solution draft log containing auto-resume countdown
- `comment-3860958566-auto-resume-started.md` - The auto-resume session start comment
