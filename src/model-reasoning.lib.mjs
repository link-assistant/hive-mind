/** Exact effort capabilities and nearest-level selection. No model calls or I/O. */
import { CODEX_MODEL_VARIANTS } from './models/catalog.mjs';

// Ultra is a separate, more expensive delegation mode above single-agent max.
export const REASONING_EFFORT_ORDER = Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const acceptedEfforts = new Set([...REASONING_EFFORT_ORDER, 'auto']);
const standard = ['low', 'medium', 'high', 'xhigh'];
const maximum = [...standard, 'max'];
const delegated = [...maximum, 'ultra'];

// Verified against codex-cli 0.160.0 and official model pages; see issue #2526's case study.
// Exact IDs only: a future generation must supply its own capabilities.
const bundledEfforts = {
  'gpt-6.1-sol': delegated,
  'gpt-6-astra': delegated,
  'gpt-6-sol': ['none', ...delegated],
  'gpt-6-luna': ['none', ...maximum],
  'gpt-reserve': maximum,
  'gpt-5.6-sol': ['none', ...delegated],
  'gpt-5.6-terra': ['none', ...delegated],
  'gpt-5.6-luna': ['none', ...maximum],
  'gpt-5.5': ['none', ...standard],
  'codex-auto-review': maximum,
};

/** The CLI picker hides none even for models whose documented API supports it. */
export const normalizeCodexReasoningCapabilities = entry => {
  const capabilities = normalizeReasoningCapabilities(entry);
  if (!capabilities) return null;
  const bundled = getBundledReasoningCapabilities(entry?.slug);
  if (bundled?.supportedReasoningEfforts.includes('none') && !capabilities.supportedReasoningEfforts.includes('none')) {
    capabilities.supportedReasoningEfforts.unshift('none');
  }
  return capabilities;
};

export const normalizeReasoningCapabilities = (model = {}) => {
  if (!model || typeof model !== 'object') return null;
  const raw = model.supportedReasoningEfforts ?? model.supported_reasoning_levels ?? model.supported_reasoning_efforts;
  if (!Array.isArray(raw)) return null;
  const supportedReasoningEfforts = [...new Set(raw.map(value => (typeof value === 'string' ? value : value?.effort)).filter(value => acceptedEfforts.has(value)))];
  if (supportedReasoningEfforts.length === 0) return null;
  const defaultEffort = model.defaultReasoningEffort ?? model.default_reasoning_level ?? model.default_reasoning_effort;
  return { supportedReasoningEfforts, defaultReasoningEffort: supportedReasoningEfforts.includes(defaultEffort) ? defaultEffort : null };
};

export const getBundledReasoningCapabilities = model => {
  const id = String(CODEX_MODEL_VARIANTS[model] ?? model ?? '').replace(/^openai[/.]/, '');
  return bundledEfforts[id] ? { supportedReasoningEfforts: [...bundledEfforts[id]], defaultReasoningEffort: null } : null;
};

/** Fresh first-party data wins; stale data is used only without a bundled answer. */
export const getModelReasoningCapabilities = (model, catalogue = null) => {
  const id = CODEX_MODEL_VARIANTS[model] ?? model;
  const matches = candidate => candidate?.id === id || candidate?.id === String(id).replace(/^openai[/.]/, '');
  const sources = catalogue?.sources ?? [];
  for (const source of sources) {
    if (source.status !== 'ok' || source.stale) continue;
    const capabilities = normalizeReasoningCapabilities(source.models?.find(matches));
    if (capabilities) return { ...capabilities, source: source.id };
  }
  const bundled = getBundledReasoningCapabilities(id);
  if (bundled) return { ...bundled, source: 'bundled' };
  for (const source of sources) {
    if (source.status !== 'ok') continue;
    const capabilities = normalizeReasoningCapabilities(source.models?.find(matches));
    if (capabilities) return { ...capabilities, source: `${source.id} (stale)` };
  }
  const metadata = catalogue?.metadata?.[id];
  const capabilities = normalizeReasoningCapabilities(metadata);
  return capabilities ? { ...capabilities, source: 'models-dev' } : null;
};

/** Ties prefer less effort; automatic mode is a valid fallback for disabled thinking. */
export const selectSupportedReasoningEffort = (requested, capabilities) => {
  const supported = capabilities?.supportedReasoningEfforts ?? [];
  if (supported.includes(requested)) return requested;
  if (requested === 'none' && supported.includes('auto')) return 'auto';
  const rank = REASONING_EFFORT_ORDER.indexOf(requested);
  if (rank < 0) return null;
  const ranked = REASONING_EFFORT_ORDER.filter(effort => supported.includes(effort));
  ranked.sort((left, right) => Math.abs(REASONING_EFFORT_ORDER.indexOf(left) - rank) - Math.abs(REASONING_EFFORT_ORDER.indexOf(right) - rank));
  return ranked[0] ?? (supported.includes('auto') ? 'auto' : null);
};
