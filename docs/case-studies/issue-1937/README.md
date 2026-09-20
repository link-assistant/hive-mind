# Case Study — Issue #1937: `API Error: Stream idle timeout - partial response received` aborts the session instead of auto-retrying

- **Issue:** [#1937](https://github.com/link-assistant/hive-mind/issues/1937) — _"`API Error: Stream idle timeout - partial response received`"_
- **Type:** Bug (missing retry classification)
- **Pull request:** [#1938](https://github.com/link-assistant/hive-mind/pull/1938)
- **Author:** @konard
- **Status at analysis:** Open

Raw issue data and the captured log are archived under [`data/`](./data/):

- [`data/issue-1937.json`](./data/issue-1937.json) — the issue as captured from GitHub.
- [`data/solution-draft-log-pr-1781617633345.txt.gz`](./data/solution-draft-log-pr-1781617633345.txt.gz) — the full ~125k-line `solve.mjs` log from the run that hit the timeout (gzip; mirrored from the [gist](https://gist.githubusercontent.com/konard/c1f38bd29f4f344a10cc45ba67da1a9b/raw/0aa2148daf60101acb159588bf201b55e01ac0e2/solution-draft-log-pr-1781617633345.txt)). `gunzip -c` to read.
- [`data/stream-idle-timeout-excerpt.txt`](./data/stream-idle-timeout-excerpt.txt) — the ~136-line slice of that log containing the synthetic `assistant` message, the terminal `result` event (`is_error: true`, `result: "API Error: Stream idle timeout - partial response received"`), the `⚠️ Detected error from Claude CLI` line, and the `❌ Claude command failed with exit code 1` abort.

---

## 1. Summary

A long-running `solve.mjs` session (391 turns, ~$34.11, resuming PR
`link-assistant/formal-ai#489`) had its streaming response stall **mid-answer**.
The Claude CLI gave up on the stalled server-sent-events stream and surfaced a
synthetic `assistant` message (model `<synthetic>`) plus a terminal `result`
event with `subtype: "success"`, `is_error: true`, and:

```
API Error: Stream idle timeout - partial response received
```

Instead of being treated as a **transient streaming stall** — safe to retry by
resuming the (still valid) session with `--resume <sessionId>` and the same
context — it fell straight through to the generic failure path:

```
⚠️ Detected error from Claude CLI (subtype: success)
✅ Stream closed normally after result event
❌ Claude command failed with exit code 1
```

The harness exited with code **1** after **zero retries**, even though it had a
valid session ID and printed the exact `--resume` command a human would use to
continue. The whole ~$34, 391-turn session was abandoned on a single stalled
stream.

The issue asks: _"This error should become auto-retriable with exponential
backoff by resume (with same context)."_

---

## 2. Timeline / sequence of events (reconstructed from the log)

All references are line numbers in the **uncompressed**
`data/solution-draft-log-pr-1781617633345.txt`.

1. **L7** — Command invoked: `solve https://github.com/link-assistant/formal-ai/pull/489 --model opus --think max --tool claude --attach-logs --verbose ...`.
2. **L588** — `📌 Session ID: 1dbe466b-d9da-40c8-8204-b012a3d0f3a3` — the Claude session is created and runs real work for ~110 minutes.
3. **~L125289** — The last genuine `assistant` event is logged at `13:44:09`. The stream then goes **idle**.
4. **~3 minutes of silence** — no further bytes arrive on the SSE stream (the stall).
5. **L125292–L125341 (`13:47:10`)** — A synthetic `assistant` message arrives: `model: "<synthetic>"`, `stop_reason: "stop_sequence"`, content `text: "API Error: Stream idle timeout - partial response received"`, `error: "unknown"`.
6. **L125342 (`13:47:10`)** — The terminal `result` event: `is_error: true`, `subtype: "success"`, `api_error_status: null`, `result: "API Error: Stream idle timeout - partial response received"`, `num_turns: 391`, `total_cost_usd: 34.107997`.
7. **L125397** — `⚠️ Detected error from Claude CLI (subtype: success)` — `commandFailed = true` is set (the generic else branch).
8. **L125399** — `✅ Stream closed normally after result event`.
9. **L125401** — `❌ Claude command failed with exit code 1`. **No retry was attempted** (`grep -c "Retry .../... in" → 0`).
10. **L125404+** — The log prints the `--resume 1dbe466b-...` commands a human could run manually — proof the session was still resumable, the harness just didn't do it automatically.

---

## 3. Requirements extracted from the issue

| #   | Requirement                                                                                                                                   | Addressed                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| R1  | Make `API Error: Stream idle timeout - partial response received` **auto-retriable with exponential backoff**.                                | ✅ Yes                                                                                                              |
| R2  | The retry must **resume with the same context** (`--resume <sessionId>`), not start fresh.                                                    | ✅ Yes                                                                                                              |
| R3  | Download all logs/data and compile into `docs/case-studies/issue-1937/`.                                                                      | ✅ Yes (this folder)                                                                                                |
| R4  | Deep case-study analysis: timeline, requirements, root causes, proposed solutions; search online for additional facts; check known libraries. | ✅ Yes (this README)                                                                                                |
| R5  | If not enough data to find the root cause, add debug output / verbose mode.                                                                   | ✅ N/A — root cause found from the existing verbose log; the retry path already logs the classified label (see §6). |
| R6  | If the issue is related to another reportable repository, file an issue there with repro + workaround + fix suggestion.                       | ✅ See §7 — it is an upstream Claude Code bug already tracked by many issues; no new report needed.                 |
| R7  | Apply the fix everywhere the problem exists (entire codebase, not just one place).                                                            | ✅ Yes — fixed in the shared classifier used by **all** tools (claude/codex/gemini/opencode/qwen/agent). See §6.    |

---

## 4. Root cause

The retry decision in `src/claude.lib.mjs` builds an `isTransientError` flag from
a fixed set of recognised patterns and a shared classifier,
`classifyRetryableError()` (in `src/tool-retry.lib.mjs`):

```js
const retryableLastError = classifyRetryableError(lastMessage);
const isTransientError =
  isStartupTimeout || isActivityTimeout || isOverloadError ||
  isInternalServerError || is503Error || isRequestTimeout ||
  isRateLimitError || retryableLastError.isRetryable || /* …string checks… */;
```

When the `result` event carries `is_error: true`, the harness sets
`lastMessage = data.result` (here, `"API Error: Stream idle timeout - partial
response received"`) and `commandFailed = true`. It then asks
`classifyRetryableError(lastMessage)` whether to retry.

**The classifier had no branch for "stream idle timeout".** It recognised
`overloaded`, `request timed out`, `stream disconnected before completion`,
socket/connection drops (#1881), 429 rate limits (#1924), 503/500, and corrupted
thinking blocks (#1834) — but **not** the idle-timeout family. So
`classifyRetryableError(...).isRetryable` was `false`, every other flag was also
`false` (it is not a startup/activity timeout, not a 429/500/503, not a request
timeout), `isTransientError` evaluated to `false`, and execution fell through to
the generic `commandFailed` failure path → **exit code 1, no retry**.

This is the same class of gap that #1881 (socket closed) and #1924 (429) closed
earlier: a transient, resumable streaming failure that simply wasn't in the
recognised-pattern list.

### Why it is safe to resume

`Stream idle timeout - partial response received` is a **transport-level stall**,
not a request-content rejection: the model already produced part of its answer,
and the streaming socket then went quiet long enough for the CLI's idle watchdog
to abort the turn. The session transcript on disk is intact and valid, which is
exactly why the harness was able to print a working
`claude --resume 1dbe466b-... -p "Continue."` command. Resuming replays the same
context and lets the model continue — the canonical recovery for this error.

---

## 5. The fix

A single new branch in the **shared** classifier
`src/tool-retry.lib.mjs::classifyRetryableError()` — placed alongside the other
streaming/timeout branches:

```js
// Issue #1937: Stream idle timeout. When the Anthropic streaming response stalls
// (no bytes for the SDK's idle window) after the model has already emitted part of
// its answer, the Claude CLI aborts the turn and surfaces a synthetic assistant /
// result message:
//   "API Error: Stream idle timeout - partial response received"
// This is a transient network/streaming stall (a slow or stuck server-sent-events
// socket), not a request-content error, so the session is still valid and safe to
// resume. ... Switching models does not help (the stall is in the response stream,
// not model capacity), so isCapacity is false → retry with the session preserved.
if (lower.includes('stream idle timeout') || (lower.includes('idle timeout') && lower.includes('partial response'))) {
  return { message, isRetryable: true, isCapacity: false, label: 'Stream idle timeout (partial response)' };
}
```

- **`isRetryable: true`** → flips `isTransientError` to `true`, so the existing
  unified retry block (exponential backoff: 2 min → 30 min cap, up to
  `maxTransientErrorRetries`) runs. **(R1)**
- **`isCapacity: false`** → no model switch; the stall is in the stream, not model
  capacity.
- The existing retry block already does
  `if (!isStartupTimeout && sessionId && !argv.resume) argv.resume = sessionId;`
  — so the retry **resumes with the same context**. **(R2)**

### Why the fix is in the shared classifier (R7 — entire codebase)

`classifyRetryableError()` is the single retry classifier imported by **every**
agent backend:

| File                   | Uses `classifyRetryableError` |
| ---------------------- | ----------------------------- |
| `src/claude.lib.mjs`   | ✅ (result + exception paths) |
| `src/codex.lib.mjs`    | ✅                            |
| `src/gemini.lib.mjs`   | ✅                            |
| `src/opencode.lib.mjs` | ✅                            |
| `src/qwen.lib.mjs`     | ✅                            |
| `src/agent.lib.mjs`    | ✅                            |

Fixing the classifier therefore makes the idle-timeout error auto-retriable for
**all** tools at once, not just Claude — no per-tool string checks to keep in
sync. (Claude is where it was observed because the synthetic message is
Claude-CLI-specific, but any backend that surfaces the same text now retries.)

---

## 6. Diagnosability (R5)

No extra debug plumbing was required — the existing **`--verbose`** log already
captured the full synthetic message and the `result` event, which is how the root
cause was found. Once the classifier recognises the error, the existing unified
retry block logs it with its label automatically:

```
⚠️ Stream idle timeout (partial response) detected. Retry 1/N in 2 min (session preserved)...
   Error: API Error: Stream idle timeout - partial response received
```

(The label comes from `retryableLastError.label` in the retry log line in
`src/claude.lib.mjs`.) So the retry is now both **automatic** and **visible** in
the logs.

---

## 7. Upstream / related work (R6)

This is a **known upstream Claude Code bug**, reported many times. It is a
client/server streaming keep-alive problem on Anthropic's side — there is nothing
to fix in their code from here, and no new report is warranted (it is already
heavily tracked). Our job is purely to **recover gracefully**, which this PR does.

Representative upstream reports (`anthropics/claude-code`):

- [#46987](https://github.com/anthropics/claude-code/issues/46987) — _"Stream idle timeout - partial response received - multiple times today"_
- [#47698](https://github.com/anthropics/claude-code/issues/47698) — _"Anthropic API Error: Stream idle timeout - partial response received"_
- [#47841](https://github.com/anthropics/claude-code/issues/47841) — _"Stream idle timeout … on Claude Code Web"_
- [#49500](https://github.com/anthropics/claude-code/issues/49500) — _"API Error: Stream idle timeout - partial response received"_
- [#49619](https://github.com/anthropics/claude-code/issues/49619) — _"Stream idle timeout / partial response during long tool-use turns (Opus 4.7)"_
- [#52507](https://github.com/anthropics/claude-code/issues/52507) — _"Stream idle timeout - partial response"_
- [#47252](https://github.com/anthropics/claude-code/issues/47252) — _"Ultraplan: repeated 'Stream idle timeout' errors"_

Common findings from those threads: the stream aborts mid-turn during long /
multi-step responses; the partial response is discarded; in some cases the tool
side-effect (e.g. a file write) actually completed even though the client stream
died — consistent with a keep-alive/heartbeat gap between
`tool-result-accepted` and the next assistant token. Newer Claude Code releases
reduce its frequency, but it still surfaces, so the harness must handle it.

### Known components / libraries that solve the same problem

This is solved entirely with the harness's **existing** retry infrastructure —
no new dependency is needed:

- `classifyRetryableError()` (`src/tool-retry.lib.mjs`) — the shared retry
  classifier; this PR adds one branch to it.
- The unified transient-error retry block in `src/claude.lib.mjs` (exponential
  backoff with `--resume` session preservation), already used for #1331, #1353,
  #1439, #1472/#1475, #1881, #1924.
- `retryLimits` / `getRetryDelayMs` / `waitWithCountdown` (`src/config.lib.mjs`,
  `src/tool-retry.lib.mjs`) — backoff schedule and countdown.

The same pattern (classify → exponential backoff → resume) is the industry norm
for transient streaming errors (e.g. `p-retry`, AWS SDK adaptive retry,
`exponential-backoff`); reusing the in-house implementation keeps behaviour
consistent with every other transient error the harness already handles.

---

## 8. Verification

- **New test:** `tests/test-issue-1937-stream-idle-timeout-retry.mjs` — 17
  assertions covering the exact issue message, wrapped `{ result }` / `{ message }`
  objects, casing/phrasing variants, the correct label, `isCapacity: false`,
  non-regression of unrelated non-retryable errors, and that pre-existing
  transient classifications (overload, request timeout, stream disconnected,
  socket-closed #1881) still pass.
- **Regression sweep:** the sibling retry tests
  (`test-issue-1881-socket-error-retry`, `test-issue-1924-rate-limit-retry`,
  `test-issue-1935-session-limit-429`, `test-issue-1834-thinking-block-recovery`)
  still pass.

Reproduce:

```bash
node tests/test-issue-1937-stream-idle-timeout-retry.mjs
```
