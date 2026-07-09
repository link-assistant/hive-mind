---
"@link-assistant/hive-mind": minor
---

Default `--tool codex` to `gpt-5.6-sol` and make the `--think` levels map predictably to Codex reasoning efforts (`off`→`none`, `low`/`medium`/`high`/`xhigh`/`ultra`/`max` as an identity mapping). GPT-5.6 Sol's multi-agent `ultra` mode is always paired with a `rollout_token_budget` cap (default `500000`, overridable via `--rollout-token-budget`), and budget-derived effort stays capped at `xhigh`. Align `--tool claude` by adding the matching `ultra` level (equivalent to `ultracode`). By default both tools run the model as-is with no thinking level enforced.
