/**
 * Model IDs observed in an AI tool's own output stream (Issue #2840).
 *
 * Claude Code names the model that actually runs in its `system/init` event and
 * in every assistant `message.model`, long before the terminal `result` event
 * that carries `modelUsage`. Since Issue #2690 the session metadata is only
 * captured from a real success result, so a session that crashed, was
 * OOM-killed (exit 137) or ended with an error had no actual model at all, and
 * the PR comment fell back to the bundled alias mapping, presenting a stale
 * guess (`opus` → `claude-opus-5`) as the model that ran (`claude-opus-5-5`).
 *
 * This registry records the IDs as the stream arrives, so they survive a crash
 * or a kill, and are available to the failure comment and to the fallback
 * selection on retries. It is process-wide on purpose: the failure comment is
 * posted from many call sites (including the pre-exit notifier) that never see
 * the tool result object.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2840
 */

// Ordered by first observation. Each entry remembers which model was requested
// when it was observed, so a fallback decision only trusts an observation made
// for the model that is still requested.
let observations = [];
let sequence = 0;

const isRealModelId = modelId => typeof modelId === 'string' && modelId.trim().length > 0 && !(modelId.startsWith('<') && modelId.endsWith('>'));

/** Forget every observation, e.g. at the start of a new tool session. */
export const resetObservedModels = () => {
  observations = [];
};

/**
 * Record a model ID reported by the tool itself.
 *
 * Synthetic entries such as Claude's `<synthetic>` (Issue #1486) are ignored.
 *
 * @param {Object} params
 * @param {string} params.modelId - model ID reported by the tool
 * @param {string|null} [params.requestedModel] - the `--model` value in effect when it was observed
 * @param {string|null} [params.source] - where it came from, e.g. `system/init` or `assistant`
 * @param {boolean} [params.fromSubagent] - whether it came from a sub-agent event
 * @returns {boolean} true when this is the first time the ID is seen
 */
export const recordObservedModel = ({ modelId, requestedModel = null, source = null, fromSubagent = false } = {}) => {
  if (!isRealModelId(modelId)) return false;
  const id = modelId.trim();
  const existing = observations.find(entry => entry.modelId === id && entry.requestedModel === requestedModel);
  if (existing) {
    existing.lastSeen = ++sequence;
    // A model first seen from a sub-agent and later from the main thread is a main-thread model.
    if (!fromSubagent) existing.fromSubagent = false;
    return false;
  }
  const isNew = !observations.some(entry => entry.modelId === id);
  observations.push({ modelId: id, requestedModel, source, fromSubagent: fromSubagent === true, lastSeen: ++sequence });
  return isNew;
};

/**
 * Every distinct model ID observed, main-thread models first (in order of first
 * observation), then models only seen from sub-agents.
 * @returns {string[]}
 */
export const getObservedModelIds = () => {
  const main = observations.filter(entry => !entry.fromSubagent).map(entry => entry.modelId);
  const subagent = observations.filter(entry => entry.fromSubagent).map(entry => entry.modelId);
  return [...new Set([...main, ...subagent])];
};

/**
 * The main-thread model most recently observed while `requestedModel` was the
 * requested model, or null when the tool never reported one for it.
 * @param {string|null} requestedModel
 * @returns {string|null}
 */
export const getLatestObservedModelFor = requestedModel => {
  let latest = null;
  for (const entry of observations) {
    if (entry.fromSubagent || entry.requestedModel !== requestedModel) continue;
    if (!latest || entry.lastSeen > latest.lastSeen) latest = entry;
  }
  return latest ? latest.modelId : null;
};

/**
 * Model IDs a Claude Code stream-json event reports: the `system/init` model
 * and the assistant `message.model`.
 * @param {Object} data - parsed stream-json event
 * @returns {Array<{modelId: string, source: string, fromSubagent: boolean}>}
 */
export const extractClaudeEventModelIds = data => {
  if (!data || typeof data !== 'object') return [];
  const fromSubagent = typeof data.parent_tool_use_id === 'string' && data.parent_tool_use_id.length > 0;
  if (data.type === 'system' && data.subtype === 'init' && isRealModelId(data.model)) {
    return [{ modelId: data.model.trim(), source: 'system/init', fromSubagent }];
  }
  if (data.type === 'assistant' && isRealModelId(data.message?.model)) {
    return [{ modelId: data.message.model.trim(), source: 'assistant', fromSubagent }];
  }
  return [];
};
