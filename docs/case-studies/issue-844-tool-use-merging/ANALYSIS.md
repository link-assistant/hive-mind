# Case Study: Issue #844 - Interactive Mode Tool Use Comment Merging

## Summary

This case study analyzes the root cause of why tool use and tool result comments in interactive mode were not being merged into a single comment, resulting in excessive comment spam in pull requests.

## Timeline of Events

1. **Issue #844 Created**: User reported multiple issues with interactive mode output, including item #4: "If we have the same tool use, we should write tool use call in the first message, and after that if we get result for that tool we should just update already existing comment."

2. **Initial Implementation (PR #843)**: Interactive mode was implemented with code that should merge tool_use and tool_result into a single comment.

3. **Problem Observed (PR #851)**: Despite the implementation, tool results were still being posted as separate comments, not merged with the original tool use comments.

4. **Analysis Date**: December 6, 2025

## Data Collected

- Issue #844 details and comments
- PR #843 (original implementation) - 1156 additions
- PR #851 comments - 30 comments showing the problem
- Test-anywhere PR #87 comments - 30 comments showing the same problem

## Root Cause Analysis

### The Problem

The interactive mode code was designed to:
1. Post a tool_use comment with "⏳ Waiting for result..."
2. Capture the GitHub comment ID
3. Store the ID in `pendingToolCalls` Map keyed by tool_use_id
4. When tool_result comes, look up the pending call and EDIT the existing comment

### Why It Failed

**The root cause was rate limiting combined with asynchronous comment queue processing.**

#### The Flow (Before Fix)

```
1. System.init event → postComment() → Posted directly (commentId = 1000000)
2. Assistant.text event → postComment() → QUEUED (timeSinceLastComment < 5s)
                        → Returns null immediately
3. Tool_use event → postComment() → QUEUED (timeSinceLastComment < 5s)
                  → Returns null immediately
                  → if (commentId) { ... } // commentId is null, so pendingToolCalls NOT stored!
4. Tool_result event → pendingToolCalls.get(toolUseId) → Returns undefined
                     → Posts as separate comment
5. processQueue() → Finally posts all queued comments, but too late
```

The key insight: **Claude CLI streams events in real-time, often within milliseconds of each other.** The 5-second rate limit (`MIN_COMMENT_INTERVAL = 5000`) means most comments get queued. When a tool_use comment is queued, `postComment()` returns `null` immediately, and the code skips storing the pending call because `commentId` is null.

### Evidence from PR #851 Comments

All comments were posted approximately 6 seconds apart on GitHub, but this was due to queue processing, not actual event timing:

```
Comment 3620999152: 19:25:54 - Session started
Comment 3620999301: 19:26:00 - Assistant text
Comment 3620999412: 19:26:06 - Tool use: Bash (with "⏳ Waiting for result...")
Comment 3620999590: 19:26:12 - Tool use: Bash (another)
Comment 3620999797: 19:26:18 - Tool result: Success (SEPARATE comment, NOT merged!)
```

## The Fix

### Solution: Store pending calls BEFORE posting, update with comment ID later

1. **Store pending call immediately** - Create the pending call entry before calling `postComment()`, with `commentId: null` initially.

2. **Pass toolId to postComment()** - Modified the queue to track which comment belongs to which tool.

3. **Update pending call when queue processes** - When `processQueue()` posts a queued tool_use comment, it updates the corresponding pending call with the real comment ID.

4. **Wait for comment ID in handleToolResult** - Use a promise-based approach where `handleToolResult` can wait for the comment ID if it hasn't been assigned yet.

### Code Changes

#### State Structure (updated)
```javascript
state.pendingToolCalls = new Map()
// Map<tool_use_id, {
//   commentId: string|null,  // null if queued, set when posted
//   commentIdPromise: Promise<string>,  // Resolves when comment is posted
//   resolveCommentId: Function,  // Function to resolve the promise
//   toolData, inputDisplay, toolName, toolIcon
// }>
```

#### Queue Structure (updated)
```javascript
state.commentQueue = [
  { body: string, toolId?: string }  // toolId added for tracking
]
```

#### Key Function Changes

1. `postComment(body, toolId)` - Now accepts optional toolId parameter
2. `processQueue()` - Updates pending calls with comment IDs when processing queued tool_use comments
3. `handleToolUse()` - Stores pending call BEFORE posting, uses promise for comment ID
4. `handleToolResult()` - Waits for comment ID promise if needed (with 30s timeout)

## Verification

### Test Results

Created `experiments/test-interactive-mode-flow.mjs` to simulate rapid Claude events:

**Before fix:**
```
pendingToolCalls size: 0
❌ Tool use is NOT in pendingToolCalls!
Total comments created: 4
❌ Merging failed! Tool result was posted as separate comment.
```

**After fix:**
```
pendingToolCalls size: 1
  commentId: 1000002 (set after queue processing)
Total comments created: 3
Total comments edited: 1
✅ SUCCESS: Tool result was merged by editing the tool use comment!
```

### All Existing Tests Pass

```
Test Results for interactive-mode.lib.mjs:
  ✅ Passed: 41
  ❌ Failed: 0
```

## Lessons Learned

1. **Async queues need careful ID tracking** - When comments are queued for later posting, any dependent operations (like merging) need a way to wait for the actual result.

2. **Test with realistic timing** - The original implementation likely worked in manual tests where comments were posted with enough delay, but failed in production where events stream rapidly.

3. **Promise-based coordination** - Using promises to coordinate between event handlers allows clean async waiting without polling.

4. **Rate limiting has side effects** - Rate limiting isn't just about slowing down API calls; it can fundamentally change the control flow by making previously synchronous operations asynchronous.

## Files Modified

- `src/interactive-mode.lib.mjs` - Main fix implementation

## Files Created

- `docs/case-studies/issue-844-tool-use-merging/ANALYSIS.md` - This document
- `docs/case-studies/issue-844-tool-use-merging/issue-844.json` - Issue data
- `docs/case-studies/issue-844-tool-use-merging/pr-851-comments.json` - PR comment data showing the problem
- `experiments/test-interactive-mode-flow.mjs` - Test script verifying the fix
