# Third-party aggregator coverage on 2026-09-04

The question this measurement answers: **can a third-party model aggregator be
the source of truth for "all new models"?**

Method: query each aggregator's public, unauthenticated catalogue endpoint and
check for the two models named in issue #2202 — `claude-fable-5-1` (released
2026-09-01) and `gpt-6-astra` (released 2026-09-03).

| Aggregator        | Endpoint                                                           | `claude-fable-5-1`                                                                                                  | `gpt-6-astra`                |
| ----------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| models.dev        | `https://models.dev/api.json`                                      | present (`anthropic.models["claude-fable-5-1"]`)                                                                    | **absent**                   |
| OpenRouter        | `https://openrouter.ai/api/v1/models`                              | present as `anthropic/claude-fable-5.1`, `context_length` 1000000, prompt `$0.00001`/tok, completion `$0.00005`/tok | **absent**                   |
| LiteLLM           | `model_prices_and_context_window.json`                             | present, plus regional variants `anthropic.claude-fable-5-1`, `us.anthropic.claude-fable-5-1`                       | **absent**                   |
| Codex CLI 0.150.1 | `codex debug models` (local)                                       | n/a (OpenAI only)                                                                                                   | **absent**                   |
| OpenAI docs       | `https://developers.openai.com/api/docs/models/gpt-6-astra`        | n/a                                                                                                                 | **present**, with full specs |
| Anthropic docs    | `https://platform.claude.com/docs/en/about-claude/models/overview` | **present**, with full specs                                                                                        | n/a                          |

## Conclusion

All three independent aggregators carry a model released on **2026-09-01** and
none carries a model released on **2026-09-03**. Aggregator lag is measured in
days, not hours.

Two design consequences for issue #2202:

1. An aggregator is a **metadata fallback**, never the catalogue. The catalogue
   of _usable_ models must come from something the account can actually reach —
   the vendor's own `/v1/models` (through the router, or directly), or the
   locally installed CLI's own catalogue.
2. Because every aggregator misses the newest model, and the locally installed
   `codex-cli 0.150.1` also misses it while `0.153.2` is published, R6's
   "check if a new version is available … before providing a new models list"
   is not housekeeping — it is the only mechanism in the whole design that can
   surface `gpt-6-astra` at all on a Codex-only host.
