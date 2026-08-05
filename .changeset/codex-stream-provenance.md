---
'@link-assistant/hive-mind': patch
---

Keep stream provenance on mirrored agent output and make the Codex completion
gate explain itself (issue #2140).

A `solve --tool codex` run that had finished its work — PR updated, all 46
check-runs green, `turn.completed` received — was still failed by the completion
gate with `turn.started=3, turn.completed=1`. Replaying the real 96k-line log
through the parser shows the two extra `turn.started` records arrived on Codex's
**stderr**, inside an OTEL `codex.tool_result` dump of a command that merely read
a stored NDJSON log file from disk. This is the issue #2136 defect on a binary
released minutes before that fix shipped; current builds already gate correctly.
Three residual gaps remain, and this change closes them:

- `log()` accepted an `options.stream` hint and silently discarded it, so every
  agent CLI's mirrored output — both streams, all five tools — was written as
  `[INFO]` on our stdout. It is now tagged `[STDOUT]` / `[STDERR]`, matching the
  tags the stdio interceptor already uses, and mirrored stderr goes to our
  stderr so piping stdout yields only what the child wrote there. An explicit
  `level` still wins, and callers that pass no stream are unchanged.
- `codex exec` starts exactly one thread, so a `thread.started` on the protocol
  stream announcing a different `thread_id` is proof of echoed output. Those ids
  are now collected and reported (`🧬 Foreign thread IDs seen on the codex
  protocol stream`).
- The completion-failure reason carried counts and nothing else, which made a
  false positive impossible to refute from the posted comment. It now also
  states the ordered turn lifecycle, how many `turn.started` records were
  discarded as echoed telemetry, and any foreign thread id seen.

No gate outcome changes: a genuinely truncated turn still fails, and a completed
run with echoed events still passes.
