# Case Study: Issue #1495 — Multiple Repeated Comments After `ready to merge`

## Summary

After an AI work session completed on PR [link-foundation/sandbox#73](https://github.com/link-foundation/sandbox/pull/73), **4+ duplicate "Validation Complete" comments** were posted within a 37-second window (12:01:45Z–12:02:22Z), all with near-identical content. This occurred **after** the primary solve session had already ended (12:00:06Z) and after the system had posted its own "Ready to merge" comment (12:00:05Z).

## Timeline of Events

| Time (UTC)          | Event                                                         | Source                                          |
| ------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| 2026-03-26 11:18:21 | "Solution Draft Log" comment posted                           | hive-mind system (previous session)             |
| 2026-03-26 11:51:45 | "✅ Ready to merge" comment posted                            | auto-restart-until-mergeable (previous session) |
| 2026-03-29 11:20:09 | Human comment: "We need to ensure all changes are correct..." | @konard                                         |
| 2026-03-29 11:20:37 | New solve session starts (v1.37.1)                            | solve.mjs                                       |
| 2026-03-29 11:20:47 | PR converted to draft mode                                    | startWorkSession()                              |
| 2026-03-29 11:20:49 | "🤖 AI Work Session Started" comment posted                   | startWorkSession()                              |
| 2026-03-29 11:20:57 | Claude Opus 4.6 agent begins execution                        | executeClaude()                                 |
| 2026-03-29 11:59:31 | Agent posts "✅ Validation Complete — Ready to merge"         | AI agent (via `gh pr comment`)                  |
| 2026-03-29 11:59:49 | Claude session ends (11 turns, $1.19 cost)                    | Claude Code result event                        |
| 2026-03-29 11:59:57 | "🤖 Solution Draft Log" comment posted (with Gist link)       | attachLogToGitHub()                             |
| 2026-03-29 12:00:03 | PR confirmed mergeable (CI: 19/19 passed)                     | watchUntilMergeable()                           |
| 2026-03-29 12:00:05 | "✅ Ready to merge" comment posted                            | watchUntilMergeable()                           |
| 2026-03-29 12:00:06 | Work session ends, process reports completion                 | endWorkSession()                                |
| 2026-03-29 12:00:06 | **4 leaked ChildProcess handles detected at exit**            | Active handles report                           |
| 2026-03-29 12:01:45 | **DUPLICATE**: "✅ Validation Complete" comment               | Unknown source (post-session)                   |
| 2026-03-29 12:01:55 | **DUPLICATE**: "Validation Complete" comment                  | Unknown source (post-session)                   |
| 2026-03-29 12:02:10 | **DUPLICATE**: "✅ Validation Complete — All Checks Passed"   | Unknown source (post-session)                   |
| 2026-03-29 12:02:22 | **DUPLICATE**: "✅ Validation Complete" comment               | Unknown source (post-session)                   |

## Root Cause Analysis

### Primary Root Cause: No Deduplication for AI-Generated PR Comments

The hive-mind system has deduplication mechanisms for **system-generated** comments:

- `readyToMergeCommentPosted` (in-memory flag) prevents duplicate "Ready to merge" comments within a session
- `checkForExistingComment()` checks for existing comments with specific signatures
- `checkForAiCreatedComments()` checks if the AI posted any comments during the session

However, there is **no mechanism** to prevent:

1. The AI agent from posting multiple similar validation/summary comments during a single session
2. Different sessions/processes from posting similar validation comments to the same PR
3. Post-session processes (leaked or concurrent) from posting duplicate comments

### Contributing Factor: Leaked Child Processes

At session exit (12:00:06Z), the process reported **4 leaked ChildProcess handles** (PIDs: 57180, 60552, 73553, 79694). These are shell processes spawned by the AI agent's Bash tool calls that were not properly cleaned up. While these specific processes are unlikely to independently post comments, they indicate resource management issues (related to issue #1493).

### Contributing Factor: No Session Locking or Overlap Protection

The solve system lacks protection against concurrent sessions working on the same PR. If the hive scheduler or a manual invocation starts a new solve process while a previous one is still in its auto-restart-until-mergeable phase, both processes can post overlapping comments.

### Contributing Factor: Lack of Session Boundary Markers in AI Prompt

The AI agent's system prompt instructs it to "make sure no uncommitted changes corresponding to the original requirements are left behind" and to post validation comments, but does not instruct it to:

- Check if a similar validation comment was already posted
- Avoid posting redundant status comments
- Be aware of session boundaries

## Evidence

### Log File

- Gist: https://gist.githubusercontent.com/konard/4c1eff531891736872e9aeb391feb8b8/raw/d93194d12586998482765aa98bd6ecab46bd8efe/adc44743-e23f-4703-8cc7-ec2664bded32.log
- Session ID: `adc44743-e23f-4703-8cc7-ec2664bded32`
- 23,467 log lines, session duration: ~40 minutes

### PR Comments

- PR: https://github.com/link-foundation/sandbox/pull/73
- 11 comments total, 4 duplicate validation comments posted after session ended

## Proposed Solutions

### Solution 1: System-Level Duplicate Comment Prevention (Implemented)

Add a `checkForRecentSimilarComment()` function in the comment-posting utilities that:

1. Before posting any comment, fetches recent PR comments (last 10)
2. Computes a similarity score between the new comment and existing comments
3. Skips posting if a sufficiently similar comment was posted within a configurable time window (default: 5 minutes)
4. Logs a warning when a duplicate is detected and skipped

This prevents duplicates regardless of source (AI agent, system, concurrent processes).

### Solution 2: AI Agent Prompt Enhancement

Add instructions to the system prompt template that:

1. Tell the AI to check existing PR comments before posting a new validation/summary comment
2. Tell the AI to avoid posting if a similar comment already exists
3. Tell the AI to edit/update an existing comment rather than posting a new one

### Solution 3: Session-Level Comment Tracking

Track all comments posted during a session (both by the system and by the AI agent) and prevent posting comments with similar content within the same session.

### Solution 4: Improved Session Demarcation

Add clear "work session boundary" markers that both the system and the AI can use to understand session scope, preventing post-session comment leaks.

## Related Issues

- Issue #1493: Resource leaks (leaked ChildProcess handles)
- Issue #1323: Duplicate "Ready to merge" comments
- Issue #1371: In-memory dedup for "Ready to merge" comments
