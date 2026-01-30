---
'@link-assistant/hive-mind': patch
---

fix: detect agent tool errors during streaming for reliable failure detection (Issue #1201)

Previously, agent tool errors (`"type": "error"`) could be missed when the post-hoc
detection function failed to parse NDJSON lines that were concatenated without newline
delimiters. Now errors are detected inline during stream processing, ensuring
`"type": "error"` events always trigger a failure exit regardless of output buffering.
