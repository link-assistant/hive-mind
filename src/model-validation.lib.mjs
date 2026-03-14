#!/usr/bin/env node
// Model validation library for hive-mind
// Provides model name validation with exact matching and fuzzy suggestions

// Check if use is already defined (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

import { log } from './lib.mjs';

// Available models for each tool
// These are the "known good" model names that we accept
export const CLAUDE_MODELS = {
  // Short aliases (single word)
  sonnet: 'claude-sonnet-4-6', // Sonnet 4.6 (default, Issue #1329)
  opus: 'claude-opus-4-5-20251101', // Opus 4.5 (Issue #1238)
  haiku: 'claude-haiku-4-5-20251001',
  'haiku-3-5': 'claude-3-5-haiku-20241022',
  'haiku-3': 'claude-3-haiku-20240307',
  // Shorter version aliases (Issue #1221, Issue #1329 - PR comment feedback)
  'sonnet-4-6': 'claude-sonnet-4-6', // Sonnet 4.6 short alias (Issue #1329)
  'opus-4-6': 'claude-opus-4-6', // Opus 4.6 short alias
  'opus-4-5': 'claude-opus-4-5-20251101', // Opus 4.5 short alias
  'sonnet-4-5': 'claude-sonnet-4-5-20250929', // Sonnet 4.5 short alias (backward compatibility)
  'haiku-4-5': 'claude-haiku-4-5-20251001', // Haiku 4.5 short alias
  // Sonnet version aliases (Issue #1329)
  'claude-sonnet-4-6': 'claude-sonnet-4-6', // Sonnet 4.6
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250929', // Sonnet 4.5 (backward compatibility)
  // Opus version aliases (Issue #1221)
  'claude-opus-4-6': 'claude-opus-4-6', // Opus 4.6
  'claude-opus-4-5': 'claude-opus-4-5-20251101', // Opus 4.5
  // Haiku version aliases
  'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
  // Full model IDs (also valid inputs)
  'claude-sonnet-4-5-20250929': 'claude-sonnet-4-5-20250929',
  'claude-opus-4-5-20251101': 'claude-opus-4-5-20251101',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5-20251001',
  'claude-3-5-haiku-20241022': 'claude-3-5-haiku-20241022',
  'claude-3-haiku-20240307': 'claude-3-haiku-20240307',
};

// Models that support 1M token context window via [1m] suffix (Issue #1221, Issue #1238, Issue #1329)
// See: https://code.claude.com/docs/en/model-config
export const MODELS_SUPPORTING_1M_CONTEXT = [
  'claude-opus-4-6',
  'claude-opus-4-5-20251101',
  'claude-sonnet-4-6', // Sonnet 4.6 (Issue #1329)
  'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-5',
  'sonnet', // Now maps to Sonnet 4.6 (Issue #1329)
  'sonnet-4-6', // Short alias (Issue #1329)
  'opus',
  'opus-4-6', // Short alias (Issue #1221 - PR comment feedback)
  'opus-4-5', // Short alias (Issue #1238)
  'sonnet-4-5', // Short alias (Issue #1221 - PR comment feedback)
];

export const OPENCODE_MODELS = {
  gpt4: 'openai/gpt-4',
  gpt4o: 'openai/gpt-4o',
  claude: 'anthropic/claude-3-5-sonnet',
  sonnet: 'anthropic/claude-3-5-sonnet',
  opus: 'anthropic/claude-3-opus',
  gemini: 'google/gemini-pro',
  grok: 'opencode/grok-code',
  'grok-code': 'opencode/grok-code',
  'grok-code-fast-1': 'opencode/grok-code',
  // Full model IDs
  'openai/gpt-4': 'openai/gpt-4',
  'openai/gpt-4o': 'openai/gpt-4o',
  'anthropic/claude-3-5-sonnet': 'anthropic/claude-3-5-sonnet',
  'anthropic/claude-3-opus': 'anthropic/claude-3-opus',
  'google/gemini-pro': 'google/gemini-pro',
  'opencode/grok-code': 'opencode/grok-code',
};

export const CODEX_MODELS = {
  gpt5: 'gpt-5',
  'gpt-5': 'gpt-5',
  'gpt5-codex': 'gpt-5-codex',
  'gpt-5-codex': 'gpt-5-codex',
  o3: 'o3',
  'o3-mini': 'o3-mini',
  gpt4: 'gpt-4',
  gpt4o: 'gpt-4o',
  claude: 'claude-3-5-sonnet',
  sonnet: 'claude-3-5-sonnet',
  opus: 'claude-3-opus',
  // Full model IDs
  'gpt-4': 'gpt-4',
  'gpt-4o': 'gpt-4o',
  'claude-3-5-sonnet': 'claude-3-5-sonnet',
  'claude-3-opus': 'claude-3-opus',
};

export const AGENT_MODELS = {
  // Free models (via OpenCode Zen)
  // Issue #1185: Model IDs must use opencode/ prefix for OpenCode Zen models
  // Issue #1300: Updated free models - minimax-m2.5-free replaces m2.1, glm-4.7-free removed
  grok: 'opencode/grok-code',
  'grok-code': 'opencode/grok-code',
  'grok-code-fast-1': 'opencode/grok-code',
  'big-pickle': 'opencode/big-pickle',
  'gpt-5-nano': 'opencode/gpt-5-nano',
  'minimax-m2.5-free': 'opencode/minimax-m2.5-free', // Upgraded from M2.1 (Issue #1300); default as of Issue #1391
  // Free models (via Kilo Gateway)
  // Issue #1282: Kilo provider adds access to 500+ models including free tier
  // Issue #1300: Updated Kilo free models with new offerings
  // See: https://kilo.ai/docs/advanced-usage/free-and-budget-models
  // Short names for Kilo-exclusive models (Issue #1300)
  'glm-5-free': 'kilo/glm-5-free', // Kilo-exclusive: Z.AI flagship model
  'glm-4.5-air-free': 'kilo/glm-4.5-air-free', // Kilo-exclusive: Z.AI agent-centric model
  'deepseek-r1-free': 'kilo/deepseek-r1-free', // Kilo-exclusive: DeepSeek reasoning model
  'giga-potato-free': 'kilo/giga-potato-free', // Kilo-exclusive: Evaluation model
  'trinity-large-preview': 'kilo/trinity-large-preview', // Kilo-exclusive: Arcee AI preview
  // Full names with kilo/ prefix
  'kilo/glm-5-free': 'kilo/glm-5-free',
  'kilo/glm-4.5-air-free': 'kilo/glm-4.5-air-free',
  'kilo/minimax-m2.5-free': 'kilo/minimax-m2.5-free', // Also on OpenCode Zen
  'kilo/deepseek-r1-free': 'kilo/deepseek-r1-free',
  'kilo/giga-potato-free': 'kilo/giga-potato-free',
  'kilo/trinity-large-preview': 'kilo/trinity-large-preview',
  // Deprecated free models (kept for backward compatibility)
  // These models are no longer the recommended options but may still work
  'kimi-k2.5-free': 'opencode/kimi-k2.5-free', // Deprecated: not supported by OpenCode Zen (Issue #1391)
  'glm-4.7-free': 'opencode/glm-4.7-free', // Deprecated: no longer free on OpenCode Zen
  'minimax-m2.1-free': 'opencode/minimax-m2.1-free', // Deprecated: replaced by m2.5
  'kilo/glm-4.7-free': 'kilo/glm-4.7-free', // Deprecated: replaced by glm-4.5-air-free
  'kilo/kimi-k2.5-free': 'kilo/kimi-k2.5-free', // Deprecated: not recommended
  'kilo/minimax-m2.1-free': 'kilo/minimax-m2.1-free', // Deprecated: replaced by m2.5
  // Premium models (requires OpenCode Zen subscription)
  sonnet: 'anthropic/claude-3-5-sonnet',
  haiku: 'anthropic/claude-3-5-haiku',
  opus: 'anthropic/claude-3-opus',
  'gemini-3-pro': 'google/gemini-3-pro',
  // Full model IDs with provider prefix (OpenCode Zen)
  'opencode/grok-code': 'opencode/grok-code',
  'opencode/big-pickle': 'opencode/big-pickle',
  'opencode/gpt-5-nano': 'opencode/gpt-5-nano',
  'opencode/minimax-m2.5-free': 'opencode/minimax-m2.5-free', // New (Issue #1300)
  // Deprecated OpenCode Zen models (kept for backward compatibility)
  'opencode/kimi-k2.5-free': 'opencode/kimi-k2.5-free', // Deprecated: not supported (Issue #1391)
  'opencode/glm-4.7-free': 'opencode/glm-4.7-free', // Deprecated
  'opencode/minimax-m2.1-free': 'opencode/minimax-m2.1-free', // Deprecated
  // Premium models with provider prefix
  'anthropic/claude-3-5-sonnet': 'anthropic/claude-3-5-sonnet',
  'anthropic/claude-3-5-haiku': 'anthropic/claude-3-5-haiku',
  'anthropic/claude-3-opus': 'anthropic/claude-3-opus',
  'google/gemini-3-pro': 'google/gemini-3-pro',
};

/**
 * Get the model map for a given tool
 * @param {string} tool - The tool name ('claude', 'opencode', 'codex', 'agent')
 * @returns {Object} The model mapping for the tool
 */
export const getModelMapForTool = tool => {
  switch (tool) {
    case 'opencode':
      return OPENCODE_MODELS;
    case 'codex':
      return CODEX_MODELS;
    case 'agent':
      return AGENT_MODELS;
    case 'claude':
    default:
      return CLAUDE_MODELS;
  }
};

/**
 * Get the list of available model names for a tool (for display in help/error messages)
 * @param {string} tool - The tool name ('claude', 'opencode', 'codex', 'agent')
 * @returns {string[]} Array of available model short names
 */
export const getAvailableModelNames = tool => {
  const modelMap = getModelMapForTool(tool);
  // Get unique short names (aliases) - exclude full model IDs that contain '/' or long claude- prefixed IDs
  const aliases = Object.keys(modelMap).filter(key => {
    // Keep short aliases only - exclude:
    // - Full model IDs with slashes (e.g., 'openai/gpt-4')
    // - Long claude-prefixed model IDs (e.g., 'claude-sonnet-4-5-20250929')
    // - Full gpt- prefixed IDs that are ONLY version numbers (e.g., 'gpt-4', 'gpt-4o', 'gpt-5')
    // But keep descriptive aliases like 'gpt-5-nano', 'gpt-5-codex', 'o3', 'o3-mini', 'gpt5', etc.
    // Issue #1185: Updated regex to not filter out gpt-5-nano (a valid short alias)
    if (key.includes('/')) return false;
    if (key.match(/^claude-.*-\d{8}$/)) return false; // Full claude model IDs with date
    if (key.match(/^gpt-\d+[a-z]?$/)) return false; // Full gpt-N or gpt-No model IDs only (e.g., gpt-4, gpt-4o, gpt-5)
    return true;
  });
  return [...new Set(aliases)];
};

/**
 * Calculate Levenshtein distance between two strings (case-insensitive)
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} The edit distance between the strings
 */
export const levenshteinDistance = (a, b) => {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  if (aLower === bLower) return 0;
  if (aLower.length === 0) return bLower.length;
  if (bLower.length === 0) return aLower.length;

  const matrix = [];

  // Initialize first column
  for (let i = 0; i <= bLower.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first row
  for (let j = 0; j <= aLower.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= bLower.length; i++) {
    for (let j = 1; j <= aLower.length; j++) {
      if (bLower.charAt(i - 1) === aLower.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[bLower.length][aLower.length];
};

/**
 * Find the closest matching model names using fuzzy matching
 * @param {string} input - The user-provided model name
 * @param {string[]} validModels - Array of valid model names
 * @param {number} maxSuggestions - Maximum number of suggestions to return
 * @param {number} maxDistance - Maximum Levenshtein distance to consider
 * @returns {string[]} Array of suggested model names
 */
export const findSimilarModels = (input, validModels, maxSuggestions = 3, maxDistance = 3) => {
  const suggestions = validModels
    .map(model => ({
      model,
      distance: levenshteinDistance(input, model),
    }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxSuggestions)
    .map(({ model }) => model);

  return suggestions;
};

/**
 * Parse model name to extract base model and optional [1m] suffix
 * @param {string} model - The model name (e.g., "opus[1m]", "claude-opus-4-6[1m]")
 * @returns {{ baseModel: string, has1mSuffix: boolean }}
 */
export const parseModelWith1mSuffix = model => {
  if (!model || typeof model !== 'string') {
    return { baseModel: model, has1mSuffix: false };
  }

  // Check for [1m] suffix (case-insensitive)
  const match = model.match(/^(.+?)\[1m\]$/i);
  if (match) {
    return { baseModel: match[1], has1mSuffix: true };
  }

  return { baseModel: model, has1mSuffix: false };
};

/**
 * Check if a model supports the [1m] context window
 * @param {string} model - The base model name (without [1m] suffix)
 * @param {string} tool - The tool name
 * @returns {boolean} True if the model supports 1M context
 */
export const supports1mContext = (model, tool = 'claude') => {
  if (tool !== 'claude') {
    return false;
  }

  const normalizedModel = model.toLowerCase();

  // Check if the model or its mapped version supports 1M context
  for (const supportedModel of MODELS_SUPPORTING_1M_CONTEXT) {
    if (supportedModel.toLowerCase() === normalizedModel) {
      return true;
    }
  }

  // Also check if the mapped model supports 1M context
  const modelMap = getModelMapForTool(tool);
  const matchedKey = Object.keys(modelMap).find(key => key.toLowerCase() === normalizedModel);
  if (matchedKey) {
    const mappedModel = modelMap[matchedKey];
    for (const supportedModel of MODELS_SUPPORTING_1M_CONTEXT) {
      if (supportedModel.toLowerCase() === mappedModel.toLowerCase()) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Validate a model name against the available models for a tool
 * Supports [1m] suffix for 1 million token context (Issue #1221)
 * @param {string} model - The model name to validate (e.g., "opus", "opus[1m]", "claude-opus-4-6[1m]")
 * @param {string} tool - The tool name ('claude', 'opencode', 'codex')
 * @returns {{ valid: boolean, message?: string, suggestions?: string[], mappedModel?: string, has1mSuffix?: boolean }}
 */
export const validateModelName = (model, tool = 'claude') => {
  if (!model || typeof model !== 'string') {
    return {
      valid: false,
      message: 'Model name is required',
      suggestions: [],
    };
  }

  // Parse [1m] suffix (Issue #1221)
  const { baseModel, has1mSuffix } = parseModelWith1mSuffix(model);

  const modelMap = getModelMapForTool(tool);
  const availableNames = Object.keys(modelMap);

  // Case-insensitive exact match
  const normalizedModel = baseModel.toLowerCase();
  const matchedKey = availableNames.find(key => key.toLowerCase() === normalizedModel);

  if (matchedKey) {
    const mappedModel = modelMap[matchedKey];

    // If [1m] suffix is present, validate it's supported
    if (has1mSuffix) {
      if (!supports1mContext(baseModel, tool)) {
        const supportedModels = MODELS_SUPPORTING_1M_CONTEXT.filter(m => !m.includes('-')).join(', ');
        return {
          valid: false,
          message: `Model "${baseModel}" does not support [1m] context window.\n   Models supporting 1M context: ${supportedModels}`,
          suggestions: [],
        };
      }
      // Return the mapped model with [1m] suffix appended
      return {
        valid: true,
        mappedModel: `${mappedModel}[1m]`,
        has1mSuffix: true,
      };
    }

    return {
      valid: true,
      mappedModel,
      has1mSuffix: false,
    };
  }

  // Model not found - provide helpful error with suggestions
  const shortNames = getAvailableModelNames(tool);
  const suggestions = findSimilarModels(baseModel, shortNames);

  let message = `Unrecognized model: "${model}"`;

  if (suggestions.length > 0) {
    message += `\n   Did you mean: ${suggestions.map(s => `"${s}"`).join(', ')}?`;
  }

  message += `\n   Available models for ${tool}: ${shortNames.join(', ')}`;

  // Add hint about [1m] suffix if available
  if (tool === 'claude') {
    message += `\n   Tip: Use [1m] suffix for 1M context (e.g., opus[1m], sonnet[1m])`;
  }

  return {
    valid: false,
    message,
    suggestions,
  };
};

/**
 * Validate model name and exit with error if invalid
 * This is the main entry point for model validation in solve.mjs, hive.mjs, etc.
 * @param {string} model - The model name to validate
 * @param {string} tool - The tool name ('claude', 'opencode', 'codex')
 * @param {Function} exitFn - Function to call for exiting (default: process.exit)
 * @returns {Promise<boolean>} True if valid, exits process if invalid
 */
export const validateAndExitOnInvalidModel = async (model, tool = 'claude', exitFn = null) => {
  const result = validateModelName(model, tool);

  if (!result.valid) {
    await log(`❌ ${result.message}`, { level: 'error' });

    if (exitFn) {
      await exitFn(1, 'Invalid model name');
    } else {
      process.exit(1);
    }
    return false;
  }

  return true;
};

/**
 * Format the list of available models for help text
 * @param {string} tool - The tool name
 * @returns {string} Formatted list of available models
 */
export const formatAvailableModelsForHelp = (tool = 'claude') => {
  const names = getAvailableModelNames(tool);
  return names.join(', ');
};
