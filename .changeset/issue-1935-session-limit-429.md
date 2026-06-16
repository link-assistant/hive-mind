---
'@link-assistant/hive-mind': patch
---

fix(retry): treat 5-hour "session limit" and "weekly limit" 429s as account usage limits, not transient throttles (#1935)

A long-running solve session (588 turns, ~$70.62) hit Claude's **5-hour session
limit**. The Claude CLI surfaced it as a `result` event with `is_error: true`,
`api_error_status: 429`, and:

```
You've hit your session limit · resets 4pm (UTC)
```

Instead of being treated as an **account usage limit** (post a comment with the
reset time + wait until the exact reset moment), it was put through the transient
exponential-backoff retry loop:

```
⚠️ Server rate limited (429) detected. Retry 1/10 in 2 min (session preserved)...
   Error: You've hit your session limit · resets 4pm (UTC)
⚠️ Server rate limited (429) detected. Retry 2/10 in 4 min (session preserved)...
```

Each retry re-hit the same limit because the quota only frees at the reset time —
so the harness burned ~10 futile retries and never told the user when the limit
resets.

Root cause (regression from #1924): `src/claude.lib.mjs` set
`isRateLimitError = true` for **every** structured `api_error_status === 429`,
without checking whether the message was an account usage limit. Claude reports
**both** a transient throttle ("...not your usage limit...") and account
session/weekly limits with `api_error_status: 429`, so the unconditional check
swept genuine usage limits into the transient-retry path — ahead of the
`detectUsageLimit()` reset-time wait, which was therefore never reached.

Fix: `src/claude.lib.mjs` now only flags a structured 429 as a transient rate
limit when the message is **not** a usage limit
(`api_error_status === 429 && !isUsageLimitError(lastMessage)`), so session/weekly
limits fall through to the usage-limit handler that immediately posts a comment
and waits until the exact reset time (auto-resuming there with
`--auto-continue-limit`). `src/usage-limit.lib.mjs` additionally recognises the
"hit your session limit" / "hit your weekly limit" phrasing as a backstop (the
reset-time regex already matched "resets 4pm").

Added `tests/test-issue-1935-session-limit-429.mjs` (15 assertions) and a full
case study with timeline, blame history (PR #1924), root-cause analysis, and the
captured logs under `docs/case-studies/issue-1935`.
