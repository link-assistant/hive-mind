#!/usr/bin/env node

/**
 * Sub-session size and 1M-context controls.
 *
 * Implements --sub-session-size and --disable-1m-context (issue #1706).
 *
 * --sub-session-size accepts:
 *   - "default" / "auto"  → keep tool's built-in compaction threshold (no override)
 *   - "off" / "0"         → keep tool's default (alias for "default")
 *   - A token count       → "150k", "150K", "150000", "1.5m", "1M"
 *   - A percentage        → "50%", "75%" (relative to model context window)
 *
 * --disable-1m-context (boolean, default true) opts out of the 1M extended
 * context window so models fall back to their standard 200K-400K window.
 *
 * Claude Code controls (env vars only — no CLI flags exist):
 *   - CLAUDE_CODE_DISABLE_1M_CONTEXT=1
 *   - CLAUDE_CODE_AUTO_COMPACT_WINDOW=<tokens>     (basis for compaction math)
 *   - CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=<1..100>     (only lowers; clamped to <= 95)
 *
 * Codex controls (via -c key=value, same mechanism as model_reasoning_effort):
 *   - -c model_context_window=<tokens>             (forces 200K window)
 *   - -c model_auto_compact_token_limit=<tokens>   (compaction threshold)
 */

const PARSE_ERROR_PREFIX = '--sub-session-size';

const DEFAULT_TOKENS_VALUES = new Set(['default', 'auto', 'off', '0', 'none']);

/**
 * Parse a token count expression: "150k", "150K", "150000", "1.5m", "1M".
 * Returns null if the input doesn't match the token-count format.
 */
const parseTokenCount = value => {
  const match = String(value)
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*([kmKM]?)$/);
  if (!match) return null;
  const number = parseFloat(match[1]);
  if (!Number.isFinite(number) || number < 0) return null;
  const suffix = match[2].toLowerCase();
  const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : 1;
  return Math.round(number * multiplier);
};

/**
 * Parse a percentage expression: "50%", "75%".
 * Returns null if the input doesn't match the percentage format.
 */
const parsePercent = value => {
  const match = String(value)
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (!match) return null;
  const percent = parseFloat(match[1]);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return null;
  return percent;
};

/**
 * Parse the --sub-session-size option value into a normalized descriptor.
 *
 * @param {string|undefined|null} rawValue - The raw option value.
 * @param {Object} [options]
 * @param {number|null} [options.contextWindow] - Model context window in tokens (used for percentage values).
 * @returns {{ kind: 'default' | 'tokens' | 'percent', tokens: number | null, percent: number | null, raw: string }}
 * @throws {Error} If the value cannot be parsed.
 */
export const parseSubSessionSize = (rawValue, { contextWindow = null } = {}) => {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return { kind: 'default', tokens: null, percent: null, raw: '' };
  }

  const trimmed = String(rawValue).trim();
  const lower = trimmed.toLowerCase();

  if (DEFAULT_TOKENS_VALUES.has(lower)) {
    return { kind: 'default', tokens: null, percent: null, raw: trimmed };
  }

  const percent = parsePercent(trimmed);
  if (percent !== null) {
    const tokens = Number.isFinite(contextWindow) && contextWindow > 0 ? Math.round((contextWindow * percent) / 100) : null;
    return { kind: 'percent', percent, tokens, raw: trimmed };
  }

  const tokens = parseTokenCount(trimmed);
  if (tokens !== null) {
    return { kind: 'tokens', tokens, percent: null, raw: trimmed };
  }

  throw new Error(`${PARSE_ERROR_PREFIX}: invalid value "${rawValue}". Expected a token count (e.g. 150k, 1m), a percentage (e.g. 50%), or "default".`);
};

/**
 * Apply --sub-session-size to a Claude Code env object.
 *
 * Claude Code uses CLAUDE_CODE_AUTO_COMPACT_WINDOW + CLAUDE_AUTOCOMPACT_PCT_OVERRIDE.
 * The percentage override only *lowers* the default ~95% threshold (per upstream
 * docs), so we clamp it at 95 to avoid silently being ignored.
 *
 * @param {Object} env - Mutable env object to update.
 * @param {Object} parsed - Result of parseSubSessionSize.
 * @param {Object} [options]
 * @param {number|null} [options.contextWindow] - Model context window in tokens.
 * @returns {{ applied: boolean, summary: string|null }}
 */
export const applySubSessionSizeToClaudeEnv = (env, parsed, { contextWindow = null } = {}) => {
  if (!parsed || parsed.kind === 'default') {
    return { applied: false, summary: null };
  }

  const window = Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : null;

  if (parsed.kind === 'tokens') {
    const tokens = parsed.tokens;
    if (!Number.isFinite(tokens) || tokens <= 0) return { applied: false, summary: null };

    // Use the tokens value as the compaction window basis and apply 100%.
    // Capped to the model's actual window by Claude Code itself.
    env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(tokens);
    // Compute percentage relative to the model context window (if known) so the
    // override stays within Claude Code's "lower-only" semantics. Default to 95.
    let pct = 95;
    if (window) {
      pct = Math.max(1, Math.min(95, Math.round((tokens / window) * 100)));
    }
    env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = String(pct);
    return {
      applied: true,
      summary: `CLAUDE_CODE_AUTO_COMPACT_WINDOW=${tokens}, CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=${pct}`,
    };
  }

  if (parsed.kind === 'percent') {
    const pct = Math.max(1, Math.min(95, Math.round(parsed.percent)));
    env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = String(pct);
    if (window) {
      env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(window);
    }
    return {
      applied: true,
      summary: `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=${pct}${window ? `, CLAUDE_CODE_AUTO_COMPACT_WINDOW=${window}` : ''}`,
    };
  }

  return { applied: false, summary: null };
};

/**
 * Apply --disable-1m-context to a Claude Code env object.
 * Sets CLAUDE_CODE_DISABLE_1M_CONTEXT=1 when disabled is true.
 */
export const applyDisable1mContextToClaudeEnv = (env, disabled) => {
  if (!disabled) return { applied: false };
  env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1';
  return { applied: true };
};

/**
 * Build Codex `-c` config args for --sub-session-size.
 * Returns an array like ['-c', 'model_auto_compact_token_limit=150000'] or [].
 */
export const buildCodexSubSessionSizeConfigArgs = (parsed, { contextWindow = null } = {}) => {
  if (!parsed || parsed.kind === 'default') return [];

  let tokens = null;
  if (parsed.kind === 'tokens') {
    tokens = parsed.tokens;
  } else if (parsed.kind === 'percent') {
    if (!Number.isFinite(contextWindow) || contextWindow <= 0) return [];
    tokens = Math.round((contextWindow * parsed.percent) / 100);
  }

  if (!Number.isFinite(tokens) || tokens <= 0) return [];
  return ['-c', `model_auto_compact_token_limit=${tokens}`];
};

/**
 * Build Codex `-c` config args for --disable-1m-context.
 *
 * Codex doesn't have a 1M-specific opt-out flag, but setting
 * `model_context_window=200000` forces the standard window.
 *
 * @param {boolean} disabled - True when --disable-1m-context is in effect.
 * @param {Object} [options]
 * @param {number} [options.fallbackTokens] - Tokens to set when disabling (default: 200_000).
 * @returns {string[]} Codex `-c` args, possibly empty.
 */
export const buildCodexDisable1mContextConfigArgs = (disabled, { fallbackTokens = 200_000 } = {}) => {
  if (!disabled) return [];
  return ['-c', `model_context_window=${fallbackTokens}`];
};

/**
 * Resolve --sub-session-size for a given tool, including fetching the model
 * context window when a percentage is provided. Tolerates fetch failures.
 *
 * @param {Object} params
 * @param {string|undefined|null} params.rawValue - The argv.subSessionSize value.
 * @param {string} params.tool - 'claude' or 'codex'.
 * @param {string} params.modelId - Model id (used for models.dev lookup when percent).
 * @param {Function} [params.fetchModelInfo] - models.dev fetcher (injected for testability).
 * @param {Function} [params.log] - log function (used for parse warnings).
 * @returns {Promise<{ parsed: Object, contextWindowTokens: number|null }>}
 */
export const resolveSubSessionSize = async ({ rawValue, tool, modelId, fetchModelInfo, log }) => {
  let parsed;
  try {
    parsed = parseSubSessionSize(rawValue);
  } catch (parseError) {
    if (log) await log(`⚠️  ${parseError.message}`, { level: 'warn' });
    parsed = { kind: 'default', tokens: null, percent: null, raw: '' };
  }

  let contextWindowTokens = null;
  if (parsed.kind === 'percent' && typeof fetchModelInfo === 'function') {
    try {
      const baseModelId = String(modelId || '').replace(/\[1m\]$/i, '');
      const preferredProviderIds = tool === 'codex' ? ['openai'] : ['anthropic'];
      const meta = await fetchModelInfo(baseModelId, { preferredProviderIds });
      contextWindowTokens = meta?.limit?.context || null;
    } catch {
      contextWindowTokens = null;
    }
  }

  return { parsed, contextWindowTokens };
};

export default {
  parseSubSessionSize,
  applySubSessionSizeToClaudeEnv,
  applyDisable1mContextToClaudeEnv,
  buildCodexSubSessionSizeConfigArgs,
  buildCodexDisable1mContextConfigArgs,
  resolveSubSessionSize,
};
