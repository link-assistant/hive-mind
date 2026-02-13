---
'@link-assistant/hive-mind': patch
---

Fix: Add workaround for process stream hanging after completion (Issue #1280)

After the Claude CLI sends the final result event, the `for await` loop over
`command-stream`'s `stream()` can hang indefinitely. Root cause: `command-stream` v0.9.4's
`stream()` async iterator waits for both process exit AND stdout/stderr pipe close before
ending. If the CLI process keeps stdout open after sending the result, `pumpReadable()` hangs,
`finish()` never fires, and the stream iterator never terminates.

Additionally, `command-stream` v0.9.4 `stream()` does NOT yield `{type:'exit'}` chunks,
making the exit code detection via `chunk.type === 'exit'` dead code (exit code is obtained
from `execCommand.result.code` after the loop instead).

Workaround: after receiving the result event, start a configurable timeout (default 30s,
`HIVE_MIND_RESULT_STREAM_CLOSE_MS`) to force-kill the process with SIGTERM/SIGKILL.

Related: https://github.com/link-foundation/command-stream/issues/155
