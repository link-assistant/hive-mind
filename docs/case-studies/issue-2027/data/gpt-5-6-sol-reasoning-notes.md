# GPT-5.6 Sol Reasoning Effort Notes

Collected for issue 2027 (2026-07-09).

## Sources

- OpenAI live event: https://openai.com/live/
- OpenAI GPT-5.6 Sol preview: https://openai.com/index/previewing-gpt-5-6-sol/
- Local authoritative data: `codex debug models` (codex-cli 0.142.5), captured in
  `codex-debug-models.json` / `codex-debug-models-summary.json`.
- Prior case study: `docs/case-studies/issue-1992` (already added the GPT-5.6
  Sol/Terra/Luna model IDs to the hive-mind registry).

## Reasoning ladder

GPT-5.6 Sol keeps the existing Codex reasoning ladder and extends it upward:

- `none` disables reasoning (used by hive-mind when no thinking level is set).
- `low`, `medium`, `high`, `xhigh` are the standard efforts. Every model in the
  local Codex catalog (including the current default `gpt-5.5`) supports these
  four levels, confirmed by `codex debug models`.
- `max` sits above `xhigh` and is exposed by the GPT-5.6 Sol preview family.
- `ultra` is a multi-agent mode. It must be paired with a `rollout_token_budget`
  cap, because without a cap the multi-agent fan-out can consume an unbounded
  number of tokens. The recommended default cap is `500000`.

## Mapping decision for hive-mind

hive-mind exposes a unified `--think` scale. For Codex we use an identity
mapping so the levels stay predictable and match the model's own vocabulary:

| `--think` | Codex `model_reasoning_effort` | Notes                                                       |
| --------- | ------------------------------ | ----------------------------------------------------------- |
| (unset)   | `none`                         | Default: no thinking enforced (R5)                          |
| `off`     | `none`                         | Explicitly disable reasoning                                |
| `low`     | `low`                          |                                                             |
| `medium`  | `medium`                       |                                                             |
| `high`    | `high`                         |                                                             |
| `xhigh`   | `xhigh`                        | Universally supported today                                 |
| `ultra`   | `ultra`                        | Multi-agent mode, paired with `rollout_token_budget=500000` |
| `max`     | `max`                          | Highest single-agent effort (GPT-5.6 Sol)                   |

When effort is derived from a token budget instead of an explicit `--think`
level, the top bucket is capped at `xhigh` so a budget alone never silently
triggers the `max`/`ultra` extremes (those require an explicit `--think`).
