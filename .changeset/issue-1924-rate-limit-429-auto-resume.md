---
'@link-assistant/hive-mind': patch
---

fix(retry): auto-resume on server-side 429 "Server is temporarily limiting requests" rate-limit errors (#1924)

A long-running solve session (177 turns, ~72 min) was thrown away when the Claude
CLI surfaced a **server-side temporary rate limit**:

```
API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited
```

The CLI reports this as a `result` event with `is_error: true` and
`api_error_status: 429`, and the HTTP response carries `x-should-retry: true`.
This is a transient throttle that clears on its own — distinct from an account
usage/quota limit (the message literally says "not your usage limit", and there
is no reset time to wait for).

Root cause: the error matched neither `classifyRetryableError` (no pattern for
the 429 throttle wording) nor `isUsageLimitError` (correctly, since it is not a
quota limit), so it fell through to a hard failure with exit code 1 and **no
auto-resume**, unlike every other transient class (overload 500/529, 503,
internal server error, request timeout, socket drops).

Fix: `classifyRetryableError` (in `src/tool-retry.lib.mjs`, the shared classifier
used by every tool wrapper — claude, codex, gemini, opencode, qwen, agent) now
recognises this throttle and marks it retryable (`isCapacity: false`, so no model
switch), so it retries with the session preserved (`--resume`) after a backoff.
`src/claude.lib.mjs` additionally detects the structured `api_error_status === 429`
directly (robust to wording changes) and logs a verbose diagnostic with the
`request_id`. The matcher is narrow so genuine account usage limits stay on the
usage-limit reset-time path.

Added `tests/test-issue-1924-rate-limit-retry.mjs` (18 assertions) and a full
case study with timeline, root-cause analysis, upstream references
(anthropics/claude-code#53915, #53922), and the captured logs under
`docs/case-studies/issue-1924`.
