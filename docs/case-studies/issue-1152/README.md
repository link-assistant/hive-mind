# Case Study: Issue #1152 - `--auto-resume-on-limit-reset` Improvements

## Overview

This case study documents the investigation and root causes of several problems related to the `--auto-resume-on-limit-reset` feature in solve.mjs, based on real-world usage data from [PR #2 on VisageDvachevsky/veil-windows-client](https://github.com/VisageDvachevsky/veil-windows-client/pull/2).

## Timeline of Events (2026-01-21)

| Time (UTC) | Event                                                  | Comment ID     | Notes                                     |
| ---------- | ------------------------------------------------------ | -------------- | ----------------------------------------- |
| 17:40:53   | User requests testing of installers and CI/CD          | #3780014672    |                                           |
| 17:50:13   | AI Work Session Started                                | #3780092810    | Regular "AI Work Session Started" comment |
| 17:50:24   | Claude hits usage limit                                | (internal log) | `"error": "rate_limit"` in stream JSON    |
| 17:50:27   | Limit detected: "7pm (Europe/Berlin)"                  | (internal log) | Reset time extracted correctly            |
| 17:50:29   | **PROBLEM 1**: Usage Limit Reached comment posted      | #3780094933    | Contains CLI command in GitHub comment    |
| 17:50:30   | Auto-resume timer started                              | (internal log) | Wait time: 9 min 29 sec                   |
| 18:00:00   | Limit reset time reached                               | (internal log) | Only waited until exactly 7:00 PM         |
| 18:00:00   | **PROBLEM 2**: Resume executed WITHOUT `--resume` flag | (internal log) | Did restart, not resume!                  |
| 18:00:10   | **PROBLEM 3**: Solution Draft Log posted               | #3780177716    | Failed attempt, $0.00 cost                |
| 18:00:52   | **PROBLEM 4**: Work Session Started (again)            | #3780183691    | Should say "Auto resume (on limit reset)" |
| 18:00:54   | Claude successfully continues work                     | (internal log) | With `--resume` flag this time            |
| 18:06:52   | **PROBLEM 5**: Solution Draft Log posted               | #3780233713    | Should say "Draft log of auto resume"     |

## Root Cause Analysis

### Problem 1: CLI commands shown in GitHub comments

**Evidence**: Comment #3780094933 contains:

````
### 🔄 How to Continue
Once the limit resets at **7:00 PM**, you can resume this session by running:
```bash
(cd "/tmp/gh-issue-solver-1769017807089" && claude --resume ff411057-0dc8-4cc2-8087-10bef0bce233 --model opus)
````

**Root Cause**: The `attachLogToGitHub()` function in `github.lib.mjs:462-466` includes `resumeCommand` in the GitHub comment. When `--auto-resume-on-limit-reset` is active, the resume command will be executed automatically, so showing it to users is confusing and unnecessary.

**Files involved**:

- `src/github.lib.mjs:462-466` - Comment template includes resumeCommand
- `src/github.lib.mjs:620-624` - Same for gist upload path

### Problem 2: No 5-minute buffer after limit reset

**Evidence**: Log shows the auto-resume executed at exactly 7:00:00 PM when limit was supposed to reset at 7:00 PM. The first attempt at 18:00:00 failed because the limit hadn't actually reset yet (server time differences).

**Root Cause**: The `autoContinueWhenLimitResets()` function in `solve.auto-continue.lib.mjs:91` waits exactly until the reset time with no buffer:

```javascript
await new Promise(resolve => setTimeout(resolve, waitMs));
```

**User requirement**: Wait at least 5 minutes after the limit resets to account for server time differences.

### Problem 3: First auto-resume attempt did RESTART instead of RESUME

**Evidence**: Failed attempt log (comment #3780177716) shows at 17:50:24:

```
📝 Raw command: (cd "/tmp/gh-issue-solver-1769017807089" && claude --output-format stream-json --verbose --dangerously-skip-permissions --model claude-opus-4-5-20251101 -p "Issue to solve...
```

Note: **NO `--resume` flag** in the command! This is a restart, not a resume.

But in the successful log at 18:01:05:

```
🔄 Resuming from session: ff411057-0dc8-4cc2-8087-10bef0bce233
📝 Raw command: (cd "/tmp/gh-issue-solver-1769017807089" && claude --resume ff411057-0dc8-4cc2-8087-10bef0bce233 ...
```

**Root Cause**: The auto-resume functionality was calling the solve script which then ran without a session ID on the first attempt. Looking at the logs:

1. First invocation (17:50:00): `solve https://github.com/... --auto-resume-on-limit-reset --model opus ...` (no `--resume`)
2. After limit hit, spawned: `solve https://github.com/... --resume ff411057... --auto-resume-on-limit-reset ...` (with `--resume`)

The issue is that the FIRST invocation didn't have `--resume`, so when it hit the limit immediately and tried to continue, it still used the new session ID logic.

Actually, looking more carefully at the evidence:

- The first failed attempt at 18:00 was a NEW invocation WITHOUT --resume flag
- The second successful attempt at 18:00:26 was WITH --resume flag

This suggests the auto-continue logic spawned a new solve process WITHOUT passing the session ID on the first attempt.

### Problem 4: Work session comment shows "AI Work Session Started" instead of "Auto resume (on limit reset)"

**Evidence**: Comment #3780183691 at 18:00:54 shows:

```
🤖 **AI Work Session Started**

Starting automated work session at 2026-01-21T18:00:52.260Z
```

**Root Cause**: The `startWorkSession()` function in `solve.session.lib.mjs:42` always uses the same "AI Work Session Started" message. It doesn't distinguish between:

- New work session (first time working on PR)
- Resume session (continuing after errors)
- Auto-resume on limit reset (specifically waiting for limit to reset)

### Problem 5: Solution draft log comment doesn't indicate auto-resume

**Evidence**: Comment #3780233713 shows normal "🤖 Solution Draft Log" instead of "Draft log of auto resume (on limit reset)".

**Root Cause**: The `attachLogToGitHub()` function in `github.lib.mjs` always uses "🤖 Solution Draft Log" as the title (or "⏳ Usage Limit Reached" for limit errors). There's no parameter to indicate this is an auto-resumed session.

### Problem 6: Reset time format in comments is incomplete

**Evidence**: Comment #3780094933 shows only "7:00 PM" without:

- Relative time (e.g., "in 20 minutes")
- Absolute time with timezone (e.g., "7:00 PM UTC")

**Root Cause**: The comment template in `github.lib.mjs:456-457` just uses the raw `limitResetTime` string without formatting it with relative time and UTC conversion.

## Proposed Solutions

### Solution 1: Remove CLI commands from GitHub comments when auto-resume is active

When `--auto-resume-on-limit-reset` is enabled, the comment should say:

```
Working session will be automatically resumed in 20 minutes at 7:00 PM (UTC).
```

Instead of showing the bash command.

**Implementation**:

- Add parameter `isAutoResumeEnabled` to `attachLogToGitHub()`
- If `isAutoResumeEnabled`, show "Will be automatically resumed" message instead of CLI command
- Keep CLI command in console logs for debugging

### Solution 2: Add 5-minute buffer after limit reset

Add a configurable buffer (default 5 minutes) after the reset time before attempting to resume.

**Implementation**:

- Add constant `LIMIT_RESET_BUFFER_MS = 5 * 60 * 1000` (5 minutes)
- In `autoContinueWhenLimitResets()`, wait for `waitMs + LIMIT_RESET_BUFFER_MS`
- Update countdown message to show the actual resume time including buffer

### Solution 3: Ensure both `--auto-resume-on-limit-reset` and `--auto-restart-on-limit-reset` exist

Currently only `--auto-resume-on-limit-reset` exists. Users may want:

- `--auto-resume-on-limit-reset`: True resume with `--resume` flag (maintains context)
- `--auto-restart-on-limit-reset`: Fresh restart without `--resume` flag (loses context)

**Implementation**:

- Add `--auto-restart-on-limit-reset` option in `solve.config.lib.mjs`
- In `autoContinueWhenLimitResets()`, conditionally include `--resume` flag based on which option was used
- Update comments to reflect whether it's a resume or restart

### Solution 4: Differentiate work session comments for auto-resume

Add context to work session comments:

| Scenario                      | Comment Header                       |
| ----------------------------- | ------------------------------------ |
| New session                   | 🤖 **AI Work Session Started**       |
| Resume (manual)               | 🔄 **AI Work Session Resumed**       |
| Auto resume (on limit reset)  | ⏰ **Auto Resume (on limit reset)**  |
| Auto restart (on limit reset) | 🔄 **Auto Restart (on limit reset)** |

**Implementation**:

- Add parameter `sessionType` to `startWorkSession()`: 'new', 'resume', 'auto-resume', 'auto-restart'
- Update comment template based on session type

### Solution 5: Differentiate solution draft log comments

The log comment title should reflect the context:

| Scenario               | Comment Title                                    |
| ---------------------- | ------------------------------------------------ |
| Normal completion      | 🤖 **Solution Draft Log**                        |
| Auto-resume completion | 🔄 **Draft log of auto resume (on limit reset)** |
| Usage limit reached    | ⏳ **Usage Limit Reached**                       |

**Implementation**:

- Pass `sessionType` to `attachLogToGitHub()`
- Use appropriate title based on session type

### Solution 6: Improve reset time formatting

Format reset time as: `in 20 minutes at 7:00 PM (UTC)`

**Implementation**:

- Use existing `formatResetTimeWithRelative()` from `usage-limit.lib.mjs`
- Apply to all places where reset time is displayed in comments

## Evidence Files

- `evidence/pr-comments.json` - All PR comments with timestamps and summaries
- `evidence/solution-draft-log-pr-1769018808231.txt` - Successful auto-resume log (gist)
- `evidence/failed-attempt-log-3780177716.txt` - Failed auto-restart attempt (embedded in comment)

## Related Issues and PRs

- [Issue #1152](https://github.com/link-assistant/hive-mind/issues/1152) - Original issue
- [PR #1140](https://github.com/link-assistant/hive-mind/pull/1140) - Added `--working-directory` option for session resume
- [Issue #1139](https://github.com/link-assistant/hive-mind/issues/1139) - Original working directory issue
