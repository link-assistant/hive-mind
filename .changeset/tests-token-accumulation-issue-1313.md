---
'@link-assistant/hive-mind': patch
---

tests: expand unit tests for token accumulation logic (Issue #1313)

Added comprehensive unit tests for the token accumulation fix (Issue #1250)
that resolved the "Token usage: 0 input, 0 output" bug reported in Issue #1313.

New test coverage includes:

- End-to-end token display pipeline (accumulation → display format)
- Large token count handling (millions of tokens across many steps)
- NDJSON boundary cases (CRLF line endings, arrays, extra fields)
- Accumulator state isolation (independent accumulators)
- Exact reproduction of the Issue #1313 bug scenario
- Demonstration of why the streaming fix was necessary (concatenated JSON)

Total: 44 tests covering both `parseAgentTokenUsage` and streaming accumulation.
