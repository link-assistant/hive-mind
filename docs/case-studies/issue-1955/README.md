# Case Study: Issue #1955 — `CODEX execution failed with Network lookup skipped in fixture`

## Summary

Issue #1955 reported that a `/solve` run using `--tool codex` **failed** with:

```
❌ Codex emitted error event: Network lookup skipped in fixture
   Error events: item=0, turn=0, stream=1
```

The failure was a **false positive**. The codex session had actually **succeeded**:
the turn completed (`turn.completed=1`, `turn.failed=0`), 419 command executions and
38 file changes ran, the public-pricing estimate was produced (`$18.29`), and the work
was an _unrelated_ task — `link-assistant/formal-ai` #518, "an Agent CLI **NDJSON
adapter**". The phrase `Network lookup skipped in fixture` is **not a real error at
all**: it is a line of a **test fixture** the codex agent printed to its terminal while
building that adapter.

Two distinct requirements come out of the issue, and both are fixed in PR #1956:

1. **Root cause — a fixture line printed by the agent was misread as a fatal codex
   stream error.** When codex runs with debug logging on (our verbose mode sets
   `RUST_LOG=debug`), the codex CLI renders OTEL telemetry — `codex_otel.log_only`,
   `event.name="codex.tool_result"` — to **stderr**, including a raw `Output:` dump of
   every command's stdout. One command printed an NDJSON fixture whose body contained
   the standalone line `{"type":"error","message":"Network lookup skipped in fixture"}`.
   Our line-by-line JSON parser — which consumes **both** stdout and stderr — `JSON.parse`d
   that echoed line and recorded it as a genuine codex _stream_ error, then failed an
   otherwise-successful run.
2. **Expand auto-retry to all genuinely-transient codex/GitHub network errors** (429,
   timeouts, DNS, gateway 502/503/504/52x, connection resets) — "everything that is
   100% temporary should be retriable (except 5-hour and 7-day limits), like we do with
   `--tool claude`."

## Captured Evidence

All evidence lives under [`raw/`](./raw/):

| File                                | Purpose                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `raw/issue-1955.json`               | Issue title, body, labels, timestamps                              |
| `raw/issue-1955-body.md`            | Issue body (verbatim requirements)                                 |
| `raw/issue-comments.json`           | Issue comments (empty `[]` at capture time)                        |
| `raw/codex-failure-log.excerpt.txt` | The smoking-gun excerpts of the 75 MB failure log                  |
| `raw/research-sources.json`         | Primary sources (codex source at `rust-v0.141.0`, RFCs, man-pages) |

> The full run log is ~75 MB (`log-tmp-solution-draft-log-pr-1781897288930.txt`) and is
> **not** committed; the three relevant slices that prove the root cause are preserved in
> `raw/codex-failure-log.excerpt.txt`.

## Timeline (UTC, 2026-06-19)

| Time               | Event                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19:01:03.009       | Codex (v0.141.0, `auth_mode="Chatgpt"`, conversation `019ee135…`) ran a command that printed an NDJSON test fixture for formal-ai #518. With debug logging on, the OTEL `codex.tool_result` event rendered the command's stdout to stderr as an `Output:` dump — including the bare line `{"type":"error","message":"Network lookup skipped in fixture"}`. Our parser recorded it as `streamErrors[0]`. |
| 19:01:03.035       | The _real_ codex protocol stream continued normally (`item.started` / `item.completed` for the next `command_execution`). The fixture echo was interleaved noise, not a stream event.                                                                                                                                                                                                                   |
| …(27 min of work)… | 419 command executions, 38 file changes, 59 reasoning summaries, 1 turn — all successful.                                                                                                                                                                                                                                                                                                               |
| 19:28:03.730       | `📈 Codex usage from turn.completed: 509,741 input … across 1 turn(s)` — the turn **completed**.                                                                                                                                                                                                                                                                                                        |
| 19:28:03.733       | `⚠️ Codex error events observed: item=0, turn=0, stream=1` — the only "error" is the echoed fixture line.                                                                                                                                                                                                                                                                                               |
| 19:28:03.965       | `💰 Codex public pricing estimate: $18.29` — the run produced a full, billable, successful result.                                                                                                                                                                                                                                                                                                      |
| 19:28:03.991       | `❌ Codex emitted error event: Network lookup skipped in fixture` — the **false-positive** fatal error fails the run.                                                                                                                                                                                                                                                                                   |

The decisive contradiction: `turn.completed=1`, `turn.failed=0`, yet the run was
reported failed solely because of `stream=1` — an echoed fixture line.

## Root-Cause Analysis

### Why the fixture line reached our error path

Verified against `openai/codex` at tag `rust-v0.141.0` (the failing version):

- **The stdout JSONL protocol has exactly 8 `type` values** — `thread.started`,
  `turn.started`, `turn.completed`, `turn.failed`, `item.started`, `item.updated`,
  `item.completed`, and top-level `error` (`ThreadEvent`, `exec_events.rs`). The fixture's
  vocabulary — `session_start`, `text`, `tool_use`, `tool_result` — is **not** codex
  protocol; it is the formal-ai adapter's own NDJSON shape. Only the one line that
  happens to _also_ be a valid codex shape (`{"type":"error","message":...}`) slipped
  through.
- **OTEL `codex.tool_result` (`codex_otel.log_only`) carries the full raw `output=`
  payload** of each command (`otel/src/events/session_telemetry.rs`). At default
  verbosity (`RUST_LOG=error`) these INFO events are filtered out, but a broad
  `RUST_LOG` (we set `RUST_LOG=debug` in verbose mode — `src/codex.lib.mjs:39`) makes
  the stderr fmt layer render the entire event, **including the multi-line command
  output**, onto stderr.
- **We feed stderr through the same JSON parser as stdout** (`src/codex.lib.mjs:1077`).
  So a continuation line of the OTEL `output=` field — the printed fixture's
  `{"type":"error",...}` — was `JSON.parse`d and bucketed as a codex stream error.
- **A standalone top-level codex `error` does not itself fail the run upstream either** —
  in codex, `error` keeps the stream `Running` and `exit(1)` is gated only on
  `TurnStatus::Failed | Interrupted` (`event_processor_with_jsonl_output.rs`,
  `lib.rs`). So codex's own contract agrees with our fix: a completed turn with no
  `turn.failed` is a success.

### Why this is the correct place to fix

`turn.failed` is codex's **authoritative** failure signal. A `turn.completed` with no
`turn.failed` means the session succeeded, so any _stray_ non-`turn` error event in that
window is non-fatal — whether it is (a) a transient blip codex itself recovered from
before completing the turn, or (b) echoed content that merely _looks_ like a protocol
event (this issue). Gating at the **summary** layer is transport-agnostic: it fixes the
false positive regardless of whether the echo arrived via OTEL stderr, `aggregated_output`,
or any future leak path, and without trying to perfectly reconstruct multi-line OTEL
fields.

## The Fixes (PR #1956)

### Fix 1 — A completed codex turn is never failed by a stray non-`turn` error

`src/codex.lib.mjs` → `getCodexErrorEventSummary()`:

```js
const turnCompleted = (codexJsonState?.eventCounts?.['turn.completed'] || 0) > 0;
const turnFailed   = (codexJsonState?.turnFailures?.length || 0) > 0;
const sessionSucceeded = turnCompleted && !turnFailed;
// …inside addEvents():
if (type !== 'turn' && sessionSucceeded) {
  ignoredEvents.push({ ...event, reason: 'Codex turn completed successfully with no turn.failed; stray non-turn error event is non-fatal (Issue #1955)' });
  continue;
}
```

- `turn.failed` is **never** suppressed — genuine failures stay fatal.
- Suppressed strays are still recorded (`ignoredEvents`, `ignoredCounts`) and, in verbose
  mode, logged per-event (`↳ [stream] "…" — <reason>`) so they remain fully observable
  for the next investigation.
- The parser still records the stray in `streamErrors` for observability; only the
  _fatal classification_ changes.

### Fix 2 — Expand transient network-error auto-retry for all tools

`src/tool-retry.lib.mjs` → `classifyRetryableError()` gains three transient branches
(shared by claude/codex/gemini/qwen/opencode), all `isCapacity:false` (a network fault is
not a model-capacity problem, so no `--model` fallback switch):

| Branch     | Matches                                                                                                                                                                     | Label                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| DNS        | `ENOTFOUND`, `EAI_AGAIN`, "temporary failure in name resolution", `getaddrinfo`, "failed to lookup address information", "name or service not known"                        | `DNS resolution failure`               |
| Connection | `ETIMEDOUT`, "connection timed out", `ECONNREFUSED`, "connection refused", `EHOSTUNREACH`, `ENETUNREACH`, "no route to host", "network is unreachable", `EPIPE`, `EAI_FAIL` | `Transient network connection failure` |
| Gateway    | `502/504 Bad Gateway/Gateway Timeout`, "api error: 502/504", and Cloudflare `52x` (`/\b52[0-4]\b/`)                                                                         | `Gateway error (502/504/52x)`          |

The existing `503` branch was broadened to "503 service unavailable"/"service
unavailable". These align with **AWS's retryable set** (I/O failure, DNS resolution
failure, socket timeout, 500/502/503/504), **RFC 9110 §15.6** (502/503/504 are temporary;
`Retry-After`), and the **getaddrinfo(3)** man-page (`EAI_AGAIN` = "try again later").
Cloudflare 520–524 are delivered as HTTP 5xx, so the gateway branch covers them. 429 and
the pre-existing socket/overload/timeout signatures (#1881, #1949) were already retryable.

> **Guard:** the fixture phrase `Network lookup skipped in fixture` is explicitly tested
> to be **NOT** retryable — the broadened DNS/network patterns must never match it.

## Verification

`tests/test-issue-1955-codex-fixture-false-positive.mjs` (23 tests, all passing):

- **Section 1 — reproduction:** the exact interleaved stream (codex protocol + echoed
  NDJSON fixture incl. the `error` line + `turn.completed`) must report **no** fatal
  error; the stray is moved to `ignoredEvents` with a reason; `executeCodexCommand`
  returns `success:true` and never logs the fixture line as a fatal codex error.
- **Section 2 — no over-suppression:** a real `error` + `turn.failed` stays fatal; a
  stray `error` with **no** `turn.completed` (process died mid-stream) stays fatal.
- **Section 3 — retry classification:** every new transient pattern is retryable with the
  expected label; the fixture phrase and `ENOENT`/syntax/`context_length_exceeded`/auth
  errors are **not** retryable.

Existing suites confirmed green: `test-codex-support` (39), `test-issue-1881`, `#1924`,
`#1937`, `#1949`, `#1935`. (`test-internal-server-error-retry.mjs` has 8 failures that
**pre-date** this branch — confirmed by `git stash` on the base commit — caused by an
unrelated `initialTransientErrorDelayMs` config/test mismatch; out of scope for #1955.)

## Existing Components Reused

- **`classifyRetryableError`** (`src/tool-retry.lib.mjs`) — the single shared retry
  classifier already used by every tool; extending it applies the fix "to the entire
  codebase" in one place (the issue's explicit ask).
- **`getCodexErrorEventSummary` / `parseCodexExecJsonOutput`** (`src/codex.lib.mjs`) —
  the existing codex stream model, already tracking `eventCounts`, `turnFailures`,
  `streamErrors`, and an `ignoredEvents` channel (originally for app-server backpressure
  warnings) — reused as the natural home for the new gate.
- **Verbose/debug tracing** already exists (`RUST_LOG=debug` in verbose mode); the issue's
  "add debug output if not present" requirement was already satisfied, and we additionally
  emit a per-ignored-event verbose trace.

## Upstream Reporting

Codex is closed-to-PRs from us but accepts issues. The behavior here is a **known
category** upstream — non-protocol text contaminating a stream consumed by a JSON parser
(`openai/codex#21658`, `#22393`), and full-payload `output=` in `codex.tool_result`
(`#17909`). The robust resolution is on our side (don't fail a completed turn on echoed
content; don't trust stderr as a protocol stream), so no new upstream issue is required;
the relevant upstream tickets are catalogued in `raw/research-sources.json`. Operators who
want to silence the OTEL stderr dump entirely can scope logging, e.g.
`RUST_LOG=codex_core=info,codex_otel=off`.

## Requirements Checklist

- [x] Determine network issue vs. other root cause → **other root cause**: a fixture
      line misclassified as a fatal codex stream error (not a network failure).
- [x] Auto-retry all genuinely-transient codex/GitHub network errors (429, timeouts, DNS,
      gateway, connection resets), excluding 5-hour/7-day limits, mirroring `--tool claude`.
- [x] Apply the fix across the entire codebase (shared `classifyRetryableError`).
- [x] Download logs/data and compile a deep case study under `docs/case-studies/issue-1955/`.
- [x] Reconstruct timeline, enumerate requirements, find root cause, propose/implement
      solutions, check existing components, search online for facts.
- [x] Add a reproducing test before the fix; keep verbose tracing (off by default).
- [x] Single PR (#1956) on branch `issue-1955-10bea8889447`.
