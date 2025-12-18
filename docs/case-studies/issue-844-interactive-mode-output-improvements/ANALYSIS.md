# Case Study: Interactive Mode Output Improvements (Issue #844)

## Summary

This case study analyzes the interactive mode output from PR #843 and proposes improvements for better readability and maintainability.

## Timeline of Events

1. **PR #843** was the first interactive mode run, demonstrating real-time Claude CLI output posted as PR comments.
2. **242 comments** were generated during the session, showing both capabilities and areas for improvement.
3. **Issue #844** was created to track the identified improvements.

## Current Implementation Analysis

### File: `src/interactive-mode.lib.mjs`

The current implementation handles these event types:
- `system.init` - Session initialization
- `assistant` (text) - AI text responses
- `assistant` (tool_use) - Tool invocations
- `user` (tool_result) - Tool execution results
- `result` - Session completion

### Current Comment Formats

#### Session Started (system.init)
```markdown
## 🚀 Session Started

| Property | Value |
|----------|-------|
| **Session ID** | `{session_id}` |
| **Working Directory** | `{cwd}` |
| **Available Tools** | ... |

---
<details>
<summary>📄 Raw JSON</summary>
{single JSON object}
</details>
```

#### Tool Call
```markdown
## 💻 Tool: Bash

**Tool ID:** `{tool_id}`

<details open>
<summary>📋 Command</summary>
{command}
</details>

---
<details>
<summary>📄 Raw JSON</summary>
{single JSON object}
</details>
```

#### Tool Result
```markdown
## ✅ Tool Result: Success

**Tool Use ID:** `{tool_use_id}`

<details open>
<summary>📤 Output</summary>
{output}
</details>

---
<details>
<summary>📄 Raw JSON</summary>
{single JSON object}
</details>
```

#### Assistant Response
```markdown
## 💬 Assistant Response

{message text}

---
_Tokens: {input} in / {output} out_

---
<details>
<summary>📄 Raw JSON</summary>
{single JSON object}
</details>
```

#### TodoWrite Tool
```markdown
## 📋 Tool: TodoWrite

**Tool ID:** `{tool_id}`

<details open>
<summary>📋 Todos (N items)</summary>

- [ ] Item 1
- [x] Item 2
- [ ] Item 3
- [ ] Item 4
- [ ] Item 5
- _...and N more_

</details>

---
<details>
<summary>📄 Raw JSON</summary>
{single JSON object}
</details>
```

## Issues Identified

### Issue 1: Tool ID in comments
- **Problem**: Tool IDs like `toolu_012uHuVXeG7ko5Kx5xP132xs` are shown in comments
- **Impact**: Adds visual noise, information available in Raw JSON
- **Solution**: Remove `**Tool ID:** \`${toolId}\`` line from tool use comments
- **Location**: `handleToolUse()` function, line ~462

### Issue 2: Token info in assistant responses
- **Problem**: Token counts shown in response header
- **Impact**: Redundant info, available in Raw JSON
- **Solution**: Remove token usage line from `handleAssistantText()`
- **Location**: Lines ~354-356

### Issue 3: Verbose assistant response header
- **Problem**: "## 💬 Assistant Response" header for every message
- **Impact**: Creates visual clutter, should be just the message
- **Solution**: Remove header for regular responses, just write message with collapsed Raw JSON after separator
- **Location**: `handleAssistantText()` function

### Issue 4: Separate tool call and result comments
- **Problem**: Tool call and result are posted as separate comments
- **Impact**: Hard to correlate, doubles comment count, should merge them
- **Solution**: Implement comment tracking and update mechanism
- **Complexity**: HIGH - requires state management and GitHub API edit

### Issue 5: Raw JSON not always arrays
- **Problem**: Raw JSON contains single objects, not arrays
- **Impact**: Harder to merge multiple JSON objects (e.g., tool call + result)
- **Solution**: Wrap all Raw JSON in arrays at root level
- **Location**: `createRawJsonSection()` function

### Issue 6: Session comment missing details
- **Problem**: "Session Started" should be "Interactive session Started"
- **Problem**: Missing `model`, `permissionMode`, `claude_code_version` in properties
- **Problem**: Missing `mcp_servers`, `slash_commands`, `agents` display
- **Solution**: Update `handleSystemInit()` to include all metadata nicely formatted
- **Location**: Lines ~317-328

### Issue 7: Tool label wording
- **Problem**: `💻 Tool: Bash` should be `💻 Tool use: Bash`
- **Solution**: Simple string replacement in tool use handlers
- **Location**: Line ~460

### Issue 8: Todos display limit
- **Problem**: Only shows 5 todos with "...and N more" at end
- **Solution**: Show up to 30 items, skip items in middle if > 30
- **Example format**:
  ```
  📋 Todos (35 items)
   - [ ] Item 1
   - [x] Item 2
   ...
   - [ ] Item 14
   - [ ] Item 15
   ...and 5 more
   - [ ] Item 31
   ...
   - [ ] Item 35
  ```
- **Location**: Lines ~434-440

## Proposed Solutions

### Solution 1-3, 6-8: Direct Code Changes
These are straightforward edits to the formatting functions.

### Solution 4: Comment Merging (Complex)
Requires:
1. Track pending tool calls by tool_use_id
2. When result arrives, find matching call
3. Edit existing comment instead of posting new one
4. Merge both JSON objects into array

Implementation approach:
```javascript
// State tracking
const pendingToolCalls = new Map(); // tool_use_id -> comment_id

// On tool call
const commentId = await postComment(...);
pendingToolCalls.set(toolId, { commentId, callData });

// On tool result
if (pendingToolCalls.has(toolUseId)) {
  const { commentId, callData } = pendingToolCalls.get(toolUseId);
  await editComment(commentId, mergedContent);
  pendingToolCalls.delete(toolUseId);
} else {
  await postComment(resultContent);
}
```

### Solution 5: Array Wrapper
```javascript
const createRawJsonSection = (data) => {
  // Ensure data is always an array
  const dataArray = Array.isArray(data) ? data : [data];
  const jsonContent = truncateMiddle(safeJsonStringify(dataArray, 2), {...});
  return createCollapsible('📄 Raw JSON', '```json\n' + jsonContent + '\n```');
};
```

## Impact Assessment

| Change | Complexity | Impact | Risk |
|--------|------------|--------|------|
| Remove tool ID | Low | Medium | Low |
| Remove token info | Low | Medium | Low |
| Simplify response header | Low | Medium | Low |
| Merge tool call/result | High | High | Medium |
| Array wrapper for JSON | Low | Medium | Low |
| Update session comment | Low | High | Low |
| Change Tool label | Low | Low | Low |
| Fix todos limit | Medium | Medium | Low |

## Recommendations

1. Implement all low-complexity changes first
2. Implement todos limit fix (medium complexity)
3. Implement comment merging last (highest complexity)
4. Add comprehensive unit tests for each change
5. Test with a real PR to verify output format

## Data Files

- `pr-843-comments.json` - All 242 comments from the PR #843 session
- `pr-843-metadata.json` - PR metadata
- `issue-844.json` - Issue details
