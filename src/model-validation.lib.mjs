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
  // Short aliases
  'sonnet': 'claude-sonnet-4-5-20250929',
  'opus': 'claude-opus-4-5-20251101',
  'haiku': 'claude-haiku-4-5-20251001',
  'haiku-3-5': 'claude-3-5-haiku-20241022',
  'haiku-3': 'claude-3-haiku-20240307',
  // Full model IDs (also valid inputs)
  'claude-sonnet-4-5-20250929': 'claude-sonnet-4-5-20250929',
  'claude-opus-4-5-20251101': 'claude-opus-4-5-20251101',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5-20251001',
  'claude-3-5-haiku-20241022': 'claude-3-5-haiku-20241022',
  'claude-3-haiku-20240307': 'claude-3-haiku-20240307',
};

export const OPENCODE_MODELS = {
  'gpt4': 'openai/gpt-4',
  'gpt4o': 'openai/gpt-4o',
  'claude': 'anthropic/claude-3-5-sonnet',
  'sonnet': 'anthropic/claude-3-5-sonnet',
  'opus': 'anthropic/claude-3-opus',
  'gemini': 'google/gemini-pro',
  'grok': 'opencode/grok-code',
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
  'gpt5': 'gpt-5',
  'gpt-5': 'gpt-5',
  'gpt5-codex': 'gpt-5-codex',
  'gpt-5-codex': 'gpt-5-codex',
  'o3': 'o3',
  'o3-mini': 'o3-mini',
  'gpt4': 'gpt-4',
  'gpt4o': 'gpt-4o',
  'claude': 'claude-3-5-sonnet',
  'sonnet': 'claude-3-5-sonnet',
  'opus': 'claude-3-opus',
  // Full model IDs
  'gpt-4': 'gpt-4',
  'gpt-4o': 'gpt-4o',
  'claude-3-5-sonnet': 'claude-3-5-sonnet',
  'claude-3-opus': 'claude-3-opus',
};

export const AGENT_MODELS = {
  // Free models (via OpenCode)
  'grok': 'opencode/grok-code',
  'grok-code': 'opencode/grok-code',
  'grok-code-fast-1': 'opencode/grok-code',
  'big-pickle': 'opencode/big-pickle',
  'gpt-5-nano': 'openai/gpt-5-nano',
  // Premium models (requires OpenCode Zen subscription)
  'sonnet': 'anthropic/claude-3-5-sonnet',
  'haiku': 'anthropic/claude-3-5-haiku',
  'opus': 'anthropic/claude-3-opus',
  'gemini-3-pro': 'google/gemini-3-pro',
  // Full model IDs
  'opencode/grok-code': 'opencode/grok-code',
  'opencode/big-pickle': 'opencode/big-pickle',
  'openai/gpt-5-nano': 'openai/gpt-5-nano',
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
export const getModelMapForTool = (tool) => {
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
export const getAvailableModelNames = (tool) => {
  const modelMap = getModelMapForTool(tool);
  // Get unique short names (aliases) - exclude full model IDs that contain '/' or long claude- prefixed IDs
  const aliases = Object.keys(modelMap).filter(key => {
    // Keep short aliases only - exclude:
    // - Full model IDs with slashes (e.g., 'openai/gpt-4')
    // - Long claude-prefixed model IDs (e.g., 'claude-sonnet-4-5-20250929')
    // - Full gpt- prefixed IDs with version numbers (e.g., 'gpt-4', 'gpt-4o')
    // But keep short names like 'o3', 'o3-mini', 'gpt5', etc.
    if (key.includes('/')) return false;
    if (key.match(/^claude-.*-\d{8}$/)) return false;  // Full claude model IDs with date
    if (key.match(/^gpt-\d+/)) return false;  // Full gpt-N model IDs
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
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
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
      distance: levenshteinDistance(input, model)
    }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxSuggestions)
    .map(({ model }) => model);

  return suggestions;
};

/**
 * Validate a model name against the available models for a tool
 * @param {string} model - The model name to validate
 * @param {string} tool - The tool name ('claude', 'opencode', 'codex')
 * @returns {{ valid: boolean, message?: string, suggestions?: string[] }}
 */
export const validateModelName = (model, tool = 'claude') => {
  if (!model || typeof model !== 'string') {
    return {
      valid: false,
      message: 'Model name is required',
      suggestions: []
    };
  }

  const modelMap = getModelMapForTool(tool);
  const availableNames = Object.keys(modelMap);

  // Case-insensitive exact match
  const normalizedModel = model.toLowerCase();
  const matchedKey = availableNames.find(key => key.toLowerCase() === normalizedModel);

  if (matchedKey) {
    return {
      valid: true,
      mappedModel: modelMap[matchedKey]
    };
  }

  // Model not found - provide helpful error with suggestions
  const shortNames = getAvailableModelNames(tool);
  const suggestions = findSimilarModels(model, shortNames);

  let message = `Unrecognized model: "${model}"`;

  if (suggestions.length > 0) {
    message += `\n   Did you mean: ${suggestions.map(s => `"${s}"`).join(', ')}?`;
  }

  message += `\n   Available models for ${tool}: ${shortNames.join(', ')}`;

  return {
    valid: false,
    message,
    suggestions
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
