---
"@link-assistant/hive-mind": patch
---

Fix "Cannot read properties of null (reading 'type')" crash that aborted Codex (and other agent) runs when the tool echoed a stream line that parsed to a bare `null` or non-object JSON primitive. All NDJSON stream parsers (Codex, Claude, Agent, OpenCode) now ignore non-object lines instead of dereferencing them.
