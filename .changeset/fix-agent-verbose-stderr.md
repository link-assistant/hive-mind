---
'@link-assistant/hive-mind': patch
---

Fix agent --verbose output by properly handling stderr stream

- Agent CLI sends ALL output (including verbose logs and structured events) to stderr, not stdout
- Previous code only processed stdout with JSON parsing, treating stderr as plain error text
- Now stderr is processed the same way as stdout: NDJSON line-by-line parsing with JSON formatting
- Session IDs are now correctly extracted from stderr messages
- stderr output is now collected for error detection

Fixes #1151
