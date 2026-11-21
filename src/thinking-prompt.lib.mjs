#!/usr/bin/env node
import { promptText, localizePromptConstant } from './prompt-text.lib.mjs';

import { supportsEffortLevel, supportsThinkingBudget } from './config.lib.mjs';
import { defaultModels, mapModelForTool } from './models/index.mjs';

export const THINK_PROMPT_MESSAGES = Object.freeze({
  minimal: promptText('prompt.templates.thinking-prompt.THINK_PROMPT_MESSAGES.text1', {}, { locale: 'en' }),
  low: promptText('prompt.templates.thinking-prompt.THINK_PROMPT_MESSAGES.text2', {}, { locale: 'en' }),
  medium: promptText('prompt.templates.thinking-prompt.THINK_PROMPT_MESSAGES.text3', {}, { locale: 'en' }),
  high: promptText('prompt.templates.thinking-prompt.THINK_PROMPT_MESSAGES.text4', {}, { locale: 'en' }),
  xhigh: promptText('prompt.templates.thinking-prompt.THINK_PROMPT_MESSAGES.text5', {}, { locale: 'en' }),
  ultra: promptText('prompt.templates.thinking-prompt.THINK_PROMPT_MESSAGES.text6', {}, { locale: 'en' }),
  max: promptText('prompt.templates.thinking-prompt.THINK_PROMPT_MESSAGES.text7', {}, { locale: 'en' }),
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
  return localizePromptConstant(THINK_PROMPT_MESSAGES[options?.argv?.think]);
};
