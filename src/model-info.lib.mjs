#!/usr/bin/env node

/**
 * Model information library for hive-mind
 * Provides unified model display, verification, and metadata fetching
 * for all tools (Claude, Agent, OpenCode, Codex).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1225
 */

// Check if use is already defined (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

import { log } from './lib.mjs';

/**
 * Map tool identifier to user-friendly display name.
 * Replaces duplicated ternary chains across the codebase.
 * @param {string|null} tool - The tool identifier (claude, codex, opencode, agent)
 * @returns {string} User-friendly display name
 */
export const getToolDisplayName = tool => {
  const name = (tool || '').toString().toLowerCase();
  switch (name) {
    case 'claude':
      return 'Claude';
    case 'codex':
      return 'Codex';
    case 'opencode':
      return 'OpenCode';
    case 'agent':
      return 'Agent';
    default:
      return 'AI tool';
  }
};

/**
 * Cached models.dev API response to avoid repeated network requests.
 * The cache is per-process and cleared when the process exits.
 */
let modelsDevCache = null;

/**
 * Fetch the full models.dev API data with caching.
 * @returns {Promise<Object|null>} The full API response or null on failure
 */
const fetchModelsDevApi = async () => {
  if (modelsDevCache) return modelsDevCache;
  try {
    const https = (await globalThis.use('https')).default;
    return new Promise((resolve, reject) => {
      https
        .get('https://models.dev/api.json', res => {
          let data = '';
          res.on('data', chunk => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              modelsDevCache = JSON.parse(data);
              resolve(modelsDevCache);
            } catch (parseError) {
              reject(parseError);
            }
          });
        })
        .on('error', err => {
          reject(err);
        });
    });
  } catch {
    return null;
  }
};

/**
 * Fetch model metadata from models.dev API.
 * Returns enriched model information including name, provider, version, and knowledge cutoff.
 * @param {string} modelId - The model ID (e.g., "claude-opus-4-6", "opencode/grok-code")
 * @returns {Promise<Object|null>} Model metadata or null if not found
 */
export const fetchModelInfoForComment = async modelId => {
  if (!modelId) return null;
  try {
    const apiData = await fetchModelsDevApi();
    if (!apiData) return null;

    // Normalize model ID: strip provider prefix for lookup (e.g., "anthropic/claude-3-5-sonnet" -> "claude-3-5-sonnet")
    const lookupId = modelId.includes('/') ? modelId.split('/').pop() : modelId;

    // Check Anthropic provider first (most common for Claude tools)
    if (apiData.anthropic?.models?.[lookupId]) {
      const modelInfo = { ...apiData.anthropic.models[lookupId] };
      modelInfo.provider = apiData.anthropic.name || 'Anthropic';
      return modelInfo;
    }

    // Search across all providers
    for (const provider of Object.values(apiData)) {
      if (provider.models && provider.models[lookupId]) {
        const modelInfo = { ...provider.models[lookupId] };
        modelInfo.provider = provider.name || provider.id;
        return modelInfo;
      }
    }

    // Try the full modelId (with provider prefix) as well
    if (lookupId !== modelId) {
      for (const provider of Object.values(apiData)) {
        if (provider.models && provider.models[modelId]) {
          const modelInfo = { ...provider.models[modelId] };
          modelInfo.provider = provider.name || provider.id;
          return modelInfo;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
};

/**
 * Build model information string for PR/issue comments.
 * Displays the requested model, actual model metadata from models.dev, and mismatch warnings.
 *
 * @param {Object} options - Model info options
 * @param {string|null} options.requestedModel - The model requested via --model flag (e.g., "opus")
 * @param {string|null} options.tool - The tool used (claude, agent, opencode, codex)
 * @param {Object|null} options.pricingInfo - Pricing info from tool result (agent tool provides modelName)
 * @param {Object|null} options.modelInfo - Pre-fetched model metadata from models.dev
 * @returns {string} Formatted markdown string for model info section (empty if no data available)
 */
export const buildModelInfoString = ({ requestedModel = null, tool = null, pricingInfo = null, modelInfo = null } = {}) => {
  // Don't show model section when we have no model data at all
  const hasRequested = requestedModel !== null && requestedModel !== undefined;
  const hasModelInfo = modelInfo !== null;
  const hasPricingModel = pricingInfo?.modelName;

  if (!hasRequested && !hasModelInfo && !hasPricingModel) return '';

  let info = '\n\n🤖 **Model information:**';

  // Display tool name
  if (tool) {
    info += `\n- Tool: ${getToolDisplayName(tool)}`;
  }

  // Display requested model (--model flag value)
  if (hasRequested) {
    info += `\n- Requested model: \`${requestedModel}\``;
  }

  // Display actual model information from models.dev
  if (hasModelInfo) {
    if (modelInfo.name) info += `\n- Model: ${modelInfo.name}`;
    if (modelInfo.id) info += `\n- Model ID: \`${modelInfo.id}\``;
    if (modelInfo.provider) info += `\n- Provider: ${modelInfo.provider}`;
    if (modelInfo.knowledge) info += `\n- Knowledge cutoff: ${modelInfo.knowledge}`;
  } else if (hasPricingModel) {
    // Fallback to pricingInfo if models.dev lookup failed
    info += `\n- Model: ${pricingInfo.modelName}`;
    if (pricingInfo.provider) info += `\n- Provider: ${pricingInfo.provider}`;
  }

  return info;
};

/**
 * Resolve the full model ID from a user-provided alias using the model mapping.
 * @param {string|null} requestedModel - The model alias (e.g., "opus", "sonnet")
 * @param {string|null} tool - The tool being used
 * @returns {string|null} The full model ID or null
 */
export const resolveModelId = (requestedModel, tool) => {
  if (!requestedModel) return null;

  try {
    // Import dynamically to avoid circular dependency
    // Use the model maps directly from model-validation.lib.mjs
    const modelMaps = {
      claude: {
        sonnet: 'claude-sonnet-4-5-20250929',
        opus: 'claude-opus-4-6',
        haiku: 'claude-haiku-4-5-20251001',
        'opus-4-6': 'claude-opus-4-6',
        'opus-4-5': 'claude-opus-4-5-20251101',
        'sonnet-4-5': 'claude-sonnet-4-5-20250929',
        'haiku-4-5': 'claude-haiku-4-5-20251001',
      },
      agent: {
        grok: 'opencode/grok-code',
        'grok-code': 'opencode/grok-code',
        sonnet: 'anthropic/claude-3-5-sonnet',
        opus: 'anthropic/claude-3-opus',
        haiku: 'anthropic/claude-3-5-haiku',
      },
      opencode: {
        gpt4: 'openai/gpt-4',
        gpt4o: 'openai/gpt-4o',
        sonnet: 'anthropic/claude-3-5-sonnet',
        opus: 'anthropic/claude-3-opus',
        grok: 'opencode/grok-code',
      },
      codex: {
        gpt5: 'gpt-5',
        'gpt-5': 'gpt-5',
        o3: 'o3',
        gpt4: 'gpt-4',
        gpt4o: 'gpt-4o',
        sonnet: 'claude-3-5-sonnet',
        opus: 'claude-3-opus',
      },
    };

    const toolName = (tool || 'claude').toString().toLowerCase();
    const map = modelMaps[toolName];
    if (map) {
      // Strip [1m] suffix if present (1M context window flag)
      const cleanModel = requestedModel.replace(/\[1m\]$/i, '');
      return map[cleanModel.toLowerCase()] || cleanModel;
    }

    return requestedModel;
  } catch {
    return requestedModel;
  }
};

/**
 * Fetch model info and build the complete model information string for PR comments.
 * This is the main entry point for adding model info to comments.
 *
 * @param {Object} options
 * @param {string|null} options.requestedModel - The --model flag value
 * @param {string|null} options.tool - The tool used (claude, agent, opencode, codex)
 * @param {Object|null} options.pricingInfo - Pricing info from tool result
 * @returns {Promise<string>} Formatted markdown model info section
 */
export const getModelInfoForComment = async ({ requestedModel = null, tool = null, pricingInfo = null } = {}) => {
  // Resolve model ID from alias
  const resolvedModelId = resolveModelId(requestedModel, tool);

  // Try to fetch detailed model info from models.dev
  let modelInfo = null;
  if (resolvedModelId) {
    try {
      modelInfo = await fetchModelInfoForComment(resolvedModelId);
    } catch {
      // Non-critical: continue without models.dev data
      await log('  ⚠️  Could not fetch model info from models.dev', { verbose: true });
    }
  }

  return buildModelInfoString({
    requestedModel,
    tool,
    pricingInfo,
    modelInfo,
  });
};
