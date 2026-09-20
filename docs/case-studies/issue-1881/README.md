# Issue 1881 Case Study: `CLAUDE execution failed with API Error: The socket connection was closed unexpectedly.`

## Summary

Issue: https://github.com/link-assistant/hive-mind/issues/1881

Pull request: https://github.com/link-assistant/hive-mind/pull/1882

A `solve` run against `link-assistant/model-in-browser#11` (driving Claude Opus 4.8)
aborted mid-session with:

```
API Error: The socket connection was closed unexpectedly. For more information,
pass `verbose: true` in the second argument to fetch()
```

The Claude CLI surfaced this as a **synthetic** assistant message
(`"model": "<synthetic>"`, `"stop_reason": "stop_sequence"`, `"error": "unknown"`)
followed by a `result` event with `subtype: "success"` **but** `is_error: true`.
hive-mind detected the error (`⚠️ Detected error from Claude CLI`), set
`commandFailed = true`, and — because the message did **not** match any known
transient pattern — **failed the whole session immediately with exit code 1 and
performed zero retries**, discarding ~35 turns of work and ~$5.28 of API spend.

The root cause is a gap in `classifyRetryableError()`
(`src/tool-retry.lib.mjs`): it recognised `Overloaded`, `Request timed out`,
`stream disconnected before completion`, `503`, and `500` as retryable, but **not**
socket-level network disconnects (`socket connection was closed unexpectedly`,
`socket hang up`, `ECONNRESET`, `connection reset`, `Connection error`,
`fetch failed`, `network connection lost`). These are network-level failures, not
request-content errors, so they are safe to retry with the session preserved
(`--resume`).

The fix adds a socket/connection-error branch to `classifyRetryableError()`. Because
that function is the single, shared classifier used by the Claude, Codex, Agent,
Gemini and Qwen execution paths, one change fixes every tool's execution loop.

## Evidence Collected

- `data/solution-draft-log-pr-1781045909387.txt` — the full `--attach-logs` solve
  log (the source gist referenced by the issue), ~2.9 MB.
- `data/error-excerpt.txt` — the relevant tail of the log: the synthetic error
  message, the `result` event, and the "Claude command failed with exit code 1".
- `data/issue-1881.json` — the GitHub issue body and metadata.
- `data/pr-1882.json` — the draft PR opened for this fix.

## Timeline (from the solve log)

All times UTC, from `data/solution-draft-log-pr-1781045909387.txt`.

- `2026-06-09T22:47:22.946Z` — `solve v1.74.11` starts:
  `solve https://github.com/link-assistant/model-in-browser/issues/11 --model opus --tool claude --attach-logs --verbose --no-tool-check --disable-report-issue --language en`.
- `22:47:23` – `22:56:13` — The session runs normally: clones the repo, opens the
  draft PR, and works through the task. Last healthy assistant turn:
  `"Now I'll write the case study. Starting with the main README."`
  (request_id `req_011CbtWcSC6zFrUKcqDMHaoP`).
- `22:58:27.493Z` — A **synthetic** assistant message arrives:
  `model: "<synthetic>"`, `stop_reason: "stop_sequence"`, `error: "unknown"`,
  text = `API Error: The socket connection was closed unexpectedly. …`. The socket
  for the in-flight streaming request (`req_011CbtWcSC6zFrUKcqDMHaoP`) dropped after
  ~2m15s of no data.
- `22:58:27.494Z` — `result` event: `subtype: "success"`, `is_error: true`,
  `num_turns: 35`, `total_cost_usd: 5.2768862500000004`.
- `22:58:27.495Z` — hive-mind logs `⚠️ Detected error from Claude CLI (subtype: success)`.
- `22:58:27.885Z` — `❌ Claude command failed with exit code 1`. **No retry is
  attempted** (grep for `Retrying now` / `Retry N/M` in the log → 0 matches). The
  session resume command is printed and the run ends.

The whole 11-minute, 35-turn session is thrown away because of one dropped socket.

## Requirements From The Issue

1. Download all logs/data related to the issue into `docs/case-studies/issue-1881`.
2. Do a deep case-study analysis: reconstruct the timeline, list every requirement,
   find the root cause of each problem, and propose solutions / solution plans.
3. Search online for additional facts and check for known existing
   components/libraries that solve a similar problem.
4. If there is not enough data to find the root cause, add debug output / verbose
   mode so the root cause can be found on the next iteration.
5. If the issue is related to another repository where we can report issues, do so —
   with reproducible examples, workarounds and suggested code fixes.
6. Apply the fix to the **entire** codebase — if the problem exists in multiple
   places, fix all of them.
7. Plan and execute everything in a single pull request.

## Root Cause

### Where the error is produced

The error does not originate in hive-mind. It is emitted by the Claude CLI / the
underlying Anthropic SDK `fetch()` when the HTTP/streaming socket to
`api.anthropic.com` drops mid-request. The CLI converts the network failure into a
synthetic assistant message and a `result` event with `is_error: true`.

### Where hive-mind handles it

In `src/claude.lib.mjs`, the `result` event handler sets `commandFailed = true` and
captures `lastMessage = data.result`:

```js
if (data.is_error === true) {
  lastMessage = data.result || JSON.stringify(data);
  const subtype = data.subtype || 'unknown';
  …
  commandFailed = true;
  await log(`⚠️ Detected error from Claude CLI (subtype: ${subtype})`, { verbose: true });
}
```

The retry decision is then driven by `classifyRetryableError(lastMessage)` plus the
`isTransientError` aggregate:

```js
const retryableLastError = classifyRetryableError(lastMessage);
const isTransientError =
  isStartupTimeout || isActivityTimeout || isOverloadError || isInternalServerError ||
  is503Error || isRequestTimeout || retryableLastError.isRetryable || /* …500/529/503… */;
if ((commandFailed || isTransientError) && isTransientError) { /* retry with --resume */ }
```

### The gap

Before this PR, `classifyRetryableError()` (`src/tool-retry.lib.mjs`) only matched:

- `selected model is at capacity` / `at capacity … try a different model`
- `overloaded` / `overloaded_error`
- `request timed out`
- `stream disconnected before completion`
- corrupted thinking blocks (`requiresFreshSession`)
- `api error: 503` / `upstream connect error` / `remote connection failure`
- `internal server error` / `api error: 500`

`The socket connection was closed unexpectedly` matched **none** of these, so
`retryableLastError.isRetryable === false`, `isTransientError === false`, and the
`if (… isTransientError)` retry branch was skipped. The session failed fast with no
retry — even though this is a textbook transient network error and the session was
fully resumable via `--resume`.

This is the same class of failure as the already-handled
`stream disconnected before completion`; the socket-closed variant was simply never
added.

### Why one fix covers the whole codebase

`classifyRetryableError` is the single shared classifier. It is imported and used by
every tool execution loop:

- `src/claude.lib.mjs` (line 1163) — Claude CLI.
- `src/agent.lib.mjs` (line 791) — Agent SDK runner.
- `src/codex.lib.mjs` (lines 1014, 1082) — Codex.
- (Gemini/Qwen share the same retry plumbing.)

No tool path has its own bespoke socket-error list, so adding the pattern to
`classifyRetryableError` fixes Claude, Codex and Agent simultaneously. A repo-wide
search for `socket`, `ECONNRESET`, `connection was closed` in the tool libs
confirmed there was no other place special-casing these strings.

## The Fix

`src/tool-retry.lib.mjs` — new branch in `classifyRetryableError`, placed next to the
existing `stream disconnected before completion` case:

```js
// Issue #1881: Transient socket / network disconnects from the SDK's underlying fetch.
if (lower.includes('socket connection was closed unexpectedly') || lower.includes('socket hang up') || lower.includes('econnreset') || lower.includes('connection reset') || lower.includes('network connection lost') || lower.includes('connection error') || lower.includes('fetch failed')) {
  return { message, isRetryable: true, isCapacity: false, label: 'Socket/connection closed unexpectedly' };
}
```

Effect on the failing run: `retryableLastError.isRetryable` becomes `true` →
`isTransientError` becomes `true` → the unified transient-retry path runs. Because
`sessionId` is known and `argv.resume` is unset, the loop sets
`argv.resume = sessionId` and re-invokes with `--resume`, preserving all 35 turns of
context and resuming after an exponential-backoff delay (1 min → 30 min, up to
`maxTransientErrorRetries = 10`). `isCapacity: false` means no spurious model switch.

The chosen patterns mirror the project's existing network-error vocabulary in
`isTransientNetworkError()` (`src/lib.mjs`, used for `gh`/GitHub retries — issue
#1536), which already lists `econnreset`, `connection reset`, `socket hang up`, etc.

## Tests

`tests/test-issue-1881-socket-error-retry.mjs` (default suite, 19 assertions):

1. The exact issue-#1881 message is classified retryable, gets the
   `Socket/connection closed unexpectedly` label, and `isCapacity: false`.
2. The message wrapped in a `{ message }` object (the SDK shape) is still retryable.
3. Related signatures (`socket hang up`, `ECONNRESET`, `connection reset`,
   `Connection error.`, `fetch failed`, `network connection lost`) are retryable.
4. Regression guard: non-transient errors (`ENOENT`, `SyntaxError`,
   `Permission denied`, `context_length_exceeded`) stay non-retryable.
5. Regression guard: pre-existing transient classifications (`Overloaded`,
   `Request timed out`, `stream disconnected before completion`, `503`) still work.

## Online Research / Prior Art

`The socket connection was closed unexpectedly` is a **known upstream Claude Code /
Anthropic SDK issue**, reported many times during long agentic sessions:

- anthropics/claude-code#48837 — `[Bug] Anthropic API Error: Socket connection closed unexpectedly`
- anthropics/claude-code#51107 — `Socket connection closed unexpectedly during Anthropic API request`
- anthropics/claude-code#54287 — duplicate report
- anthropics/claude-code#60133 — `… + SOLUTION FOR ANTHROPIC DEVS`
- anthropics/claude-code#56711 — `Claude Code hangs with Unable to connect to API (ECONNRESET) …`
- anthropics/claude-code#49761 — OAuth variant of the same socket-closed message

Reported root causes upstream: network/firewall/VPN interference; QUIC/UDP-443 being
mangled while the Bun runtime prefers HTTP/3 and does not fall back to TCP HTTPS;
and idle-socket teardown during long sessions (missing `SO_KEEPALIVE`). All of these
are **transient, client-side / network-level** failures — exactly the kind that
should be retried, which is what this PR does on the hive-mind side.

Existing component reused: hive-mind already has a battle-tested transient-network
classifier for `gh` commands — `isTransientNetworkError()` in `src/lib.mjs` (issue
#1536). This case study aligns the AI-tool classifier (`classifyRetryableError`) with
that same vocabulary rather than inventing a new mechanism.

## Upstream Reporting

The socket disconnect itself is an upstream Claude Code / Anthropic SDK bug and is
already extensively reported (issues listed above), including a request for
`SO_KEEPALIVE`. No new, non-duplicate upstream issue is warranted. The actionable,
in-our-control defect is hive-mind aborting instead of retrying a resumable session,
which this PR fixes.

## Verification Checklist

- [x] Reproduced the classification gap (the exact message → `isRetryable: false`
      before the fix).
- [x] Fix makes the exact message and related socket signatures retryable.
- [x] No regression for non-transient errors or pre-existing transient patterns.
- [x] Single shared classifier → fix applies to Claude, Codex and Agent paths.
- [x] Case-study data compiled under `docs/case-studies/issue-1881/`.
