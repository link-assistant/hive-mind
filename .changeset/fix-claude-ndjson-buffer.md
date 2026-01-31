---
'@link-assistant/hive-mind': patch
---

fix: NDJSON stream buffering for Claude CLI output (Issue #1183)

Fixed issue where `total_cost_usd` and other critical fields were not being captured from Claude CLI sessions when the output JSON was split across multiple stdout chunks.

**Root Cause**: Claude CLI outputs NDJSON (newline-delimited JSON) format, but long JSON messages (like the `result` type containing `total_cost_usd`) can be split across multiple stdout buffer chunks. The code was splitting each chunk by newlines and parsing independently, causing partial JSON fragments to fail parsing.

**Solution**:

- Implemented line buffering to accumulate incomplete lines across chunks
- Lines are only parsed when they're complete (have a trailing newline)
- Added processing of any remaining buffer content after the stream ends

This ensures that even very long JSON output (e.g., result messages with extensive usage data) is properly parsed and cost tracking works correctly.

**Evidence from logs**: The broken session showed JSON truncated mid-word at `ephemeral_5m_input_tok` continuing on the next line with `ens":97252}}` - making both lines unparseable.
