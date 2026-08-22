# External research snapshot (2026-07-11)

## OpenAI model catalog

OpenAI maintains a model catalog with canonical model IDs. It demonstrates why
Hive Mind should validate against known model identities instead of accepting
arbitrary provider-prefixed strings.

Source: https://developers.openai.com/api/docs/models/all

## Provider-prefixed Codex IDs

Two upstream reports establish the relevant compatibility trade-off:

- `openai/codex#21070` documents gateways that return provider-prefixed IDs such
  as `openai/gpt-5.3-codex`.
- `openai/codex#12295` documents ChatGPT-authenticated Codex rejecting a
  provider-prefixed model while accepting its bare name.

Consequently, Hive Mind should support explicit prefix forms without forcing
them on callers or silently stripping them.

Sources:

- https://github.com/openai/codex/issues/21070
- https://github.com/openai/codex/issues/12295

## Codex provider configuration

Codex's configuration schema includes a built-in `openai` provider and supports
custom model providers. Provider identity and model identity are related but
separate concepts, reinforcing the decision to preserve an explicitly supplied
prefix.

Source: https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json
