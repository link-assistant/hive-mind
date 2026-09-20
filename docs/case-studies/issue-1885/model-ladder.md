# The model ladder — Issue #1885

`--escalate` operates over a single ordered ladder of Claude tiers, cheapest →
most capable:

```
haiku  <  sonnet  <  opus  <  fable
```

This is `MODEL_ESCALATION_ORDER` in `src/solve.escalate.lib.mjs`. Everything —
range bounds, "the next tier up", and `--escalate-steps` expansion — is derived
from indices into this single list, so there is exactly one place to change if the
ladder ever grows.

## Mapping to concrete models

The short tier names map onto the project's existing model aliases
(`claudeModels` in `src/models/index.mjs`), so escalate reuses the same model
resolution as every other `--model` value:

| Tier     | Short name | Resolves to (alias)         |
| -------- | ---------- | --------------------------- |
| cheapest | `haiku`    | `claude-haiku-4-5-20251001` |
|          | `sonnet`   | `claude-sonnet-4-6`         |
|          | `opus`     | `claude-opus-4-8`           |
| top      | `fable`    | `claude-fable-5`            |

## Alias handling

`canonicalTier(name)` normalizes a model name to its ladder tier. It accepts the
short names and common aliases, case-insensitively, trimming whitespace:

- `opus`, `opus-4-8`, `claude-opus-4-8` → `opus`
- `sonnet`, `sonnet-4-6`, `claude-sonnet-4-6` → `sonnet`
- `fable`, `fable-5`, `claude-fable-5` → `fable`
- `haiku`, `haiku-4-5`, `claude-haiku-4-5-20251001` → `haiku`

Aliases are accepted by **`--escalate-from`** (a single, unambiguous value). They
are **not** accepted inside an **`--escalate <range>`**, because the `-` inside
`opus-4-8` collides with the range delimiter — see
[`analysis.md`](./analysis.md) §4.

## Worked examples

| Command                                     | `{from, to, steps}`            | Plan (`buildEscalationPlan`)    | First session runs on |
| ------------------------------------------- | ------------------------------ | ------------------------------- | --------------------- |
| `--escalate`                                | `{sonnet, fable, 1}` (default) | `sonnet → opus → fable`         | `sonnet`              |
| `--escalate sonnet-opus`                    | `{sonnet, opus, 1}`            | `sonnet → opus`                 | `sonnet`              |
| `--escalate opus`                           | `{opus, opus, 1}`              | `opus`                          | `opus`                |
| `--escalate-from haiku`                     | `{haiku, fable, 1}`            | `haiku → sonnet → opus → fable` | `haiku`               |
| `--escalate --escalate-steps 2`             | `{sonnet, fable, 2}`           | `sonnet×2 → opus×2 → fable×2`   | `sonnet`              |
| `--escalate-from sonnet --escalate-steps 2` | `{sonnet, fable, 2}`           | `sonnet×2 → opus×2 → fable×2`   | `sonnet`              |

The **plan** is the full list of working sessions, in order. The first regular
solve session is plan index 0 (so it runs on the lower bound). `runEscalation`
then walks indices 1..N-1, restarting the AI tool on each subsequent tier **only
while** the deferred-work detector still finds unfinished work. If the cheap model
finished, escalation stops early and the more expensive tiers in the plan are
never used.

## Invalid inputs (rejected at config time)

| Input                                       | Why it is rejected                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `--escalate fable-sonnet`                   | Reversed range: lower bound is more capable than upper bound.                    |
| `--escalate opus-4-8`                       | Dashed alias inside a range is ambiguous; use a short name or `--escalate-from`. |
| `--escalate gpt-fable`                      | `gpt` is not a ladder tier.                                                      |
| `--escalate-from gpt-4`                     | `gpt-4` is not a known Claude tier/alias.                                        |
| `--escalate-steps 0` / `-1` / `1.5` / `abc` | Steps must be a positive integer.                                                |

Validation happens eagerly in `resolveEscalationConfig` (called from the config
normalization block), so a typo fails fast with a clear message before any tokens
are spent.
