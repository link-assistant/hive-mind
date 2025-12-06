# Claude CLI JSON Output Examples

This document contains real JSON examples collected from solution logs in this repository.

## 1. System Init Event

The first event in every Claude CLI session.

```json
{
  "type": "system",
  "subtype": "init",
  "cwd": "/tmp/gh-issue-solver-1764803505742",
  "session_id": "faa32ca1-82fb-42ea-8e5b-04bbdfc74d25",
  "tools": [
    "Read",
    "Edit",
    "Write",
    "Bash",
    "Glob",
    "Grep",
    "WebFetch",
    "TodoWrite",
    "Task"
  ]
}
```

**Key fields:**
- `session_id` - Unique identifier for the session, can be used to resume
- `cwd` - Working directory
- `tools` - List of available tools

## 2. Assistant Message Event

Assistant responses, can contain text and/or tool uses.

### Text Response

```json
{
  "type": "assistant",
  "message": {
    "model": "claude-sonnet-4-5-20250929",
    "id": "msg_01GXv2id9iRP2AkB3A6ASNu9",
    "type": "message",
    "role": "assistant",
    "content": [
      {
        "type": "text",
        "text": "I'll start by reading the issue details and understanding the current state of the PR."
      }
    ],
    "stop_reason": "tool_use",
    "usage": {
      "input_tokens": 5234,
      "output_tokens": 156,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 4500
    }
  }
}
```

### Tool Use

```json
{
  "type": "assistant",
  "message": {
    "model": "claude-sonnet-4-5-20250929",
    "id": "msg_01GXv2id9iRP2AkB3A6ASNu9",
    "type": "message",
    "role": "assistant",
    "content": [
      {
        "type": "tool_use",
        "id": "toolu_01ABC123",
        "name": "Bash",
        "input": {
          "command": "gh issue view https://github.com/link-assistant/hive-mind/issues/796"
        }
      }
    ],
    "stop_reason": "tool_use",
    "usage": {
      "input_tokens": 5234,
      "output_tokens": 89
    }
  }
}
```

**Key fields:**
- `message.content[].type` - Either "text" or "tool_use"
- `message.content[].name` - Tool name (for tool_use)
- `message.content[].input` - Tool input parameters (for tool_use)
- `message.usage` - Token usage for this turn

## 3. User Message Event (Tool Result)

Contains results from tool executions.

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "type": "tool_result",
        "tool_use_id": "toolu_01ABC123",
        "content": "title: Interactive mode\nstate: OPEN\nauthor: konard\nlabels: documentation, enhancement\n..."
      }
    ]
  }
}
```

**Key fields:**
- `message.content[].tool_use_id` - References the tool_use that triggered this result
- `message.content[].content` - The actual result (often truncated for large outputs)

## 4. Result Event (Session Complete)

Final event indicating session completion.

### Success Result

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 727021,
  "duration_api_ms": 603394,
  "num_turns": 68,
  "result": "Perfect! Let me create a final summary of what was accomplished:\n\n## Summary\n\nI've successfully solved issue #796...",
  "session_id": "faa32ca1-82fb-42ea-8e5b-04bbdfc74d25",
  "total_cost_usd": 1.6043104499999998,
  "usage": {
    "input_tokens": 98,
    "output_tokens": 45678,
    "cache_creation_input_tokens": 1234,
    "cache_read_input_tokens": 56789
  }
}
```

### Error Result (Usage Limit)

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": true,
  "result": "Session limit reached ∙ resets 10am",
  "session_id": "62358490-0949-4236-8273-cedae423703e"
}
```

**Key fields:**
- `is_error` - Whether the session ended with an error
- `result` - Human-readable summary or error message
- `total_cost_usd` - Anthropic's official cost calculation
- `duration_ms` - Total session duration
- `num_turns` - Number of conversation turns

## Event Flow

Typical session event sequence:

1. `system.init` - Session starts
2. `assistant` (text) - Initial response/planning
3. `assistant` (tool_use) - Tool invocation
4. `user` (tool_result) - Tool result
5. *... repeat 3-4 for each tool use ...*
6. `assistant` (text) - Final summary
7. `result` - Session complete

## Considerations for Interactive Mode

When implementing interactive mode, consider:

1. **Text events** - Good candidates for immediate comment posting
2. **Tool use events** - Could show "Using tool: Bash" or similar
3. **Tool results** - Often very long, may need summarization
4. **Result events** - Final summary, always post

### Rate Limiting

GitHub API has rate limits. Consider:
- Batching multiple events into single comments
- Minimum time between comments
- Collapsible sections for large outputs
