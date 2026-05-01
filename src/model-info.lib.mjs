import https from 'node:https';

const buildLookupIds = modelId => (modelId?.includes('/') ? [modelId.split('/').pop(), modelId] : [modelId]);

const buildProviderPriority = (modelId, preferredProviderIds = []) => {
  const inferredProviderIds = [];
  if (modelId?.startsWith('claude-')) inferredProviderIds.push('anthropic');
  if (modelId?.startsWith('gpt-') || modelId?.startsWith('chatgpt-')) inferredProviderIds.push('openai');
  return [...new Set([...preferredProviderIds, ...inferredProviderIds])];
};

const findProviderModel = (apiData, providerIds, lookupIds) => {
  for (const providerId of providerIds) {
    const provider = apiData[providerId];
    if (!provider?.models) continue;
    for (const lookupId of lookupIds) {
      if (provider.models[lookupId]) {
        return {
          ...provider.models[lookupId],
          provider: provider.name || providerId,
        };
      }
    }
  }
  return null;
};

const fetchModelsDevApi = () =>
  new Promise((resolve, reject) => {
    https
      .get('https://models.dev/api.json', res => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject);
  });

/**
 * Fetches model information from models.dev.
 * @param {string} modelId - The model ID (e.g., "claude-sonnet-4-5-20250929")
 * @param {Object} [options]
 * @param {string[]} [options.preferredProviderIds] Provider IDs to check before the default search order.
 * @returns {Promise<Object|null>} Model information or null if not found
 */
export const fetchModelInfo = async (modelId, options = {}) => {
  if (!modelId) return null;
  try {
    const apiData = await fetchModelsDevApi();
    const lookupIds = buildLookupIds(modelId);
    const preferredProviderIds = Array.isArray(options.preferredProviderIds) ? options.preferredProviderIds : [];
    const providerPriority = buildProviderPriority(modelId, preferredProviderIds);
    return findProviderModel(apiData, providerPriority, lookupIds) || findProviderModel(apiData, Object.keys(apiData), lookupIds);
  } catch {
    // If we can't fetch model info, return null and continue without it.
    return null;
  }
};
