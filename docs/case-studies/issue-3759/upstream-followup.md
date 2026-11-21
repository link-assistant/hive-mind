# Claude Code #103820: 403 variant and bounded control

Additional evidence for [anthropics/claude-code#103820](https://github.com/anthropics/claude-code/issues/103820), from [Hive Mind issue 3759](https://github.com/link-assistant/hive-mind/issues/3759) and [PR 3762](https://github.com/link-assistant/hive-mind/pull/3762).

## Observed failure

A long subscription-auth Claude Code **2.1.310** print-mode session exited 1 after a Messages HTTP **403**, with no synthetic assistant API-error or terminal `result` event. `ANTHROPIC_LOG=debug` put an opaque dump directly before the SDK summary on the same stdout line, then printed a response block with `message: undefined`, JSON content type and `content-encoding: br`. This is similar to the missing 429 terminal events already reported here, but concerns access denial rather than a quota reset.

```text
<opaque body>[log_51b53c, …, request-id: "req_011CgMM7s2E3s8XGWrwAMd1U"] post https://api.anthropic.com/v1/messages?beta=true failed with status 403 in 1038692ms - error; not retryable
[log_51b53c] response error (error; not retryable) {
  url: "https://api.anthropic.com/v1/messages?beta=true",
  status: 403,
  headers: { "content-encoding": "br", "content-type": "application/json", … },
  message: undefined,
  durationMs: 1040528,
}
```

The reporter says the subscription ended after cancellation; the available log only proves a 403. We have no decoded response or original session transcript to confirm a provider reason. Host capture is 16:15–16:16 UTC on 2026-10-24, while the response `date` is 16:05:35. This timing discrepancy does not identify the delaying component.

Full sanitized evidence and timeline: [case study](https://github.com/link-assistant/hive-mind/tree/issue-3759-54e1dde0ad42/docs/case-studies/issue-3759).

## Reproducible control and limits

From a checkout of the PR branch, with `claude` on PATH:

```sh
node experiments/issue-3759/probe-claude-403.mjs json
node experiments/issue-3759/probe-claude-403.mjs br
```

The self-contained script binds a mock HTTP API to localhost, uses a dummy key and fresh config, disables tools, and returns this response as either plain JSON or valid Brotli:

```json
{ "type": "error", "error": { "type": "permission_error", "message": "Your subscription has ended because it was cancelled." }, "request_id": "req_mock_3759" }
```

It bounds requests to 10, captured output to 512 KiB and runtime to 45 seconds, waits for exit and cleans up. On the locally installed **2.1.308**, each mode made one request and exited 1. Both emitted an assistant error (`authentication_failed`) and a terminal result (`subtype: success`, **`is_error: true`**), retaining the cancellation text. They produced **67/68 non-JSON stdout lines** respectively with `ANTHROPIC_LOG=debug`.

This directly reproduces debug output contaminating `stream-json` stdout. It **does not** reproduce the missing terminal event or `message: undefined` from the long 2.1.310 session. Valid Brotli alone is not sufficient. The archived outputs are `data/probe-{json,br}-{stdout,stderr}.log` and summaries in the linked case study. Offline `node tests/claude-access-error-3759.test.mjs` replays the actual incident to verify the host workaround.

## Workaround

On a failed CLI exit, recover explicit access/billing text from the transcript or stream; otherwise retain the Messages HTTP status and request ID from debug evidence. Never publish opaque body dumps as an error reason. A bare 403 should explain denied access and suggest checking subscription renewal, organization policy and active credentials without declaring cancellation as established. Do not interpret an earlier 99% quota warning as a resettable usage limit. Honor `is_error` independently of `subtype`.

## Suggested code changes upstream

1. Route SDK diagnostics to stderr or `--debug-file` while stream-json is active, and enforce record boundaries even after writing body data.
2. Centralize print-mode error finalization in a `finally`/terminal path: whenever an API failure ends a turn, emit and await flushing of a structured error/result containing HTTP status, provider type/message and request ID, including fallback text if decoding failed.
3. Retain a sanitized decoding failure reason when the HTTP body cannot be parsed, instead of logging only `message: undefined`; avoid logging raw binary/image bodies as the user-facing error.
4. Add a delayed/backpressured long-session 403 regression alongside the existing 429 case, checking both stream and transcript output. The short plain/Brotli controls here should continue to pass.
