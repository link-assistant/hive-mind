# Upstream report: `result` event reports `subtype: "success"` for an `api_error` termination

Prepared for [anthropics/claude-code](https://github.com/anthropics/claude-code).
Everything below is quoted from `data/solve-log.txt` in this directory — the raw
`--output-format stream-json --verbose` output of Claude Code `2.1.233` on
2026-08-14.

## Summary

When a session terminates because the API rejected the request (here: HTTP 403,
`oauth_org_not_allowed` — the organization has disabled Claude subscription
access), the final `result` event sets `is_error: true` and
`terminal_reason: "api_error"` but still reports `"subtype": "success"`.

Consumers that switch on `subtype` — the field that names _how_ the session
ended — therefore see a success and have to discover the failure from a
different field. Our runner logged, verbatim:

```
⚠️ Detected error from Claude CLI (subtype: success)
```

which is self-contradictory and was the reason the failure was reported to the
user as an opaque "execution failed with <provider sentence>" rather than as an
account-access problem.

## Reproduction

Any request that terminates the session with a non-retryable API error
reproduces it. The cheapest reproduction is an invalid credential:

```bash
ANTHROPIC_API_KEY=sk-ant-invalid \
  claude -p "hi" --output-format stream-json --verbose
```

The original occurrence needed no special setup: a normal long-running
`--print` session whose account lost Claude Code access mid-run (request
`req_011Ce2pPpFrtD864x1cuhUHu`).

## Observed output

The synthetic assistant message is correct and carries everything a consumer
needs:

```json
{
  "type": "assistant",
  "message": {
    "model": "<synthetic>",
    "content": [{ "type": "text", "text": "Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access" }]
  },
  "error": "oauth_org_not_allowed",
  "is_api_error_message": true,
  "request_id": "req_011Ce2pPpFrtD864x1cuhUHu"
}
```

The `result` event that follows is the problem:

```json
{
  "type": "result",
  "subtype": "success", // <-- expected: "error_during_execution" (or an api_error subtype)
  "is_error": true,
  "terminal_reason": "api_error",
  "api_error_status": 403,
  "num_turns": 484,
  "duration_ms": 15050306,
  "total_cost_usd": 31.38905599999999
}
```

The HTTP layer had already classified it correctly — the response carried
`x-should-retry: "false"` and the CLI logged
`post https://api.anthropic.com/v1/messages?beta=true failed with status 403 in 341ms - error; not retryable`
— so the information is present and simply is not reflected in `subtype`.

## Impact

`subtype` is the documented discriminator for the `result` event, and the other
terminal cases (`error_max_turns`, `error_during_execution`) do use it. Reporting
`success` for an API-error termination means:

- dashboards and CI wrappers that branch on `subtype` mis-classify hard
  failures as successes;
- consumers that do check `is_error` still get no _category_ from `subtype` and
  must special-case `terminal_reason`, which is not part of the documented
  schema surface.

## Workaround (what we shipped)

Treat `is_error === true` as authoritative and ignore `subtype` for
classification, reading the category from the other fields:

```js
const failed = data.is_error === true || data.subtype !== 'success';
const code = data.error || null; // e.g. "oauth_org_not_allowed"
const status = data.api_error_status || null; // e.g. 403
const terminalReason = data.terminal_reason; // e.g. "api_error"
```

We additionally classify on the `assistant` event carrying
`is_api_error_message: true`, because it arrives first and holds the same
`error` code.

## Suggested fix

Set `subtype` from the terminal reason when building the `result` event, so the
error path cannot fall through to the success literal — e.g. emit
`error_during_execution` (or a dedicated `error_api`) whenever
`terminal_reason === "api_error"`, and assert `subtype === "success"` implies
`is_error === false`.

Either shape is fine for consumers; what matters is that `subtype` and
`is_error` can no longer disagree.
