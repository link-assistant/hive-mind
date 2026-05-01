#!/usr/bin/env node

import { codexModels } from './models/index.mjs';

export const mapModelToId = model => codexModels[model] || model;

const THINK_LEVEL_TO_CODEX_REASONING = {
  off: 'none',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'xhigh',
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
    const reasoningEffort = ratio <= 0.2 ? 'minimal' : ratio <= 0.4 ? 'low' : ratio <= 0.6 ? 'medium' : ratio <= 0.8 ? 'high' : 'xhigh';

    return {
      reasoningEffort,
      source: `--thinking-budget ${thinkingBudget}`,
    };
  }

  if (argv?.think && THINK_LEVEL_TO_CODEX_REASONING[argv.think]) {
    return {
      reasoningEffort: THINK_LEVEL_TO_CODEX_REASONING[argv.think],
      source: `--think ${argv.think}`,
    };
  }

  return {
    reasoningEffort: 'none',
    source: 'default',
  };
};

export default {
  mapModelToId,
  resolveCodexReasoningEffort,
};
