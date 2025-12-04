# Case Study: Claude Code CLI Streaming Input Capabilities

**Issue**: [#814 - Research if it is possible to continue streaming the input for claude command](https://github.com/link-assistant/hive-mind/issues/814)

**Date**: 2024-12-04

**Status**: Research Complete

## Executive Summary

This case study explores whether the Claude Code CLI supports bidirectional streaming - specifically, the ability to send input messages while simultaneously receiving output. The research confirms that **streaming input IS supported** via the `--input-format stream-json` flag, but with important limitations regarding true bidirectional (simultaneous) communication.

## Key Findings

### 1. Streaming Input IS Supported

Claude Code CLI supports streaming input via the `--input-format stream-json` flag. This allows:

- Sending multiple user messages via stdin without relaunching the CLI
- Multi-turn conversations in a single session
- Message acknowledgment via `--replay-user-messages` flag

### 2. Stream-JSON Format Specification

Messages must be sent in NDJSON (Newline-Delimited JSON) format:

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Your message here"}]}}
```

### 3. Bidirectional Streaming: Queued, Not Simultaneous

**Critical Finding**: While you CAN send input while receiving output, the input is **queued** and processed only after the current response completes. Claude does NOT interrupt its current response to process new input.

**Evidence from Experiment 08**:
- Content deltas before interrupt: 2
- Content deltas after interrupt: 65
- The interrupt message was processed as a separate turn AFTER the first response completed

### 4. Relevant CLI Flags

| Flag | Purpose |
|------|---------|
| `--input-format stream-json` | Accept streaming JSON input via stdin |
| `--output-format stream-json` | Stream JSON output |
| `--include-partial-messages` | Include partial streaming events |
| `--replay-user-messages` | Echo user messages back for acknowledgment |
| `--verbose` | Required when using stream-json output with -p |
| `-p, --print` | Non-interactive (headless) mode |

## Detailed Experiment Results

### Experiment 01: Basic Stream-JSON Input
- **Result**: SUCCESS
- **Finding**: Single messages can be sent via stdin in stream-json format

### Experiment 02: Multi-Turn Conversations
- **Result**: SUCCESS
- **Finding**: Multiple messages maintain conversation context (Claude remembered "42")

### Experiment 04: Replay User Messages
- **Result**: SUCCESS
- **Finding**: `--replay-user-messages` echoes messages with `"isReplay": true`

### Experiment 07: Partial Messages
- **Result**: SUCCESS
- **Finding**: `--include-partial-messages` shows token-by-token streaming events

### Experiment 08: True Bidirectional Test
- **Result**: PARTIAL SUCCESS
- **Finding**: Input during output is accepted but QUEUED, not immediately processed

## Architecture Implications

```
┌────────────────────────────────────────────────────────────────┐
│                        stdin (NDJSON)                          │
│    User Message 1 ─────┐                                       │
│    User Message 2 ─────┼───► Input Queue                       │
│    User Message N ─────┘         │                             │
│                                  ▼                             │
│                    ┌─────────────────────────┐                 │
│                    │    Claude Processing    │                 │
│                    │   (Sequential Turns)    │                 │
│                    └─────────────────────────┘                 │
│                                  │                             │
│                                  ▼                             │
│                        stdout (NDJSON)                         │
│    ◄───── Stream Events                                        │
│    ◄───── Assistant Messages                                   │
│    ◄───── Result                                               │
└────────────────────────────────────────────────────────────────┘
```

## Limitations

1. **No True Interruption**: Cannot interrupt an ongoing response with a new message
2. **Sequential Processing**: Messages are processed in order, one turn at a time
3. **Requires Print Mode**: Only works with `-p` (headless) mode
4. **Verbose Required**: `--output-format stream-json` requires `--verbose`

## Possible Solutions/Workarounds

### Option 1: Session-Based Multi-Turn (Recommended)
Use `--input-format stream-json` for multi-turn conversations where each message is queued and processed in sequence.

```bash
{
  echo '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Message 1"}]}}'
  sleep 5  # Wait for response
  echo '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Message 2"}]}}'
} | claude -p --output-format=stream-json --input-format=stream-json --verbose
```

### Option 2: Session Resume for Pseudo-Bidirectional
Launch multiple Claude processes, resuming the same session:

```bash
# Start session
claude -p "Initial prompt" --output-format json > response.json

# Extract session ID and continue
SESSION_ID=$(jq -r '.session_id' response.json)
claude --resume "$SESSION_ID" -p "Follow-up" --output-format json
```

### Option 3: Stream Chaining for Agent Pipelines
Chain multiple Claude instances for complex workflows:

```bash
claude -p --output-format stream-json "Analyze" | \
  claude -p --input-format stream-json --output-format stream-json "Summarize" | \
  claude -p --input-format stream-json "Report"
```

### Option 4: Custom Wrapper with Rate Limiting
Build a wrapper that monitors output and batches input appropriately:

```javascript
// Pseudo-code for a wrapper approach
const claude = spawn('claude', [...streamingFlags]);
const inputQueue = [];

claude.stdout.on('data', (data) => {
  if (isResponseComplete(data)) {
    if (inputQueue.length > 0) {
      claude.stdin.write(inputQueue.shift());
    }
  }
});

function sendMessage(msg) {
  inputQueue.push(formatStreamJson(msg));
}
```

## Conclusion

**The `claude` command DOES support streaming input**, but it operates on a **queued, sequential model** rather than true simultaneous bidirectional streaming. Messages sent while output is being generated are accepted and queued, then processed after the current response completes.

For use cases requiring true real-time bidirectional communication, consider:
1. Using the streaming input as-is with appropriate flow control
2. Building a wrapper layer to manage message queuing
3. Using session resume for more complex interaction patterns

## References

- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference)
- [Claude Code Headless Mode](https://code.claude.com/docs/en/headless)
- [Stream Chaining Documentation](https://github.com/ruvnet/claude-flow/wiki/Stream-Chaining)
- [Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)

## Experiment Files

All experiment scripts are available in:
`/experiments/issue-814-streaming-input/`

- `01-basic-stream-json-input.sh` - Basic streaming input test
- `02-multi-turn-stream-input.sh` - Multi-turn conversation test
- `03-bidirectional-test.mjs` - Node.js bidirectional test
- `04-replay-user-messages.sh` - Message replay test
- `05-concurrent-io-test.mjs` - Concurrent I/O analysis
- `06-fifo-streaming-test.sh` - FIFO-based test
- `07-partial-messages-test.sh` - Partial message streaming test
- `08-true-bidirectional-test.mjs` - True bidirectional analysis
