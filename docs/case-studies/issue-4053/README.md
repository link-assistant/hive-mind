# Case study: temporary authentication failures and `/limits` 503 (issue #4053)

Issue: [#4053](https://github.com/link-assistant/hive-mind/issues/4053) "Some errors should become retry-able and be handled better".
Implementation: [PR #4054](https://github.com/link-assistant/hive-mind/pull/4054).
Research date: 2026-11-13 UTC. Evidence: [`data/`](data/).

## Summary

During an Anthropic authentication incident, a `/solve` run stopped on the **first** occurrence of

```
CLAUDE: Authentication expired — re-login required
Provider said: Failed to authenticate. API Error: 403 Attention Required! | Cloudflare
Error code: authentication_failed
```

A minute later `claude hi -p --model haiku` worked again, with no re-login. The error was a temporary Cloudflare edge block, not an expired login. At the same time `/limits` printed `Claude Max subscription (active)` and `Failed to fetch usage from API: 503`. The "(active)" was unverified, and the 503 read like a permanent failure.

## Requirements

| #   | Requirement (issue text)                                                                                                     | Where it is addressed                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| R1  | Do not fail on the first try on this error; retry it                                                                         | [S1](#s1-re-check-unconfirmed-authentication-failures-by-retrying) |
| R2  | Retry even longer if status.claude.com reports issues                                                                        | [S2](#s2-consult-the-provider-status-page)                         |
| R3  | `/limits` with HTTP 503: say limits for Claude/Codex/… are temporarily unavailable and will be retried on the next `/limits` | [S3](#s3-limits-temporary-failures)                                |
| R4  | Check online and on GitHub whether the subscription expiry date can be obtained                                              | [Expiry research](#expiry-research)                                |
| R5  | Drop the misleading `(active)` unless an exact end date is known (as with Codex)                                             | [S4](#s4-no-bare-active)                                           |
| R6  | Collect logs and data in `docs/case-studies/issue-4053`; timeline, requirements, root causes, solutions, libraries, facts    | This file, [`data/`](data/)                                        |
| R7  | Add debug/verbose output where the data is insufficient                                                                      | [Debug output](#debug-output)                                      |
| R8  | Report issues to other projects with a reproduction, workaround and fix suggestion                                           | [Upstream](#upstream)                                              |
| R9  | Apply the fix to the entire codebase wherever the same problem exists                                                        | [S5](#s5-the-same-defect-elsewhere-in-the-codebase)                |

## Timeline (UTC, 2026-11-13)

| When     | Event                                                                                                                                                                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 09:57:23 | [anthropics/claude-code#109508](https://github.com/anthropics/claude-code/issues/109508) "[BUG] Claude down?" is opened ([data](data/upstream/claude-code-109508.json)).                                                                                         |
| 09:58:58 | status.claude.com opens the major incident "Elevated errors on claude.ai, Claude Code, and platform.claude.com": "We are investigating an issue with users authenticating to Claude.ai and Claude Code." ([data](data/status-claude-incidents-2026-11-13.json)). |
| ~10:00   | A hive-mind `/solve` run gets the Cloudflare 403 as `authentication_failed`, prints the `SUBSCRIPTION/ACCESS UNAVAILABLE` report and stops. Uncommitted work is auto-committed.                                                                                  |
| ~10:00   | `/limits`: `Claude Max subscription (active)` / `Failed to fetch usage from API: 503`.                                                                                                                                                                           |
| 10:30:42 | [#109516](https://github.com/anthropics/claude-code/issues/109516) "Mid-session 403 Cloudflare 'Attention Required' auth error burns tokens".                                                                                                                    |
| 10:34:11 | [#109517](https://github.com/anthropics/claude-code/issues/109517) "Long-running sessions lose authentication mid-task and require the user to sign in again".                                                                                                   |
| 10:37:02 | Issue #4053 is opened; `claude hi -p --model haiku` already answers on the same server with the same credentials.                                                                                                                                                |
| 10:39:32 | PR #4054 is opened.                                                                                                                                                                                                                                              |
| 11:05:23 | status.claude.com: "A fix has been deployed for the issue affecting Claude services and we are monitoring for recovery." ([data](data/status-claude-incidents-2026-11-13T11-08-52-567Z.json)).                                                                   |
| 11:07:04 | [#109521](https://github.com/anthropics/claude-code/issues/109521) "API Error: 403 Attention Required! Cloudflare block prompts /login" is opened; it is the precise upstream report of root cause 1.                                                            |
| 11:08:52 | Status snapshots for both providers are saved ([claude](data/status-claude-summary-2026-11-13T11-08-52-567Z.json), [openai](data/status-codex-summary-2026-11-13T11-08-52-567Z.json)).                                                                           |

## Root causes

### RC1. Claude Code reports a Cloudflare edge block as `authentication_failed`

[`experiments/issue-4053-probe-cloudflare-403.mjs`](../../../experiments/issue-4053-probe-cloudflare-403.mjs) points the real Claude Code 2.1.323 at a local server. The server answers like Cloudflare does: HTTP 403, `text/html`, `<title>Attention Required! | Cloudflare</title>`, with and without the documented `cf-mitigated: challenge` header. The CLI sends **one** request, does not retry, and emits ([recorded stream](data/probe/claude-2.1.323-cloudflare-403-stream.jsonl), [summary](data/probe/claude-2.1.323-cloudflare-403-summary.json)):

```json
{"type":"assistant","error":"authentication_failed", "...": "Failed to authenticate. API Error: 403 Attention Required! | Cloudflare"}
{"type":"result","subtype":"success","is_error":true,"api_error_status":403,"result":"Failed to authenticate. API Error: 403 Attention Required! | Cloudflare"}
```

So Claude Code formats **every** generic 401/403 as "Failed to authenticate. API Error: <status> <title>" with the machine code `authentication_failed`. The HTML `<title>` of an edge page becomes the "error message". The machine code alone cannot tell an expired login from an edge block.

### RC2. hive-mind treated the generic code as proof of an expired login

`detectSubscriptionError()` (`src/subscription-error.lib.mjs`) mapped the code `authentication_failed` straight to `kind: 'login_required'` ("Authentication expired — re-login required"). `executeClaudeCommand()` then took the terminal access-error path. That path has no retry, and it prints `SUBSCRIPTION_BLOCKED_MARKER`, which also makes `/hive` stop all workers. The same "first 401 stops the run" rule existed for Codex (`authError` in `src/codex.lib.mjs`) and for Claude CLI validation (`src/claude.connection.lib.mjs`). Qwen classified any "403 … Cloudflare" text as an auth error.

### RC3. `/limits` reported a provider outage as a raw failure, and cached it

`getClaudeUsageLimits()` and `getCodexUsageLimits()` returned `Failed to fetch usage from API: 503` for every non-2xx answer. The text did not say that 5xx/408/425, timeouts and network errors describe the provider's state, not the account's. The Router path (`src/limits-router.lib.mjs`) cached a failed 503 response like any other result, so the next `/limits` did not retry.

### RC4. `(active)` came from a field that does not mean "verified now"

The heading was `Claude Max subscription (active)`. Here `active` is `organization.subscription_status` from `/api/oauth/profile` (or the stored metadata). It does not mean the plan was valid at that moment: the usage endpoint was failing right next to it. For Codex, an exact end date is known from the `chatgpt_subscription_active_until` JWT claim; for Claude it is not (see [Expiry research](#expiry-research)).

## Solutions

### S1. Re-check unconfirmed authentication failures by retrying

- **Two kinds of access error** (`src/subscription-error.lib.mjs`). Explicit wordings stay **terminal**: "OAuth token revoked", "login expired", billing, disabled organization, `/login` with a reason. A generic `authentication_failed`/`permission_error` without such wording, or any response that looks like an edge/CDN page, is **`verifiable`**. `isEdgeBlockedResponse()` matches "Attention Required! | Cloudflare", "Just a moment…", `cf-mitigated`, `cf-ray` with a 403 and similar pages.
- **Retry policy** (`src/auth-failure-retry.lib.mjs`, new). `createAuthFailureRetry()` retries a verifiable error with the session preserved (`--resume`). It waits 1, 2, 4 … minutes (up to 10 minutes) and allows `HIVE_MIND_MAX_AUTH_FAILURE_RETRIES` attempts (default 3). The retries share the 12 h transient-retry budget of #2169/#3831. Provider progress resets the count, detected through the new `budget.recoveries` counter.
- **Detection line.** While an error is unconfirmed, the log says `⚠️ Unconfirmed access error — … it will be re-checked by retrying before the run stops`, **not** the `/hive` stop marker. Only a confirmed failure prints the marker and the report.
- **Report.** The report and the Telegram completion message now state how often the error was re-checked:

  ```
     Retried: 3 time(s) over 7m; the provider kept returning the same error.
     Status page: status.claude.com: Partial System Outage — Elevated errors on claude.ai, Claude Code, … (major, investigating)
  ```

- **Tests and settings.** Configuration lives in `src/config.lib.mjs`: `HIVE_MIND_MAX_AUTH_FAILURE_RETRIES`, `HIVE_MIND_INITIAL_AUTH_FAILURE_RETRY_DELAY_MS` and `HIVE_MIND_MAX_AUTH_FAILURE_RETRY_DELAY_MS`. Tests: [`tests/issue-4053-retryable-auth-and-limits.test.mjs`](../../../tests/issue-4053-retryable-auth-and-limits.test.mjs), and [`tests/issue-4053-claude-auth-retry-replay.test.mjs`](../../../tests/issue-4053-claude-auth-retry-replay.test.mjs), which replays the recorded 2.1.323 stream through `executeClaudeCommand` (3 calls, then confirmed; no stop marker). The replay test fails on `main` (1 call).

### S2. Consult the provider status page

`src/provider-status.lib.mjs` (new) reads the Atlassian Statuspage v2 JSON API, which status.claude.com and status.openai.com both publish (`GET <page>/api/v2/summary.json`).

- **Extended retries.** While a relevant incident or degraded component is reported, the auth retry policy allows the full transient retry count (`HIVE_MIND_MAX_TRANSIENT_ERROR_RETRIES`) instead of 3.
- **Relevance.** Incidents are matched to the tool by their components, or by their wording when they list no components. An OpenAI "Microsoft 365 connector" incident therefore does not extend Codex auth retries.
- **Never fatal.** The lookup has a 10 s timeout and a 60 s cache, and never throws. It can be disabled with `HIVE_MIND_PROVIDER_STATUS_CHECK=false`, and the URLs are configurable (`HIVE_MIND_CLAUDE_STATUS_URL`, `HIVE_MIND_CODEX_STATUS_URL`).
- **Tooling.** [`experiments/issue-4053-status-probe.mjs`](../../../experiments/issue-4053-status-probe.mjs) prints the live summary and saves snapshots. [`examples/auth-failure-retry-demo.mjs`](../../../examples/auth-failure-retry-demo.mjs) shows the decisions for a given provider message.

### S3. `/limits` temporary failures

`src/limits-unavailable.lib.mjs` (new) gives HTTP 5xx/408/425, timeouts and network errors `failureKind: 'temporary'` and a localized message (en/ru/zh/hi):

```
Claude limits are temporarily unavailable (HTTP 503 Service Unavailable). They will be retried on the next /limits call.
```

Temporary failures are not cached, neither by `getCachedUsageLimits()` nor by the Router limits cache. The next `/limits` call therefore queries the provider again. The Telegram `/limits` view and the console view both use the new text.

### S4. No bare `(active)`

`displayableSubscriptionStatus()` hides `active`/`trialing`. The heading now shows only `Claude Max subscription`, followed by an exact end or trial-end date when the provider publishes one (as for Codex: `ChatGPT Pro subscription`, `Subscription ends …`). Explicitly non-active statuses such as `past_due`, `canceled` or `inactive` are still shown, because they are warnings.

### S5. The same defect elsewhere in the codebase

| Place                                             | Before                                            | After                                                                  |
| ------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/claude.lib.mjs` (stream + result events)     | marker on first `authentication_failed`, stop     | unconfirmed line, re-check by retrying (via `claude.access-error.lib`) |
| `src/claude.access-error.lib.mjs` (#3759 path)    | marker for a recovered bare 403                   | same re-check                                                          |
| `src/claude.connection.lib.mjs` (validation)      | `Failed to authenticate` → validation fails       | re-checked with the same policy                                        |
| `src/codex.lib.mjs`                               | first bare 401 → throw                            | re-checked; an edge page is not an auth error                          |
| `src/qwen.lib.mjs`                                | "403 … Cloudflare" = auth error                   | edge pages go to the transient retry path                              |
| `src/tool-retry.lib.mjs` (all tools)              | edge page not retryable                           | `Provider edge/CDN block (HTTP 403 challenge page)` is retryable       |
| `src/limits.lib.mjs`, `src/limits-router.lib.mjs` | raw `Failed to fetch usage from API: 503`, cached | temporary, localized, not cached                                       |

## Expiry research

| Provider | Source                                                                                    | Exact end date?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex    | `id_token` JWT, claim `https://api.openai.com/auth` → `chatgpt_subscription_active_until` | **Yes**, already used for `Subscription ends …`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Claude   | `GET https://api.anthropic.com/api/oauth/profile` (OAuth token)                           | **No** for paid plans. It returns `subscription_status`, `subscription_created_at`, `has_claude_max`/`has_claude_pro`, and `claude_code_trial_ends_at` for trials only. Claude Code's own OAuth client and profile code ([OAuth client](https://claudecode-plum.vercel.app/docs/claude-src/file/services/oauth/client.ts), [a profile port](https://docs.rs/crate/ai-agent/0.88.0/source/src/services/oauth/profile.rs)) read no end/renewal field, and Anthropic's help center only describes the billing date in the claude.ai settings UI ([support](https://support.claude.com/en/articles/8325618)). |
| Claude   | `~/.claude/.credentials.json`                                                             | No; `subscriptionType` and the OAuth token `expiresAt`. The latter is the access-token lifetime (hours), not the plan end.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Upstream reports about wrong plan display after gifts or cancellations confirm this. Examples are [anthropics/claude-code#43257](https://github.com/anthropics/claude-code/issues/43257) and the reports collected on claudeissues.com: the plan end date lives only in claude.ai billing. So hive-mind shows no Claude end date. It already reads `organization.subscription_ends_at` in case Anthropic adds it. With `--verbose`, `/limits` now logs the **names** (never values) of all subscription/billing/trial/period/renewal fields the profile returns. When Anthropic adds such a field, the log will show it.

## Debug output

- `[provider-status] GET <url> → indicator=… incidents=… degraded=…` (verbose) for every status-page lookup.
- Each retry logs `evidence=edge_block|transient_wording`, the code and the HTTP status. `Provider said:` (verbose) shows the raw text.
- `[VERBOSE] /limits Claude subscription fields: …` lists the profile field names (see above).
- `usage-limits-cache` logs (verbose) when a temporary failure is deliberately not cached.

## Upstream

- [anthropics/claude-code#109521 comment](https://github.com/anthropics/claude-code/issues/109521#issuecomment-6851160424) has the local reproduction (a 15-line Node server and a dummy API key), the workaround for wrappers, and the suggested fix. The fix: classify `text/html` / `cf-mitigated` / `server: cloudflare` 401/403 responses as edge/network errors, retry them like 5xx, never say "Please run /login" for them, and include the `cf-ray`. Saved in [`data/upstream/claude-code-109521-comment.md`](data/upstream/claude-code-109521-comment.md).
- Related upstream reports, saved in [`data/upstream/`](data/upstream/): [#109508](https://github.com/anthropics/claude-code/issues/109508), [#109516](https://github.com/anthropics/claude-code/issues/109516), [#109517](https://github.com/anthropics/claude-code/issues/109517), [#108761](https://github.com/anthropics/claude-code/issues/108761) ("Request blocked before it reached Anthropic's API (HTTP 403)"; resending the same message immediately succeeded) and [#66844](https://github.com/anthropics/claude-code/issues/66844) (OAuth refresh blocked by Cloudflare).

## Existing components and libraries considered

| Need                           | Candidates                                                                                                                                                                                                               | Decision                                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status page                    | npm [`statuspage.io`](https://security.snyk.io/package/npm/statuspage.io), [`statuspage-api`](https://www.npmjs.com/package/statuspage-api), [`node-statuspage`](https://classic.yarnpkg.com/en/package/node-statuspage) | Not used. They target the authenticated _management_ API, while the public `summary.json` is one `fetch` and a 20-line parser. A dependency would add supply-chain risk for no gain.                          |
| Retry/backoff                  | `p-retry`, `async-retry`                                                                                                                                                                                                 | Not used. hive-mind already has a tested framework (`createTransientRetryBudget`, `getRetryDelayMs`, `waitWithCountdown`, session resume, progress-based reset), and auth retries must share its 12 h budget. |
| Cloudflare challenge detection | Cloudflare docs: [detect a Challenge Page response](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/) (`cf-mitigated: challenge`)                                | Used as the main signal in the upstream fix suggestion. hive-mind only sees the CLI's text, so it matches the page title and the Cloudflare markers in the text.                                              |

## Online facts

- Cloudflare documents that challenge responses carry `cf-mitigated: challenge` and recommends checking it ([docs](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/)). Managed challenges are typically 403/503 responses with HTML bodies, and they are often temporary ([dev.to](https://dev.to/bshahin/managed-vs-interactive-cloudflare-challenge-how-to-tell-and-why-it-changes-your-fix-3in0)).
- The Statuspage public API (`/api/v2/summary.json`, `/api/v2/incidents.json`) is the same on every Atlassian Statuspage page, including status.claude.com and status.openai.com ([example](https://status.newrelic.com/api)).
- On 2026-11-13 status.claude.com reported the authentication incident from 09:58:58 UTC, a fix deployed at 11:05:23 UTC, and 5 upstream Claude Code issues filed within 70 minutes. All of them describe a mid-session 403 or "Please run /login" that went away without re-login.
