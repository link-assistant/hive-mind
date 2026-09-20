# Issue 1634 case study: Codex pricing display

## Source artifacts

- Issue snapshot: `raw/issue-1634.json`
- Prepared PR snapshot: `raw/pr-1636.json`
- Referenced PR snapshot: `raw/referenced-pr-1859.json`
- Referenced PR comments: `raw/referenced-pr-1859-comments.json`
- Referenced failing comment: `raw/referenced-comment-4271561699.json`
- Referenced solution log: `raw/solution-draft-log-pr-1776463285180.txt`
- Extracted unknown-pricing comment summary: `raw/pr-1859-codex-cost-comment-summary.json`
- models.dev API snapshot: `raw/models-dev-api.json`

## Timeline

- 2026-04-17 22:01:21 UTC: The referenced Codex run finished. Its log reports one `turn.completed` event and usage fields `input_tokens`, `cached_input_tokens`, and `output_tokens`.
- 2026-04-17 22:01:31 UTC: The referenced PR comment was posted with `Public pricing estimate: unknown` and a raw `Token usage:` line.
- 2026-04-17 22:11:23 UTC: Issue 1634 was opened to fix Codex pricing and duplicate token display.
- 2026-04-17 22:23:25 UTC: Draft PR 1636 was created for this issue.

## Requirements

- Show a public pricing estimate for `--tool codex` when models.dev contains the requested model.
- Remove the duplicated raw `Token usage:` line when the shared budget-stats `Total:` line already summarizes the same token data.
- Reuse the same context and token display path used by `--tool claude` and `--tool agent`.
- Check whether Codex provides direct price data or richer token data.
- Preserve issue data and log evidence in `docs/case-studies/issue-1634`.
- Add tracing or verbose output if data is insufficient for root-cause analysis.
- Report external upstream issues only if the root cause is outside this repository.

## Evidence

The failing comment at `https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1859#issuecomment-4271561699` showed:

```text
Public pricing estimate: unknown
Token usage: 42,742 input, 4,784 output, 885,376 cache read
Total: (42.7K + 885.4K cached) input tokens, 4.8K output tokens
```

The corresponding log shows Codex emitted token usage from a `turn.completed` event, but the old code only wrapped it as:

```js
{
  modelId: "gpt-5.4",
  modelName: "gpt-5.4",
  provider: "OpenAI",
  tokenUsage
}
```

It did not fetch model pricing, compute `totalCostUSD`, set `publicPricingEstimate`, or attach model limits for the shared budget-stats renderer.

## External facts

- OpenAI API pricing lists GPT-5.4 at $2.50 per 1M input tokens, $0.25 per 1M cached input tokens, and $15.00 per 1M output tokens: https://openai.com/api/pricing/
- The OpenAI GPT-5.4 model page lists a 1,050,000 token context window, 128,000 max output tokens, and says prompts over 272K input tokens are charged at higher long-context rates for GPT-5.4 sessions: https://developers.openai.com/api/docs/models/gpt-5.4/
- OpenAI's Codex token-based rate card maps GPT-5.4 input, cached input, and output token usage to credits, confirming Codex usage is token-metered: https://help.openai.com/en/articles/20001106-codex-rate-card
- The models.dev snapshot in `raw/models-dev-api.json` contains OpenAI `gpt-5.4` with input, output, cached input, long-context pricing, and model limits.

## Root causes

1. `executeCodexCommand()` parsed Codex token usage but did not calculate pricing. `publicPricingEstimate` was never returned for Codex, so GitHub comments rendered `unknown`.
2. The generic cost block always appended `Token usage:` when `pricingInfo.tokenUsage` existed. When `--tokens-budget-stats` was also enabled, this duplicated the shared `Total:` line.
3. Codex token usage did not retain peak per-turn context usage. That prevented the shared renderer from showing context-window usage and prevented long-context pricing decisions.
4. The generic models.dev lookup preferred Anthropic for Claude but had no way to prefer OpenAI for OpenAI model IDs. For `gpt-5.4`, relying on first provider order can select a non-OpenAI entry with incomplete cached-token pricing.

## Solution

- Added Codex pricing calculation from models.dev with OpenAI provider preference.
- Returned `publicPricingEstimate` from Codex runs and included `totalCostUSD`, `modelInfo`, and model limits in `pricingInfo`.
- Tracked `peakContextUsage` from Codex `turn.completed` input usage.
- Applied GPT-5.4 long-context pricing when peak prompt usage exceeds 272K input tokens and models.dev exposes `context_over_200k` rates.
- Reused `buildAgentBudgetStats()` and `buildBudgetStatsString()` for Codex token/context display through the existing `pricingInfo.tokenUsage` fallback path.
- Added an option to omit raw token usage from the cost block when budget stats are already rendered.

For the referenced comment, standard under-272K pricing would be:

```text
(42,742 * 2.50 + 885,376 * 0.25 + 4,784 * 15.00) / 1,000,000 = $0.399959
```

The referenced log's single turn had a peak prompt of approximately `42,742 + 885,376 = 928,118` input tokens, so the fixed Codex path applies GPT-5.4 long-context pricing:

```text
(42,742 * 5.00 + 885,376 * 0.50 + 4,784 * 22.50) / 1,000,000 = $0.764038
```

No external upstream issue is needed: Codex exposes the token data required for this repository to calculate and display a public estimate.

## Verification plan

- Unit-test Codex JSON parsing for peak context tracking.
- Unit-test Codex pricing for GPT-5.4 standard and long-context rates.
- Unit-test cost comment rendering so raw `Token usage:` can be suppressed when budget stats render `Total:`.
- Run targeted Codex and cost-info tests.
- Run lint and the repository test suite before finalizing the PR.
