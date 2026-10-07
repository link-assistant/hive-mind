#!/usr/bin/env node

import { CODEX_MODEL_VARIANTS } from './models/catalog.mjs';
import { getRuntimeModelAlias } from './models/aliases.mjs';
import { REASONING_EFFORT_ORDER, getModelReasoningCapabilities, normalizeReasoningCapabilities, selectSupportedReasoningEffort } from './model-reasoning.lib.mjs';

// Aliases validation resolved against the installed Codex catalogue win, so the
// run uses the same model the validation step reported (Issue #2591).
export const mapModelToId = model => getRuntimeModelAlias('codex', model) || CODEX_MODEL_VARIANTS[model] || model;

// Translate the shared --think level into a requested Codex effort. The selected
// model's capabilities are applied below: none, minimal, max and ultra are not
// universal. Ultra is a delegation mode above the single-agent max effort.
const THINK_LEVEL_TO_CODEX_REASONING = {
  off: 'none',
  // Minimal expresses an intent below low; models may require a nearby tier.
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

const resolveRequestedCodexReasoningEffort = argv => {
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
    // Budget-derived intent caps at xhigh. Max and delegation require an explicit
    // --think request; the selected model's supported tiers constrain this intent below.
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

export const resolveCodexReasoningEffort = (argv, { capabilities = null, catalogue = null, maxEffort = null } = {}) => {
  const requested = resolveRequestedCodexReasoningEffort(argv);
  // Preserve the model-independent mapping API for callers asking only about levels.
  if (!argv?.model && !capabilities && !catalogue) return requested;
  let resolved = normalizeReasoningCapabilities(capabilities) ?? getModelReasoningCapabilities(argv?.model, catalogue);
  const ceiling = REASONING_EFFORT_ORDER.indexOf(maxEffort);
  if (resolved && ceiling >= 0) {
    const supportedReasoningEfforts = resolved.supportedReasoningEfforts.filter(effort => effort === 'auto' || REASONING_EFFORT_ORDER.indexOf(effort) <= ceiling);
    if (!supportedReasoningEfforts.length) throw new Error(`Model ${argv?.model} does not support a reasoning effort at or below ${maxEffort}`);
    resolved = { ...resolved, supportedReasoningEfforts };
  }
  const reasoningEffort = selectSupportedReasoningEffort(requested.reasoningEffort, resolved);
  const result = { reasoningEffort, source: requested.source };
  if (ceiling >= 0) result.source += `; ceiling ${maxEffort}`;
  if (reasoningEffort !== requested.reasoningEffort) {
    result.source += `; ${requested.reasoningEffort} -> ${reasoningEffort ?? 'model default'} (${resolved?.source ?? (resolved ? 'model capabilities' : 'capabilities unavailable')})`;
  }
  if (reasoningEffort === 'ultra') result.rolloutTokenBudget = resolveUltraRolloutTokenBudget(argv);
  return result;
};

export default {
  mapModelToId,
  resolveCodexReasoningEffort,
  CODEX_ULTRA_ROLLOUT_TOKEN_BUDGET,
};
