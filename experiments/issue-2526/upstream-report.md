Additional reproduction from Codex CLI 0.160.0 while fixing [link-assistant/hive-mind#2526](https://github.com/link-assistant/hive-mind/issues/2526), with the workaround implemented in [PR #2527](https://github.com/link-assistant/hive-mind/pull/2527).

The CLI already provides a token-free model catalogue, but `supported_reasoning_levels` appears to describe the picker choices rather than every valid API setting. For example, GPT-6 Sol's [official model page](https://developers.openai.com/api/docs/models/gpt-6-sol) supports `none`, while its CLI catalogue lists only `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`. Conversely, GPT-6.1 Sol's [model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol) excludes `none`, and a retained `none` configuration causes an HTTP 400. This is also related to [#45009](https://github.com/openai/codex/issues/45009).

Reproduce the metadata discrepancy without authentication or inference:

```sh
codex --version
codex debug models > /tmp/codex-models.json
jq '.models[] | select(.slug == "gpt-6-sol" or .slug == "gpt-6.1-sol") | {slug, default_reasoning_level, supported_reasoning_levels}' /tmp/codex-models.json
```

The historical failing request is preserved in [our case study](https://github.com/link-assistant/hive-mind/blob/issue-2526-977f266926a4/docs/case-studies/issue-2526/data/failure.log#L738). It used `--model gpt-6.1-sol -c model_reasoning_effort=none`; the API rejected `reasoning.effort` and listed `low`, `medium`, `high`, `xhigh`, and `max`. We did not repeat that inference request to reproduce the metadata issue.

Workaround: consume the CLI's exact per-model metadata; keep documented `none` support for known models whose picker omits it; select the closest supported tier for other unsupported settings (`none` → `low` for GPT-6.1 Sol); and omit an explicit effort when no reliable capability list exists. Do not assume every future GPT model accepts the same enum.

Suggested implementation:

1. Expose separate complete API capability and picker-choice lists, with a clear distinction between API effort and CLI delegation mode (`ultra`). Include the complete list and default in both the CLI model catalogue and the API-key model metadata requested here.
2. When changing models, validate an inherited `model_reasoning_effort` against the destination model's capabilities before submitting a request. Choose a supported default or nearest effort and emit a diagnostic explaining the adjustment.
3. Add tests for `none` accepted by GPT-6 Sol, `none` rejected by GPT-6.1 Sol, and a newly listed model with a different effort set. The listing should remain free and should not require probing a completion endpoint.
