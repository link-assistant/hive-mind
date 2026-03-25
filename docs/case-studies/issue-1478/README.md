# Case Study: Issue #1478 - PR Creation Failed Due to Transient GitHub API Error

## Summary

The `solve.mjs` auto-PR creation process failed when `gh pr create --draft` received a transient GraphQL server error from GitHub's API. The error occurred during a confirmed GitHub service disruption on March 24, 2026. The PR title contained Cyrillic characters ("update враг снайпер"), which was initially suspected as a cause but was ruled out — the failure was a transient server-side error with no retry mechanism in place.

## Affected Issue

- **Target Repository**: Jhon-Crow/godot-topdown-MVP
- **Target Issue**: [#1336](https://github.com/Jhon-Crow/godot-topdown-MVP/issues/1336) — "update враг снайпер"
- **Error**: `GraphQL: Something went wrong while executing your query on 2026-03-24T20:09:47Z. Please include C494:160A:1899070D:156DE0AF:69C2EF89 when reporting this issue.`

## Timeline of Events

| Timestamp (UTC)              | Event                                                            |
| ---------------------------- | ---------------------------------------------------------------- |
| 2026-03-24T20:09:14.090Z     | solve.mjs v1.35.9 started                                        |
| 2026-03-24T20:09:19.720Z     | System checks passed (disk, memory)                              |
| 2026-03-24T20:09:20.501Z     | Fork mode enabled (no write access to target repo)               |
| 2026-03-24T20:09:26.907Z     | Fork validated: konard/Jhon-Crow-godot-topdown-MVP               |
| 2026-03-24T20:09:37.398Z     | Repository cloned to /tmp/gh-issue-solver-1774382965260          |
| 2026-03-24T20:09:39.082Z     | Branch created: issue-1336-9d97d520d1f8                          |
| 2026-03-24T20:09:39.155Z     | .gitkeep committed: 4e6145a5                                     |
| 2026-03-24T20:09:40.083Z     | Branch pushed to remote (exit code 0)                            |
| 2026-03-24T20:09:42.587Z     | Compare API confirms: 1 commit ahead of main                     |
| 2026-03-24T20:09:43.526Z     | Issue title fetched: "update враг снайпер"                       |
| 2026-03-24T20:09:44.432Z     | `gh pr create --draft` command executed                          |
| **2026-03-24T20:09:47.583Z** | **FATAL ERROR: GraphQL server-side error (3.1s after command)**  |

## Root Cause Analysis

### Primary Root Cause: Transient GitHub API Server Error

The error `"Something went wrong while executing your query"` is a **generic GitHub server-side error** (HTTP 500-class). The hex code `C494:160A:1899070D:156DE0AF:69C2EF89` is an internal GitHub correlation ID for their engineering team to locate the specific failure.

**GitHub confirmed a service disruption on March 24, 2026** titled "Disruption with some GitHub services" (incident code: `kp06czybl7dw`) affecting:
- Pull Requests — ~1,941 seconds of downtime
- Issues — ~1,940 seconds of downtime
- Git Operations — ~5,006 seconds of downtime

The error timestamp `2026-03-24T20:09:47Z` falls within this disruption window.

### Red Herring: Cyrillic Characters

The PR title `[WIP] update враг снайпер` contains Cyrillic characters. Initial investigation considered whether non-ASCII characters in the title caused the GraphQL error. This was **ruled out** because:

1. GitHub's GraphQL API accepts UTF-8 JSON payloads, which fully supports Cyrillic
2. The code already uses file-based title passing (`$(cat '/tmp/pr-title-*.txt')`) to avoid shell encoding issues
3. No documented bugs exist in `gh` CLI or GitHub API related to non-ASCII PR titles
4. If Cyrillic were invalid, GitHub would return a 422 Unprocessable Entity with a descriptive validation error, not a generic 500 "something went wrong"
5. The error coincided with a confirmed GitHub service disruption

### Secondary Root Cause: Missing Retry Logic for PR Creation

While the codebase already has retry logic with exponential backoff for:
- **Compare API** (lines 571-624): 5 retries with 2s, 4s, 6s, 8s, 10s backoff
- **PR verification** (lines 1206-1259): 5 retries with same backoff pattern

The `gh pr create` command itself (line 1121) has **no retry logic for transient server errors**. It only retries for assignee validation errors (lines 1124-1156). When a transient GitHub API error occurs, the tool immediately fails without any retry attempt.

## Evidence

### Sources Consulted
- [cli/cli Issue #7735](https://github.com/cli/cli/issues/7735) — Same generic GraphQL error with `gh pr merge --auto`
- [cli/cli Issue #3316](https://github.com/cli/cli/issues/3316) — Same error with `gh repo create`
- [cli/cli Issue #4037](https://github.com/cli/cli/issues/4037) — Same error pattern in other operations
- [GitHub Status Page](https://www.githubstatus.com) — Confirmed disruption on 2026-03-24

### Key Code Locations
- `src/solve.auto-pr.lib.mjs:1121` — `execAsync(command, ...)` call with no retry
- `src/solve.auto-pr.lib.mjs:1396-1420` — Error handler that immediately throws
- `src/solve.auto-pr.lib.mjs:571-624` — Existing retry pattern (compare API)
- `src/solve.auto-pr.lib.mjs:1206-1259` — Existing retry pattern (PR verification)

## Proposed Solution

Add retry logic with exponential backoff for the `gh pr create` command when transient server errors are detected. The retry should:

1. **Detect transient errors**: Match patterns like "Something went wrong", HTTP 500, "502 Bad Gateway", "503 Service Unavailable", and network errors
2. **Use existing backoff pattern**: 5 retries with `Math.min(2000 * attempt, 10000)` delays (2s, 4s, 6s, 8s, 10s)
3. **Only retry transient errors**: Non-transient errors (validation, auth, "No commits between") should still fail immediately
4. **Log retry attempts**: Using existing verbose logging pattern

### Implementation Reference

The retry logic follows the same pattern already established at lines 571-624 and 1206-1259 of `solve.auto-pr.lib.mjs`.
