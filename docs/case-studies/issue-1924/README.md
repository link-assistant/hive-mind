# Case Study — Issue #1924: Auto-resume missing for server-side 429 "Rate limited" errors

- **Issue:** [#1924](https://github.com/link-assistant/hive-mind/issues/1924) — _"Auto resume on `CLAUDE execution failed with API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited` is missing"_
- **Type:** Bug
- **Pull request:** [#1925](https://github.com/link-assistant/hive-mind/pull/1925)
- **Author:** @konard
- **Status at analysis:** Open

Raw issue data and the original solution-draft log are archived under [`data/`](./data/):

- [`data/issue-1924.json`](./data/issue-1924.json) — the issue as captured from GitHub.
- [`data/solution-draft-log-pr-1781377731550.txt`](./data/solution-draft-log-pr-1781377731550.txt) — the full ~90k-line `solve.mjs` log from the run that failed (mirrored from the [gist](https://gist.github.com/konard/936c8f264ecd7f9957642252cb76d268)).
- [`data/rate-limit-error-excerpt.txt`](./data/rate-limit-error-excerpt.txt) — the ~210-line slice of that log containing the 429 event, the synthetic assistant message, the `result` event, and the abort.

---

## 1. Summary

A long-running `solve.mjs` session (PR [link-foundation/rust-web-box#42](https://github.com/link-foundation/rust-web-box/pull/42), 177 turns, ~72 min, $23.47) was terminated when the Claude CLI surfaced a **server-side temporary rate limit**:

```
API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited
```

The CLI reported this as a `result` event with `subtype: "success"`, `is_error: true`, and **`api_error_status: 429`**. The session simply **failed with exit code 1** — no auto-resume, no retry — even though this is a _transient_ error that clears on its own.

The harness already auto-resumes/retries for several transient conditions (overload 500/529, 503, internal server error, request timeout, socket drops, and account usage limits). The 429 "Server is temporarily limiting requests" case was the one transient class **not** covered, so the whole expensive session was thrown away on a temporary throttle.

---

## 2. Timeline / sequence of events (reconstructed from the log)

All timestamps from [`data/solution-draft-log-pr-1781377731550.txt`](./data/solution-draft-log-pr-1781377731550.txt).

1. `17:56:25` — `solve v1.78.8` starts on `https://github.com/link-foundation/rust-web-box/pull/42` (continue mode, `--model opus --tool claude --verbose`).
2. `17:56:38` → `19:08` — The Claude session runs for ~72 minutes across **177 turns**, doing real work (measurement rig, in-VM tracing, case study).
3. `19:08:43.835` — The stream emits a **`rate_limit_event`**:
   ```json
   { "type": "rate_limit_event", "rate_limit_info": { "status": "rejected", "isUsingOverage": false } }
   ```
4. `19:08:43.836` — A **synthetic `assistant` message** is emitted with `error: "rate_limit"` and a single text block:
   ```
   API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited
   ```
   (The HTTP response just above it shows `"x-should-retry": "true"`.)
5. `19:08:43.843` — The terminal **`result`** event:
   ```json
   { "type": "result", "subtype": "success", "is_error": true, "api_error_status": 429, "result": "API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited" }
   ```
6. `19:08:43.852` — `⚠️ Detected error from Claude CLI (subtype: success)`.
7. `19:08:49.340` — `❌ Claude command failed with exit code 1`. The run prints manual `--resume` instructions and **stops**. No automatic resume occurs.

---

## 3. Requirements extracted from the issue

| #   | Requirement                                                                                          | Addressed                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Auto-resume/retry when the 429 "Server is temporarily limiting requests · Rate limited" error occurs | ✅ core fix in `classifyRetryableError` + `claude.lib.mjs`                                                                                                                                        |
| R2  | Compile issue logs/data into `docs/case-studies/issue-1924`                                          | ✅ [`data/`](./data/)                                                                                                                                                                             |
| R3  | Deep case study: timeline, requirements, root cause, solution plans, existing components             | ✅ this document                                                                                                                                                                                  |
| R4  | Search online for additional facts                                                                   | ✅ §6 (upstream issues + docs)                                                                                                                                                                    |
| R5  | If not enough data to find root cause, add debug/verbose output                                      | ✅ root cause found; added a verbose 429-detection log line anyway                                                                                                                                |
| R6  | Apply the fix across the **entire** codebase (all affected places)                                   | ✅ shared `tool-retry.lib.mjs` covers claude/codex/gemini/opencode/qwen/agent                                                                                                                     |
| R7  | If related to another repository, file reproducible issues there                                     | ✅ already reported upstream — anthropics/claude-code [#53915](https://github.com/anthropics/claude-code/issues/53915), [#53922](https://github.com/anthropics/claude-code/issues/53922) (see §6) |

---

## 4. Root-cause analysis

### 4.1 How transient-error auto-resume works today

In [`src/claude.lib.mjs`](../../../src/claude.lib.mjs), after the CLI finishes, the code computes a single boolean:

```js
const isTransientError = isStartupTimeout || isActivityTimeout || isOverloadError
  || isInternalServerError || is503Error || isRequestTimeout
  || retryableLastError.isRetryable || /* …text checks for 500/529/503/timeout… */;
```

When `isTransientError` is true, the session is retried with exponential backoff and the **session preserved** (`argv.resume = sessionId`). `retryableLastError` comes from `classifyRetryableError(lastMessage)` in [`src/tool-retry.lib.mjs`](../../../src/tool-retry.lib.mjs), which is the **shared** classifier used by every tool wrapper (claude, codex, gemini, opencode, qwen, agent).

A separate path handles **account usage limits**: `detectUsageLimit(lastMessage)` (in [`src/usage-limit.lib.mjs`](../../../src/usage-limit.lib.mjs)) parses a reset time and waits for it.

### 4.2 The gap

The 429 message fell through **both** nets:

- `isUsageLimitError("…Server is temporarily limiting requests (not your usage limit) · Rate limited")` → **`false`**. Correct! The message literally says _"not your usage limit"_, and there is **no reset time** to wait for. Routing it through the usage-limit path would be wrong.
- `classifyRetryableError(…)` → **`{ isRetryable: false, label: null }`**. There was no pattern for "temporarily limiting requests" / "rate limited" / 429.

With neither matching, `isTransientError` was `false` and the code fell through to the generic `commandFailed` branch → **exit code 1, no resume**. Verified empirically before the fix:

```
classifyRetryableError: {"isRetryable":false,"isCapacity":false,"label":null}
isUsageLimitError: false
```

### 4.3 Why this is the correct classification

This error is a **transient server-side throttle**, not an account quota:

- The response carried `"x-should-retry": "true"`.
- The stream's `rate_limit_event.isUsingOverage` was `false` and `status` was `"rejected"` (request rejected by a temporary throttle, not an exhausted plan).
- Anthropic's own docs say Claude Code retries this class internally (up to ~10× with backoff) **before** surfacing it; seeing it means the CLI's internal retries were exhausted — exactly when our harness should take over with a longer backoff + `--resume`.

It is therefore safe to retry **with the session preserved** after a backoff. It is **not** a model-capacity problem, so no model switch is warranted (`isCapacity: false`).

---

## 5. The fix

### 5.1 Core (cross-tool) — `src/tool-retry.lib.mjs`

A new branch in `classifyRetryableError`, placed alongside the other transient classes:

```js
if (lower.includes('temporarily limiting requests') || (lower.includes('rate limited') && lower.includes('not your usage limit')) || (lower.includes('rate_limit') && lower.includes('429'))) {
  return { message, isRetryable: true, isCapacity: false, label: 'Server rate limited (429)' };
}
```

Because this helper is shared, **every tool** (claude, codex, gemini, opencode, qwen, agent) now auto-resumes on this error — satisfying the "fix it everywhere" requirement with a single change. The matcher is deliberately narrow: it requires the throttle-specific wording (`temporarily limiting requests`, or `rate limited` together with the `not your usage limit` disclaimer), so genuine account usage limits ("usage limit reached", "weekly limit reached", "resets 5am") stay on the usage-limit reset-time path.

### 5.2 Robustness (Claude) — `src/claude.lib.mjs`

Even if the message wording changes upstream, the **structured** status code is captured directly from the `result` event:

```js
if (data.api_error_status === 429) {
  isRateLimitError = true;
  await log(`⚠️ Detected server-side rate limiting (429) … (will retry with --resume). request_id=${data.request_id || 'unknown'}`, { verbose: true });
}
```

`isRateLimitError` is OR-ed into `isTransientError` and given a `'Server rate limited (429)'` label in the retry messaging. The verbose log line (R5) makes future occurrences self-explanatory in the logs, including the `request_id` for upstream reports.

### 5.3 Tests — `tests/test-issue-1924-rate-limit-retry.mjs`

18 assertions covering: the exact issue message is retryable / correctly labelled / not a capacity error / not a usage limit; related 429 signatures; **real usage limits stay on the usage-limit path** (regression guard); pre-existing transient classes (overload/timeout/503/socket) still retry; and non-transient errors stay non-retryable.

---

## 6. External facts (web research)

The error string and behaviour are documented and reported upstream:

- **Anthropic — Error reference (Claude Code):** transient server failures (including temporary 429 throttles) are retried automatically — up to ~10 times with exponential backoff — _before_ the error is shown. Seeing the error means those internal retries were exhausted. Suggested checks: `/status` (confirm the active credential; a stray `ANTHROPIC_API_KEY` can route through a low-tier key) and https://status.claude.com.
- **anthropics/claude-code#53915** — _"[BUG] API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited"_ (OPEN). The exact error, reported upstream.
- **anthropics/claude-code#53922** — _"Parallel Claude Code sessions started right after 5-hour limit resets — first 3–4 work, the rest fail with 'Server is temporarily limiting requests (not your usage limit) · Rate limited'"_ (OPEN). A common trigger: bulk-spawning sessions right after a reset window.

Because the upstream defect is already tracked in those two issues, **no new upstream issue was filed** (R7) — filing a duplicate would add noise. The actionable fix for _this_ repository is the harness-side auto-resume above.

Sources:

- [Error reference — Claude Code Docs](https://code.claude.com/docs/en/errors)
- [anthropics/claude-code#53915](https://github.com/anthropics/claude-code/issues/53915)
- [anthropics/claude-code#53922](https://github.com/anthropics/claude-code/issues/53922)
- [Rate limits — Claude API Docs](https://platform.claude.com/docs/en/api/rate-limits)

---

## 7. Reproduction

Unit-level (deterministic), using the exact message from the log:

```bash
node -e "import('./src/tool-retry.lib.mjs').then(m => console.log(m.classifyRetryableError(
  'API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited')))"
# before fix: { isRetryable: false, isCapacity: false, label: null }
# after  fix: { isRetryable: true,  isCapacity: false, label: 'Server rate limited (429)' }
```

Full test suite for this issue:

```bash
node tests/test-issue-1924-rate-limit-retry.mjs
```

---

## 8. Existing components reused

- **`classifyRetryableError` / `isTransientError` / backoff machinery** (`tool-retry.lib.mjs`, `claude.lib.mjs`): the new 429 class plugs into the _existing_ exponential-backoff + `--resume` retry loop (`maxTransientErrorRetries`, `waitWithCountdown`, session preservation) — no new retry mechanism was needed.
- **`detectUsageLimit` / `isUsageLimitError`** (`usage-limit.lib.mjs`): deliberately left as the home for _account_ limits; the fix is careful not to poach those messages.
- **Verbose logging convention** (`log(…, { verbose: true })`): the new 429 diagnostic follows the same pattern as the existing 500/503/timeout detections.
