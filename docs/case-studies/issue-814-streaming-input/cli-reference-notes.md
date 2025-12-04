# Claude Code CLI Reference Notes

## Streaming-Related Flags (from `claude --help`)

```
--output-format <format>
    Output format (only works with --print): "text" (default), "json" (single result),
    or "stream-json" (realtime streaming)
    Choices: "text", "json", "stream-json"

--include-partial-messages
    Include partial message chunks as they arrive
    (only works with --print and --output-format=stream-json)

--input-format <format>
    Input format (only works with --print): "text" (default), or "stream-json"
    (realtime streaming input)
    Choices: "text", "stream-json"

--replay-user-messages
    Re-emit user messages from stdin back on stdout for acknowledgment
    (only works with --input-format=stream-json and --output-format=stream-json)
```

## Key Requirements

1. **Stream-JSON output requires `--verbose`** when used with `-p` (print mode)
2. **Input format `stream-json`** requires `-p` (print mode)
3. **Replay user messages** requires both `--input-format=stream-json` AND `--output-format=stream-json`

## Message Format

### User Message (Input)
```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": "Your message here"
      }
    ]
  }
}
```

### System Init Message (Output)
```json
{
  "type": "system",
  "subtype": "init",
  "cwd": "/path/to/working/directory",
  "session_id": "uuid",
  "tools": ["Tool1", "Tool2", ...],
  "model": "claude-opus-4-5-20251101",
  ...
}
```

### Assistant Message (Output)
```json
{
  "type": "assistant",
  "message": {
    "model": "claude-opus-4-5-20251101",
    "id": "msg_xxx",
    "type": "message",
    "role": "assistant",
    "content": [
      {
        "type": "text",
        "text": "Response text"
      }
    ],
    ...
  },
  "session_id": "uuid"
}
```

### Stream Event (Output with --include-partial-messages)
```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_delta",
    "index": 0,
    "delta": {
      "type": "text_delta",
      "text": "partial text"
    }
  },
  "session_id": "uuid"
}
```

### Result Message (Output)
```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 3799,
  "num_turns": 1,
  "result": "Final result text",
  "session_id": "uuid",
  "total_cost_usd": 0.01380425,
  ...
}
```

### User Message Replay (Output with --replay-user-messages)
```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [...]
  },
  "session_id": "uuid",
  "isReplay": true
}
```

## Example Usage

### Basic Streaming I/O
```bash
echo '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Hello"}]}}' | \
  claude -p --output-format=stream-json --input-format=stream-json --verbose
```

### Multi-Turn with Partial Messages
```bash
{
  echo '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Remember: 42"}]}}'
  sleep 3
  echo '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"What did I say?"}]}}'
} | claude -p --output-format=stream-json --input-format=stream-json --include-partial-messages --replay-user-messages --verbose
```

### Stream Chaining
```bash
claude -p --output-format=stream-json "Analyze this" | \
  claude -p --input-format=stream-json --output-format=stream-json "Summarize" | \
  claude -p --input-format=stream-json "Create report"
```
