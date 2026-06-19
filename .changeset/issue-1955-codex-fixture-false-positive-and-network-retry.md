---
'@link-assistant/hive-mind': patch
---

fix(codex): don't fail a completed turn on echoed fixture content; expand transient network auto-retry (#1955)

A `--tool codex` run failed with `❌ Codex emitted error event: Network lookup
skipped in fixture` even though the codex session **succeeded** (`turn.completed=1`,
`turn.failed=0`, working tree clean, full pricing produced). The phrase was not a
real error: while building an unrelated NDJSON adapter, the codex agent printed a
**test fixture** to its terminal. In verbose mode (`RUST_LOG=debug`) the codex CLI
renders OTEL telemetry (`codex_otel.log_only`, `event.name="codex.tool_result"`)
to stderr, including a raw `Output:` dump of each command's stdout. Our line-by-line
parser — which consumes stderr as well as stdout — `JSON.parse`d the fixture line
`{"type":"error","message":"Network lookup skipped in fixture"}` and bucketed it as
a genuine codex stream error.

- `getCodexErrorEventSummary()` (`src/codex.lib.mjs`) now treats any stray
  **non-`turn`** error event as non-fatal whenever the turn completed successfully
  (a `turn.completed` with no `turn.failed`). `turn.failed` remains the authoritative
  failure signal and is never suppressed; suppressed strays are still recorded in
  `ignoredEvents` (and logged per-event in verbose mode) for observability. This is
  transport-agnostic — it fixes the false positive regardless of how the echo
  arrived.
- `classifyRetryableError()` (`src/tool-retry.lib.mjs`, shared by
  claude/codex/gemini/qwen/opencode) now classifies the full set of genuinely
  transient network faults as retryable (`isCapacity:false`): DNS failures
  (`ENOTFOUND`, `EAI_AGAIN`, "temporary failure in name resolution"), connection
  faults (`ETIMEDOUT`, `ECONNREFUSED`, `EHOSTUNREACH`, `ENETUNREACH`, `EPIPE`,
  "no route to host", "network is unreachable"), and gateway errors (502/504 and
  Cloudflare `52x`); the 503 branch was broadened to "service unavailable". Aligns
  with AWS retry guidance, RFC 9110 §15.6, and the getaddrinfo(3) man-page. The
  fixture phrase itself is explicitly guarded to stay non-retryable.

Adds `tests/test-issue-1955-codex-fixture-false-positive.mjs` (23 tests) and a deep
case study in `docs/case-studies/issue-1955/`.
