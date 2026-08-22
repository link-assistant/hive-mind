#!/usr/bin/env node

import { codexModels } from './models/index.mjs';

export const mapModelToId = model => codexModels[model] || model;

// Issue #2027: Map the shared hive-mind --think levels to Codex `model_reasoning_effort`
// values. GPT-5.6 Sol (the default Codex model) keeps the full ladder inherited from the
// GPT-5.5/GPT-5.4 generation — low/medium/high/xhigh — and adds `max` *above* xhigh for the
// deepest single-agent reasoning, plus a multi-agent `ultra` mode. Because every hive level
// has a same-named Codex reasoning effort, the mapping is a predictable identity: `xhigh`
// stays `xhigh` (natively supported per `codex debug models`), `ultra` selects GPT-5.6's
// multi-agent ultra mode (the counterpart of Claude's "ultracode"), and `max` selects the
// deepest single-agent effort. `off` disables reasoning (`none`). See docs/case-studies/issue-2027.
const THINK_LEVEL_TO_CODEX_REASONING = {
  off: 'none',
  // Issue #2038: Codex/GPT-5.x natively exposes a `minimal` reasoning effort below `low`.
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  ultra: 'ultra',
  max: 'max',
};

// Issue #2027: GPT-5.6 Sol's multi-agent `ultra` mode spawns subagents and consumes far more
// tokens per turn than single-agent reasoning. OpenAI's guidance is explicit: never use `ultra`
// reasoning effort without a `rollout_token_budget` cap, or it can run away on cost. We pair
// every `ultra` selection with this budget (their recommended default) so `--think ultra` stays
// predictable. Override with `--rollout-token-budget`.
export const CODEX_ULTRA_ROLLOUT_TOKEN_BUDGET = 500000;

const resolveUltraRolloutTokenBudget = argv => {
  const override = argv?.rolloutTokenBudget;
  return Number.isFinite(override) && override > 0 ? override : CODEX_ULTRA_ROLLOUT_TOKEN_BUDGET;
};

export const resolveCodexReasoningEffort = argv => {
  const maxBudget = Number.isFinite(argv?.maxThinkingBudget) && argv.maxThinkingBudget > 0 ? argv.maxThinkingBudget : 31999;
  const thinkingBudget = Number.isFinite(argv?.thinkingBudget) ? argv.thinkingBudget : undefined;

  if (thinkingBudget !== undefined) {
    if (thinkingBudget <= 0) {
      return {
        reasoningEffort: 'none',
        source: `--thinking-budget ${thinkingBudget}`,
      };
    }

    const ratio = Math.min(1, thinkingBudget / maxBudget);
    // Issue #2027: the budget-derived effort caps at `xhigh` — the deepest tier every Codex
    // model (including the gpt-5.5 runtime fallback) supports. `max` is GPT-5.6-only and `ultra`
    // needs a paired rollout token budget, so both require an explicit `--think max`/`--think ultra`
    // to stay predictable rather than being reached implicitly through a token budget.
    const reasoningEffort = ratio <= 0.2 ? 'minimal' : ratio <= 0.4 ? 'low' : ratio <= 0.6 ? 'medium' : ratio <= 0.8 ? 'high' : 'xhigh';

    return {
      reasoningEffort,
      source: `--thinking-budget ${thinkingBudget}`,
    };
  }

  if (argv?.think && THINK_LEVEL_TO_CODEX_REASONING[argv.think]) {
    const reasoningEffort = THINK_LEVEL_TO_CODEX_REASONING[argv.think];
    const result = {
      reasoningEffort,
      source: `--think ${argv.think}`,
    };
    if (reasoningEffort === 'ultra') {
      result.rolloutTokenBudget = resolveUltraRolloutTokenBudget(argv);
    }
    return result;
  }

  return {
    reasoningEffort: 'none',
    source: 'default',
  };
};

export default {
  mapModelToId,
  resolveCodexReasoningEffort,
  CODEX_ULTRA_ROLLOUT_TOKEN_BUDGET,
};
