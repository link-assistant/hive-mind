// Shared context-window fill helpers.

const TOKEN_FIELD_ALIASES = {
  input: ['inputTokens', 'input_tokens', 'input', 'promptTokens', 'prompt_tokens', 'prompt'],
  output: ['outputTokens', 'output_tokens', 'output', 'completionTokens', 'completion_tokens', 'completion'],
  cacheWrite: ['cacheCreationTokens', 'cacheWriteTokens', 'cacheCreationInputTokens', 'cache_creation_input_tokens', 'cache_write_tokens', 'cacheWrite'],
  cacheRead: ['cacheReadTokens', 'cacheReadInputTokens', 'cache_read_input_tokens', 'cache_read_tokens', 'cachedInputTokens', 'cached_input_tokens', 'cacheRead'],
};

export const toTokenCount = value => {
  if (Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return 0;
};

const getFirstTokenField = (usage, fieldNames) => {
  if (!usage || typeof usage !== 'object') return 0;
  for (const fieldName of fieldNames) {
    if (Object.hasOwn(usage, fieldName)) return toTokenCount(usage[fieldName]);
  }
  return 0;
};

export const getInputTokenCount = usage => getFirstTokenField(usage, TOKEN_FIELD_ALIASES.input);

export const getOutputTokenCount = usage => getFirstTokenField(usage, TOKEN_FIELD_ALIASES.output);

export const getCacheWriteTokenCount = usage => {
  const direct = getFirstTokenField(usage, TOKEN_FIELD_ALIASES.cacheWrite);
  if (direct > 0 || !usage?.cache || typeof usage.cache !== 'object') return direct;
  return toTokenCount(usage.cache.write);
};

export const getCacheReadTokenCount = usage => {
  const direct = getFirstTokenField(usage, TOKEN_FIELD_ALIASES.cacheRead);
  if (direct > 0 || !usage?.cache || typeof usage.cache !== 'object') return direct;
  return toTokenCount(usage.cache.read);
};

/**
 * Issue #1741: context-fill from cumulative/session usage.
 *
 * Cache reads are intentionally excluded. They are the same cached prefix replayed
 * across requests, so summing them in a cumulative row can exceed the model's
 * context window even though no single sub-session filled that much context.
 */
export const getCumulativeContextInputTokens = usage => getInputTokenCount(usage) + getCacheWriteTokenCount(usage);

/**
 * Issue #1737: restored prompt size for one concrete request/turn.
 *
 * Use this only when the source row is a single request or a tool-specific
 * per-turn value. For cumulative model rows, use getCumulativeContextInputTokens.
 */
export const getRestoredContextInputTokens = usage => getInputTokenCount(usage) + getCacheWriteTokenCount(usage) + getCacheReadTokenCount(usage);

export const getExplicitContextFillInputTokens = usage => {
  if (!usage || typeof usage !== 'object') return null;
  if (Object.hasOwn(usage, 'contextFillInputTokens')) return toTokenCount(usage.contextFillInputTokens);
  if (Object.hasOwn(usage, 'cumulativeContextInputTokens')) return toTokenCount(usage.cumulativeContextInputTokens);
  return null;
};

export const getDisplayContextInputTokens = usage => {
  const explicitContextFill = getExplicitContextFillInputTokens(usage);
  if (explicitContextFill !== null) return explicitContextFill;
  return toTokenCount(usage?.peakContextUsage);
};
