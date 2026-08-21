# Use case: auditing and monitoring per-task usage

> **Goal** — answer "which task token made which request, against which
> subscription, and how many requests and upstream-reported tokens has it
> spent?" both live and after the
> fact.

This is the observability half of [per-task-tokens.md](per-task-tokens.md).
Nothing here requires a client change; the router records what it already knows
when it authorises a request.

## Three views, three retention models

| View | Endpoint / file | Retention | Best for |
| --- | --- | --- | --- |
| Prometheus counters | `GET /metrics` (public, aggregate only) | in-memory, resets on restart | dashboards, alerts |
| JSON snapshot | `GET /v1/usage` (admin only) | in-memory, resets on restart | per-token inspection, scripts |
| Audit trail | `--audit-log <file>` (JSONL) | durable, append-only | forensics, compliance |
| Persisted budgets | `tokens list` | durable token store | quota enforcement |

## Live per-token counters

Every authorised request is attributed to its token id (the JWT `sub`) and the
label the token was issued with. The detailed counters are available only from
the admin-gated `/v1/usage` endpoint:

```bash
curl -s http://127.0.0.1:8080/v1/usage \
  -H "Authorization: Bearer $ROUTER_ADMIN_TOKEN" | jq .token_calls
```

```json
{
  "550e8400-…": { "label": "issue-45-solver", "requests": 42 }
}
```

The count increments once per *authorised* request — the same unit
`--max-requests` budgets. Persisted `used_tokens/max_tokens` in `tokens list`
instead comes from actual vendor response usage and survives restarts.
`/metrics` remains unauthenticated for standard
Prometheus scrapers, so it exposes aggregate totals and status codes only; it
never emits token ids, token labels, or account names.

## Durable audit trail

The audit log is **off by default**. Enable it with a path:

```bash
router serve --audit-log /var/log/link-assistant/audit.jsonl
# or
AUDIT_LOG=/var/log/link-assistant/audit.jsonl router serve
```

One JSON object per line is appended as each request is authorised:

```json
{"time":"2026-08-07T12:00:00.123456+00:00","token_id":"550e8400-…","label":"issue-45-solver","provider":"codex","surface":"anthropic","path":"/v1/messages","model":"claude-sonnet-4-20250514"}
```

| Field | Meaning |
| --- | --- |
| `time` | RFC 3339 timestamp of the authorisation |
| `token_id` | Router token id — the JWT `sub`, **not** the token string |
| `label` | Label the token was issued with |
| `provider` | Upstream that served it: `anthropic`, `codex`, `gemini`, `qwen`, `gonka`, `crater`, `openai-compatible` |
| `surface` | Client-facing dialect: `anthropic`, `openai_chat`, `openai_responses` |
| `path` | Request path as the router saw it |
| `model` | Model the client asked for, when the body carried one (omitted otherwise) |

### What the log deliberately does not contain

- the `la_sk_…` token string,
- any vendor credential or `Authorization` header,
- prompt or completion content.

A unit test (`events_never_carry_the_token_string_or_credentials`) asserts the
first two. The file is therefore safe to ship to a shared log collector.

This content policy applies only to the optional audit log. The default request
log is a diagnostic record of complete exchanges and therefore includes prompt
and completion content. It partially masks long credentials and fully masks
short ones, but operators with access to `$DATA_DIR/requests` can read message
content and should protect and retain that directory accordingly.

### Rotation

Each write re-opens the file in append mode, so an external rotator
(`logrotate`, `copytruncate`, a container log driver) can move the file
underneath a running router without a restart. A failed write is logged as a
warning and dropped — auditing never takes the proxy down.

## Example queries

```bash
# requests per label, from the audit log
jq -r .label audit.jsonl | sort | uniq -c | sort -rn

# which upstream a task actually used (useful when bridging is enabled)
jq -r 'select(.label=="issue-45-solver") | [.surface,.provider,.model] | @tsv' audit.jsonl | sort -u

# tokens that are close to their budget
router tokens list
```

```promql
# Prometheus: aggregate request rate over 5 minutes
rate(link_assistant_requests_total[5m])
```

## Related

- [per-task-tokens.md](per-task-tokens.md) — issuing and scoping the tokens
  these views attribute traffic to.
- The router also exports overall counters (`link_assistant_requests_total`,
  `…_errors_total`, and per-status series) — see the main
  [`README.md`](../../README.md).
