#!/usr/bin/env node

import { supportsEffortLevel, supportsThinkingBudget } from './config.lib.mjs';
import { defaultModels, mapModelForTool } from './models/index.mjs';

export const THINK_PROMPT_MESSAGES = Object.freeze({
  low: 'Think.',
  medium: 'Think hard.',
  high: 'Think harder.',
  xhigh: 'Ultrathink.',
  ultra: 'Ultrathink.',
  max: 'Ultrathink.',
});

export const isClaudeLikeModel = model => {
  if (!model) return false;
  const normalized = String(model).toLowerCase();
  return normalized === 'opusplan' || normalized.includes('claude') || normalized.startsWith('anthropic/');
};

export const resolvePromptModelForTool = (tool = 'claude', model) => {
  const selectedModel = model || defaultModels[tool];
  return selectedModel ? mapModelForTool(tool, selectedModel) : null;
};

export const toolSupportsStructuredThinkingBudget = ({ tool = 'claude', claudeVersion, thinkingBudgetClaudeMinimumVersion } = {}) => {
  if (tool === 'claude') {
    return supportsThinkingBudget(claudeVersion || '0.0.0', thinkingBudgetClaudeMinimumVersion || '2.1.12');
  }

  // Codex maps --think/--thinking-budget to model_reasoning_effort instead of prompt text.
  return tool === 'codex';
};

export const shouldAddThinkingPromptInstruction = ({ tool = 'claude', argv, claudeVersion } = {}) => {
  const thinkLevel = argv?.think;
  if (!thinkLevel || !THINK_PROMPT_MESSAGES[thinkLevel]) {
    return false;
  }

  const resolvedModel = resolvePromptModelForTool(tool, argv?.model);
  if (!isClaudeLikeModel(resolvedModel)) {
    return false;
  }

  if (supportsEffortLevel(resolvedModel)) {
    return false;
  }

  return !toolSupportsStructuredThinkingBudget({
    tool,
    claudeVersion,
    thinkingBudgetClaudeMinimumVersion: argv?.thinkingBudgetClaudeMinimumVersion,
  });
};

export const getThinkingPromptInstruction = options => {
  if (!shouldAddThinkingPromptInstruction(options)) {
    return undefined;
  }
  return THINK_PROMPT_MESSAGES[options?.argv?.think];
};
