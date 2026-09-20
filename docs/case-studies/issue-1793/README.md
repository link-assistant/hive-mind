# Case Study — Issue #1793: Display subscription end date/time for all tools

- Issue: https://github.com/link-assistant/hive-mind/issues/1793
- PR: https://github.com/link-assistant/hive-mind/pull/1794
- Branch: `issue-1793-b8b0656b942f`

## 1. Problem statement (from the issue)

> Please find a way, and if possible to get from API or claude CLI the date and time, at which subscription will end. The same for codex and other tools.
>
> For all tools where it possible to get the end time and date of subscription add such feature, and display it in `/limits` command (if data is available).
>
> So we will know exactly how long it will last. Double check the internet, online docs and so on. Double check all places. For codex and other open-source tools you can also read the code if docs and so on have no data, and reproduce the feature if CLI/API does not give it directly.

## 2. Requirements

1. Identify every supported coding-assistant tool whose subscription end date/time
   can be obtained programmatically (API, CLI, or on-disk credentials).
2. For tools where the data is available, surface a “Subscription ends …” line in
   the existing `/limits` output (and in the Telegram snapshot helpers that share
   the same code path).
3. For tools where the data is **not** available, do nothing: the issue is
   explicit that the new line should appear **only when the data is available**.
   The /limits output must not gain a noisy “N/A” row for every unsupported tool.
4. Treat the work as a single PR: research + case study + implementation + tests.

## 3. Supported tools inventory (this repo)

`/limits` only knows about two coding tools today (`limits.lib.mjs`):

| Tool   | API library function   | Auth source                   |
| ------ | ---------------------- | ----------------------------- |
| Claude | `getClaudeUsageLimits` | `~/.claude/.credentials.json` |
| Codex  | `getCodexUsageLimits`  | `~/.codex/auth.json`          |
| GitHub | `getGitHubRateLimits`  | `gh` CLI                      |

The bot also recognises `gemini`, `qwen`, `agent`, and `opencode` as runtimes
(`pickLimitsToolKey` in `telegram-show-limits.lib.mjs`), but they route to the
`claude` limits view because the open-source Gemini/Qwen CLIs do **not** expose
a Cloud subscription end date — they are either free-tier (Code Assist) or
API-key based (no subscription concept). See §4.3 below.

GitHub is a rate-limited HTTP API, not a subscription, so the “subscription
ends” concept does not apply to it.

## 4. Research — where subscription end date lives per tool

### 4.1 Claude (Anthropic Claude Code)

**Local credentials (`~/.claude/.credentials.json`)**

```jsonc
{
  "claudeAiOauth": {
    "accessToken":  "sk-ant-oat01-…",
    "refreshToken": "sk-ant-ort01-…",
    "expiresAt":    1778624953828,        // ms epoch — OAuth access-token expiry, NOT plan expiry
    "scopes":       ["user:file_upload", "user:inference", …],
    "subscriptionType": "max",
    "rateLimitTier":    "default_claude_max_20x"
  }
}
```

`expiresAt` is the OAuth **access-token** expiry (≈ 1h, refreshed silently by
the CLI), not the subscription period. It is therefore **not** the value the
issue is asking for.

**OAuth REST API**

The Anthropic OAuth API used by `claude-code` exposes (probed live for this
case study):

| Endpoint                      | Status | Useful for issue 1793                                                               |
| ----------------------------- | ------ | ----------------------------------------------------------------------------------- |
| `GET /api/oauth/usage`        | 200    | usage windows + reset times (already wired into `/limits`)                          |
| `GET /api/oauth/profile`      | 200    | `organization.subscription_status`, `subscription_created_at`, `has_claude_max/pro` |
| `GET /api/oauth/account`      | 200    | extended org info: same data + `internal_tier_override_expires_at`                  |
| `GET /api/oauth/subscription` | 404    | not exposed                                                                         |
| `GET /api/oauth/billing*`     | 404    | not exposed                                                                         |
| `GET /api/oauth/renewal`      | 404    | not exposed                                                                         |

Sample (sanitised) profile response captured for the case study:

```jsonc
{
  "organization": {
    "uuid": "684cb0ba-…",
    "billing_type": "stripe_subscription",
    "rate_limit_tier": "default_claude_max_20x",
    "subscription_status": "active",
    "subscription_created_at": "2025-10-09T02:30:53.133490Z",
    "claude_code_trial_ends_at": null,
    "claude_code_trial_duration_days": null,
  },
}
```

The OAuth API exposes **`subscription_status` + `subscription_created_at`** and
the `claude_code_trial_ends_at` field — but it does **not** publish the next
renewal/end date for a regular (non-trial) Stripe subscription. We confirmed
this both by probing every plausible path (`subscription`,
`billing/subscription`, `renewal`, …) and by reading the official Claude Code
docs at https://docs.anthropic.com (no mention of a subscription-end endpoint).

**Conclusions for Claude**

- For **trial subscriptions** the API publishes `claude_code_trial_ends_at`.
  We can display that as “Trial ends …”.
- For **paid subscriptions** the OAuth API does not currently publish the end
  date. The closest fields we can surface are `subscription_status` (e.g.
  _active_) and `subscription_created_at`. Trying to “reproduce” a non-existent
  end-date by extrapolating from the creation date would be misleading, so we
  do not.

### 4.2 Codex (OpenAI ChatGPT-authenticated Codex CLI)

**Local credentials (`~/.codex/auth.json`)**

The Codex CLI stores an OIDC `id_token` whose JWT payload contains a verifiable
subscription window:

```jsonc
"https://api.openai.com/auth": {
  "chatgpt_plan_type": "pro",
  "chatgpt_subscription_active_start":   "2026-04-13T14:45:32+00:00",
  "chatgpt_subscription_active_until":   "2026-05-13T14:45:32+00:00",
  "chatgpt_subscription_last_checked":   "2026-04-15T04:56:24.221286+00:00"
}
```

`chatgpt_subscription_active_until` is exactly the value the issue asks for.

We reuse the JWT-decoding helper already present in `limits.lib.mjs`
(`decodeJwtPayload`) — no new HTTP call is required, so this works even when
the ChatGPT backend is unreachable.

The Codex `wham/usage` HTTP API does **not** contain a subscription-end field
(verified live for this case study — see `data/codex-wham-usage.sample.json`).
So the JWT claim is the only viable source.

### 4.3 Gemini / Qwen / Agent / OpenCode

| Tool       | Auth model                | Subscription end available?  |
| ---------- | ------------------------- | ---------------------------- |
| Gemini CLI | API key / free-tier OAuth | No (no subscription concept) |
| Qwen Code  | API key / free OAuth      | No                           |
| OpenCode   | API key                   | No                           |
| Agent CLI  | API key                   | No                           |

We searched the upstream repos and docs (e.g.
`google-gemini/gemini-cli`, `QwenLM/qwen-code`,
`sst/opencode`) and none of them expose a subscription end date because they
are key-based or use a free tier without a renewal period. We therefore do not
add a subscription-end line for these tools.

If that ever changes (e.g. Gemini-Code-Assist Pro grows a subscription-end
endpoint), the new field can be wired into the same display path with a few
lines — the renderer is data-driven.

## 5. Solution design

### 5.1 Data acquisition

- `getClaudeSubscriptionInfo({ verbose, credentialsPath })` in
  `limits.lib.mjs`:
  - Reads `~/.claude/.credentials.json` for `subscriptionType` and the access
    token (no extra dependencies). Returns plan label + access-token expiry
    (informational).
  - Calls `GET /api/oauth/profile` and returns `subscription_status`,
    `subscription_created_at`, and `claude_code_trial_ends_at` when
    available.
  - Cached for the same TTL as `/limits` (20 minutes) so we don’t hit the
    Usage API rate limit. Wrapped in `getCachedClaudeSubscription()`.

- `getCodexSubscriptionInfo({ verbose, authPath })` in `limits.lib.mjs`:
  - Reads `~/.codex/auth.json`, decodes `id_token`, extracts
    `chatgpt_subscription_active_start/_until/_last_checked` and
    `chatgpt_plan_type`. No network call needed.
  - Cached via `getCachedCodexSubscription()`.

### 5.2 Display

Inside the existing fenced code block emitted by `formatUsageMessage` /
`formatCodexLimitsSection`, append a single line **only when data is
available**:

```
Claude limits
…
Subscription ends Dec 3, 6:59pm UTC (in 18d 4h)

Codex limits
Plan: pro
…
Subscription ends May 13, 2:45pm UTC (in 1d 18h)
```

- Reuses the existing `formatLocalizedResetTime` / `formatLocalizedRelativeTime`
  helpers, so localisation, UTC formatting, and the “Resets in (…)” pattern
  are consistent with the rest of the block.
- When the field is missing, we render nothing — no noisy `N/A` row.
- When only `subscription_status` is known (paid Claude account), we render a
  short status line — `Subscription: active` — but we do **not** invent a
  date.
- Trial Claude accounts get `Trial ends …` because the field is reliable.

### 5.3 i18n

New keys:

- `limits.subscription_ends`
- `limits.trial_ends`
- `limits.subscription_status`

added to `limits-i18n.lib.mjs` and to the four `.lino` locale files (`en`,
`ru`, `zh`, `hi`).

### 5.4 Tests

`tests/limits-display.test.mjs` already exercises `formatUsageMessage` and
`formatCodexLimitsSection`. We add focused unit tests that:

1. Decode a sample Codex JWT and assert the subscription-end line is rendered
   with the right timestamp and the relative remainder.
2. Render the same formatter with `subscription_ends_at: null` and assert the
   line is **not** present.
3. Decode a Claude profile sample where `claude_code_trial_ends_at` is set
   and assert “Trial ends …” is rendered.
4. Decode a Claude profile sample where only `subscription_status` is set and
   assert “Subscription: active” is rendered.

## 6. Alternatives considered

- **Hard-code Stripe billing intervals.** Rejected — Anthropic plans can be
  monthly or annual, can be paused, and Stripe is not the only billing
  provider (enterprise contracts exist). Extrapolating from
  `subscription_created_at` would lie to the user.
- **Use `expiresAt` from `~/.claude/.credentials.json` directly.** Rejected —
  it’s the OAuth token, not the plan. (It also rolls every refresh.)
- **Call Anthropic /v1 billing endpoints.** Those endpoints require an API key
  with billing scope, not the OAuth token Claude Code uses. Out of scope for
  `/limits`.
- **Scrape the ChatGPT account page for renewal dates.** Rejected — fragile,
  unrelated to a CLI’s persisted state, and the JWT claim already gives us the
  data.

## 7. Files touched

- `src/limits.lib.mjs` — new helpers + integrated rendering
- `src/limits-i18n.lib.mjs` — new keys + English fallbacks
- `src/locales/en.lino`, `ru.lino`, `zh.lino`, `hi.lino` — translations
- `tests/limits-display.test.mjs` — new tests
- `docs/case-studies/issue-1793/` — this case study
- `.changeset/issue-1793-subscription-end-date.md` — version bump

## 8. References

- Anthropic Claude Code docs (https://docs.anthropic.com/en/docs/claude-code/)
- OpenAI Codex CLI source (`openai/codex` GitHub — JWT shape confirmed)
- Issue #594 — original `--show-limits` work (sets the display style we follow)
- Issue #1074 — Claude Usage API rate limiting (drives 20-minute cache TTL)
- Issue #1242 — progress-bar threshold markers (sets the visual style)
