# OpenAI GPT-5.6 Preview Notes

Source: https://openai.com/index/previewing-gpt-5-6-sol/

Fetched: 2026-06-27

## Relevant model data

- The article announces a limited preview of the GPT-5.6 family with three tiers:
  Sol, Terra, and Luna.
- It describes Sol as the flagship model, Terra as balanced for everyday work,
  and Luna as fast and affordable.
- Availability is initially through the API and Codex for selected trusted
  partners and organizations, with broader ChatGPT, Codex, and API availability
  planned.
- GPT-5.6 introduces a `max` reasoning effort and an `ultra` mode, but hive-mind
  only needs model identifier support for this issue.

## Slug inference

The article gives tier names but not CLI slugs. The matching upstream OpenAI
Codex Bedrock provider constants use these concrete model IDs:

- `openai.gpt-5.6-sol`
- `openai.gpt-5.6-terra`
- `openai.gpt-5.6-luna`

The local registry therefore accepts both the provider-prefixed IDs above and
the plain Codex-style IDs:

- `gpt-5.6-sol`
- `gpt-5.6-terra`
- `gpt-5.6-luna`
