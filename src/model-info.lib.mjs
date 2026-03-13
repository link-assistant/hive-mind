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
 * Normalize model ID for comparison purposes (strip suffixes, lowercase).
 * @param {string} modelId - A model ID or alias
 * @returns {string} Normalized ID
 */
const normalizeForComparison = modelId => {
  if (!modelId) return '';
  return modelId
    .toLowerCase()
    .replace(/\[1m\]$/i, '')
    .trim();
};

/**
 * Check if a requested model alias matches an actual model ID.
 * @param {string} requestedModel - The --model flag value (alias or full ID)
 * @param {string} actualModelId - The actual model ID from CLI output
 * @param {string|null} tool - The tool being used
 * @returns {boolean}
 */
const doesRequestedMatchActual = (requestedModel, actualModelId, tool) => {
  if (!requestedModel || !actualModelId) return false;
  const resolvedRequested = resolveModelId(requestedModel, tool);
  const normResolved = normalizeForComparison(resolvedRequested);
  const normActual = normalizeForComparison(actualModelId);
  // Direct match
  if (normResolved === normActual) return true;
  // Partial match: resolved starts with actual or vice versa (for date-suffixed IDs)
  if (normActual.startsWith(normResolved) || normResolved.startsWith(normActual)) return true;
  return false;
};

/**
 * Build model information string for PR/issue comments.
 * Displays the requested model vs actual models used from CLI JSON output.
 * The main model is bolded if it matches the requested model.
 * A warning is shown if the main model doesn't match the requested model.
 *
 * @param {Object} options - Model info options
 * @param {string|null} options.requestedModel - The model requested via --model flag (e.g., "opus")
 * @param {string|null} options.tool - The tool used (claude, agent, opencode, codex)
 * @param {Object|null} options.pricingInfo - Pricing info from tool result (agent tool provides modelId)
 * @param {Object|null} options.modelInfo - Pre-fetched model metadata from models.dev (for first actual model)
 * @param {Array<{modelId: string, modelInfo: Object|null}>|null} options.modelsUsed - Actual models used from CLI JSON output
 * @returns {string} Formatted markdown string for model info section (empty if no data available)
 */
export const buildModelInfoString = ({ requestedModel = null, tool = null, pricingInfo = null, modelInfo = null, modelsUsed = null } = {}) => {
  const hasRequested = requestedModel !== null && requestedModel !== undefined;
  const hasModelsUsed = Array.isArray(modelsUsed) && modelsUsed.length > 0;
  const hasModelInfo = modelInfo !== null;
  const hasPricingModel = pricingInfo?.modelId || pricingInfo?.modelName;

  if (!hasRequested && !hasModelsUsed && !hasModelInfo && !hasPricingModel) return '';

  let info = '\n\n🤖 **Models used:**';

  // Display tool name
  if (tool) {
    info += `\n- Tool: ${getToolDisplayName(tool)}`;
  }

  // Display requested model (--model flag value)
  if (hasRequested) {
    info += `\n- Requested: \`${requestedModel}\``;
  }

  if (hasModelsUsed) {
    // The first model is considered the "main" model
    const [mainEntry, ...supportingEntries] = modelsUsed;
    const mainModelId = mainEntry.modelId;
    const mainModelMeta = mainEntry.modelInfo;

    const mainMatches = hasRequested ? doesRequestedMatchActual(requestedModel, mainModelId, tool) : true;

    // Build main model line
    const mainModelName = mainModelMeta?.name || mainModelId;
    const mainModelProvider = mainModelMeta?.provider || null;
    const mainModelKnowledge = mainModelMeta?.knowledge || null;

    if (mainMatches) {
      info += `\n- **Main model: ${mainModelName}** (ID: \`${mainModelId}\`${mainModelProvider ? `, ${mainModelProvider}` : ''}${mainModelKnowledge ? `, cutoff: ${mainModelKnowledge}` : ''})`;
    } else {
      // Main model doesn't match requested - show warning
      info += `\n- **Main model: ${mainModelName}** (ID: \`${mainModelId}\`${mainModelProvider ? `, ${mainModelProvider}` : ''}${mainModelKnowledge ? `, cutoff: ${mainModelKnowledge}` : ''})`;
      if (hasRequested) {
        info += `\n- ⚠️ **Warning**: Main model \`${mainModelId}\` does not match requested model \`${requestedModel}\``;
      }
    }

    // Display supporting models
    if (supportingEntries.length > 0) {
      info += '\n- Supporting models:';
      for (const entry of supportingEntries) {
        const name = entry.modelInfo?.name || entry.modelId;
        const provider = entry.modelInfo?.provider || null;
        info += `\n  - ${name} (\`${entry.modelId}\`${provider ? `, ${provider}` : ''})`;
      }
    }
  } else if (hasModelInfo) {
    // Fallback: single model info from models.dev (no actual CLI output data)
    const mainModelName = modelInfo.name || (pricingInfo?.modelId ? pricingInfo.modelId : null) || 'Unknown';
    info += `\n- Model: ${mainModelName}`;
    if (modelInfo.id) info += ` (ID: \`${modelInfo.id}\`)`;
    if (modelInfo.provider) info += `\n- Provider: ${modelInfo.provider}`;
    if (modelInfo.knowledge) info += `\n- Knowledge cutoff: ${modelInfo.knowledge}`;
  } else if (hasPricingModel) {
    // Fallback to pricingInfo when no models.dev data
    const modelId = pricingInfo.modelId || null;
    const modelName = pricingInfo.modelName || modelId || 'Unknown';
    if (modelId && modelId !== modelName) {
      info += `\n- Model: ${modelName} (ID: \`${modelId}\`)`;
    } else {
      info += `\n- Model: ${modelName}`;
    }
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
    // Use model-mapping.lib.mjs mappings as authoritative source
    const modelMaps = {
      claude: {
        sonnet: 'claude-sonnet-4-6',
        opus: 'claude-opus-4-5-20251101',
        haiku: 'claude-haiku-4-5-20251001',
        'opus-4-6': 'claude-opus-4-6',
        'opus-4-5': 'claude-opus-4-5-20251101',
        'sonnet-4-6': 'claude-sonnet-4-6',
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
 * Uses actual models from CLI JSON output when available.
 *
 * @param {Object} options
 * @param {string|null} options.requestedModel - The --model flag value
 * @param {string|null} options.tool - The tool used (claude, agent, opencode, codex)
 * @param {Object|null} options.pricingInfo - Pricing info from tool result
 * @param {Array<string>|null} options.actualModelIds - Actual model IDs from CLI JSON output
 *   For Claude: from tokenUsage.modelUsage keys (model IDs used in session)
 *   For Agent: from pricingInfo.modelId
 * @returns {Promise<string>} Formatted markdown model info section
 */
export const getModelInfoForComment = async ({ requestedModel = null, tool = null, pricingInfo = null, actualModelIds = null } = {}) => {
  // Determine the list of actual model IDs to display
  // Priority: explicit actualModelIds > pricingInfo.modelId > resolve from requestedModel
  let modelIds = [];

  if (Array.isArray(actualModelIds) && actualModelIds.length > 0) {
    modelIds = actualModelIds;
  } else if (pricingInfo?.modelId) {
    // Agent tool provides pricingInfo.modelId as the actual model used
    modelIds = [pricingInfo.modelId];
  } else if (requestedModel) {
    // Fallback: resolve from requested model alias
    const resolved = resolveModelId(requestedModel, tool);
    if (resolved) modelIds = [resolved];
  }

  // Fetch model metadata from models.dev for each model ID
  const modelsUsed = [];
  for (const modelId of modelIds) {
    let meta = null;
    try {
      meta = await fetchModelInfoForComment(modelId);
    } catch {
      await log('  ⚠️  Could not fetch model info from models.dev', { verbose: true });
    }
    modelsUsed.push({ modelId, modelInfo: meta });
  }

  // Determine which modelInfo to pass for legacy fallback (first model's metadata)
  const firstModelInfo = modelsUsed.length > 0 ? modelsUsed[0].modelInfo : null;

  return buildModelInfoString({
    requestedModel,
    tool,
    pricingInfo,
    modelInfo: modelsUsed.length === 0 ? firstModelInfo : null, // only used as fallback when no modelsUsed
    modelsUsed: modelsUsed.length > 0 ? modelsUsed : null,
  });
};
