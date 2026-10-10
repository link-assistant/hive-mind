# Issue #2771: Online research on context-length and speed-tier pricing

Research date: 2026-10-08. All prices are USD per 1M tokens (MTok) unless noted.

Confidence levels:

- **High**: an official vendor doc or source code says it verbatim.
- **Medium**: an official source implies it, or a third party corroborates it.
- **Low**: inference or unverified.

"Derived" means my own arithmetic or inference from the cited facts.

---

## Executive summary for the cost audit

| Tool / vendor           | Context-length price cliff                                                                        | Default auto-compaction point                                              | Does the default compaction cross the cliff?        | Speed-tier multiplier                                                    | Default speed tier                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Claude Code (Anthropic) | None for 4.6+ models, except Haiku 5.5 (5x above 100K input)                                      | ~967K on native-1M models                                                  | Only for Haiku 5.5                                  | Fast mode 2x API price; on subscriptions it draws usage credits          | Off. Disabled by default for Team/Enterprise orgs.                                 |
| Codex CLI (OpenAI)      | 272K input tokens: 2x input/cache, 1.5x output                                                    | 90% of the model context window                                            | Yes, if the catalog window is above ~302K (derived) | Fast: 2.5x included limits, 2x credits, 2x API. Ultrafast: 8x / 6x / 6x. | **Fast by default on eligible Enterprise/Business-like ChatGPT plans** (PR #19053) |
| Gemini CLI (Google)     | 200K for Pro models (2.5 Pro, 3.1 Pro): 2x input, 1.5x output. No tier on Flash/Flash-Lite.       | 0.5 x 1,048,576 = 524,288 tokens (unless a remote experiment overrides it) | Yes, for Pro models                                 | Priority 1.8x; Flex/Batch 0.5x                                           | Standard (no tier set)                                                             |
| Qwen Code (Alibaba)     | qwen3-coder-plus has four tiers: 0-32K, 32K-128K, 128K-256K, 256K-1M (up to 6x input, 12x output) | 0.85 x 1,000,000 = ~850K                                                   | Yes. It reaches the most expensive 256K-1M tier.    | n/a                                                                      | n/a                                                                                |
| OpenCode                | Inherits the provider's pricing                                                                   | Context nearly full (limit.input minus reserved buffer)                    | Yes, for any provider with a cliff                  | Passes `serviceTier` through only when configured                        | Not set                                                                            |

---

## Q1. Anthropic long-context pricing

### 1.1 No long-context premium for Claude 4.6 and later, except Haiku 5.5

- **Fact:** Claude 4.6 and later models (except Haiku 5.5) and Mythos Preview bill the full 1M window at standard per-token rates.
- **Source:** https://platform.claude.com/docs/en/about-claude/pricing (no date shown)
- **Quote:** "Claude 4.6 and later models (except Claude Haiku 5.5) and Claude Mythos Preview include the full 1M token context window at standard pricing. (A 900k-token request is billed at the same per-token rate as a 9k-token request.)"
- **Confidence:** High

### 1.2 Haiku 5.5 is priced by prompt length

- **Fact:** Haiku 5.5 is the one current model with a long-context surcharge. Above 100K input tokens, both input and output cost 5x.

  | Prompt size | Input | Output |
  | ----------- | ----- | ------ |
  | ≤100K       | $0.10 | $0.50  |
  | >100K       | $0.50 | $2.50  |

- **Source:** https://platform.claude.com/docs/en/about-claude/pricing
- **Quote:** "Claude Haiku 5.5 is priced by prompt length: a prompt of over 100,000 tokens pays higher prices."
- **Confidence:** High
- **Note:** Haiku 5.5 launched on 2026-10-07 with a 1M context window (release notes).

### 1.3 Standard prices (input / output per MTok)

| Model                                    | Input | Output |
| ---------------------------------------- | ----- | ------ |
| Fable 5.1, Mythos 5.1, Fable 5, Mythos 5 | $10   | $50    |
| Opus 5.5                                 | $4    | $20    |
| Opus 5, 4.8, 4.7, 4.6, 4.5               | $5    | $25    |
| Sonnet 5.5, Sonnet 5                     | $2    | $10    |
| Sonnet 4.6, 4.5                          | $3    | $15    |
| Haiku 4.5                                | $1    | $5     |

- **Sonnet 5 note:** its $2/$10 is now the standard price. A scheduled rise to $3/$15 on 2026-09-01 will not happen.
- **Cache reads:**
  - 0.025x base input on Fable 5.1 / Mythos 5.1
  - 0.05x on Opus 5.5 / Sonnet 5.5
  - 0.1x on all other models
- **Tokenizer:** Claude 4.7 and later produce about 30% more tokens for the same text.
- **US-only inference:** `inference_geo: "us"` adds a 1.1x multiplier.
- **Source:** https://platform.claude.com/docs/en/about-claude/pricing
- **Confidence:** High

### 1.4 1M went GA at standard pricing for Opus 4.6 and Sonnet 4.6 on 2026-03-13

- **Sources and quotes:**
  - Release notes, https://platform.claude.com/docs/en/release-notes/overview, Mar 13, 2026: "The 1M token context window is out of beta for Claude Opus 4.6 and Sonnet 4.6, at standard pricing... The 1M token context window remains in beta for Claude Sonnet 4.5 and Sonnet 4."
  - Blog, https://claude.com/blog/1m-context-ga, dated March 13, 2026:
    - "Standard pricing now applies across the full 1M window for both models, with no long-context premium."
    - "There's no multiplier: a 900K-token request is billed at the same per-token rate as a 9K one."
    - "Claude Code Max, Team, and Enterprise users on Opus 4.6 will default to 1M context automatically."
  - Corroboration: https://simonwillison.net/2026/Mar/13/1m-context/ (13 March 2026). It contrasts this with Gemini 3.1 Pro's 200K threshold and GPT-5.4's 272K threshold.
- **Confidence:** High

### 1.5 Historical premium (no longer applicable)

- **Sonnet 4 / 4.5 beta (from 2025-08-12):**

  | Prompt size | Input | Output |
  | ----------- | ----- | ------ |
  | ≤200K       | $3    | $15    |
  | >200K       | $6    | $22.50 |
  - Source: https://claude.com/blog/1m-context (August 12, 2025). Confidence: High.

- **Opus 4.6 before GA:** release notes, Feb 5, 2026: "Long context pricing applies to requests exceeding 200k input tokens". Confidence: High.
- **Beta retired:** release notes, Apr 30, 2026: "We've retired the 1M token context window beta (`context-1m-2025-08-07`) for Claude Sonnet 4.5 and Claude Sonnet 4... requests exceeding the standard 200k-token context window return an error." Confidence: High.
- **Conclusion:** no current Claude model charges a >200K premium.

### 1.6 Default context window per model

- **Fact:** These models have a 1M window, and 1M is the default:
  - Fable 5.1, Mythos 5.1, Fable 5, Mythos 5
  - Opus 5.5, Opus 5, Opus 4.8, Opus 4.7, Opus 4.6
  - Sonnet 5.5, Sonnet 5, Sonnet 4.6
  - Haiku 5.5
  - Mythos Preview
- All other models, including Sonnet 4.5, have 200K.
- **Source:** https://platform.claude.com/docs/en/build-with-claude/context-windows
- **Quotes:**
  - "Other Claude models, including Claude Sonnet 4.5 (deprecated), have a 200k-token context window."
  - "For every model with a 1M-token context window, 1M is the default: you don't need a beta header, and long-context requests are billed at standard pricing, except on Claude Haiku 5.5".
- **Release notes:**
  - Opus 5 (2026-07-24): 1M is "both the default and the maximum".
  - Opus 4.8 (2026-05-28) and Opus 5.5 (2026-09-22): 1M by default.
- **Confidence:** High

---

## Q2. Anthropic fast mode

### 2.1 Supported models and pricing (API)

| Model    | Fast mode price (input / output) | Multiplier vs standard |
| -------- | -------------------------------- | ---------------------- |
| Opus 5.5 | $8 / $40                         | 2x                     |
| Opus 5   | $10 / $50                        | 2x                     |
| Opus 4.8 | $10 / $50                        | 2x                     |

- **Fact:** Fast pricing applies across the full context window, including requests over 200K.
- **Source:** https://platform.claude.com/docs/en/build-with-claude/fast-mode
- **Quotes:**
  - Opt-in: "Set `speed: "fast"` with the `fast-mode-2026-02-01` beta header".
  - Speed: "up to 2.5x higher output tokens per second".
- **Other behavior:**
  - On Opus 4.7, `speed: "fast"` returns an error.
  - On Opus 4.6, the request runs at standard speed and is billed at standard rates; `usage.speed` reports "standard".
  - Fast mode is not available with Batch or with Priority Tier.
  - Changing speed invalidates the prompt cache.
- **Confidence:** High

### 2.2 Fast mode history (release notes)

| Date       | Change                                                        |
| ---------- | ------------------------------------------------------------- |
| 2026-02-07 | Launched on Opus 4.6: "up to 2.5x as fast at premium pricing" |
| 2026-05-12 | Opus 4.7 added                                                |
| 2026-05-28 | Opus 4.8 added; Opus 4.6 deprecated                           |
| 2026-06-25 | Opus 4.7 deprecated                                           |
| 2026-06-29 | Opus 4.6 removed                                              |
| 2026-07-24 | Opus 4.7 removed                                              |
| 2026-09-22 | Opus 5.5 added                                                |

- **Source:** https://platform.claude.com/docs/en/release-notes/overview
- **Confidence:** High

### 2.3 Claude Code: enabling and disabling, defaults, billing

- **Source:** https://code.claude.com/docs/en/fast-mode. Confidence: High.
- **How to enable:**
  - Toggle with `/fast`, or set `"fastMode": true` in user settings.
  - Headless: `claude -p --settings '{"fastMode": true}'`.
- **Persistence:** "By default, fast mode you turn on in an interactive session persists across sessions". Setting `fastModePerSessionOptIn: true` changes this.
- **Default for organizations:** "fast mode is disabled by default for Team and Enterprise organizations". An Owner must enable it.
- **Billing on subscription plans:**
  - "available via usage credits only and not included in the subscription rate limits"
  - "Fast mode usage draws directly from usage credits, even if you have remaining usage on your plan."
- **Cost trap when switching mid-conversation:** "The first time you enable fast mode in a conversation, you pay the full fast mode uncached input token price for the entire conversation context."
- **Kill switch:** "Another option to disable fast mode entirely is to set `CLAUDE_CODE_DISABLE_FAST_MODE=1`." The env-var page also lists it: https://code.claude.com/docs/en/env-vars ("Set to `1` to disable fast mode").
- **Default fast model:** Opus 5.5 from Claude Code v2.1.280.
- **Removed setting:** `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE` was removed in v2.1.160 (env-vars page).
- **Is fast mode off by default for individuals?** Yes in practice. It must be toggled on, but once on it persists across sessions.

---

## Q3. Claude Code context settings

Source for all items: https://code.claude.com/docs/en/env-vars and https://code.claude.com/docs/en/model-config. Confidence: High unless noted.

### Context-window and compaction variables

- **`CLAUDE_CODE_DISABLE_1M_CONTEXT=1`**: removes 1M variants from the model picker. It also "holds sessions on models with a native 1M window, such as Sonnet 5.5 and the Fable models, to a 200K window".
- **`CLAUDE_CODE_AUTO_COMPACT_WINDOW`**:
  - Accepts an integer from 100000 to 1000000. Use digits only: "a value like `500k` reads as `500` and clamps to the 100K minimum".
  - Capped at the model's context window.
  - Takes precedence over `/autocompact`, `--autocompact` and the `autoCompactWindow` setting.
- **`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`**: "percentage (1-100) of the auto-compact window at which auto-compaction triggers... can't raise the threshold, so values above the default percentage are ignored... Applies to both main conversations and subagents".
- **Default compaction points:**
  - Native-1M sessions compact at about 967K tokens.
  - Opus 4.6 and Sonnet 4.6 without extended context compact at 200K.
- **Other related variables:**
  - `CLAUDE_CODE_MAX_CONTEXT_TOKENS`
  - `DISABLE_AUTO_COMPACT` (manual `/compact` still works)
  - `DISABLE_COMPACT`
  - `CLAUDE_CODE_EFFORT_LEVEL`
  - `CLAUDE_CODE_SUBAGENT_MODEL`
  - Prompt-cache TTL: `ENABLE_PROMPT_CACHING_1H`, `FORCE_PROMPT_CACHING_5M`, `CLAUDE_CODE_PROMPT_CACHE_TTL`. 1h cache writes cost 2x base input. "Subscription users within included usage receive the 1-hour TTL automatically".

### The `[1m]` suffix

- On the Anthropic API, these models "run with the 1M window on every plan, including Pro" and have no `[1m]` variant to select:
  - Fable 5.1, Fable 5
  - Sonnet 5 and later
  - Haiku 5.5
  - Opus 4.7 and later
- Opus 4.6 and Sonnet 4.6 reach 1M only through `[1m]`:

| Plan                  | Opus 4.6 with 1M           | Sonnet 4.6 with 1M     |
| --------------------- | -------------------------- | ---------------------- |
| Max, Team, Enterprise | Included with subscription | Requires usage credits |
| Pro                   | Requires usage credits     | Requires usage credits |
| API / pay-as-you-go   | Full access                | Full access            |

- Pricing note from the same page: "The 1M context window uses standard model pricing with no premium for tokens beyond 200K, except on Haiku 5.5".

### Model aliases

- On the Anthropic API:
  - `opus` = Opus 5.5 (native 1M)
  - `sonnet` = Sonnet 5.5
  - `haiku` = Haiku 5.5
- Other providers resolve some aliases to older models.
- The `default` model is Opus 5.5 on Pro, Max, Team, Enterprise and API. Before v2.1.280 it was Sonnet 5 on Pro / Team Standard and Opus 5 on Max and others.
- **Does `opus` default to 1M on some plans?** Today `opus` resolves to Opus 5.5, which is 1M on every plan. The plan-specific 1M default applied to Opus 4.6: the GA blog says "Claude Code Max, Team, and Enterprise users on Opus 4.6 will default to 1M context automatically".

### Effort defaults

- `medium` on Opus 5.5, Sonnet 5.5 and Haiku 5.5
- `xhigh` on Opus 4.7
- `high` on all other models

### Fable billing

- Fable "can bill to usage credits" on some plans.
- Quote: "In non-interactive mode with the `-p` flag... When a Fable request there would bill to usage credits, Claude Code bills it without asking."
- Confidence: High. **Audit relevance:** headless runs can spend usage credits silently.

### Derived: keeping Haiku 5.5 under its 100K cliff

- Default compaction (~967K on a native-1M window) is far above Haiku 5.5's 100K cliff.
- Example: `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000` with `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=90` should compact at about 90K.
- Confidence: Medium. This is inferred from the documented semantics, not tested.

---

## Q4. OpenAI long-context pricing

### 4.1 The 272K threshold and its multipliers

- **Fact:** "Short context: ≤272K input tokens. Long context: >272K input tokens." Long context costs 2x input (and cached input) and 1.5x output.
- **Source:** https://developers.openai.com/api/docs/pricing (no date shown). openai.com/api/pricing returned 403.
- **Confidence:** High
- **Standard prices:**

| Model                    | Short context (input / output) | Long context (input / output) |
| ------------------------ | ------------------------------ | ----------------------------- |
| gpt-6-astra              | $10 / $50                      | $20 / $75                     |
| gpt-6.1-sol              | $2 / $10                       | $4 / $15                      |
| gpt-6-sol                | $2 / $10                       | $4 / $15                      |
| gpt-6-luna               | $0.10 / $0.50                  | $0.20 / $0.75                 |
| gpt-5.6-sol              | $4 / $20                       | $8 / $30                      |
| gpt-5.6-terra            | $2 / $12                       | $4 / $18                      |
| gpt-5.6-luna             | $0.20 / $1.20                  | $0.40 / $1.80                 |
| gpt-5.5                  | $5 / $30                       | $10 / $45                     |
| gpt-5.4                  | $2.50 / $15                    | $5 / $22.50                   |
| gpt-5.4-pro, gpt-5.5-pro | $30 / $180                     | $60 / $270                    |

- **No long-context tier listed** for gpt-5.4-mini, gpt-5.4-nano, gpt-5.2, gpt-5.1, gpt-5 or gpt-5-mini.
- **Regional surcharge:** data-residency endpoints add +10% for models released on or after 2026-03-05.
- **Promotion:** GPT-5.6 Sol promotional pricing runs "at least through November 21, 2026".

### 4.2 Does the multiplier apply to the whole session or one request?

All six model pages list a 1,050,000-token context window. Their wording differs:

| Model page                                                | Quote                                                                                                                       | Max input |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------- |
| https://developers.openai.com/api/docs/models/gpt-5.4     | "prompts with >272K input tokens are priced at 2x input and 1.5x output for the full session for standard, batch, and flex" | not noted |
| https://developers.openai.com/api/docs/models/gpt-5.5     | Same "full session" wording                                                                                                 | not noted |
| https://developers.openai.com/api/docs/models/gpt-5.6-sol | "for the full request"                                                                                                      | 922,000   |
| https://developers.openai.com/api/docs/models/gpt-6-sol   | "2x input and cache rates and 1.5x output for the full request"                                                             | 922,000   |
| https://developers.openai.com/api/docs/models/gpt-6.1-sol | Same "full request" wording                                                                                                 | not noted |
| https://developers.openai.com/api/docs/models/gpt-6-astra | Same "full request" wording                                                                                                 | not noted |

- **Confidence:** High for the quotes. Low for whether "full session" means anything beyond the single request. See the Unverified list.

### 4.3 Codex context window and compaction keys

**Source code** (openai/codex; latest release `rust-v0.161.0`, 2026-10-07):

- `codex-rs/models-manager/src/model_info.rs`:
  - Fallback metadata for unknown slugs: `context_window: Some(272_000)`, `max_context_window: Some(272_000)`, `effective_context_window_percent: 95`.
  - In `with_config_overrides`, `model_context_window` is clamped to `max_context_window`.
- `codex-rs/protocol/src/openai_models.rs`, `auto_compact_token_limit()`:
  - Returns `min(configured_limit, context_window * 9/10)`.
  - Doc comment: "When omitted, core derives it from `context_window` (90%). When provided, core clamps it to 90% of the context window".
- **Confidence:** High

**Config docs:** https://learn.chatgpt.com/docs/config-file/config-reference (redirected from developers.openai.com/codex/config-reference)

- `model_context_window`: "Context window tokens available to the active model."
- `model_auto_compact_token_limit`: "Token threshold that triggers automatic history compaction (unset uses model defaults)."
- `model_auto_compact_token_limit_scope` also exists.
- **Confidence:** High

**Derived:**

- If the server catalog gives a model a window above about 302K, the default 90% compaction point exceeds 272K. Every turn above 272K then pays long-context rates.
- Setting `model_auto_compact_token_limit` to about 250000 (below 272K, with headroom for the next turn) avoids this.
- Confidence: Medium.

---

## Q5. OpenAI speed and service tiers

### 5.1 API tiers

**Fast** (formerly Priority) — https://developers.openai.com/api/docs/guides/fast-mode

- Rename: "Priority processing was renamed Fast mode on July 30, 2026."
- Either `service_tier: "priority"` or `"fast"` is accepted.
- Price: "Fast mode costs twice the corresponding Standard rate". Example, GPT-5.6 Sol: $8/$40 short context, $16/$60 long context.
- A project-level "Project Service Tier" setting can make Fast the default for requests that don't set `service_tier`. **Audit item:** check the project setting.
- Confidence: High

**Flex and Batch**

- Model pages: "Batch and Flex are priced at 50% of Standard rates". The pricing tables confirm it.
- Flex guide, https://developers.openai.com/api/docs/guides/flex-processing:
  - `service_tier: "flex"`
  - "in beta with limited model availability"
  - Can return 429 Resource Unavailable, which is not charged.
- Confidence: High

**Ultrafast** — https://developers.openai.com/api/docs/guides/ultrafast-mode

- `service_tier: "ultrafast"`.
- Broadly available for GPT-6 Astra; preview for GPT-5.6 Sol.
- gpt-6-astra Ultrafast costs $60/$300, which is 6x standard.
- Confidence: High

**Scale Tier:** sources conflict. See the Unverified list.

### 5.2 Codex CLI speed tiers

**Docs:** https://learn.chatgpt.com/docs/agent-configuration/speed (redirected from developers.openai.com/codex/speed). Confidence: High.

- **Toggle:** "Use `/fast` in the CLI to toggle Fast mode."
- **Fast cost and speed:**
  - "For supported models, Fast mode uses included subscription limits at 2.5x the Standard rate."
  - "Purchased credits and Enterprise pay-as-you-go usage are billed at 2x the Standard rate."
  - "For GPT-5.6 and GPT-5.5, the speed increase is 1.5x."
- **Ultrafast cost and availability:**
  - "For GPT-6 Astra, Ultrafast uses included subscription limits at 8x the Standard rate."
  - Purchased credits and Enterprise pay-as-you-go are "billed at 6x".
  - "Ultrafast is available in Codex and ChatGPT Work on Pro $500 and eligible Enterprise and Edu plans."
  - "For Enterprise workspaces, Ultrafast is off by default."
- **API-key users:** "With an API key, Codex uses API token pricing instead, and ChatGPT credit multipliers don't apply."
- **Availability:** "Fast mode is available in the ChatGPT desktop app, Codex CLI, and IDE extension when you sign in with ChatGPT."
- **Retirement:** "GPT-5.5 retires from ChatGPT, ChatGPT Work, and Codex on all plans on October 14, 2026."

**Config reference** (same site):

- `service_tier`: "Use `fast` or another tier advertised by the active model; `fast` maps to the request value `priority`."
- `features.fast_mode` is "stable; on by default".
- `config.schema.json` describes `service_tier` as: "Optional explicit service tier request id for new turns (for example `default`, `priority`, or `flex`; legacy `fast` also works)."

**Source code:**

- `codex-rs/protocol/src/config_types.rs`:
  - `enum ServiceTier { Fast, Flex }`; Fast maps to "priority" and Flex to "flex".
  - `SERVICE_TIER_DEFAULT_REQUEST_VALUE = "default"`: "Request/config sentinel for explicit standard routing".
- `openai_models.rs`: "Flex is an API request option, even when the Codex catalog does not advertise it."
- `codex-rs/core/src/session/mod.rs`, `get_service_tier`:
  - A configured `flex` is always sent.
  - Other tiers are sent only if the feature is enabled and the value is `default` or advertised by the model. Otherwise a warning is logged and the tier is omitted.
- `codex-rs/tui/src/service_tier_resolution.rs`, `effective_service_tier`, in priority order:
  1. Configured flex wins.
  2. An explicit `"default"` means standard.
  3. With nothing configured, it uses the catalog preset's `default_service_tier`.
  4. `[notice].fast_default_opt_out = true` resolves to standard.
- **Confidence:** High

### 5.3 Codex can default to Fast (key cost finding)

- **Source:** PR https://github.com/openai/codex/pull/19053, "Default Fast service tier for eligible ChatGPT plans", merged 2026-04-23.
- **Quotes:**
  - "Enterprise and business-like ChatGPT plans should get Codex's Fast service tier by default when the user or caller has not made an explicit service-tier choice."
  - "otherwise eligible ChatGPT plans resolve to Fast when FastMode is enabled"
  - The PR adds "`[notice].fast_default_opt_out`".
  - "`/fast off` ... clear `service_tier`, persist the opt-out marker, and send explicit standard".
- **Confidence:** High that the code exists. Medium on exactly which plans the server catalog marks as eligible today.
- **Mitigation (derived):** pin one of these in `config.toml` or with `-c`:
  - `service_tier = "default"` (standard), or
  - `service_tier = "flex"` (API-key users), or
  - `[notice] fast_default_opt_out = true`, or
  - `[features] fast_mode = false`.
- **Related PRs:**
  - #46230 (2026-09-17): configured Flex is preserved regardless of catalog or fast-mode support; `service_tier` is omitted on Bedrock.
  - #51253 (2026-10-06): adds a default-enabled `features.ultrafast_mode` flag, enforced independently of `features.fast_mode`.
  - #51794 (2026-10-07): advertises Ultrafast for GPT-6.1 Sol on Bedrock.

### 5.4 Flex in Codex

- **API keys:** the code sends `flex` when it is configured. Flex costs 50% of standard on the API. Confidence: High.
- **ChatGPT login:** not verified. See the Unverified list.

---

## Q6. Google Gemini

### 6.1 Pricing tiers

- **Source:** https://ai.google.dev/gemini-api/docs/pricing ("Last updated 2026-10-07 UTC")
- **Confidence:** High
- **Standard paid tier, Pro models** (labels quoted: "prompts <= 200k tokens" / "prompts > 200k tokens"):

| Model                  | ≤200K (input / output) | >200K (input / output) |
| ---------------------- | ---------------------- | ---------------------- |
| Gemini 3.1 Pro Preview | $2.00 / $12.00         | $4.00 / $18.00         |
| Gemini 2.5 Pro         | $1.25 / $10.00         | $2.50 / $15.00         |

- Both are 2x input and 1.5x output above 200K.
- **Same 200K split in other tiers:**

| Model   | Batch / Flex ≤200K | Batch / Flex >200K | Priority ≤200K | Priority >200K |
| ------- | ------------------ | ------------------ | -------------- | -------------- |
| 3.1 Pro | $1 / $6            | $2 / $9            | $3.60 / $21.60 | $7.20 / $32.40 |
| 2.5 Pro | $0.625 / $5        | $1.25 / $7.50      | $2.25 / $18    | $4.50 / $27    |

- Priority is 1.8x standard; Batch and Flex are 0.5x.
- **Gemini 3 Pro:** the pricing page has no separate entry. Gemini 3 Pro Image says its text is priced like 3.1 Pro.
- **gemini-3-pro-preview status:**
  - The deprecations page (https://ai.google.dev/gemini-api/docs/deprecations, last updated 2026-10-07) lists a shutdown date of "March 9, 2026", with replacement "`gemini-3.1-pro-preview`".
  - gemini-2.5-pro has "No shutdown date announced".
- **Flash / Flash-Lite:** no context-length tiers in any tier.
  - Models covered: 3.8, 3.7, 3.6 and 3.5 Flash; 3.5 and 3.1 Flash-Lite; 3 Flash Preview; 2.5 Flash; 2.5 Flash-Lite.
  - Audio input is priced separately, which is a modality split, not a length tier.
  - 3.8/3.7/3.6 Flash: $0.75 / $3.75 through 2026-12-31, rising to $1.50 / $7.50 from 2027-01-01.

### 6.2 Gemini CLI compression settings

- **Sources** (google-gemini/gemini-cli `main`; latest release v0.63.0, 2026-10-06):
  - `docs/reference/configuration.md`
  - `packages/core/src/context/chatCompressionService.ts`
  - `packages/core/src/core/tokenLimits.ts`
  - `packages/core/src/config/config.ts`
  - `packages/a2a-server/src/config/settings.ts`
- **Confidence:** High
- **`model.compressionThreshold`:** "The fraction of context usage at which to trigger context compression (e.g. 0.2, 0.3)." Default `0.5`. Requires restart.
- **The trigger in code:** `originalTokenCount >= threshold * tokenLimit(model)`, with `DEFAULT_COMPRESSION_TOKEN_THRESHOLD = 0.5`.
- **`tokenLimit()`:** 1,048,576 for gemini-2.5-pro, gemini-3-pro-preview, the Flash models and the default fallback. So default compression fires at about 524,288 tokens.
- **Remote override:** `getCompressionThreshold()` uses the local setting if set. Otherwise it uses a remote experiment flag (`CONTEXT_COMPRESSION_THRESHOLD`). So the effective default can be changed server-side unless the setting is set locally.
- **Legacy setting:** `chatCompression.contextPercentageThreshold` survives only as a migration path. Code comment: "Normalize legacy object chatCompression: { contextPercentageThreshold: n } -> n". The current key is `model.compressionThreshold`.
- **Experimental history window** (only with `experimental.contextManagement`, default `false`):
  - `contextManagement.historyWindow.maxTokens`, default `150000`: "The number of tokens to allow before triggering compression."
  - `retainedTokens`, default `40000`.
- **Defaults:**
  - Code: `DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro'`, `PREVIEW_GEMINI_MODEL = 'gemini-3-pro-preview'`.
  - Docs: the alias `chat-compression-default` resolves to `gemini-3-pro-preview`. Compression itself may therefore run on a Pro model (Medium confidence; the alias resolution chain was not traced).
- **Vertex tier header:** `billing.vertexAi.sharedRequestType` accepts `"priority"` or `"flex"`. Default undefined, which means standard.
- **Credit overage:** `billing.overageStrategy` defaults to `"ask"`.
- **Derived:**
  - On Pro models, the default 0.5 threshold lets every turn between 200K and 524K pay the >200K rate.
  - `model.compressionThreshold` of about 0.18 (~189K of 1,048,576) keeps prompts at or below 200K.
  - Confidence: Medium.

---

## Q7. Alibaba Qwen

### 7.1 qwen3-coder-plus tiered pricing

- **Source:** https://www.alibabacloud.com/help/en/model-studio/model-pricing ("Last Updated: Oct 08, 2026")
- **Confidence:** High
- **Tier rule:**
  - "The unit price is determined by the total number of input tokens in a single request."
  - The whole request is billed at that tier, and output follows the input tier.
  - Context cache: "only input tokens receive a discount."
- **Prices** (input / output per MTok):

| Tier (input tokens per request) | qwen3-coder-plus, Singapore (International) | qwen3-coder-plus, Beijing / Frankfurt Global / US Global | qwen3-coder-flash, Singapore |
| ------------------------------- | ------------------------------------------- | -------------------------------------------------------- | ---------------------------- |
| 0<Token≤32K                     | $1 / $5                                     | $0.574 / $2.294                                          | $0.3 / $1.5                  |
| 32K<Token≤128K                  | $1.8 / $9                                   | $0.861 / $3.441                                          | $0.5 / $2.5                  |
| 128K<Token≤256K                 | $3 / $15                                    | $1.434 / $5.735                                          | $0.8 / $4                    |
| 256K<Token≤1M                   | $6 / $60                                    | $2.868 / $28.671                                         | $1.6 / $9.6                  |

- **Size of the jump:** the top tier is 6x input and 12x output versus the first tier.
- **Snapshots:** in Singapore, the qwen3-coder-plus alias points to the 2025-09-23 snapshot (2025-07-22 is also listed).
- **Other coder models:**
  - qwen3-coder-next tops out at 128K-256K.
  - qwen3-coder-480b-a35b-instruct and qwen3-coder-30b-a3b-instruct top out at 128K-200K.

### 7.2 Qwen Code compaction settings

- **Sources** (QwenLM/qwen-code `main`; latest CLI tags v0.25.1-preview.0 on 2026-10-06 and nightly on 2026-10-07):
  - `docs/users/configuration/settings.md`
  - `packages/core/src/core/tokenLimits.ts`
- **Confidence:** High
- **`model.chatCompression.contextPercentageThreshold` has been REMOVED.** Quote: "**REMOVED.** Replaced by `context.autoCompactThreshold`... The old setting is silently ignored (no startup warning)."
  - Removed by PR #4345, "feat(core)!: redesign auto-compaction thresholds with three-tier ladder", merged 2026-05-25.
  - **Audit item:** a tool still writing the old key gets no effect.
- **`context.autoCompactThreshold`:** "Target fraction of the context window at which auto-compaction triggers... Default is `0.85` (85%). Acts as a ceiling on the trigger".
- **Context window:**
  - `tokenLimits.ts` maps `^qwen3-coder-plus` and `^qwen3-coder-flash` to 1M; other `qwen3-coder-*` to 256K; the default is 200K.
  - A bundled models.dev catalog can also supply limits (`QWEN_CODE_MODELS_DEV`, on by default).
- **Other knobs:**
  - `model.generationConfig.contextWindowSize` overrides the assumed window.
  - `compactionModel` sets a cheaper summarizer; empty means the main model.
  - `model.sessionTokenLimit` defaults to -1 (unlimited).
- **Derived:**
  - The default compaction point is about 850K on qwen3-coder-plus, so long sessions reach the 256K-1M tier ($6 / $60 in Singapore).
  - To stay at or below 128K: set `context.autoCompactThreshold` to about 0.12, or set `contextWindowSize: 128000` (0.85 x 128K = ~109K).
  - Confidence: Medium.

---

## Q8. Other cost-amplifying defaults

### OpenCode (anomalyco/opencode, formerly sst/opencode; latest v1.18.35, 2026-10-06)

- **Compaction config** — https://opencode.ai/docs/config/ ("Last updated: Oct 8, 2026"). Confidence: High.
  - "`auto` - Automatically compact the session when context is full (default: `true`)."
  - "`prune` - Remove old tool outputs to save tokens (default: `false`)."
  - "`reserved` - Token buffer for compaction."
  - There is no percentage threshold key.
- **Compaction trigger** — `packages/opencode/src/session/overflow.ts`. Confidence: High.
  - `isOverflow` compares total tokens with `usable()`.
  - `usable()` is `limit.input - reserved`, where reserved defaults to `min(20_000, maxOutputTokens)`. If no input limit exists, it is `limit.context - maxOutputTokens`.
  - So OpenCode compacts only when the context is almost full, far above the 200K or 272K cliffs on 1M-window models.
- **Derived:** the only lever is a large `compaction.reserved`, or a lower per-model limit override. Confidence: Low; see the Unverified list.
- **Service tier:**
  - `packages/llm/src/protocols/utils/openai-options.ts` accepts `serviceTier` values `"auto"`, `"default"`, `"flex"` and `"priority"` in OpenAI provider options.
  - `provider/transform.ts` contains no service-tier default, so OpenCode sends no tier unless configured.
  - Confidence: Medium. I grepped the main files only.
- **`small_model`:** "By default, OpenCode tries to use a cheaper model if one is available from your provider" for title generation and similar tasks.

### Other cross-tool defaults that raise cost

| Tool        | Default                                                                            | Source     |
| ----------- | ---------------------------------------------------------------------------------- | ---------- |
| Claude Code | Fast mode, once enabled, persists across sessions                                  | §2.3       |
| Claude Code | Switching to fast mid-session re-bills the whole context at the uncached fast rate | §2.3       |
| Claude Code | `-p` mode bills Fable usage credits without asking                                 | §3         |
| Claude Code | `default` model is Opus 5.5 on all plans                                           | §3         |
| Claude Code | Subscriptions get the 1h cache TTL; its writes cost 2x                             | §3         |
| Codex       | `features.fast_mode` and `features.ultrafast_mode` are on by default               | §5.2, §5.3 |
| Codex       | Eligible ChatGPT plans resolve to Fast when no tier is set                         | §5.3       |
| OpenAI API  | A project-level setting can make Fast the default                                  | §5.1       |
| Gemini CLI  | Compression threshold can be set remotely by experiment flag                       | §6.2       |
| Gemini CLI  | Credit overage strategy defaults to `"ask"`, not `"never"`                         | §6.2       |
| Qwen Code   | The old compression key is silently ignored                                        | §7.2       |

---

## Q9. Batch APIs: can a coding agent use them? (PR #2772 review)

Question from the PR review: "May be we can use batch speed for Codex by default? Or it does not work at all?" Short answer: **Batch does not work for interactive CLIs. Flex is the synchronous tier at the Batch price.** Docs re-read on 2026-10-08.

| Vendor    | Batch: how it works                                                                                                                                                                                             | Batch price                     | Synchronous tier at the Batch price                                                                                                                                    | Can the hive CLI send it?                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| OpenAI    | Upload a `.jsonl` file (`purpose="batch"`), `POST /v1/batches`; "the completion window can only be set to `24h`"; results come back as an output file whose "line order **may not match** the input line order" | 0.5x ("50% lower costs")        | **Flex**: "Tokens are priced at Batch API rates"; `service_tier: "flex"`; beta, limited models; `429 Resource Unavailable` (not charged); 10-minute default timeout    | Codex: yes, `-c service_tier=flex` (`--speed flex`, alias `--speed batch`)                 |
| Anthropic | Message Batches API; "most batches finishing in less than 1 hour", results "after 24 hours, whichever comes first"; `stream: true` and `speed` are not supported                                                | 0.5x                            | None on the first-party API (tiers are Priority, Standard, Batch; Priority Tier is closed to new commitments). Bedrock has `flex` via `ANTHROPIC_BEDROCK_SERVICE_TIER` | No: Claude Code has no batch option; it streams every turn                                 |
| Google    | Batch Mode, "target turnaround time is 24 hours"                                                                                                                                                                | 0.5x                            | **Flex** (preview): "50% cost reduction", "synchronous", latency "Minutes (1–15 min target)", "Best-effort (Sheddable)", "No server-side fallback"                     | No: Gemini CLI 0.63.0 has no service-tier setting (no `serviceTier` string in the package) |
| Alibaba   | OpenAI-compatible batch, "processes them asynchronously", `completion_window="24h"`                                                                                                                             | 0.5x ("50% of real-time calls") | None                                                                                                                                                                   | No: and no `qwen3-coder-*` model is on the batch-supported lists                           |

Why Batch cannot drive an agent loop (derived, Medium–High):

- A coding agent sends one request per turn and must read the tool calls in the reply before it can send the next turn. A batch is submitted as a file and answered as a file, up to 24 hours later, with no streaming. A single solve session has hundreds of such dependent turns.
- Anthropic says the same about its own agent product: Managed Agents pricing excludes the Batch discount because "Sessions are stateful and interactive. There is no batch mode."

What Codex does with `service_tier=batch` (High, local capture with Codex CLI 0.161.0, `codex-service-tier-capture.txt`):

- `batch`, `scale` and any unknown value are dropped silently. The request goes out with no `service_tier` (standard price), and Codex prints no warning.
- The Responses API reference lists `auto`, `default`, `flex`, `scale`, `priority`, `fast` and `ultrafast`. There is no `batch`.
- So hive maps `--speed batch` to `flex`. Otherwise `batch` would quietly bill at the standard price.

Sources:

- https://developers.openai.com/api/docs/guides/batch
- https://developers.openai.com/api/docs/guides/flex-processing
- https://developers.openai.com/api/reference/resources/responses/methods/create (`service_tier`)
- https://platform.claude.com/docs/en/build-with-claude/batch-processing
- https://platform.claude.com/docs/en/api/service-tiers
- https://ai.google.dev/gemini-api/docs/batch-mode
- https://ai.google.dev/gemini-api/docs/flex-inference
- https://www.alibabacloud.com/help/en/model-studio/batch-interfaces-compatible-with-openai

## Re-check of all model docs (2026-10-08, PR #2772 review)

Re-read the vendor pages listed in Q1–Q7. Results:

- **OpenAI:**
  - Short context is still "≤272K input tokens".
  - gpt-6.1-sol is $2 / $0.10 cached / $10, the cheapest Sol. Its cached input is half of gpt-6-sol's $0.20.
  - Fast is 2x on GPT-6 and 5.6.
  - The Codex speed page still says "With an API key, Codex uses API token pricing instead, and ChatGPT credit multipliers don't apply".
  - No Codex doc mentions Flex for ChatGPT login, so open question 3 stays open.
- **Anthropic:**
  - Opus 5.5 is $4 / $20, cheaper than Opus 5 and 4.8 ($5 / $25).
  - Sonnet 5.5 is $2 / $10. Haiku 5.5 is $0.10 / $0.50 up to 100K input and $0.50 / $2.50 above.
  - "Claude 4.6 and later models (except Claude Haiku 5.5) ... include the full 1M token context window at standard pricing."
  - Fast mode is supported on Opus 5.5, 5 and 4.8 only.
  - `CLAUDE_CODE_AUTO_COMPACT_WINDOW` "Accepts a plain integer ... only" in the range 100000–1000000, which is what hive passes.
- **Google:**
  - The pricing page was last updated 2026-10-07.
  - The 200K split still applies only to the Pro models.
  - Flex and Batch are 0.5x, Priority is 1.8x.
  - `model.compressionThreshold` still defaults to `0.5`.
- **Qwen:**
  - Qwen Code uses `context.autoCompactThreshold` (default 0.85). It "Replaces the old `model.chatCompression.contextPercentageThreshold`", which is removed and ignored. hive already writes the new key.
  - The Model Studio models page no longer shows the per-range qwen3-coder prices, so Q7.1 could not be re-confirmed from the current page. The text-generation page now lists Qwen3-Coder under "Legacy models", with a 1M window for `qwen3-coder-plus` and `-flash`.

## Not verified / open questions

1. **Original Opus 4.6 fast-mode price.** Widely reported as $30 / $150 (6x). It does not appear in current docs, and I could not reach Wayback. Only "premium pricing" (release notes, 2026-02-07) is verified. Fast mode no longer exists on Opus 4.6.
2. **Codex per-model context windows.** These come from a live, server-delivered model catalog. I verified only the 272K fallback for unknown slugs and the 90% / 95% rules. The windows Codex uses for gpt-5.6-sol, gpt-6-sol and others (the API pages say 1.05M, max input 922K) were not confirmed.
3. **Flex for ChatGPT-login Codex users.** The client sends `service_tier: "flex"` when configured. No doc confirms that the ChatGPT backend honors it, or how it counts against included limits. The Codex speed page does not mention flex.
4. **"Full session" vs "full request".** The gpt-5.4 / gpt-5.5 pages say the long-context multiplier applies "for the full session". The gpt-5.6 / gpt-6 pages say "for the full request". I found no doc explaining whether "session" means more than the single request (for example, later turns after one >272K request).
5. **Scale Tier spillover.** One OpenAI page says Scale Tier spillover goes to Fast mode. The Fast mode docs and FAQ treat them as separate. Unresolved.
6. **Which ChatGPT plans get Codex Fast by default today.** The PR says "Enterprise and business-like" plans. The current list comes from the server catalog (`default_service_tier`) and was not observable.
7. **Mythos in Claude Code.** The model-config page does not mention Mythos models. Availability and billing in Claude Code are unknown.
8. **Gemini CLI remote compression experiment.** The current server-side value of `CONTEXT_COMPRESSION_THRESHOLD` is not observable. I also did not trace which concrete model the compression alias resolves to after fallbacks.
9. **OpenCode per-model limit overrides.** Overriding `limit.context` / `limit.input` in a provider model config was not checked against the docs.
10. **Gemini 3 Pro pricing.** It is not on the current pricing page, and gemini-3-pro-preview has a listed shutdown date of 2026-03-09. Its historical ≤200K / >200K prices were not re-verified. Gemini CLI still references `gemini-3-pro-preview` as `PREVIEW_GEMINI_MODEL`, and I did not trace how it is remapped.
11. **Qwen international vs other regions.** Prices differ about 1.7-2x by region. Which endpoint a given Qwen Code install uses (DashScope intl vs Beijing vs OAuth free tier) depends on the auth method and was not verified.
