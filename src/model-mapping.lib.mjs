#!/usr/bin/env node

/**
 * Unified model mapping module
 * Provides a single source of truth for model name mapping across all tools
 */

// Claude models (Anthropic API)
export const claudeModels = {
  'sonnet': 'claude-sonnet-4-5-20250929',  // Sonnet 4.5
  'opus': 'claude-opus-4-5-20251101',      // Opus 4.5
  'haiku': 'claude-haiku-4-5-20251001',    // Haiku 4.5
  'haiku-3-5': 'claude-3-5-haiku-20241022', // Haiku 3.5
  'haiku-3': 'claude-3-haiku-20240307',     // Haiku 3
};

// Agent models (OpenCode API via agent CLI)
export const agentModels = {
  'grok': 'opencode/grok-code',
  'grok-code': 'opencode/grok-code',
  'grok-code-fast-1': 'opencode/grok-code',
  'big-pickle': 'opencode/big-pickle',
  'gpt-5-nano': 'openai/gpt-5-nano',
  'sonnet': 'anthropic/claude-3-5-sonnet',
  'haiku': 'anthropic/claude-3-5-haiku',
  'opus': 'anthropic/claude-3-opus',
  'gemini-3-pro': 'google/gemini-3-pro',
};

// OpenCode models (OpenCode API)
export const opencodeModels = {
  'gpt4': 'openai/gpt-4',
  'gpt4o': 'openai/gpt-4o',
  'claude': 'anthropic/claude-3-5-sonnet',
  'sonnet': 'anthropic/claude-3-5-sonnet',
  'opus': 'anthropic/claude-3-opus',
  'gemini': 'google/gemini-pro',
  'grok': 'opencode/grok-code',
  'grok-code': 'opencode/grok-code',
  'grok-code-fast-1': 'opencode/grok-code',
};

// Codex models (OpenAI API)
export const codexModels = {
  'gpt5': 'gpt-5',
  'gpt5-codex': 'gpt-5-codex',
  'o3': 'o3',
  'o3-mini': 'o3-mini',
  'gpt4': 'gpt-4',
  'gpt4o': 'gpt-4o',
  'claude': 'claude-3-5-sonnet',
  'sonnet': 'claude-3-5-sonnet',
  'opus': 'claude-3-opus',
};

/**
 * Map model name to full model ID for a specific tool
 * @param {string} tool - The tool name (claude, agent, opencode, codex)
 * @param {string} model - The model name or alias
 * @returns {string} The full model ID
 */
export const mapModelForTool = (tool, model) => {
  switch (tool) {
    case 'claude':
      return claudeModels[model] || model;
    case 'agent':
      return agentModels[model] || model;
    case 'opencode':
      return opencodeModels[model] || model;
    case 'codex':
      return codexModels[model] || model;
    default:
      return model;
  }
};

/**
 * Validate if a model is compatible with a tool
 * @param {string} tool - The tool name (claude, agent, opencode, codex)
 * @param {string} model - The model name or alias
 * @returns {boolean} True if the model is compatible with the tool
 */
export const isModelCompatibleWithTool = (tool, model) => {
  const mappedModel = mapModelForTool(tool, model);

  switch (tool) {
    case 'claude':
      // Claude only accepts models in the claude- namespace
      return mappedModel.startsWith('claude-');
    case 'agent':
      // Agent accepts any model with provider prefix (opencode/, anthropic/, etc.)
      // or models in the agentModels list
      return mappedModel.includes('/') || Object.keys(agentModels).includes(model);
    case 'opencode':
      // OpenCode accepts models with provider prefix
      return mappedModel.includes('/') || Object.keys(opencodeModels).includes(model);
    case 'codex':
      // Codex accepts OpenAI and some Claude models
      return Object.keys(codexModels).includes(model) ||
             mappedModel.startsWith('gpt-') ||
             mappedModel.startsWith('o3') ||
             mappedModel.startsWith('claude-');
    default:
      return true;
  }
};

/**
 * Get a list of valid model names for a tool
 * @param {string} tool - The tool name
 * @returns {string[]} Array of valid model names
 */
export const getValidModelsForTool = (tool) => {
  switch (tool) {
    case 'claude':
      return Object.keys(claudeModels);
    case 'agent':
      return Object.keys(agentModels);
    case 'opencode':
      return Object.keys(opencodeModels);
    case 'codex':
      return Object.keys(codexModels);
    default:
      return [];
  }
};

/**
 * Validate tool-model compatibility and throw descriptive error if invalid
 * @param {string} tool - The tool name
 * @param {string} model - The model name
 * @throws {Error} If the model is not compatible with the tool
 */
export const validateToolModelCompatibility = (tool, model) => {
  if (!isModelCompatibleWithTool(tool, model)) {
    const validModels = getValidModelsForTool(tool);
    const mappedModel = mapModelForTool(tool, model);

    throw new Error(
      `Model '${model}' (mapped to '${mappedModel}') is not compatible with --tool ${tool}.\n` +
      `Valid models for ${tool}: ${validModels.join(', ')}\n` +
      'Hint: Different tools use different model APIs and naming conventions.'
    );
  }
};
