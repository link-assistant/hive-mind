# Case Study: API Error 400 due to Tool Use Concurrency Issues

**Issue Reference:** [#1188](https://github.com/link-assistant/hive-mind/issues/1188)
**Date of Incident:** 2026-01-27
**Affected System:** Claude Code CLI (via solve.mjs automation)
**Original PR:** [konard/subset-sum/pull/8](https://github.com/konard/subset-sum/pull/8)

## Executive Summary

This case study analyzes an API Error 400 that occurred during automated code solving when Claude Code attempted to make multiple parallel Edit tool calls on the same file. The error message "API Error: 400 due to tool use concurrency issues" represents a known issue in the Claude Code CLI where tool_use blocks are streamed or sent without corresponding tool_result blocks in the correct order.

---

## 1. Timeline/Sequence of Events

### 1.1 Initial State
- **11:25:30 UTC** - solve.mjs v1.9.0 started processing PR #8 on konard/subset-sum
- Working on issue #7: "Formally prove 'Set is equivalent to sequence with ordered unique elements'"
- Session ID: `95c0d863-0eac-4d81-acd5-b2bdeb81e909`
- Model: `claude-sonnet-4-5-20250929`

### 1.2 Normal Operation (11:25:30 - 11:30:19)
- Claude successfully performed 45 API turns
- Multiple tool calls executed successfully (Read, Bash, Edit operations)
- Total cost accumulated: $0.71

### 1.3 Failure Sequence (11:30:19 - 11:30:28)

| Timestamp | Event | Details |
|-----------|-------|---------|
| 11:30:19.181 | Edit tool call #1 | `toolu_014q8tnXnhZ4n51F3vwYrGFZ` - Edit max_first_reduction.rs |
| 11:30:21.530 | Assistant text | "Now I need to remove `target` from all the recursive calls:" |
| 11:30:23.139 | Edit tool call #2 | `toolu_01FSSFvPGq9SDccQU8wcswKw` - Same file, different location |
| 11:30:24.903 | Edit tool call #3 | `toolu_01BEkSoN1xFtbo23YPD6NoCL` - Same file (msg_01HkVGF6DafGAkcux7gQga4t) |
| 11:30:27.842 | Edit tool call #4 | `toolu_01JhYnYN7U4zg11ratL9BMyE` - Same file (same message ID) |
| 11:30:28.065 | Tool result #1 | Success for `toolu_01EX172JVsYfvr9WHrt9VP76` |
| 11:30:28.075 | Tool result #2 | Success for `toolu_014q8tnXnhZ4n51F3vwYrGFZ` |
| 11:30:28.085 | Tool result #3 | **ERROR** - "String to replace not found in file" for `toolu_01FSSFvPGq9SDccQU8wcswKw` |
| 11:30:28.090 | Tool result #4 | **ERROR** - "String to replace not found in file" for `toolu_01BEkSoN1xFtbo23YPD6NoCL` |
| 11:30:28.103 | Tool result #5 | Success for `toolu_01JhYnYN7U4zg11ratL9BMyE` |
| 11:30:28.434 | **API Error** | "API Error: 400 due to tool use concurrency issues" |

### 1.4 Underlying API Error
```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "`tool_use` ids were found without `tool_result` blocks immediately after. Each `tool_use` block must have a corresponding `tool_result` block in the next message."
  }
}
```

---

## 2. Root Cause Analysis

### 2.1 Primary Root Cause: Race Condition in Parallel Edit Operations

The core issue is a **race condition** when Claude Code executes multiple Edit tool calls in parallel on the **same file**:

1. Claude streamed multiple Edit tool_use blocks within the same message (all with message ID `msg_01HkVGF6DafGAkcux7gQga4t`)
2. The first Edit succeeded and modified the file
3. Subsequent Edits attempted to find `old_string` patterns that no longer existed (because the file had already been modified)
4. The tool results were returned out of order and/or the message construction became corrupted

### 2.2 Secondary Root Cause: Message Construction Issue

The Claude API requires strict ordering:
- Each `tool_use` block must have a corresponding `tool_result` block **immediately after** in the next message
- All `tool_result` blocks must appear **before** any text in the user message
- Tool results must be in a **single user message**, not separate messages

When parallel tools fail (some succeed, some error), the message state becomes inconsistent.

### 2.3 Contributing Factors

1. **Streaming mode**: Tool calls were streamed incrementally, creating timing windows for race conditions
2. **Same-file parallel edits**: Claude attempted 4+ edits to `max_first_reduction.rs` in parallel
3. **Edit tool nature**: The Edit tool's `old_string` matching is sensitive to prior modifications

---

## 3. Impact Analysis

| Metric | Value |
|--------|-------|
| Session duration | 273,760 ms (~4.5 minutes) |
| API round-trips | 45 turns |
| Total cost | $0.71 |
| Tokens used | ~1.5M cache read, 7.6K output |
| Work lost | Partial - 45 turns of progress lost |
| Recovery action | Requires session resume via `--resume` flag |

---

## 4. Related Issues & Prior Art

This is a **known bug** tracked across multiple GitHub issues:

| Repository | Issue # | Description | Status |
|------------|---------|-------------|--------|
| anthropics/claude-code | [#11421](https://github.com/anthropics/claude-code/issues/11421) | Original tool use concurrency bug | **OPEN** |
| anthropics/claude-code | [#8763](https://github.com/anthropics/claude-code/issues/8763) | Unexpected 400 Bad Request | Closed |
| anthropics/claude-code | [#18130](https://github.com/anthropics/claude-code/issues/18130) | Print mode specific error | Closed |
| anthropics/claude-code | [#20598](https://github.com/anthropics/claude-code/issues/20598) | Recent report (3 days old) | OPEN |
| anthropics/claude-code-action | [#732](https://github.com/anthropics/claude-code-action/issues/732) | v1 update regression | OPEN |
| anthropics/claude-agent-sdk-python | [#265](https://github.com/anthropics/claude-agent-sdk-python/issues/265) | Hook denial causes error | OPEN |

---

## 5. Proposed Solutions

### 5.1 Immediate Workarounds

#### A. Session Resume
```bash
claude --resume 95c0d863-0eac-4d81-acd5-b2bdeb81e909 --model sonnet
```

#### B. Use /rewind Command (Interactive Mode)
When encountering the error in interactive mode, use `/rewind` to recover the conversation.

#### C. Retry Logic
Implement automatic retry with exponential backoff when encountering 400 errors.

### 5.2 Client-Side Fixes (Claude Code / solve.mjs)

#### A. Sequential Edit Execution
For Edit tool calls targeting the same file, execute them sequentially instead of in parallel:

```javascript
// Pseudocode for serializing same-file edits
async function executeToolCalls(toolCalls) {
  const editsByFile = groupBy(toolCalls.filter(t => t.name === 'Edit'), t => t.input.file_path);

  for (const [filePath, edits] of Object.entries(editsByFile)) {
    // Execute same-file edits sequentially
    for (const edit of edits) {
      await executeEdit(edit);
    }
  }

  // Other tools can still run in parallel
  const otherCalls = toolCalls.filter(t => t.name !== 'Edit');
  await Promise.all(otherCalls.map(execute));
}
```

#### B. Request Queuing
Implement a request queue that ensures tool_use/tool_result pairing is maintained:

```javascript
class ToolResultQueue {
  constructor() {
    this.pending = new Map();
  }

  enqueue(toolUseId, result) {
    this.pending.set(toolUseId, result);
  }

  flush() {
    // Return all results in a single properly-formatted user message
    const results = Array.from(this.pending.entries()).map(([id, result]) => ({
      type: 'tool_result',
      tool_use_id: id,
      content: result.content,
      is_error: result.is_error || false
    }));
    this.pending.clear();
    return { role: 'user', content: results };
  }
}
```

#### C. Pre-execution File Lock
Implement file-level locking for Edit operations:

```javascript
const fileLocks = new Map();

async function executeEditWithLock(edit) {
  const lock = fileLocks.get(edit.file_path) || Promise.resolve();
  const newLock = lock.then(() => executeEdit(edit));
  fileLocks.set(edit.file_path, newLock);
  return newLock;
}
```

### 5.3 API-Side Improvements (Anthropic)

These would need to be implemented by Anthropic:

1. **Graceful handling of tool result order**: Accept tool results that arrive out of order
2. **Transaction support for parallel edits**: Allow atomic multi-file edits
3. **Better error messages**: Include which tool_use_id is missing its result
4. **Auto-retry capability**: Server-side retry for transient concurrency issues

### 5.4 Prompt Engineering

Add explicit guidance to prevent parallel same-file edits:

```markdown
IMPORTANT: When making multiple Edit tool calls to the same file:
- Execute them SEQUENTIALLY, not in parallel
- Wait for each edit to complete before starting the next
- Re-read the file if needed to ensure old_string matches current content
```

---

## 6. Existing Libraries & Components

### 6.1 Anthropic Official SDKs

The official SDKs include **Tool Runner** (beta) which handles tool execution automatically:

| SDK | Tool Runner Location | Notes |
|-----|---------------------|-------|
| Python | `anthropic.beta.messages.tool_runner()` | Auto-handles tool results |
| TypeScript | `anthropic.beta.messages.toolRunner()` | Streaming support |
| Ruby | `client.beta.messages.tool_runner()` | Full Ruby support |

**Key feature**: The Tool Runner automatically manages the request/response cycle and conversation state, potentially avoiding manual message construction errors.

Example usage:
```python
from anthropic import beta_tool

@beta_tool
def get_weather(location: str) -> str:
    """Get weather for location."""
    return "Sunny, 72°F"

runner = client.beta.messages.tool_runner(
    model="claude-sonnet-4-5",
    tools=[get_weather],
    messages=[{"role": "user", "content": "Weather in SF?"}]
)

final_message = runner.until_done()
```

### 6.2 Third-Party Solutions

| Library | Purpose | URL |
|---------|---------|-----|
| anthropic-sdk-python | Official Python SDK with retries | [GitHub](https://github.com/anthropics/anthropic-sdk-python) |
| langchain-anthropic | LangChain integration | [PyPI](https://pypi.org/project/langchain-anthropic/) |
| semantic-kernel | Microsoft's orchestration | [GitHub](https://github.com/microsoft/semantic-kernel) |

### 6.3 Retry & Queue Libraries

| Library | Language | Purpose |
|---------|----------|---------|
| tenacity | Python | Retry with backoff |
| p-queue | JavaScript | Promise-based queue |
| bottleneck | JavaScript | Rate limiting |

---

## 7. Recommendations

### 7.1 For solve.mjs / Claude Code Users

1. **Enable session resume**: Always capture session IDs for recovery
2. **Implement retry logic**: Automatically retry on 400 errors with backoff
3. **Consider using Tool Runner**: Migrate to Anthropic's official Tool Runner SDK helpers

### 7.2 For Anthropic

1. **Prioritize fixing #11421**: This is the root issue affecting many users
2. **Improve streaming parallel tool handling**: Better synchronization for streamed tool results
3. **Add disable_parallel_tool_use for edit tools**: Auto-disable parallel execution for state-modifying tools

### 7.3 For AI Automation Developers

1. **Serialize file edits**: Never run parallel edits on the same file
2. **Validate message structure**: Ensure tool_result blocks precede any text
3. **Monitor for the specific error**: Implement specific handling for "tool use concurrency issues"

---

## 8. Files & Artifacts

| File | Description |
|------|-------------|
| `solution-draft-log.txt` | Complete log from the failed session (4685 lines) |
| `CASE-STUDY.md` | This document |

---

## 9. References

1. [Anthropic Tool Use Documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use)
2. [Claude Code Issue #11421](https://github.com/anthropics/claude-code/issues/11421) - Main tracking issue
3. [Claude Code Action Issue #732](https://github.com/anthropics/claude-code-action/issues/732) - Regression in v1
4. [Original Issue #1188](https://github.com/link-assistant/hive-mind/issues/1188)
5. [Original PR (subset-sum/pull/8)](https://github.com/konard/subset-sum/pull/8)

---

## 10. Conclusion

The "API Error: 400 due to tool use concurrency issues" is a known bug in Claude Code CLI related to parallel tool execution. The error occurs when:

1. Multiple tool_use blocks are streamed/executed in parallel
2. Tool results arrive or are processed in incorrect order
3. The message structure violates API requirements for tool_use/tool_result pairing

**The recommended mitigation** is to serialize Edit tool calls targeting the same file and use Anthropic's official Tool Runner SDK helpers where possible. This issue is actively tracked by Anthropic and affects multiple projects using Claude Code for automation.
