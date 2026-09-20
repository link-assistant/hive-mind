# Online research for issue #2202

Collected 2026-09-04. Every number below is quoted from the primary vendor
source named next to it; the search-engine results are used only for release
dates and rollout status, which vendor reference pages do not carry.

## 1. Claude Fable 5.1 (the "Fable 5.1" of the issue title)

Source: <https://platform.claude.com/docs/en/about-claude/models/overview>
(fetched 2026-09-04; the docs.claude.com URL 302-redirects there).

| Field                     | Value                                                               |
| ------------------------- | ------------------------------------------------------------------- |
| Claude API ID             | `claude-fable-5-1`                                                  |
| Claude API alias          | `claude-fable-5-1` (dateless IDs are their own pinned snapshot)     |
| Amazon Bedrock ID         | `anthropic.claude-fable-5-1`                                        |
| Google Cloud ID           | `claude-fable-5-1`                                                  |
| Microsoft Foundry ID      | `claude-fable-5-1`                                                  |
| Claude Platform on AWS ID | `claude-fable-5-1`                                                  |
| Context window            | 1M tokens                                                           |
| Max output                | 128K tokens                                                         |
| Thinking                  | Adaptive (always on)                                                |
| Default effort            | `high`                                                              |
| Reliable knowledge cutoff | Jun 2026                                                            |
| Training data cutoff      | Jun 2026                                                            |
| Pricing                   | $10 / input MTok, $50 / output MTok                                 |
| Cache read                | 2.5% of base input (vs. the usual 10%)                              |
| Retirement                | Not sooner than September 1, 2027                                   |
| Position                  | Recommended "for demanding reasoning and long-horizon agentic work" |

Claude Fable 5 is now listed under **"Legacy models (still available)"**,
together with Opus 4.8 / 4.7 / 4.6 / 4.5 and Sonnet 4.6 / 4.5. The current
lineup is Fable 5.1, Opus 5, Sonnet 5, Haiku 4.5.

## 2. Claude Mythos 5.1

Source: <https://platform.claude.com/docs/en/models/mythos-5-1/overview>
(fetched 2026-09-04).

| Field                               | Value                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| Claude API ID                       | `claude-mythos-5-1`                                                             |
| Amazon Bedrock ID                   | `anthropic.claude-mythos-5-1`                                                   |
| Google Cloud / Microsoft Foundry ID | `claude-mythos-5-1`                                                             |
| Released                            | September 1, 2026                                                               |
| Status                              | Active (**invite only**, Project Glasswing)                                     |
| Context / max output                | 1M / 128K tokens                                                                |
| Pricing                             | $10 / $50 per MTok; 5m cache write $12.50, 1h cache write $20, cache read $0.25 |
| Relationship to Fable 5.1           | "the same model as Claude Fable 5.1, offered by invitation only"                |

This matters for the catalogue design: `claude-mythos-5-1` is a real, published
API ID that most accounts cannot call. A static table that ships it as a
selectable model is wrong for almost every user; a live catalogue that only
advertises what the account can actually reach is right. It is the cleanest
argument in the issue's favour for R2.

## 3. Anthropic Models API — the token-free listing endpoint

Source: <https://platform.claude.com/docs/en/api/models/list> (fetched 2026-09-04).

`GET /v1/models`, query parameters `after_id`, `before_id`, `limit`
(default 20, max 1000). Each `ModelInfo` carries:

- `id` — unique model identifier
- `display_name`
- `created_at` — RFC 3339 release datetime
- `max_input_tokens` — "Maximum input context window size in tokens"
- `max_tokens` — "Maximum value for the `max_tokens` parameter"
- `capabilities` — `batch`, `citations`, `code_execution`, `context_management`
  (`clear_thinking_20251015`, `clear_tool_uses_20250919`, `compact_20260112`),
  `effort` (`low`/`medium`/`high`/`xhigh`/`max`), `image_input`, `pdf_input`,
  `structured_outputs`, `thinking` (`adaptive`, `enabled`)

**There is no `context_window` field** — code that reads one gets `undefined`.
The context window is `max_input_tokens`.

The endpoint is a metadata listing, not an inference call: it takes no prompt,
returns no `usage` block, and is billed at nothing. This is the evidence for
R7 on the Claude side — listing models cannot spend tokens because there is no
completion to charge for.

## 4. GPT-6 Astra

Source: <https://developers.openai.com/api/docs/models/gpt-6-astra> (fetched 2026-09-04).

| Field                  | Value                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| Model API ID           | `gpt-6-astra`                                                                            |
| Context window         | 1,050,000                                                                                |
| Max input tokens       | 922,000                                                                                  |
| Max output tokens      | 128,000                                                                                  |
| Knowledge cutoff       | Apr 30, 2026                                                                             |
| `reasoning.effort`     | `low`, `medium`, `high`, `xhigh`, `max`                                                  |
| Endpoints              | Chat Completions (`v1/chat/completions`), Responses (`v1/responses`), Batch (`v1/batch`) |
| Input                  | $10 / MTok                                                                               |
| Cached input           | $1 / MTok                                                                                |
| Cache writes           | $12.5 / MTok                                                                             |
| Output                 | $50 / MTok                                                                               |
| Long-context surcharge | Prompts over 272K input tokens are charged 2x input/cache and 1.5x output                |

There is **no** `gpt-6-astra-mini`, `gpt-6-astra-pro`, or `gpt-6-astra-codex`
variant: source <https://developers.openai.com/api/docs/models> (fetched
2026-09-04) lists `gpt-6-astra` as the only GPT-6 model.

The same index page lists these current GPT-5.6 models, one of which Hive Mind
does not know: `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, and
**`gpt-5.6-cyber`** ("Advanced cybersecurity model"), plus the two Daybreak
aliases that the local Codex catalogue already advertises:
`gpt-daybreak-red-latest` ("advanced cybersecurity models for authorized
vulnerability research and security testing") and `gpt-daybreak-blue-latest`
("flagship general-purpose models with safeguards for defensive cybersecurity
work").

### Release and rollout status

- Announced and released **September 3, 2026** as a limited preview for trusted
  partners; public rollout to ChatGPT Plus/Pro/Business/Enterprise, the OpenAI
  API and AWS "over the coming days", with **September 5, 2026** cited as the
  broad availability date.
- Sources: [CNBC](https://www.cnbc.com/2026/09/03/open-ai-astra-gpt-6-cyber.html),
  [Axios](https://www.axios.com/2026/09/03/openai-astra-gpt-6-agi-brockman),
  [9to5Mac](https://9to5mac.com/2026/09/03/openai-releasing-major-upgrade-to-chatgpt-and-codex-with-gpt-6-astra-details-here/),
  [Wikipedia: GPT-6 Astra](https://en.wikipedia.org/wiki/GPT-6_Astra).

This one-day-old release is exactly the situation the issue is about: the model
is documented by the vendor, but it is **not** in models.dev's `api.json` and
**not** in the locally installed Codex CLI's catalogue (see
`../measurements/catalogue-gap-analysis.json`). Any mechanism that depends on a
third-party aggregator or on a bundled CLI's compiled-in table is, on
2026-09-04, structurally incapable of seeing GPT-6 Astra.

## 5. models.dev as a metadata fallback

`https://models.dev/api.json` — 4.4 MB, 213 providers on 2026-09-04.
It has `claude-fable-5-1` (release_date `2026-09-01`, limits
`{context: 1000000, output: 128000}`, cost `{input: 10, output: 50,
cache_read: 0.25, cache_write: 12.5}`, reasoning efforts low/medium/high/
xhigh/max, knowledge `2026-06`) — matching the vendor page exactly.

It does **not** have `gpt-6-astra`, `claude-mythos-5`, or `claude-mythos-5-1`.
That is the correct shape for a _fallback_: rich where it is present, silent
where it is not, and never authoritative over the vendor's own page.

## 6. Link.Assistant Router

- Repository: <https://github.com/link-assistant/router>
- Latest release on 2026-09-04: **v1.2.0**. Hive Mind pins
  `ghcr.io/link-assistant/router:0.119.0` (2026-08-26) — 26 releases behind.
  Full list: `../upstream/router-releases.json` and
  `../upstream/router-releases-since-0.119.0.md`.
- Router **v1.0.0** reclassified every public route into `/api/health`,
  `/api/management/*` and `/api/services/*`, and split the inference-only
  listener from the management listener. The authoritative table is
  `../upstream/router-route-contract.rs`; the client-facing summary is
  `../upstream/router-with-command.md`.
- The model-catalogue routes Hive Mind needs for R2/R5 are therefore:
  - `GET /api/services/anthropic/v1/models`
  - `GET /api/services/openai/v1/models`
  - `GET /api/services/codex/v1/models`
  - `GET /api/services/qwen/v1/models`
  - `GET /api/services/gemini/v1beta/models`
- Credential adoption commands that serve R3 directly:
  `router auth claude --from-claude-home`, `router auth codex --from-codex-home`.
