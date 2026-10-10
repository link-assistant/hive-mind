#!/usr/bin/env node
/**
 * Cheapest pricing tier by default for every tool hive-mind drives (issue #2771).
 *
 * Two independent price multipliers sit on top of every per-token price:
 *
 * 1. **Context length.** Several models bill a whole request at a higher rate
 *    once its prompt crosses a threshold: OpenAI GPT-5.4+ above 272K input,
 *    Claude Haiku 5.5 above 100K, Gemini Pro models above 200K, and Qwen3 Coder
 *    Plus/Flash with a 256K-1M top tier. A tool that compacts at 90-95% of a
 *    1M window happily runs into those tiers. So unless the user asks for a
 *    bigger sub-session, every run stays on the short-context tier, and the
 *    biggest window it can use is that tier's limit.
 * 2. **Speed.** Fast/priority and Ultrafast service tiers cost 2x-8x the
 *    standard rate. Codex turns Fast on by default for some ChatGPT plans
 *    (catalog `default_service_tier: "priority"` on gpt-6-sol and gpt-6-luna),
 *    and Claude Code's fast mode persists once a user turns it on. hive-mind
 *    therefore asks for the standard tier explicitly unless `--speed` says
 *    otherwise.
 *
 * Long context is switched on only when the user asks for it: with
 * `--no-disable-1m-context`, a `[1m]` model suffix, or a `--sub-session-size`
 * above the model's short-context tier. Even then the model name we pass stays
 * the plain one. Rolling aliases with `[1m]` (`opus[1m]`) are not resolved by
 * Claude Code 2.1.293 against the API, and native-1M models do not need the
 * suffix; only Opus 4.6 and Sonnet 4.6 still reach 1M through `[1m]`.
 *
 * Verified against claude-code 2.1.293, codex-cli 0.161.0, gemini-cli 0.63.0
 * and qwen-code 0.25.0; the evidence is in `docs/case-studies/issue-2771/`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2771
 */

import { buildCodexSubSessionSizeConfigArgs, parseSubSessionSize } from './sub-session-size.lib.mjs';
import { ensureGeminiFamilySettings } from './gemini-family-settings.lib.mjs';

/** Speed tiers accepted by `--speed`, cheapest first. */
export const SPEED_VALUES = Object.freeze(['flex', 'standard', 'fast', 'ultrafast']);

/** Default speed: the standard (non-priority) tier on every tool. */
export const DEFAULT_SPEED = 'standard';

const SPEED_ALIASES = Object.freeze({
  standard: 'standard',
  default: 'standard',
  normal: 'standard',
  auto: 'standard',
  flex: 'flex',
  slow: 'flex',
  economy: 'flex',
  // OpenAI has no synchronous `batch` service tier (the Batch API is a 24h
  // async job API, and Codex silently sends standard for service_tier=batch);
  // Flex is the synchronous tier "priced at Batch API rates".
  batch: 'flex',
  fast: 'fast',
  priority: 'fast',
  ultrafast: 'ultrafast',
});

/**
 * Normalize a `--speed` value. Empty values mean the default (standard).
 *
 * @param {string|undefined|null} value
 * @returns {'flex'|'standard'|'fast'|'ultrafast'}
 * @throws {Error} For unknown values.
 */
export const normalizeSpeed = value => {
  if (value === undefined || value === null || value === '') return DEFAULT_SPEED;
  const speed = SPEED_ALIASES[String(value).trim().toLowerCase()];
  if (!speed) throw new Error(`--speed: invalid value "${value}". Expected one of: ${SPEED_VALUES.join(', ')} (default: ${DEFAULT_SPEED}).`);
  return speed;
};

/** Normalize `--speed` without throwing; unknown values fall back to the default. */
export const resolveSpeed = value => {
  try {
    return normalizeSpeed(value);
  } catch {
    return DEFAULT_SPEED;
  }
};

/**
 * Share of the short-context tier a compaction limit may use when hive-mind
 * caps it, leaving room for the turn that is sent before compaction runs.
 */
export const SHORT_CONTEXT_HEADROOM_PERCENT = 90;

/** Claude Code's window with CLAUDE_CODE_DISABLE_1M_CONTEXT=1, and Anthropic's former 1M-beta price boundary. */
export const CLAUDE_SHORT_CONTEXT_TOKENS = 200_000;

/** OpenAI's long-context price boundary for GPT-5.4 and later (input tokens). */
export const CODEX_SHORT_CONTEXT_TOKENS = 272_000;

/**
 * Per-model short-context tiers that differ from the tool default. `tokens` is
 * the largest prompt that is still billed at the cheapest rate; `null` means
 * the model has no context-length price cliff.
 */
const SHORT_CONTEXT_RULES = Object.freeze([
  // Haiku 5.5: "a prompt of over 100,000 tokens pays higher prices" (5x input and output).
  { tool: 'claude', pattern: /^claude-haiku-5-5\b/i, tokens: 100_000 },
  // Gemini Pro models bill 2x input / 1.5x output above 200K; Flash and Flash-Lite are flat.
  { tool: 'gemini', pattern: /pro/i, tokens: 200_000 },
  // Qwen3 Coder Plus/Flash: the 256K-1M tier costs 6x input / 12x output versus the first tier.
  { tool: 'qwen', pattern: /^qwen3-coder-(plus|flash)/i, tokens: 256_000 },
]);

const DEFAULT_SHORT_CONTEXT_TOKENS = Object.freeze({
  claude: CLAUDE_SHORT_CONTEXT_TOKENS,
  codex: CODEX_SHORT_CONTEXT_TOKENS,
  gemini: null,
  qwen: null,
});

const stripOneMillionSuffix = model => String(model || '').replace(/\[1m\]$/i, '');

/**
 * Largest prompt (in tokens) billed at the model's cheapest context tier, or
 * null when the tool/model has no context-length price cliff.
 *
 * @param {string} tool - 'claude', 'codex', 'gemini' or 'qwen'.
 * @param {string} [modelId] - Concrete model ID (aliases should be mapped first).
 * @returns {number|null}
 */
export const getShortContextTokens = (tool, modelId) => {
  const model = stripOneMillionSuffix(modelId);
  const rule = SHORT_CONTEXT_RULES.find(candidate => candidate.tool === tool && candidate.pattern.test(model));
  if (rule) return rule.tokens;
  return DEFAULT_SHORT_CONTEXT_TOKENS[tool] ?? null;
};

/**
 * Context window Gemini CLI and Qwen Code assume for a model, used to turn a
 * token limit into the fraction their compaction settings take.
 */
export const getGeminiFamilyContextWindow = (tool, modelId) => {
  const model = stripOneMillionSuffix(modelId);
  if (tool === 'gemini') return 1_048_576;
  if (tool === 'qwen') {
    if (/^qwen3-coder-(plus|flash)/i.test(model)) return 1_000_000;
    if (/^qwen3-coder-/i.test(model)) return 256_000;
    return 200_000;
  }
  return null;
};

/**
 * Decide whether a run may use the long-context (1M) window.
 *
 * - `disable1mContext === true` (explicit `--disable-1m-context`) → short.
 * - `disable1mContext === false` (`--no-disable-1m-context`) → long.
 * - Otherwise (auto): long only when the model was given a `[1m]` suffix or the
 *   requested sub-session is bigger than the short-context tier.
 *
 * @returns {{ enabled: boolean, reason: string }}
 */
export const resolveLongContext = ({ disable1mContext, requestedTokens = null, shortContextTokens = null, has1mSuffix = false } = {}) => {
  if (disable1mContext === true) return { enabled: false, reason: '--disable-1m-context' };
  if (disable1mContext === false) return { enabled: true, reason: '--no-disable-1m-context' };
  if (has1mSuffix) return { enabled: true, reason: '[1m] model suffix' };
  if (Number.isFinite(requestedTokens) && Number.isFinite(shortContextTokens) && requestedTokens > shortContextTokens) {
    return { enabled: true, reason: `--sub-session-size ${requestedTokens} is above the ${shortContextTokens}-token short-context tier` };
  }
  return { enabled: false, reason: 'default (short-context pricing tier)' };
};

/** Largest compaction limit that keeps a run on the short-context tier. */
export const getShortContextCompactionLimit = shortContextTokens => (Number.isFinite(shortContextTokens) && shortContextTokens > 0 ? Math.floor((shortContextTokens * SHORT_CONTEXT_HEADROOM_PERCENT) / 100) : null);

/**
 * Cap a parsed `--sub-session-size` (see sub-session-size.lib.mjs) so a
 * short-context run cannot compact above its pricing tier. Long-context runs
 * and non-token values are returned unchanged.
 *
 * @returns {{ parsed: Object, capped: boolean }}
 */
export const capSubSessionSizeToShortContext = (parsed, { longContext, shortContextTokens }) => {
  const limit = getShortContextCompactionLimit(shortContextTokens);
  if (longContext || !limit || !parsed || parsed.kind !== 'tokens' || !(parsed.tokens > limit)) return { parsed, capped: false };
  return { parsed: { ...parsed, tokens: limit }, capped: true };
};

/**
 * Claude Code environment for the cheapest tier.
 *
 * - Speed: CLAUDE_CODE_DISABLE_FAST_MODE=1 unless `--speed fast|ultrafast`
 *   (fast mode is 2x on Opus 4.8+; Claude Code has no flex tier, so `flex`
 *   stays standard).
 * - Context: CLAUDE_CODE_DISABLE_1M_CONTEXT=1 holds native-1M models to a 200K
 *   window. Models whose price cliff is below that (Haiku 5.5, 100K) also get
 *   CLAUDE_CODE_AUTO_COMPACT_WINDOW capped to the cliff with a 90% trigger.
 *
 * @param {Object} env - Mutable env object (already holding --sub-session-size vars).
 * @returns {{ applied: string[] }} The env var names that were set.
 */
export const applyClaudePricingTierToEnv = (env, { speed = DEFAULT_SPEED, longContext = false, shortContextTokens = CLAUDE_SHORT_CONTEXT_TOKENS } = {}) => {
  const applied = [];
  const normalizedSpeed = resolveSpeed(speed);
  if (normalizedSpeed !== 'fast' && normalizedSpeed !== 'ultrafast') {
    env.CLAUDE_CODE_DISABLE_FAST_MODE = '1';
    applied.push('CLAUDE_CODE_DISABLE_FAST_MODE');
  }
  if (longContext) return { applied };

  env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1';
  applied.push('CLAUDE_CODE_DISABLE_1M_CONTEXT');
  if (Number.isFinite(shortContextTokens) && shortContextTokens < CLAUDE_SHORT_CONTEXT_TOKENS) {
    // A window already at or below the cliff (a capped --sub-session-size) keeps its own trigger.
    const window = Number(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
    if (!(window > 0 && window <= shortContextTokens)) {
      env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(shortContextTokens);
      applied.push('CLAUDE_CODE_AUTO_COMPACT_WINDOW');
      const pct = Number(env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE);
      if (!(pct > 0 && pct <= SHORT_CONTEXT_HEADROOM_PERCENT)) {
        env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = String(SHORT_CONTEXT_HEADROOM_PERCENT);
        applied.push('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE');
      }
    }
  }
  return { applied };
};

/** Claude models whose 1M window is only reachable through the `[1m]` suffix. */
export const CLAUDE_MODELS_REQUIRING_1M_SUFFIX = Object.freeze(['claude-opus-4-6', 'claude-sonnet-4-6']);

const CLAUDE_ROLLING_ALIASES = new Set(['opus', 'sonnet', 'haiku', 'fable']);

/**
 * The model name to hand to Claude Code: plain names by default, `[1m]` only
 * where Claude Code needs it to reach the window the run asked for.
 *
 * @param {string} model - The model as resolved for execution (alias or ID, maybe with `[1m]`).
 * @param {Object} options
 * @param {boolean} options.longContext - Result of resolveLongContext.
 * @param {(model: string) => string} [options.mapModelToId] - Alias → ID mapper.
 * @returns {{ model: string, changed: boolean }}
 */
export const resolveClaudeModelForContext = (model, { longContext, mapModelToId = value => value } = {}) => {
  if (!model || typeof model !== 'string') return { model, changed: false };
  const hasSuffix = /\[1m\]$/i.test(model);
  const base = stripOneMillionSuffix(model);
  let next = base;
  if (longContext) {
    const mapped = stripOneMillionSuffix(mapModelToId(base));
    if (CLAUDE_MODELS_REQUIRING_1M_SUFFIX.includes(mapped)) next = `${CLAUDE_ROLLING_ALIASES.has(base.toLowerCase()) ? mapped : base}[1m]`;
    else if (hasSuffix && !CLAUDE_ROLLING_ALIASES.has(base.toLowerCase())) next = model;
  }
  return { model: next, changed: next !== model };
};

/**
 * Codex `-c service_tier=...` for the requested speed. `default` is Codex's
 * sentinel for explicit standard routing, which also overrides a catalog
 * `default_service_tier` of `priority`.
 */
export const buildCodexServiceTierConfigArgs = speed => {
  const tier = { flex: 'flex', standard: 'default', fast: 'fast', ultrafast: 'ultrafast' }[resolveSpeed(speed)];
  return ['-c', `service_tier=${tier}`];
};

/**
 * Codex `-c model_context_window=...` that holds a short-context run to the
 * 272K tier (Codex compacts at 90% of the window by default).
 */
export const buildCodexContextWindowConfigArgs = ({ longContext, shortContextTokens = CODEX_SHORT_CONTEXT_TOKENS } = {}) => {
  if (longContext || !Number.isFinite(shortContextTokens)) return [];
  return ['-c', `model_context_window=${shortContextTokens}`];
};

/**
 * Issue #2842: read the `model_context_window=<tokens>` override back out of
 * Codex `-c` args, so usage accounting knows the window every request of the
 * run was capped at.
 *
 * @param {string[]} args - Codex `-c` args, e.g. ['-c', 'model_context_window=272000'].
 * @returns {number|null} The configured window in tokens, or null when absent.
 */
export const getCodexContextWindowFromConfigArgs = args => {
  for (const arg of Array.isArray(args) ? args : []) {
    const match = String(arg).match(/^model_context_window=(\d+)$/);
    if (match) return Number.parseInt(match[1], 10) || null;
  }
  return null;
};

/**
 * Gemini CLI / Qwen Code compaction setting for this run, as a settings
 * fragment for ensureGeminiFamilySettings, or null to leave the tool alone.
 *
 * Gemini's `model.compressionThreshold` (default 0.5) and Qwen's
 * `context.autoCompactThreshold` (default 0.85) are fractions of the window, so
 * a token limit becomes `tokens / window`. The settings file is shared across
 * runs, so when nothing caps this run the tool's own default is written back —
 * a Pro run's short-context cap must not leak into a later Flash run.
 */
export const GEMINI_FAMILY_DEFAULT_COMPACTION_THRESHOLDS = Object.freeze({ gemini: 0.5, qwen: 0.85 });

export const buildGeminiFamilyCompactionSettings = ({ tool, modelId, parsedSubSessionSize, longContext }) => {
  const window = getGeminiFamilyContextWindow(tool, modelId);
  if (!window) return null;
  let fraction = null;
  if (parsedSubSessionSize?.kind === 'percent') fraction = parsedSubSessionSize.percent / 100;
  else if (parsedSubSessionSize?.kind === 'tokens' && parsedSubSessionSize.tokens > 0) fraction = parsedSubSessionSize.tokens / window;
  const limit = longContext ? null : getShortContextCompactionLimit(getShortContextTokens(tool, modelId));
  if (limit) fraction = Math.min(fraction ?? 1, limit / window);
  if (fraction === null) fraction = GEMINI_FAMILY_DEFAULT_COMPACTION_THRESHOLDS[tool];
  const value = Math.max(0.01, Math.min(1, Math.round(fraction * 10_000) / 10_000));
  return tool === 'gemini' ? { model: { compressionThreshold: value } } : { context: { autoCompactThreshold: value } };
};

/**
 * Resolve the pricing tier of one run from the solve options.
 *
 * @param {Object} params
 * @param {string} params.tool - 'claude', 'codex', 'gemini' or 'qwen'.
 * @param {string} params.model - Model as the user gave it (may carry `[1m]`).
 * @param {string} [params.modelId] - Concrete model ID used for the short-tier lookup.
 * @param {boolean|undefined} params.disable1mContext - argv.disable1mContext (undefined = auto).
 * @param {string|undefined} params.subSessionSize - argv.subSessionSize.
 * @param {string|undefined} params.speed - argv.speed.
 * @returns {{ tool: string, speed: string, shortContextTokens: number|null, longContext: boolean, longContextReason: string }}
 */
export const resolvePricingTier = ({ tool, model, modelId = model, disable1mContext, subSessionSize, speed } = {}) => {
  let parsed;
  try {
    parsed = parseSubSessionSize(subSessionSize);
  } catch {
    parsed = { kind: 'default', tokens: null };
  }
  const shortContextTokens = getShortContextTokens(tool, modelId);
  // A sub-session only implies long context once it exceeds the window the
  // tool offers without it (Claude: 200K). Below that a price cliff such as
  // Haiku 5.5's 100K caps compaction instead, so the 150k default stays cheap.
  const standardWindowTokens = Math.max(shortContextTokens ?? 0, DEFAULT_SHORT_CONTEXT_TOKENS[tool] ?? 0) || null;
  const longContext = resolveLongContext({
    disable1mContext,
    requestedTokens: parsed.kind === 'tokens' ? parsed.tokens : null,
    shortContextTokens: standardWindowTokens,
    has1mSuffix: /\[1m\]$/i.test(String(model || '')),
  });
  return { tool, speed: resolveSpeed(speed), shortContextTokens, longContext: longContext.enabled, longContextReason: longContext.reason };
};

/**
 * Every Codex `-c` override that pins a run to its pricing tier: the service
 * tier, the 272K window for short-context runs, and the (capped)
 * `--sub-session-size` compaction limit.
 *
 * @param {Object} params
 * @param {Object} params.tier - Result of resolvePricingTier({ tool: 'codex', ... }).
 * @param {Object} params.parsedSubSessionSize - Result of parseSubSessionSize.
 * @param {number|null} [params.contextWindow] - Model window for percentages on long-context runs.
 * @returns {{ serviceTierArgs: string[], contextWindowArgs: string[], subSessionSizeArgs: string[], capped: boolean }}
 */
export const buildCodexPricingTierConfigArgs = ({ tier, parsedSubSessionSize, contextWindow = null }) => {
  const { parsed, capped } = capSubSessionSizeToShortContext(parsedSubSessionSize, tier);
  const window = !tier.longContext && parsed?.kind === 'percent' ? tier.shortContextTokens : contextWindow;
  return {
    serviceTierArgs: buildCodexServiceTierConfigArgs(tier.speed),
    contextWindowArgs: buildCodexContextWindowConfigArgs(tier),
    subSessionSizeArgs: buildCodexSubSessionSizeConfigArgs(parsed, { contextWindow: window }),
    capped,
  };
};

/**
 * Write this run's Gemini CLI / Qwen Code compaction threshold (see
 * buildGeminiFamilyCompactionSettings). Never throws.
 *
 * @param {Object} params
 * @param {'gemini'|'qwen'} params.tool
 * @param {Object} params.argv - solve options (model, disable1mContext, subSessionSize, speed).
 * @param {string} params.modelId - Concrete model ID.
 * @param {Function} [params.log]
 * @param {string} [params.settingsPath] - Overrides the settings file (tests).
 * @param {Object} [params.fsImpl] - `node:fs/promises`-shaped, for tests.
 * @returns {Promise<{ tier: Object, settings: Object|null, result: Object|null }>}
 */
export const applyGeminiFamilyPricingTier = async ({ tool, argv = {}, modelId, log, settingsPath, homeDir, fsImpl } = {}) => {
  const tier = resolvePricingTier({ tool, model: argv.model, modelId, disable1mContext: argv.disable1mContext, subSessionSize: argv.subSessionSize, speed: argv.speed });
  let parsedSubSessionSize;
  try {
    parsedSubSessionSize = parseSubSessionSize(argv.subSessionSize);
  } catch (error) {
    if (log) await log(`⚠️  ${error.message}`, { level: 'warn' });
    parsedSubSessionSize = { kind: 'default', tokens: null, percent: null, raw: '' };
  }
  const settings = buildGeminiFamilyCompactionSettings({ tool, modelId, parsedSubSessionSize, longContext: tier.longContext });
  if (log) await log(`💰 Pricing tier: ${describePricingTier(tier)}`, { verbose: true });
  if (!settings) return { tier, settings: null, result: null };
  const result = await ensureGeminiFamilySettings({ tool, settings, settingsPath, homeDir, log, describe: '💰 Compaction threshold', fsImpl });
  return { tier, settings, result };
};

/** One-line summary of a resolved pricing tier for logs. */
export const describePricingTier = tier => {
  const context = tier.longContext ? `long context allowed (${tier.longContextReason})` : `short context${Number.isFinite(tier.shortContextTokens) ? ` (≤${tier.shortContextTokens} tokens)` : ''}`;
  return `speed=${tier.speed}, ${context}`;
};

export default {
  SPEED_VALUES,
  DEFAULT_SPEED,
  normalizeSpeed,
  resolveSpeed,
  getShortContextTokens,
  getGeminiFamilyContextWindow,
  resolveLongContext,
  getShortContextCompactionLimit,
  capSubSessionSizeToShortContext,
  applyClaudePricingTierToEnv,
  resolveClaudeModelForContext,
  buildCodexServiceTierConfigArgs,
  buildCodexContextWindowConfigArgs,
  GEMINI_FAMILY_DEFAULT_COMPACTION_THRESHOLDS,
  buildGeminiFamilyCompactionSettings,
  resolvePricingTier,
  buildCodexPricingTierConfigArgs,
  applyGeminiFamilyPricingTier,
  describePricingTier,
};
