---
'@link-assistant/hive-mind': patch
---

fix(retry): auto-resume on "Stream idle timeout - partial response received" (#1937)

A long-running solve session (391 turns, ~$34.11) had its streaming response
stall mid-answer. The Claude CLI surfaced it as a `result` event with
`is_error: true`, `subtype: "success"`, and:

```
API Error: Stream idle timeout - partial response received
```

Instead of retrying with the session preserved, the harness fell straight
through to the generic failure path and exited with code 1 after **zero
retries** — abandoning the whole session even though it had a valid session ID
and printed the exact `--resume` command needed to continue.

Root cause: the shared retry classifier `classifyRetryableError()`
(`src/tool-retry.lib.mjs`) had no branch for the stream-idle-timeout family, so
`isRetryable` was false, `isTransientError` evaluated to false, and the unified
exponential-backoff retry block was never entered.

This error is a transient transport-level stall (a slow/stuck server-sent-events
socket), not a request-content rejection — the on-disk session transcript stays
valid, which is why a manual `--resume` works. The fix adds one branch to
`classifyRetryableError()` returning
`{ isRetryable: true, isCapacity: false, label: 'Stream idle timeout (partial response)' }`,
so the existing retry block resumes the session with the same context after an
exponential backoff. Because the classifier is shared, this fixes the behaviour
for **all** tools (claude/codex/gemini/opencode/qwen/agent) at once.

Added `tests/test-issue-1937-stream-idle-timeout-retry.mjs` (17 assertions) and a
full case study with timeline, root-cause analysis, upstream references, and the
captured logs under `docs/case-studies/issue-1937`.

---

Treat a Claude Code `pending` Playwright MCP `system.init` status as a normal
still-connecting state instead of a failure (#1901). Claude Code enables Tool
Search by default, so the deferred `mcp__playwright__*` browser tools load on
demand and Claude waits for the connecting server before using them. Hive Mind
no longer aborts the working session on a `pending` status; only a terminal
`failed`/`error` status surfaces a non-blocking diagnostic in the session-start
comment. See `docs/case-studies/issue-1901`.
