# Case Study — Issue #1935: 5-hour "session limit" (and weekly limit) misclassified as a transient 429 rate limit

- **Issue:** [#1935](https://github.com/link-assistant/hive-mind/issues/1935) — _"We have regression or bug"_
- **Type:** Bug (regression)
- **Pull request:** [#1936](https://github.com/link-assistant/hive-mind/pull/1936)
- **Author:** @konard
- **Status at analysis:** Open
- **Regression introduced by:** [#1924](https://github.com/link-assistant/hive-mind/pull/1924) (commit `24fb17ed`, _"fix(retry): auto-resume on server-side 429 rate-limit errors"_)

Raw issue data and the captured log are archived under [`data/`](./data/):

- [`data/issue-1935.json`](./data/issue-1935.json) — the issue as captured from GitHub.
- [`data/solution-draft-log-308dc201.log.gz`](./data/solution-draft-log-308dc201.log.gz) — the full ~196k-line `solve.mjs` log from the run that hit the limit (gzip; mirrored from the [gist](https://gist.githubusercontent.com/konard/afbe979c6f349153b1399f54758c2584/raw/d60b785e365cbd835c2f1781c1e6c2d0c0e58357/308dc201-adba-4fb4-8f0f-7a64145172a1.log)). `gunzip -c` to read.
- [`data/session-limit-429-excerpt.txt`](./data/session-limit-429-excerpt.txt) — the ~110-line slice of that log containing the `result` event (`api_error_status: 429`), the synthetic assistant message, and the wrong `Server rate limited (429) ... Retry 1/10 in 2 min` backoff.

---

## 1. Summary

A long-running `solve.mjs` session (588 turns, ~$70.62, repo `rumaster/vpn`) hit Claude's **5-hour session limit**. The Claude CLI surfaced it as a `result` event with `subtype: "success"`, `is_error: true`, **`api_error_status: 429`**, and:

```
You've hit your session limit · resets 4pm (UTC)
```

Instead of treating this as an **account usage limit** — calculating the exact reset time, posting a comment to the user, and waiting until `4pm (UTC)` — the harness treated it as a **transient server-side rate limit** and entered the short exponential-backoff retry loop:

```
⚠️ Detected server-side rate limiting (429) from Claude CLI (will retry with --resume). request_id=unknown
⚠️ Server rate limited (429) detected. Retry 1/10 in 2 min (session preserved)...
   Error: You've hit your session limit · resets 4pm (UTC)
...
⚠️ Server rate limited (429) detected. Retry 2/10 in 4 min (session preserved)...
   Error: You've hit your session limit · resets 4pm (UTC)
```

This is doubly wrong:

1. **The user is never told** when the limit resets. Session-limit (5-hour) and weekly-limit resets can be _hours_ or _days_ away — the user must get a comment immediately, with the reset time, so they understand the wait.
2. **The retries are futile and slow.** A 2/4/8/16-minute backoff loop cannot recover an account usage limit (the quota only frees at the reset moment), so the harness burns ~10 retries before giving up instead of simply waiting until `4pm` (and auto-resuming there when `--auto-continue-limit` is enabled).

---

## 2. Timeline / sequence of events (reconstructed from the log)

All references are line numbers in the uncompressed `data/solution-draft-log-308dc201.log`.

1. The Claude session runs for ~588 turns / ~$70.62 doing real work on PR `issue-388-...` in `rumaster/vpn`.
2. **L195092 / L195111** — A synthetic `assistant` message and the terminal `result` event both carry the text `You've hit your session limit · resets 4pm (UTC)`.
3. **L195107** — The `result` event reports **`api_error_status: 429`** (and `is_error: true`, `subtype: "success"`).
4. **L195176** — `⚠️ Detected error from Claude CLI (subtype: success)`.
5. **L195177** — `⚠️ Detected server-side rate limiting (429) from Claude CLI (will retry with --resume)`. ← **misclassification**
6. **L195180–195184** — `⚠️ Server rate limited (429) detected. Retry 1/10 in 2 min (session preserved)...` → waits 2 min → `🔄 Retrying now...`.
7. **L196077–196081** — The resumed session immediately hits the same limit again; `Retry 2/10 in 4 min`. The cycle repeats — each retry re-hits the limit because the quota does not free until `4pm`.

---

## 3. Requirements extracted from the issue

| #   | Requirement                                                                                                      | Addressed                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| R1  | Detect 5-hour **session limit** and **weekly limit** as usage limits, not transient rate limits                  | ✅ `claude.lib.mjs` 429 guard + `usage-limit.lib.mjs` phrasing                                                           |
| R2  | On those limits, **immediately post a comment** explaining the wait to the user                                  | ✅ unblocked existing `solve.mjs` usage-limit comment flow                                                               |
| R3  | Do **not** run the 2/10 transient-retry backoff; instead compute the exact reset time and wait until that moment | ✅ usage-limit path computes reset time + waits (auto-continue)                                                          |
| R4  | Uncover the blame history / which PR introduced the regression                                                   | ✅ §4 — PR #1924, commit `24fb17ed`                                                                                      |
| R5  | Compile all logs/data into `docs/case-studies/issue-1935`                                                        | ✅ [`data/`](./data/)                                                                                                    |
| R6  | Deep case-study analysis: timeline, requirements, root causes, solution plan, online facts, existing components  | ✅ this document                                                                                                         |
| R7  | If not enough data for root cause, add debug output / verbose mode                                               | ✅ data was sufficient; a verbose diagnostic line was retained on the path                                               |
| R8  | Apply the fix across the **entire codebase** (all affected places)                                               | ✅ §6 — the only structured-429 site is `claude.lib.mjs`; codex/others use the text classifier which was already correct |
| R9  | Add a reproducing automated test                                                                                 | ✅ `tests/test-issue-1935-session-limit-429.mjs` (15 assertions)                                                         |
| R10 | Report upstream if another project is at fault                                                                   | ✅ §8 — this is a Hive Mind regression, not an upstream bug; no upstream report needed                                   |

---

## 4. Blame history — which PR introduced the regression

The structured-429 short-circuit was added by **PR [#1924](https://github.com/link-assistant/hive-mind/pull/1924)** (commit `24fb17ed`, _"fix(retry): auto-resume on server-side 429 rate-limit errors"_):

```diff
+                  if (data.api_error_status === 429) {
+                    isRateLimitError = true;
+                    await log(`⚠️ Detected server-side rate limiting (429) from Claude CLI (will retry with --resume). request_id=${data.request_id || 'unknown'}`, { verbose: true });
+                  }
```

`git log -L 985,988:src/claude.lib.mjs` confirms this is the only commit to touch the block.

Ironically, #1924's own changeset stated the intent correctly: _"The matcher is narrow so genuine account usage limits stay on the usage-limit reset-time path."_ The **text matcher** in `classifyRetryableError` (`tool-retry.lib.mjs`) _is_ narrow — it only matches `"temporarily limiting requests"` / `"not your usage limit"` / `"rate_limit ... 429"`, and correctly leaves account limits alone. But the **structured `api_error_status === 429`** check added to `claude.lib.mjs` was **not** guarded by that narrowing: it fires for _every_ 429, and Claude's account usage limits (session/weekly) also report `api_error_status: 429`. So the structured path overrode the careful text classification and swept session/weekly limits into the transient-retry loop.

---

## 5. Root cause

`src/claude.lib.mjs` set `isRateLimitError = true` for **any** `result` event with `api_error_status === 429`, without checking whether the message was actually an account usage limit.

Claude reports **both** of these very differently-handled conditions with `api_error_status: 429`:

| Condition                               | Example message                                                                                    | Correct handling                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Transient server throttle (#1924)       | `API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited`         | Retry with `--resume` after a short backoff          |
| Account usage limit (this issue, #1935) | `You've hit your session limit · resets 4pm (UTC)` / `... weekly limit · resets Jan 15, 8am (UTC)` | Post a comment + wait until the **exact reset time** |

Because the harness flagged the account limit as `isRateLimitError`, the `isTransientError` branch (which runs _before_ the usage-limit detection at `detectUsageLimit(lastMessage)`) handled it first and looped on backoff — the usage-limit code was never reached.

---

## 6. The fix

**`src/claude.lib.mjs`** — guard the structured 429 so a real usage limit is never misclassified:

```js
if (data.api_error_status === 429 && !isUsageLimitError(lastMessage)) {
  isRateLimitError = true;
  await log(`⚠️ Detected server-side rate limiting (429) from Claude CLI (will retry with --resume). request_id=${data.request_id || 'unknown'}`, { verbose: true });
}
```

With `isRateLimitError` no longer set for an account limit, the flow falls through to the existing `if (commandFailed) { const limitInfo = detectUsageLimit(lastMessage); ... }` path, which sets `limitReached`, `limitResetTime`, `limitTimezone`. `solve.mjs` then **immediately posts** a usage-limit comment with the formatted reset time and, when `--auto-continue-limit` is enabled, **waits until the exact reset moment** (`calculateWaitTime` / `autoContinueWhenLimitResets`) and auto-resumes — exactly the behaviour the issue asks for.

**`src/usage-limit.lib.mjs`** — make detection robust to Claude's exact phrasing. The `"resets 4pm"` regex already matched, but as a backstop the `"hit your session limit"` / `"hit your weekly limit"` phrasings are now explicit patterns, so the account limit is flagged even if a future wording change drops the parseable reset time:

```js
'hit your session limit', // Claude 5-hour limit
'hit your weekly limit',  // Claude weekly limit
```

**Codebase coverage (R8):** `grep -rn "api_error_status" src/` shows `claude.lib.mjs` is the **only** site that special-cases a structured 429. Every other tool wrapper (codex, gemini, opencode, qwen, agent) routes errors through the shared `classifyRetryableError` text classifier, which was already narrow and never matched account usage limits — so no change is needed there. The shared `isUsageLimitError` / `detectUsageLimit` helpers handle every tool's usage limits uniformly.

---

## 7. Tests

`tests/test-issue-1935-session-limit-429.mjs` (15 assertions) covers:

- The exact session-limit message is detected as a usage limit, is **not** transient-retryable, and yields reset time `4:00 PM` + timezone `UTC`.
- The weekly-limit variant (`... weekly limit · resets Jan 15, 8am (UTC)`) is detected with its date.
- The `"hit your <window> limit"` backstop (no parseable reset time) still flags a usage limit.
- **Regression guard the other way:** the genuine transient 429 from #1924 (`... not your usage limit ...`) is **not** a usage limit and **stays** transient-retryable.
- A simulation of the exact `claude.lib.mjs` decision: `429 && !isUsageLimitError(msg)` is `false` for session/weekly limits and `true` for the transient throttle.

Existing suites stay green: `tests/test-issue-1924-rate-limit-retry.mjs` (18) and `tests/test-usage-limit.mjs` (78).

---

## 8. Upstream / related projects

This is a **Hive Mind regression**, not an upstream bug — the Claude CLI behaves as documented: account usage limits and transient throttles both use HTTP 429, and the message text is the discriminator. No upstream issue is warranted. Anthropic's own [error reference](https://code.claude.com/docs/en/errors) documents 429 as a shared status for rate/usage limits, which is exactly why the harness must inspect the message text rather than the status code alone.

External references on Claude's session vs. weekly limits (both reset-time-based, both surfacing as 429):

- Anthropic — [Claude Code error reference](https://code.claude.com/docs/en/errors)
- [Claude Code Rate Limits Explained (SitePoint, 2026)](https://www.sitepoint.com/claude-code-rate-limits-explained/) — session limits reset on a rolling 5-hour window; weekly limits reset weekly and form a hard ceiling.

---

## 9. Lessons

- **Status codes are not error classes.** HTTP 429 is overloaded by Anthropic for both a transient throttle _and_ an account usage limit. Any branch keyed purely on `api_error_status === 429` must additionally inspect the message text.
- **A "narrow matcher" claim must be enforced at every entry point.** #1924 narrowed the _text_ classifier but added a _structured_ check that bypassed it. When two code paths can classify the same event, they must agree.
- **Account-limit handling is user-facing.** Silently looping on backoff hides a multi-hour wait from the user; the harness must post the reset time immediately.
