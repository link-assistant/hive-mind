# Issue 2101: Codex high-demand failure

## Executive summary

The solver lost an otherwise resumable Codex session after Codex CLI exhausted
its WebSocket and HTTPS retries during a service-wide concurrency incident.
Hive Mind already retried messages containing `503 Service Unavailable`, but the
terminal `turn.failed` message had been reduced to:

> We're currently experiencing high demand, which may cause temporary errors.

That wording matched no retry rule, so Hive Mind treated it as fatal. The same
failure path attempted to upload the 60 MB log before making its emergency
commit; the captured log ends at the upload step. Thus the configured
auto-commit safety net could be bypassed by a crash, kill, or hang during log
attachment.

The fix recognizes Codex's high-demand/concurrency signatures as service-wide
transient overload, resumes the preserved thread with the selected model, and
moves emergency commit and push ahead of network-dependent log upload.

## Requirements inventory

| Requirement                                       | Evidence                                                                 | Resolution                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Automatically resume transient Codex failures     | Issue title and “tasks execution is never interrupted”                   | High-demand and concurrency-limit messages enter the shared transient retry path             |
| Preserve the Codex session                        | Incident thread `019f9601-7e91-7442-b113-22a24229f327` remained readable | Existing Codex retry code assigns the captured thread ID to `argv.resume`                    |
| Do not switch models for service-wide demand      | Backend reported concurrency throttling, not model-specific capacity     | Classification uses `isCapacity: false`                                                      |
| Emergency-commit uncommitted changes              | Explicit issue requirement                                               | Commit/push runs before log attachment; default-on behavior is regression-tested             |
| Preserve all incident evidence                    | Explicit issue requirement                                               | Original log is stored losslessly as gzip, plus issue/upstream metadata and comments         |
| Reconstruct timeline and root causes              | Explicit issue requirement                                               | Documented below                                                                             |
| Research external reports and existing components | Explicit issue requirement                                               | Related upstream Codex issue and existing Hive Mind retry/commit components documented below |
| Add diagnostics if root cause is uncertain        | Conditional requirement                                                  | Not needed: verbose HTTP and JSON event data identify both causes directly                   |

## Evidence archive

Files in [`raw/`](raw/) are source evidence, not edited excerpts:

- `solution-draft.log.gz`: the referenced 63,099,712-byte, 167,957-line log,
  compressed losslessly.
- `hive-mind-2101.json`: issue body and metadata.
- `openai-codex-35323.json` and `openai-codex-35323-comments.json`: the matching
  upstream report and its discussion.

SHA-256:

```text
f0de521d2e81f9a0a3428ba9ecdd4adb52a11e1a13e5985b51062e38765fdfaa  hive-mind-2101.json
fd4ebf402340e310dcc1d6ff79edaf43690f576bb7483783cf17833a895d5bb4  openai-codex-35323-comments.json
1f0223c66809736f0ddab03cca7e28922555d3722b6bc42756bb9141a1f6ba29  openai-codex-35323.json
7d2cd72cdf7dddfbf856022c60e964cc1fc4c3231f4362f8d45e2796aed9806c  solution-draft.log.gz
```

## Timeline

All timestamps are UTC on 2026-07-25.

| Time        | Event                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 02:13–08:54 | Codex worked in thread `019f9601-7e91-7442-b113-22a24229f327`, producing a large working tree and rollout                     |
| 08:54:40    | WebSocket returned 503 `Too many concurrent requests`, code `throttled`, source `concurrency_limit`; Codex fell back to HTTPS |
| 08:57:13    | Another WebSocket 503 reported `biscuit_baker_service_me_circuit_open`                                                        |
| 09:01:59    | Codex emitted the generic high-demand fallback message                                                                        |
| 09:03:06    | HTTPS returned 503 with `Retry-After: 30` and the circuit-open code                                                           |
| 09:03:07    | Retry returned 503 with `Retry-After: 20`                                                                                     |
| 09:04:01    | Codex confirmed the rollout was resumable (12,533 items), then emitted `turn.failed`; the turn used zero tokens               |
| 09:04:05    | Hive Mind classified the generic message as a non-retryable Codex error                                                       |
| 09:04:06    | Working directory measured 28.0 GB, up 27.2 GB during the run                                                                 |
| 09:04:06    | Log ends immediately after “Attaching failure logs to Pull Request...”                                                        |

## Root-cause analysis

### Interruption

The upstream cause was a service-wide Codex/ChatGPT concurrency incident, not a
bad prompt, local network failure, usage quota, or model-specific capacity
condition. Multiple independent signals agree: HTTP 503, `Retry-After`,
`x-envoy-ratelimited`, `Too many concurrent requests`, `throttled`,
`concurrency_limit`, and `biscuit_baker_service_me_circuit_open`.

Codex CLI already retried and changed transports. Once those internal attempts
were exhausted, its final user-facing message discarded the machine-readable
503 and throttle code. `classifyRetryableError()` handled explicit 503 and
overload messages but not “currently experiencing high demand”, so the outer
solver did not provide the longer-lived retry layer needed for unattended work.

### Emergency commit

The emergency commit implementation existed and defaulted to enabled. The
failure was ordering: `solve.mjs` awaited failure-log attachment before calling
`commitUncommittedChangesOnCriticalError()`. Uploading a 60 MB log is slow,
network-dependent, and can itself fail. The incident record ends at precisely
that boundary, so it contains no evidence that the later commit step ran.

Moving preservation before attachment establishes the required invariant:
partial work is committed and best-effort pushed before any optional remote
diagnostic operation.

## Existing components and alternatives

- The shared `classifyRetryableError()` and `prepareRetryAfterError()` already
  provide exponential backoff and distinguish service overload from
  model-specific capacity. Extending this classifier is smaller and consistent
  across supported tools.
- `executeCodexCommand()` already captures `thread.started` and sets
  `argv.resume` before a retry. No new session store is required.
- `commitUncommittedChangesOnCriticalError()` already stages, commits, and
  best-effort pushes. Reordering it is safer than duplicating Git logic.
- Respecting the server's exact `Retry-After` header would require Codex CLI to
  expose it in the terminal JSON event. Hive Mind cannot recover that header
  from the generic final message, so bounded exponential backoff remains the
  practical outer-layer policy.
- Disabling WebSockets is not a solution: the evidence shows HTTPS also returned
  the same service-wide 503.

## External correlation

[openai/codex#35323](https://github.com/openai/codex/issues/35323) was filed
shortly after this incident with the same Codex version family, model, 503
fallback, circuit-open code, and concurrent-request symptoms. Because an exact,
reproducible upstream report already exists, opening a duplicate would add no
new diagnostic value. The archived report preserves the state consulted for
this analysis.

## Verification

`tests/test-issue-2101-codex-high-demand-retry.mjs` reproduces the exact generic
message plus the detailed concurrency variant. It verifies each is retryable
without a model switch, confirms catastrophic auto-commit remains default-on,
and guards the preservation-before-upload ordering.
