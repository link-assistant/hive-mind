#!/usr/bin/env node

/**
 * Unified model mapping module
 * Provides a single source of truth for model name mapping across all tools
 */

// Claude models (Anthropic API)
// Updated for Opus 4.5/4.6 support (Issue #1221, Issue #1238)
export const claudeModels = {
  sonnet: 'claude-sonnet-4-5-20250929', // Sonnet 4.5
  opus: 'claude-opus-4-5-20251101', // Opus 4.5 (default, Issue #1238)
  haiku: 'claude-haiku-4-5-20251001', // Haiku 4.5
  'haiku-3-5': 'claude-3-5-haiku-20241022', // Haiku 3.5
  'haiku-3': 'claude-3-haiku-20240307', // Haiku 3
  // Shorter version aliases (Issue #1221 - PR comment feedback)
  'opus-4-6': 'claude-opus-4-6', // Opus 4.6 short alias
  'opus-4-5': 'claude-opus-4-5-20251101', // Opus 4.5 short alias
  'sonnet-4-5': 'claude-sonnet-4-5-20250929', // Sonnet 4.5 short alias
  'haiku-4-5': 'claude-haiku-4-5-20251001', // Haiku 4.5 short alias
  // Version aliases for backward compatibility (Issue #1221)
  'claude-opus-4-6': 'claude-opus-4-6', // Opus 4.6
  'claude-opus-4-5': 'claude-opus-4-5-20251101', // Opus 4.5
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250929', // Sonnet 4.5
  'claude-haiku-4-5': 'claude-haiku-4-5-20251001', // Haiku 4.5
};

// Agent models (OpenCode API and Kilo Gateway via agent CLI)
// Issue #1300: Updated free models to match agent PR #191
export const agentModels = {
  // OpenCode Zen free models (current)
  grok: 'opencode/grok-code',
  'grok-code': 'opencode/grok-code',
  'grok-code-fast-1': 'opencode/grok-code',
  'big-pickle': 'opencode/big-pickle',
  'gpt-5-nano': 'opencode/gpt-5-nano',
  'minimax-m2.5-free': 'opencode/minimax-m2.5-free', // New: upgraded from M2.1
  'kimi-k2.5-free': 'opencode/kimi-k2.5-free',
  // Kilo Gateway free models (Issue #1282, updated in #1300)
  // Short names for Kilo-exclusive models (Issue #1300)
  'glm-5-free': 'kilo/glm-5-free', // Kilo-exclusive
  'glm-4.5-air-free': 'kilo/glm-4.5-air-free', // Kilo-exclusive: agent-centric model
  'deepseek-r1-free': 'kilo/deepseek-r1-free', // Kilo-exclusive: reasoning model
  'giga-potato-free': 'kilo/giga-potato-free', // Kilo-exclusive
  'trinity-large-preview': 'kilo/trinity-large-preview', // Kilo-exclusive
  // Full names with kilo/ prefix
  'kilo/glm-5-free': 'kilo/glm-5-free',
  'kilo/glm-4.5-air-free': 'kilo/glm-4.5-air-free',
  'kilo/minimax-m2.5-free': 'kilo/minimax-m2.5-free', // Also on OpenCode Zen
  'kilo/deepseek-r1-free': 'kilo/deepseek-r1-free',
  'kilo/giga-potato-free': 'kilo/giga-potato-free',
  'kilo/trinity-large-preview': 'kilo/trinity-large-preview',
  // Deprecated free models (kept for backward compatibility)
  'glm-4.7-free': 'opencode/glm-4.7-free', // Deprecated: no longer free
  'minimax-m2.1-free': 'opencode/minimax-m2.1-free', // Deprecated: replaced by m2.5
  'kilo/glm-4.7-free': 'kilo/glm-4.7-free', // Deprecated: replaced by glm-4.5-air-free
  'kilo/kimi-k2.5-free': 'kilo/kimi-k2.5-free', // Deprecated: not recommended
  'kilo/minimax-m2.1-free': 'kilo/minimax-m2.1-free', // Deprecated: replaced by m2.5
  // Premium models
  sonnet: 'anthropic/claude-3-5-sonnet',
  haiku: 'anthropic/claude-3-5-haiku',
  opus: 'anthropic/claude-3-opus',
  'gemini-3-pro': 'google/gemini-3-pro',
};

// OpenCode models (OpenCode API)
export const opencodeModels = {
  gpt4: 'openai/gpt-4',
  gpt4o: 'openai/gpt-4o',
  claude: 'anthropic/claude-3-5-sonnet',
  sonnet: 'anthropic/claude-3-5-sonnet',
  opus: 'anthropic/claude-3-opus',
  gemini: 'google/gemini-pro',
  grok: 'opencode/grok-code',
  'grok-code': 'opencode/grok-code',
  'grok-code-fast-1': 'opencode/grok-code',
};

// Codex models (OpenAI API)
export const codexModels = {
  gpt5: 'gpt-5',
  'gpt5-codex': 'gpt-5-codex',
  o3: 'o3',
  'o3-mini': 'o3-mini',
  gpt4: 'gpt-4',
  gpt4o: 'gpt-4o',
  claude: 'claude-3-5-sonnet',
  sonnet: 'claude-3-5-sonnet',
  opus: 'claude-3-opus',
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
      return Object.keys(codexModels).includes(model) || mappedModel.startsWith('gpt-') || mappedModel.startsWith('o3') || mappedModel.startsWith('claude-');
    default:
      return true;
  }
};

/**
 * Get a list of valid model names for a tool
 * @param {string} tool - The tool name
 * @returns {string[]} Array of valid model names
 */
export const getValidModelsForTool = tool => {
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

    throw new Error(`Model '${model}' (mapped to '${mappedModel}') is not compatible with --tool ${tool}.\n` + `Valid models for ${tool}: ${validModels.join(', ')}\n` + 'Hint: Different tools use different model APIs and naming conventions.');
  }
};
