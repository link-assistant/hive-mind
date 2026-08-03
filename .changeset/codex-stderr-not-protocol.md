---
'@link-assistant/hive-mind': patch
---

Stop treating agent CLI stderr as a JSON protocol stream (issue #2136).

`codex exec --json` writes its NDJSON protocol to stdout only; its stderr carries
OTEL tracing whose `codex.tool_result` records dump the raw stdout of every
command Codex runs. When the task itself drove another agent CLI, that dump
replayed NDJSON byte-identical to Codex's own protocol, so an echoed
`turn.started` was counted as Codex's own and the completion gate failed a run
that had actually finished — posting a "Solution Draft Failed" comment on a pull
request that was complete and later merged.

Codex now parses only stdout as protocol; protocol-shaped JSON seen on stderr is
reported separately (`🪞 Echoed protocol-shaped lines on codex stderr`) and never
affects event counts, session id, token usage or error detection. The completion
gate additionally uses the ordered turn lifecycle (`🔁 Codex turn lifecycle`)
instead of comparing counts, so a stray `turn.started` can no longer fail a
completed run while a genuinely truncated turn still does. The same stream
separation is applied to qwen (whose stderr echo could raise a false error and
whose two streams shared one line buffer), and OpenCode now reports how many JSON
records it parsed from stderr.
