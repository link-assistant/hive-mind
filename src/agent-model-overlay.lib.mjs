/**
 * Provider model definitions Hive Mind hands to `@link-assistant/agent` for
 * free models its built-in provider table no longer reaches (issue #2625).
 *
 * On 2026-10-07 the `agent / nemotron-3-super-free` row of the Hello World
 * matrix (run 37616874265) failed on its first call:
 *
 *   Model "nemotron-3-super-free" not found in provider "opencode".
 *
 * OpenCode Zen withdrew the model (link-assistant/agent#327). Every other Zen
 * free model answers HTTP 403 `FreeTierError: OpenCode's free tier can only be
 * used from within OpenCode` to any other client (anomalyco/opencode#49433),
 * and the Kilo entries Agent 0.26.11 ships point at gateway ids that no longer
 * exist (`z-ai/glm-5:free` -> 404 model_not_found). The same Nemotron 3 Super
 * model is free on the Kilo gateway as `nvidia/nemotron-3-super-120b-a12b:free`
 * and needs no key, so Hive Mind routes its default Agent model there and
 * describes the model to Agent through `LINK_ASSISTANT_AGENT_CONFIG_CONTENT`,
 * the inline config Agent deep-merges over its own provider table.
 *
 * Remove an entry once Agent ships it itself; a user definition of the same
 * model always wins over this one.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2625
 * @see https://github.com/link-assistant/agent/issues/327
 */

const FREE_COST = Object.freeze({ input: 0, output: 0, cache_read: 0, cache_write: 0 });

/** Full Agent model id (`provider/model`) -> the provider entry Agent needs. */
export const AGENT_PROVIDER_MODEL_OVERLAYS = Object.freeze({
  'kilo/nemotron-3-super-free': Object.freeze({
    id: 'nvidia/nemotron-3-super-120b-a12b:free',
    name: 'Nemotron 3 Super (Free)',
    release_date: '2026-03-11',
    attachment: false,
    reasoning: true,
    temperature: true,
    tool_call: true,
    cost: FREE_COST,
    limit: Object.freeze({ context: 262144, output: 32768 }),
    modalities: Object.freeze({ input: Object.freeze(['text']), output: Object.freeze(['text']) }),
    options: Object.freeze({}),
  }),
});

const parseConfigObject = content => {
  if (!content) return {};
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * Add the overlay for `mappedModel` to an inline Agent config.
 *
 * @param {string} content existing `LINK_ASSISTANT_AGENT_CONFIG_CONTENT`
 * @param {string} mappedModel full Agent model id, e.g. `kilo/nemotron-3-super-free`
 * @returns {string|null} the merged config, or null when nothing has to change
 */
export const mergeAgentModelOverlayConfigContent = (content, mappedModel) => {
  const overlay = AGENT_PROVIDER_MODEL_OVERLAYS[mappedModel];
  if (!overlay) return null;
  const config = parseConfigObject(content);
  // An inline config Hive Mind cannot parse is the user's to fix; replacing it
  // would silently drop their settings.
  if (config === null) return null;
  const slash = mappedModel.indexOf('/');
  const providerID = mappedModel.slice(0, slash);
  const modelID = mappedModel.slice(slash + 1);
  const provider = config.provider?.[providerID] || {};
  if (provider.models?.[modelID]) return null;
  return JSON.stringify({ ...config, provider: { ...config.provider, [providerID]: { ...provider, models: { ...provider.models, [modelID]: overlay } } } });
};

/**
 * The environment Agent needs to reach `mappedModel`; empty when Agent's own
 * provider table already covers it.
 *
 * @param {{ env?: Record<string, string|undefined>, mappedModel: string }} options
 * @returns {Record<string, string>}
 */
export const getAgentModelOverlayEnv = ({ env = process.env, mappedModel }) => {
  const merged = mergeAgentModelOverlayConfigContent(env.LINK_ASSISTANT_AGENT_CONFIG_CONTENT || '', mappedModel);
  return merged ? { LINK_ASSISTANT_AGENT_CONFIG_CONTENT: merged } : {};
};
