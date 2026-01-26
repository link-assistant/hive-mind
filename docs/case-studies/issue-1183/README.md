# Case Study: Issue #1183 - Result Output in `--tool claude` Was Broken

## Summary

The AI solver was unable to capture the cost calculated by Anthropic when running `--tool claude` sessions. The cost comparison showed "Calculated by Anthropic: unknown" instead of the actual cost value, despite the value being present in the Claude CLI output.

## Issue Reference

- **Issue**: https://github.com/link-assistant/hive-mind/issues/1183
- **Affected PR**: https://github.com/link-assistant/agent/pull/25
- **Broken Session Comment**: https://github.com/link-assistant/agent/pull/25#issuecomment-3798485949
- **Working Session Comment**: https://github.com/link-assistant/agent/pull/25#issuecomment-3630302435

## Timeline of Events

| Timestamp (UTC)          | Event                                                                 |
|--------------------------|-----------------------------------------------------------------------|
| 2025-12-09T04:53:52Z     | **Working session** - Cost captured correctly ($3.669694 USD)        |
| 2026-01-26T08:42:19Z     | AI work session started for PR #25                                    |
| 2026-01-26T08:50:09.472Z | Claude CLI outputs `result` JSON (starts)                             |
| 2026-01-26T08:50:09.481Z | Result JSON continues on next line (9ms later, output split)          |
| 2026-01-26T08:50:10.073Z | Cost displays as "Calculated by Anthropic: unknown"                   |

## Root Cause Analysis

### Primary Root Cause: NDJSON Stream Buffering Issue

The Claude CLI outputs data in NDJSON (Newline-Delimited JSON) format via `--output-format stream-json`. When the `result` message (which contains the `total_cost_usd` field) is very long, it gets **split across multiple stdout chunks**.

#### Evidence from Logs

**Broken session** (lines 7505-7506 of `broken-session-log.txt`):
```
[2026-01-26T08:50:09.472Z] [INFO] {"type":"result","subtype":"success",...,"total_cost_usd":3.8264090000000004,"usage":{..."cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tok
[2026-01-26T08:50:09.481Z] [INFO] ens":97252}},"modelUsage":{"claude-haiku-4-5-20251001":{...}}}
```

The JSON is **truncated mid-word** at `ephemeral_5m_input_tok` and continues on the next line with `ens":97252`. This makes the first line unparseable JSON.

**Working session** - The same result JSON was formatted with `JSON.stringify(data, null, 2)` and output as multiple properly-delimited lines.

### Why This Happens

The problematic code is in `src/claude.lib.mjs` lines 947-959:

```javascript
for await (const chunk of execCommand.stream()) {
  if (chunk.type === 'stdout') {
    const output = chunk.data.toString();
    const lines = output.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);  // FAILS when line is partial JSON
        // ... process data including total_cost_usd extraction
      } catch (parseError) {
        // Falls through to raw text logging
        if (line.trim() && !line.includes('node:internal')) {
          await log(line, { stream: 'raw' });  // Partial JSON logged as raw text
        }
      }
    }
  }
}
```

**Problem Mechanism**:
1. Claude CLI writes long JSON to stdout in one logical line
2. The stream delivers data in chunks (not aligned to line boundaries)
3. A long `result` JSON spans multiple chunks
4. Code splits each chunk by `\n` and tries to parse each piece
5. First chunk ends mid-JSON, `JSON.parse()` fails
6. The partial JSON is logged as raw text instead of being buffered
7. Next chunk starts mid-JSON, also fails to parse
8. The `total_cost_usd` field is never extracted because no complete JSON is parsed

### Related Known Issues

This is a **known issue** in the Claude Code ecosystem:

1. **[anthropics/claude-code#2904](https://github.com/anthropics/claude-code/issues/2904)** - "Claude Code CLI JSON Response Truncation Issue"
   - Reports truncation at fixed positions (4000, 6000, 8000, 10000, 12000, 16000 chars)
   - Root cause identified in SDK's `readline` implementation

2. **[claude-task-master#913](https://github.com/eyaltoledano/claude-task-master/issues/913)** - "Claude Code JSON Truncation Issue Report"
   - Same symptoms when processing long PRD documents
   - Documented that direct Anthropic API calls work correctly

## Data Sources

The full logs are available via GitHub Gist (not included in this repo to avoid secret exposure):

| Resource                     | URL                                                                                           |
|------------------------------|-----------------------------------------------------------------------------------------------|
| Broken session log (Jan 26)  | https://gist.github.com/konard/bda5f97c2257750c7619ca46b0b7fffe                              |
| Working session log (Dec 9)  | https://gist.github.com/konard/8421ddd9d2193a31590e43e9e6f12fae                              |
| PR #25 with comments         | https://github.com/link-assistant/agent/pull/25                                              |

### Key Evidence Extract

**Broken session - Lines 7505-7506 showing JSON split:**
```
[2026-01-26T08:50:09.472Z] [INFO] {"type":"result","subtype":"success",...
  "total_cost_usd":3.8264090000000004,...,"ephemeral_5m_input_tok
[2026-01-26T08:50:09.481Z] [INFO] ens":97252}},"modelUsage":{...}
```

**Working session - Lines 6901-6920 showing properly formatted JSON:**
```
[2025-12-09T04:53:52.316Z] [INFO] {
  "type": "result",
  "subtype": "success",
  ...
  "total_cost_usd": 3.66969425,
  "usage": {
    ...
  }
}
[2025-12-09T04:53:52.317Z] [INFO] 💰 Anthropic official cost captured: $3.669694
```

## Proposed Solutions

### Solution 1: Implement Line Buffer (Recommended)

Maintain a buffer for incomplete lines across chunks, similar to the [split2](https://github.com/mcollina/split2) library:

```javascript
let lineBuffer = '';

for await (const chunk of execCommand.stream()) {
  if (chunk.type === 'stdout') {
    lineBuffer += chunk.data.toString();
    const lines = lineBuffer.split('\n');

    // Keep the last element (may be incomplete)
    lineBuffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        // Process complete JSON...
      } catch (parseError) {
        // Log as raw text only if it's truly non-JSON
      }
    }
  }
}

// After stream ends, process any remaining buffer
if (lineBuffer.trim()) {
  try {
    const data = JSON.parse(lineBuffer);
    // Process final JSON...
  } catch {
    // Final non-JSON content
  }
}
```

### Solution 2: Use NDJSON Library

Leverage the established [ndjson](https://www.npmjs.com/package/ndjson) library with [split2](https://www.npmjs.com/package/split2) for robust stream handling:

```javascript
import ndjson from 'ndjson';
import { Readable } from 'stream';

const parser = ndjson.parse({ strict: false });

parser.on('data', (data) => {
  if (data.type === 'result' && data.total_cost_usd !== undefined) {
    anthropicTotalCostUSD = data.total_cost_usd;
  }
});

// Pipe stdout through the parser
```

### Solution 3: Retry Parsing with Accumulated Buffer

If parsing fails, accumulate the content and retry:

```javascript
let parseAttempts = [];

for (const line of lines) {
  parseAttempts.push(line);
  const combinedLine = parseAttempts.join('');

  try {
    const data = JSON.parse(combinedLine);
    parseAttempts = []; // Reset on success
    // Process data...
  } catch {
    // Continue accumulating
  }
}
```

## Impact

- **Cost Tracking**: Unable to capture Anthropic's official cost from sessions
- **Cost Comparison**: Cannot compare public pricing estimate vs. Anthropic's calculation
- **Billing Analysis**: Missing data for cost optimization and billing verification

## References

- [NDJSON Specification](https://github.com/ndjson/ndjson-spec)
- [split2 - Line buffering library](https://github.com/mcollina/split2)
- [ndjson.js - NDJSON parser](https://github.com/ndjson/ndjson.js)
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference)

## Files Changed in This Analysis

None - this is a research and documentation case study.

## Verification Steps

After implementing a fix:

1. Run a Claude session that produces a long `result` message
2. Verify `total_cost_usd` is extracted from the result
3. Confirm cost comparison shows both public estimate and Anthropic's calculation
4. Test with both short and long sessions to ensure no regression
