#!/usr/bin/env node

/**
 * Central configuration module for all configurable values
 * Provides environment variable overrides with sensible defaults
 */

// Use use-m to dynamically import modules
if (typeof globalThis.use === 'undefined') {
  try {
    globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
  } catch (error) {
    console.error('❌ Fatal error: Failed to load dependencies for configuration');
    console.error(`   ${error.message}`);
    console.error('   This might be due to network issues or missing dependencies.');
    console.error('   Please check your internet connection and try again.');
    process.exit(1);
  }
}

// Issue #1710: use-m occasionally hands back a truncated/corrupt global package
// (npm install -g flake on hosted CI). useWithRetry deletes the broken install
// dir and re-fetches when the failure is a SyntaxError mid-import.
const { useWithRetry } = await import('./use-with-retry.lib.mjs');
const getenvModule = await useWithRetry(globalThis.use, 'getenv');
// Node 24 CJS/ESM interop may return the whole module object instead of the function directly
const getenv = typeof getenvModule === 'function' ? getenvModule : getenvModule.default || getenvModule;

// Use semver package for version comparison (see issue #1146)
import semver from 'semver';
import { buildClaudeQuietEnv } from './claude-quiet-config.lib.mjs';

// Import lino for parsing Links Notation format
const { lino } = await import('./lino.lib.mjs');

// Helper function to safely parse integers with fallback
const parseIntWithDefault = (envVar, defaultValue) => {
  const value = getenv(envVar, defaultValue.toString());
  const parsed = parseInt(value);
  return isNaN(parsed) ? defaultValue : parsed;
};

// Helper function to safely parse floats with fallback
const parseFloatWithDefault = (envVar, defaultValue) => {
  const value = getenv(envVar, defaultValue.toString());
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
};

// Timeout configurations (in milliseconds)
export const timeouts = {
  claudeCli: parseIntWithDefault('HIVE_MIND_CLAUDE_TIMEOUT_SECONDS', 60) * 1000,
  opencodeCli: parseIntWithDefault('HIVE_MIND_OPENCODE_TIMEOUT_SECONDS', 60) * 1000,
  geminiCli: parseIntWithDefault('HIVE_MIND_GEMINI_TIMEOUT_SECONDS', 60) * 1000,
  codexCli: parseIntWithDefault('HIVE_MIND_CODEX_TIMEOUT_SECONDS', 60) * 1000,
  qwenCli: parseIntWithDefault('HIVE_MIND_QWEN_TIMEOUT_SECONDS', 60) * 1000,
  githubApiDelay: parseIntWithDefault('HIVE_MIND_GITHUB_API_DELAY_MS', 5000),
  githubRepoDelay: parseIntWithDefault('HIVE_MIND_GITHUB_REPO_DELAY_MS', 2000),
  retryBaseDelay: parseIntWithDefault('HIVE_MIND_RETRY_BASE_DELAY_MS', 5000),
  retryBackoffDelay: parseIntWithDefault('HIVE_MIND_RETRY_BACKOFF_DELAY_MS', 1000),
  // Issue #1280: Timeout (ms) to wait for stream close after result event before force-killing
  // command-stream's stream() waits for process exit + pipe close; if stdout stays open, it hangs
  resultStreamCloseMs: parseIntWithDefault('HIVE_MIND_RESULT_STREAM_CLOSE_MS', 30000),
  // Issue #1472/#1475: Timeout (ms) to wait for first stream output from Claude CLI after startup.
  // If no stdout/stderr output is received within this period, the process is considered stuck
  // and will be force-killed. Both affected sessions showed ~4.5h with zero output from Claude CLI.
  // Default: 120000ms (2 minutes) — Claude CLI normally emits system.init within 1-3 seconds.
  streamStartupMs: parseIntWithDefault('HIVE_MIND_STREAM_STARTUP_MS', 120000),
  // Issue #1472: Activity timeout (ms) — if no new stream output is received for this duration
  // after at least one event was received, the process is considered hung mid-session.
  // This catches the case where Claude CLI starts producing output but then stops (e.g., the
  // original Issue #1472 where CLI was stuck for 4.5h with all output arriving only at CTRL+C).
  // Issue #1510: Increased from 300000ms (5 min) to 3600000ms (1 hour) because Claude Code can
  // legitimately wait for long-running operations (docker builds, CI polls, large compilations).
  // The 5-minute timeout was force-killing sessions during `sleep 300 && gh run view ...` commands.
  // Default: 3600000ms (1 hour). Set to 0 to disable. Configurable via environment variable.
  streamActivityMs: parseIntWithDefault('HIVE_MIND_STREAM_ACTIVITY_MS', 3600000),
};

// Auto-continue configurations
export const autoContinue = {
  ageThresholdHours: parseIntWithDefault('HIVE_MIND_AUTO_CONTINUE_AGE_HOURS', 24),
};

// Auto-resume on limit reset configurations
// See: https://github.com/link-assistant/hive-mind/issues/1152
// See: https://github.com/link-assistant/hive-mind/issues/1236
export const limitReset = {
  // Buffer time to wait after limit reset (in milliseconds)
  // Default: 10 minutes - accounts for server time differences and API propagation delays
  // Increased from 5 to 10 minutes to reduce risk of hitting limits again immediately
  // See: https://github.com/link-assistant/hive-mind/issues/1236
  bufferMs: parseIntWithDefault('HIVE_MIND_LIMIT_RESET_BUFFER_MS', 10 * 60 * 1000),
  // Random jitter added to buffer to avoid thundering herd problem (in milliseconds)
  // When multiple instances wait for the same limit reset, jitter distributes their
  // resume times to reduce simultaneous API load
  // Default: 5 minutes (0 to 5 minutes random) - total wait after reset: 10-15 minutes
  // See: https://github.com/link-assistant/hive-mind/issues/1236
  jitterMs: parseIntWithDefault('HIVE_MIND_LIMIT_RESET_JITTER_MS', 5 * 60 * 1000),
};

// GitHub API limits
export const githubLimits = {
  commentMaxSize: parseIntWithDefault('HIVE_MIND_GITHUB_COMMENT_MAX_SIZE', 65536),
  fileMaxSize: parseIntWithDefault('HIVE_MIND_GITHUB_FILE_MAX_SIZE', 25 * 1024 * 1024),
  issueBodyMaxSize: parseIntWithDefault('HIVE_MIND_GITHUB_ISSUE_BODY_MAX_SIZE', 60000),
  attachmentMaxSize: parseIntWithDefault('HIVE_MIND_GITHUB_ATTACHMENT_MAX_SIZE', 10 * 1024 * 1024),
  bufferMaxSize: parseIntWithDefault('HIVE_MIND_GITHUB_BUFFER_MAX_SIZE', 10 * 1024 * 1024),
};

// Memory and disk configurations
export const systemLimits = {
  minDiskSpaceMb: parseIntWithDefault('HIVE_MIND_MIN_DISK_SPACE_MB', 2048),
  defaultPageSizeKb: parseIntWithDefault('HIVE_MIND_DEFAULT_PAGE_SIZE_KB', 16),
};

// Retry configurations
// Issue #1331: All API error types use unified retry parameters:
// 10 max retries, 2 minute initial delay, 30 minute max delay (exponential backoff), session preserved
export const retryLimits = {
  maxForkRetries: parseIntWithDefault('HIVE_MIND_MAX_FORK_RETRIES', 5),
  maxVerifyRetries: parseIntWithDefault('HIVE_MIND_MAX_VERIFY_RETRIES', 5),
  maxApiRetries: parseIntWithDefault('HIVE_MIND_MAX_API_RETRIES', 3),
  retryBackoffMultiplier: parseFloatWithDefault('HIVE_MIND_RETRY_BACKOFF_MULTIPLIER', 2),
  // Unified retry config for all transient API errors (Overloaded, 503, Internal Server Error)
  maxTransientErrorRetries: parseIntWithDefault('HIVE_MIND_MAX_TRANSIENT_ERROR_RETRIES', 10),
  initialTransientErrorDelayMs: parseIntWithDefault('HIVE_MIND_INITIAL_TRANSIENT_ERROR_DELAY_MS', 2 * 60 * 1000), // 2 minutes
  maxTransientErrorDelayMs: parseIntWithDefault('HIVE_MIND_MAX_TRANSIENT_ERROR_DELAY_MS', 30 * 60 * 1000), // 30 minutes
  // Request timeout retry configuration (Issue #1353)
  // Network timeouts need longer waits than API errors — Claude CLI already exhausted its own retries
  maxRequestTimeoutRetries: parseIntWithDefault('HIVE_MIND_MAX_REQUEST_TIMEOUT_RETRIES', 10),
  initialRequestTimeoutDelayMs: parseIntWithDefault('HIVE_MIND_INITIAL_REQUEST_TIMEOUT_DELAY_MS', 5 * 60 * 1000), // 5 minutes
  maxRequestTimeoutDelayMs: parseIntWithDefault('HIVE_MIND_MAX_REQUEST_TIMEOUT_DELAY_MS', 60 * 60 * 1000), // 1 hour
  // Not-retryable error fail-fast configuration (Issue #1437)
  // When the API sends x-should-retry: false AND retries make no progress (num_turns <= 1),
  // stop retrying after this many attempts to avoid a stuck loop with no recovery prospects.
  // Default: 5 — retry generously even when API signals not retryable, since the signal can be wrong
  // for transient backend glitches (e.g. overloaded errors observed as non-retryable 500s).
  maxNotRetryableAttempts: parseIntWithDefault('HIVE_MIND_MAX_NOT_RETRYABLE_ATTEMPTS', 5),
};

// Claude Code CLI configurations
// See: https://github.com/link-assistant/hive-mind/issues/1076
// Claude models support different max output tokens:
// - Opus 4.6 (default 'opus' alias): 128K tokens (Issue #1221, Issue #1433)
// - Sonnet 4.5, Opus 4.5, Haiku 4.5: 64K tokens
// Setting a higher limit allows Claude to generate longer responses without hitting the limit
export const claudeCode = {
  // Maximum output tokens for Claude Code CLI responses
  // Default: 64000 (matches Claude Sonnet/Opus/Haiku 4.5 model capabilities)
  // Set via CLAUDE_CODE_MAX_OUTPUT_TOKENS or HIVE_MIND_CLAUDE_CODE_MAX_OUTPUT_TOKENS
  maxOutputTokens: parseIntWithDefault('CLAUDE_CODE_MAX_OUTPUT_TOKENS', parseIntWithDefault('HIVE_MIND_CLAUDE_CODE_MAX_OUTPUT_TOKENS', 64000)),
  // Maximum output tokens for Opus 4.6 (Issue #1221)
  // See: https://platform.claude.com/docs/en/about-claude/models/overview
  maxOutputTokensOpus46: parseIntWithDefault('CLAUDE_CODE_MAX_OUTPUT_TOKENS_OPUS_46', parseIntWithDefault('HIVE_MIND_CLAUDE_CODE_MAX_OUTPUT_TOKENS_OPUS_46', 128000)),
  // MCP (Model Context Protocol) timeout configurations
  // See: https://github.com/link-assistant/hive-mind/issues/1066
  // See: https://code.claude.com/docs/en/settings#environment-variables
  // MCP_TIMEOUT: Timeout in milliseconds for MCP server startup
  // MCP_TOOL_TIMEOUT: Timeout in milliseconds for MCP tool execution
  // Default: 900000ms (15 minutes) to accommodate long-running Playwright operations
  // Set via MCP_TIMEOUT/MCP_TOOL_TIMEOUT or HIVE_MIND_MCP_TIMEOUT/HIVE_MIND_MCP_TOOL_TIMEOUT
  mcpTimeout: parseIntWithDefault('MCP_TIMEOUT', parseIntWithDefault('HIVE_MIND_MCP_TIMEOUT', 900000)),
  mcpToolTimeout: parseIntWithDefault('MCP_TOOL_TIMEOUT', parseIntWithDefault('HIVE_MIND_MCP_TOOL_TIMEOUT', 900000)),
};

// Default max thinking budget for Claude Code (see issue #1146)
// This is the default value used by Claude Code when extended thinking is enabled
// Can be overridden via --max-thinking-budget option
export const DEFAULT_MAX_THINKING_BUDGET = 31999;

// Default max thinking budget for Opus 4.6 (Issue #1221, updated in Issue #1238)
// Aligned with standard models (31999) for consistency.
// Opus 4.6 uses CLAUDE_CODE_EFFORT_LEVEL for thinking depth instead of MAX_THINKING_TOKENS
// (MAX_THINKING_TOKENS is ignored for Opus 4.6 unless set to 0 to disable thinking).
// Can be overridden via --max-thinking-budget option or HIVE_MIND_MAX_THINKING_BUDGET_OPUS_46
export const DEFAULT_MAX_THINKING_BUDGET_OPUS_46 = parseIntWithDefault('HIVE_MIND_MAX_THINKING_BUDGET_OPUS_46', 31999);

/**
 * Check if a model is Opus 4.6 or later (Issue #1221, updated in Issue #1238, Issue #1832)
 * @param {string} model - The model name or ID
 * @returns {boolean} True if the model is Opus 4.6 or later
 */
export const isOpus46OrLater = model => {
  if (!model) return false;
  const normalizedModel = model.toLowerCase();
  // Check for explicit opus-4-6 or later versions, or opusplan (Issue #1223)
  // Note: The 'opus' alias now maps to Opus 4.8 (Issue #1832), so we also check for the alias directly
  // opusplan uses Opus for planning, so it should get Opus-level settings
  return normalizedModel === 'opus' || normalizedModel === 'opusplan' || normalizedModel.includes('opus-4-6') || normalizedModel.includes('opus-4-7') || normalizedModel.includes('opus-4-8') || normalizedModel.includes('opus-5');
};

const isOpus47 = model => {
  if (!model) return false;
  const normalizedModel = model.toLowerCase();
  // 'opus' alias now maps to Opus 4.8 (Issue #1832), which inherits 4.7 behaviour
  // opusplan uses Opus for planning, so it gets Opus-level settings
  return normalizedModel === 'opus' || normalizedModel === 'opusplan' || normalizedModel.includes('opus-4-7') || normalizedModel.includes('opus-4-8');
};

/**
 * Check if a model is Opus 4.7 or later (Issue #1620, Issue #1832)
 * These models use Opus 4.7+ adaptive thinking behavior (also applies to Opus 4.8).
 * @param {string} model - The model name or ID
 * @returns {boolean} True if the model is Opus 4.7 or later
 */
export const isOpus47OrLater = model => {
  if (!model) return false;
  const normalizedModel = model.toLowerCase();
  return isOpus47(model) || normalizedModel.includes('opus-5');
};

/**
 * Check if a model is Opus 4.8 or later (Issue #1832)
 * Opus 4.8 inherits all Opus 4.7 API constraints (adaptive thinking only, no sampling
 * params) and adds new features such as mid-conversation system messages, refusal stop
 * details, and fast mode. These are not exposed through Claude Code today, but this
 * helper enables finer-grained control for future wiring.
 * @param {string} model - The model name or ID
 * @returns {boolean} True if the model is Opus 4.8 or later
 */
export const isOpus48OrLater = model => {
  if (!model) return false;
  const normalizedModel = model.toLowerCase();
  // 'opus' alias now maps to Opus 4.8 (Issue #1832)
  return normalizedModel === 'opus' || normalizedModel === 'opusplan' || normalizedModel.includes('opus-4-8') || normalizedModel.includes('opus-5');
};

const isOpus45 = model => {
  if (!model) return false;
  const m = model.toLowerCase();
  return m === 'opus-4-5' || m.includes('opus-4-5');
};

const isOpus46 = model => {
  if (!model) return false;
  const m = model.toLowerCase();
  return m === 'opus-4-6' || m.includes('opus-4-6');
};

const isSonnet46OrLater = model => {
  if (!model) return false;
  const m = model.toLowerCase();
  return m === 'sonnet' || m === 'sonnet-4-6' || m.includes('sonnet-4-6') || m.includes('sonnet-5');
};

const isMythosPreview = model => {
  if (!model) return false;
  return model.toLowerCase().includes('mythos');
};

/**
 * Check if a model supports CLAUDE_CODE_EFFORT_LEVEL (Issue #1238, Issue #1620)
 * Official effort support: Claude Mythos Preview, Opus 4.7, Opus 4.6, Sonnet 4.6, and Opus 4.5.
 * Haiku 4.5 and older models use MAX_THINKING_TOKENS only.
 * @param {string} model - The model name or ID
 * @returns {boolean} True if the model supports effort levels
 */
export const supportsEffortLevel = model => {
  if (!model) return false;
  return isMythosPreview(model) || isOpus47OrLater(model) || isOpus46(model) || isSonnet46OrLater(model) || isOpus45(model);
};

/**
 * Check if a model supports the xhigh effort level.
 * Official docs list xhigh for Claude Opus 4.7 and Opus 4.8 (Issue #1832).
 * @param {string} model - The model name or ID
 * @returns {boolean} True if the model supports xhigh effort
 */
export const supportsXHighEffortLevel = model => isOpus47(model);

/**
 * Check if a model supports the max effort level.
 * Official docs list max for Claude Mythos Preview, Opus 4.7, Opus 4.6, and Sonnet 4.6.
 * @param {string} model - The model name or ID
 * @returns {boolean} True if the model supports max effort
 */
export const supportsMaxEffortLevel = model => isMythosPreview(model) || isOpus47OrLater(model) || isOpus46(model) || isSonnet46OrLater(model);

/**
 * Get the max output tokens for a specific model (Issue #1221)
 * @param {string} model - The model name or ID
 * @returns {number} The max output tokens for the model
 */
export const getMaxOutputTokensForModel = model => {
  if (isOpus46OrLater(model)) {
    return claudeCode.maxOutputTokensOpus46;
  }
  return claudeCode.maxOutputTokens;
};

/**
 * Get the default max thinking budget for a specific model (Issue #1221)
 * @param {string} model - The model name or ID
 * @returns {number} The default max thinking budget for the model
 */
export const getDefaultMaxThinkingBudgetForModel = model => {
  if (isOpus46OrLater(model)) {
    return DEFAULT_MAX_THINKING_BUDGET_OPUS_46;
  }
  return DEFAULT_MAX_THINKING_BUDGET;
};

/**
 * Get thinking level token values calculated from max budget
 * Values are evenly distributed: off=0, low=max/4, medium=max/2, high=max*3/4, max=max
 * @param {number} maxBudget - Maximum thinking budget (default: 31999)
 * @returns {Object} Mapping of thinking levels to token values
 */
export const getThinkingLevelToTokens = (maxBudget = DEFAULT_MAX_THINKING_BUDGET) => ({
  off: 0,
  low: Math.floor(maxBudget / 4), // ~8000 for default 31999
  medium: Math.floor(maxBudget / 2), // ~16000 for default 31999
  high: Math.floor((maxBudget * 3) / 4), // ~24000 for default 31999
  xhigh: maxBudget, // same as max when represented as MAX_THINKING_TOKENS
  max: maxBudget, // 31999 by default
});

// Default thinking level to tokens mapping (using default max budget)
export const thinkingLevelToTokens = getThinkingLevelToTokens(DEFAULT_MAX_THINKING_BUDGET);

/**
 * Get tokens to thinking level mapping function with configurable max budget
 * Uses midpoint ranges to determine the level
 * @param {number} maxBudget - Maximum thinking budget (default: 31999)
 * @returns {Function} Function that converts tokens to thinking level
 */
export const getTokensToThinkingLevel = (maxBudget = DEFAULT_MAX_THINKING_BUDGET) => {
  const levels = getThinkingLevelToTokens(maxBudget);
  // Calculate midpoints between levels for range determination
  const lowMediumMidpoint = Math.floor((levels.low + levels.medium) / 2);
  const mediumHighMidpoint = Math.floor((levels.medium + levels.high) / 2);
  const highMaxMidpoint = Math.floor((levels.high + levels.max) / 2);

  return tokens => {
    if (tokens === 0) return 'off';
    if (tokens <= lowMediumMidpoint) return 'low';
    if (tokens <= mediumHighMidpoint) return 'medium';
    if (tokens <= highMaxMidpoint) return 'high';
    return 'max';
  };
};

// Default tokens to thinking level function (using default max budget)
export const tokensToThinkingLevel = getTokensToThinkingLevel(DEFAULT_MAX_THINKING_BUDGET);

/**
 * Valid effort levels for Opus 4.6 and Sonnet 4.6 (Issue #1238, Issue #1620)
 * These models use CLAUDE_CODE_EFFORT_LEVEL for thinking depth control
 * @type {string[]}
 */
export const OPUS_46_EFFORT_LEVELS = ['low', 'medium', 'high', 'max'];

/**
 * Valid effort levels for Opus 4.7 and Opus 4.8 (Issue #1620, Issue #1832)
 * Both models support the additional 'xhigh' level.
 * Opus 4.8 keeps the same effort level set; the default effort level is 'high'
 * (enforced by Claude Code itself, not by this module).
 * See: https://platform.claude.com/docs/en/build-with-claude/effort
 * @type {string[]}
 */
export const OPUS_47_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Convert thinking level to effort level (Issue #1238, Issue #1620)
 * Models with max support keep max as max. Opus 4.7 keeps xhigh as xhigh.
 * Models with effort but without max support use high for max/xhigh.
 * @param {string|undefined} thinkLevel - The thinking level (off/low/medium/high/xhigh/max)
 * @param {Object} [options] - Options
 * @param {boolean} [options.isOpus47] - Backward-compatible shorthand for supportsXHigh
 * @param {boolean} [options.supportsXHigh] - Whether the model supports xhigh effort
 * @param {boolean} [options.supportsMax] - Whether the model supports max effort
 * @returns {string|undefined} The effort level or undefined if thinking is off
 */
export const thinkLevelToEffortLevel = (thinkLevel, options = {}) => {
  if (!thinkLevel || thinkLevel === 'off') {
    return undefined;
  }

  const supportsXHigh = options.supportsXHigh ?? options.isOpus47 ?? false;
  const supportsMax = options.supportsMax ?? true;

  switch (thinkLevel) {
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'xhigh':
      return supportsXHigh ? 'xhigh' : supportsMax ? 'max' : 'high';
    case 'max':
      return supportsMax ? 'max' : 'high';
    default:
      return undefined;
  }
};

/**
 * Convert thinking budget (tokens) to effort level (Issue #1238, Issue #1620)
 * Uses token thresholds to determine the appropriate effort level
 * @param {number|undefined} thinkingBudget - The thinking budget in tokens
 * @param {number} maxBudget - Maximum thinking budget (default: 31999)
 * @param {Object} [options] - Options
 * @param {boolean} [options.isOpus47] - Backward-compatible shorthand for supportsXHigh
 * @param {boolean} [options.supportsXHigh] - Whether the model supports xhigh effort
 * @param {boolean} [options.supportsMax] - Whether the model supports max effort
 * @returns {string|undefined} The effort level or undefined if thinking is off
 */
export const thinkingBudgetToEffortLevel = (thinkingBudget, maxBudget = DEFAULT_MAX_THINKING_BUDGET, options = {}) => {
  if (thinkingBudget === undefined || thinkingBudget === 0) {
    return undefined;
  }

  const thinkLevel = getTokensToThinkingLevel(maxBudget)(thinkingBudget);
  return thinkLevelToEffortLevel(thinkLevel, options);
};

// Check if a version supports thinking budget (>= minimum version)
// Uses semver npm package for reliable version comparison (see issue #1146)
export const supportsThinkingBudget = (version, minVersion = '2.1.12') => {
  // Clean the version string (remove any leading 'v' and extra text)
  const cleanVersion = semver.clean(version) || semver.coerce(version)?.version;
  const cleanMinVersion = semver.clean(minVersion) || semver.coerce(minVersion)?.version;

  if (!cleanVersion || !cleanMinVersion) {
    // If versions can't be parsed, assume old version (doesn't support budget)
    return false;
  }

  return semver.gte(cleanVersion, cleanMinVersion);
};

// Helper function to get Claude CLI environment with CLAUDE_CODE_MAX_OUTPUT_TOKENS set
// Optionally sets MAX_THINKING_TOKENS when thinkingBudget is provided (see issue #1146)
// Also sets MCP_TIMEOUT and MCP_TOOL_TIMEOUT for MCP tool execution (see issue #1066)
// Supports model-specific max output tokens for Opus 4.6 (Issue #1221)
// Sets CLAUDE_CODE_EFFORT_LEVEL for Opus 4.6 models (Issue #1238)
// Supports planModel/executionModel for opusplan mode (Issue #1223)
// Issue #1706: supports subSessionSize (parsed) + disable1mContext to cap
// auto-compaction sub-session size and opt out of the 1M extended context.
// See: https://code.claude.com/docs/en/env-vars and https://code.claude.com/docs/en/model-config
//   ANTHROPIC_DEFAULT_OPUS_MODEL  → model used in plan mode (and for 'opus' alias)
//   ANTHROPIC_DEFAULT_SONNET_MODEL → model used in execution mode (and for 'sonnet' alias)
//   CLAUDE_CODE_DISABLE_1M_CONTEXT, CLAUDE_CODE_AUTO_COMPACT_WINDOW, CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
export const getClaudeEnv = (options = {}) => {
  // Get max output tokens based on model (Issue #1221)
  const maxOutputTokens = options.model ? getMaxOutputTokensForModel(options.model) : claudeCode.maxOutputTokens;

  const env = buildClaudeQuietEnv({
    ...process.env,
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(maxOutputTokens),
    // MCP timeout configurations to prevent tool calls from hanging indefinitely
    // See: https://github.com/link-assistant/hive-mind/issues/1066
    MCP_TIMEOUT: String(claudeCode.mcpTimeout),
    MCP_TOOL_TIMEOUT: String(claudeCode.mcpToolTimeout),
  });

  // Opus 4.7+ always uses adaptive thinking — MAX_THINKING_TOKENS has no effect (Issue #1620, Issue #1832)
  // Opus 4.8 inherits this constraint: adaptive thinking is the only thinking mode.
  // For Opus 4.6 and earlier, MAX_THINKING_TOKENS controls extended thinking (Claude Code >= 2.1.12)
  // Default is 0 (thinking disabled) per Issue #1238.
  const opus47 = options.model && isOpus47OrLater(options.model);
  if (opus47) {
    // Remove any inherited MAX_THINKING_TOKENS from process.env — Opus 4.7+ ignores it
    delete env.MAX_THINKING_TOKENS;
  } else {
    env.MAX_THINKING_TOKENS = String(options.thinkingBudget ?? 0);
  }

  // Set CLAUDE_CODE_EFFORT_LEVEL for models that support it (Issue #1238, Issue #1620)
  if (options.model && supportsEffortLevel(options.model)) {
    const effortOptions = {
      supportsXHigh: supportsXHighEffortLevel(options.model),
      supportsMax: supportsMaxEffortLevel(options.model),
    };
    let effortLevel;
    if (options.thinkLevel) {
      effortLevel = thinkLevelToEffortLevel(options.thinkLevel, effortOptions);
    } else if (options.thinkingBudget !== undefined && options.thinkingBudget > 0) {
      effortLevel = thinkingBudgetToEffortLevel(options.thinkingBudget, options.maxBudget, effortOptions);
    }

    if (effortLevel) {
      env.CLAUDE_CODE_EFFORT_LEVEL = effortLevel;
    }
  }

  // Opus 4.7+ omits thinking content by default; opt in with --show-thinking-content (Issue #1620, Issue #1832)
  // Sets CLAUDE_CODE_SHOW_THINKING=1 which Claude Code uses to request display: "summarized"
  // Applies to Opus 4.8 as well, which inherits Opus 4.7 thinking display behaviour.
  if (options.showThinkingContent) {
    env.CLAUDE_CODE_SHOW_THINKING = '1';
  }
  // Issue #817: When bidirectional streaming input is enabled, keep the headless
  // Claude process alive between turns so newly arriving PR comments can be
  // streamed into stdin as additional user messages. Without this env var the
  // process would exit as soon as the first --input-format stream-json frame
  // is processed. Default is 1 minute (60000ms), matching the reference gist.
  if (options.exitAfterStopDelayMs) {
    env.CLAUDE_CODE_EXIT_AFTER_STOP_DELAY_MS = String(options.exitAfterStopDelayMs);
  }
  // Set ANTHROPIC_DEFAULT_OPUS_MODEL when planModel is specified (Issue #1223)
  // This tells Claude Code which model to use during plan mode in opusplan
  if (options.planModel) {
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = String(options.planModel);
  }
  // Set ANTHROPIC_DEFAULT_SONNET_MODEL when executionModel is specified (Issue #1223)
  // This tells Claude Code which model to use during execution mode in opusplan
  // Enables combinations like --plan-model opus --model haiku
  if (options.executionModel) {
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = String(options.executionModel);
  }

  // Issue #1706: --disable-1m-context. Sets CLAUDE_CODE_DISABLE_1M_CONTEXT=1.
  if (options.disable1mContext) {
    env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1';
  }

  // Issue #1706: --sub-session-size. Caller passes a pre-parsed descriptor and the
  // model context window so we can convert percentages to absolute tokens.
  if (options.subSessionSize && options.subSessionSize.kind && options.subSessionSize.kind !== 'default') {
    const window = Number.isFinite(options.contextWindowTokens) && options.contextWindowTokens > 0 ? options.contextWindowTokens : null;
    if (options.subSessionSize.kind === 'tokens') {
      const tokens = options.subSessionSize.tokens;
      if (Number.isFinite(tokens) && tokens > 0) {
        env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(tokens);
        // Compute percentage relative to the context window so the override stays
        // within Claude Code's "lower-only" semantics. Default to 95 when unknown.
        let pct = 95;
        if (window) {
          pct = Math.max(1, Math.min(95, Math.round((tokens / window) * 100)));
        }
        env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = String(pct);
      }
    } else if (options.subSessionSize.kind === 'percent') {
      const pct = Math.max(1, Math.min(95, Math.round(options.subSessionSize.percent)));
      env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = String(pct);
      if (window) {
        env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(window);
      }
    }
  }

  return env;
};

// Cache TTL configurations (in milliseconds)
// The Usage API (Claude limits) has stricter rate limiting than regular APIs
// See: https://github.com/link-assistant/hive-mind/issues/1074
// See: https://github.com/link-assistant/hive-mind/issues/1798
export const cacheTtl = {
  // General API cache TTL (GitHub API, etc.)
  api: parseIntWithDefault('HIVE_MIND_API_CACHE_TTL_MS', 3 * 60 * 1000), // 3 minutes
  // Claude Usage API cache TTL - increased by 3 minutes (from 10 → 13) per issue #1798
  // because users still hit "Resets in 3m xs" rate-limit responses. The API
  // returns null values or 429 when called too frequently.
  usageApi: parseIntWithDefault('HIVE_MIND_USAGE_API_CACHE_TTL_MS', 13 * 60 * 1000), // 13 minutes
  // System metrics cache TTL (RAM, CPU, disk)
  system: parseIntWithDefault('HIVE_MIND_SYSTEM_CACHE_TTL_MS', 2 * 60 * 1000), // 2 minutes
};

// File and path configurations
export const filePaths = {
  tempDir: getenv('HIVE_MIND_TEMP_DIR', '/tmp'),
  taskInfoFilename: getenv('HIVE_MIND_TASK_INFO_FILENAME', 'CLAUDE.md'),
  procMeminfo: getenv('HIVE_MIND_PROC_MEMINFO', '/proc/meminfo'),
};

// Text processing configurations
export const textProcessing = {
  tokenMaskMinLength: parseIntWithDefault('HIVE_MIND_TOKEN_MASK_MIN_LENGTH', 12),
  tokenMaskStartChars: parseIntWithDefault('HIVE_MIND_TOKEN_MASK_START_CHARS', 5),
  tokenMaskEndChars: parseIntWithDefault('HIVE_MIND_TOKEN_MASK_END_CHARS', 5),
  textPreviewLength: parseIntWithDefault('HIVE_MIND_TEXT_PREVIEW_LENGTH', 100),
  logTruncationLength: parseIntWithDefault('HIVE_MIND_LOG_TRUNCATION_LENGTH', 5000),
};

// UI/Display configurations
export const display = {
  labelWidth: parseIntWithDefault('HIVE_MIND_LABEL_WIDTH', 25),
};

// Sentry configurations
export const sentry = {
  dsn: getenv('HIVE_MIND_SENTRY_DSN', 'https://77b711f23c84cbf74366df82090dc389@o4510072519983104.ingest.us.sentry.io/4510072523325440'),
  tracesSampleRateDev: parseFloatWithDefault('HIVE_MIND_SENTRY_TRACES_SAMPLE_RATE_DEV', 1.0),
  tracesSampleRateProd: parseFloatWithDefault('HIVE_MIND_SENTRY_TRACES_SAMPLE_RATE_PROD', 0.1),
  profileSessionSampleRateDev: parseFloatWithDefault('HIVE_MIND_SENTRY_PROFILE_SESSION_SAMPLE_RATE_DEV', 1.0),
  profileSessionSampleRateProd: parseFloatWithDefault('HIVE_MIND_SENTRY_PROFILE_SESSION_SAMPLE_RATE_PROD', 0.1),
};

// External URLs
export const externalUrls = {
  githubBase: getenv('HIVE_MIND_GITHUB_BASE_URL', 'https://github.com'),
  bunInstall: getenv('HIVE_MIND_BUN_INSTALL_URL', 'https://bun.sh/'),
};

// Model configurations
// Default available models in Links Notation format (only aliases)
const defaultAvailableModels = `(
  opus
  sonnet
  haiku
  opusplan
)`;

export const modelConfig = {
  availableModels: (() => {
    const envValue = getenv('HIVE_MIND_AVAILABLE_MODELS', defaultAvailableModels);
    // Parse Links Notation format
    const parsed = lino.parse(envValue);
    // If parsing returns empty array, fall back to the three aliases
    return parsed.length > 0 ? parsed : ['opus', 'sonnet', 'haiku'];
  })(),
  defaultModel: getenv('HIVE_MIND_DEFAULT_MODEL', 'sonnet'),
  // Allow any model ID - validation is delegated to the tool implementation
  restrictModels: getenv('HIVE_MIND_RESTRICT_MODELS', 'false').toLowerCase() === 'true',
};

// Version configurations
export const version = {
  fallback: getenv('HIVE_MIND_VERSION_FALLBACK', '0.14.3'),
  default: getenv('HIVE_MIND_VERSION_DEFAULT', '0.14.3'),
};

// Merge queue configurations
// See: https://github.com/link-assistant/hive-mind/issues/1143
// See: https://github.com/link-assistant/hive-mind/issues/1269
// See: https://github.com/link-assistant/hive-mind/issues/1307
export const mergeQueue = {
  // Maximum PRs to process in one merge session
  // Default: 10 PRs per session
  maxPrsPerSession: parseIntWithDefault('HIVE_MIND_MERGE_QUEUE_MAX_PRS', 10),
  // CI/CD polling interval in milliseconds
  // Default: 5 minutes (300000ms) - checks CI status every 5 minutes
  ciPollIntervalMs: parseIntWithDefault('HIVE_MIND_MERGE_QUEUE_CI_POLL_INTERVAL_MS', 5 * 60 * 1000),
  // CI/CD timeout in milliseconds
  // Default: 7 hours (25200000ms) - maximum wait time for CI to complete
  ciTimeoutMs: parseIntWithDefault('HIVE_MIND_MERGE_QUEUE_CI_TIMEOUT_MS', 7 * 60 * 60 * 1000),
  // Wait time after merge before processing next PR
  // Default: 1 minute (60000ms) - allows CI to stabilize
  postMergeWaitMs: parseIntWithDefault('HIVE_MIND_MERGE_QUEUE_POST_MERGE_WAIT_MS', 60 * 1000),
  // Default merge method: 'merge', 'squash', or 'rebase'
  // Issue #1269: gh pr merge requires explicit method when running non-interactively
  // Default: 'merge' - creates a merge commit
  mergeMethod: getenv('HIVE_MIND_MERGE_QUEUE_MERGE_METHOD', 'merge'),
  // Issue #1307: Wait for main branch CI to complete before processing merge queue
  // When enabled, the merge queue will wait for any active CI runs on the target branch
  // (usually main) to complete before merging the first PR.
  // Default: true - ensures all post-merge CI workflows complete before next merge
  waitForTargetBranchCI: getenv('HIVE_MIND_MERGE_QUEUE_WAIT_FOR_TARGET_CI', 'true').toLowerCase() === 'true',
  // Issue #1307: Timeout for waiting on target branch CI (in milliseconds)
  // If active runs don't complete within this time, proceed with merge anyway
  // Default: 45 minutes (2700000ms)
  targetBranchCITimeoutMs: parseIntWithDefault('HIVE_MIND_MERGE_QUEUE_TARGET_CI_TIMEOUT_MS', 45 * 60 * 1000),
  // Issue #1307: Polling interval for checking target branch CI status (in milliseconds)
  // Default: 30 seconds (30000ms) - more frequent than PR CI polling since we're blocking
  targetBranchCIPollIntervalMs: parseIntWithDefault('HIVE_MIND_MERGE_QUEUE_TARGET_CI_POLL_INTERVAL_MS', 30 * 1000),
  // Issue #1341: Wait for post-merge CI to complete before merging next PR
  // When enabled, the merge queue will wait for all CI runs triggered by a merge
  // to complete before processing the next PR. This ensures each merge gets its own
  // release/publish cycle.
  // Default: true - ensures post-merge CI (including release workflows) completes
  waitForPostMergeCI: getenv('HIVE_MIND_MERGE_QUEUE_WAIT_FOR_POST_MERGE_CI', 'true').toLowerCase() === 'true',
  // Issue #1341: Stop the queue if post-merge CI fails
  // When enabled, the merge queue will stop processing if any post-merge CI run fails
  // This prevents cascading failures and allows humans to investigate
  // Default: true - stop on failure to prevent problems from multiplying
  stopOnPostMergeCIFailure: getenv('HIVE_MIND_MERGE_QUEUE_STOP_ON_CI_FAILURE', 'true').toLowerCase() === 'true',
  // Issue #1341: Check for existing CI failures before starting the queue
  // When enabled, the merge queue will check if there are any failed CI runs on
  // the default branch before starting to process PRs. If failures exist, it will
  // report them and stop.
  // Default: true - ensure a healthy branch before merging
  checkBranchCIHealthBeforeStart: getenv('HIVE_MIND_MERGE_QUEUE_CHECK_BRANCH_HEALTH', 'true').toLowerCase() === 'true',
  // Issue #1341: Timeout for waiting on post-merge CI (in milliseconds)
  // This is per-merge, not total. If a single merge's CI doesn't complete within
  // this time, the queue will fail with a timeout error.
  // Default: 60 minutes (3600000ms) - typical CI/CD pipelines take 15-45 minutes
  postMergeCITimeoutMs: parseIntWithDefault('HIVE_MIND_MERGE_QUEUE_POST_MERGE_CI_TIMEOUT_MS', 60 * 60 * 1000),
  // Issue #1341: Polling interval for post-merge CI status (in milliseconds)
  // Default: 30 seconds (30000ms) - balance between responsiveness and API rate limits
  postMergeCIPollIntervalMs: parseIntWithDefault('HIVE_MIND_MERGE_QUEUE_POST_MERGE_CI_POLL_INTERVAL_MS', 30 * 1000),
  // Issue #1807: Timeout (ms) the sequential auto-resolve pass will wait for
  // a single `/solve <pr> --auto-merge` session to land its PR. Conflict-
  // resolution sessions can be long-running because Claude has to recompute
  // merges and re-run CI; default is 4 hours.
  autoResolveWaitTimeoutMs: parseIntWithDefault('HIVE_MIND_MERGE_QUEUE_AUTO_RESOLVE_WAIT_TIMEOUT_MS', 4 * 60 * 60 * 1000),
  // Issue #1807: Polling interval (ms) for `gh pr view` lifecycle checks
  // during the auto-resolve wait. 60 seconds balances responsiveness with
  // GitHub API rate limits over the timeout window above.
  autoResolvePollIntervalMs: parseIntWithDefault('HIVE_MIND_MERGE_QUEUE_AUTO_RESOLVE_POLL_INTERVAL_MS', 60 * 1000),
};

// Helper function to validate configuration values
export function validateConfig() {
  // Ensure all numeric values are valid
  const numericConfigs = [...Object.values(timeouts), ...Object.values(githubLimits), ...Object.values(systemLimits), ...Object.values(retryLimits).filter(v => typeof v === 'number'), ...Object.values(textProcessing), display.labelWidth, autoContinue.ageThresholdHours];

  for (const value of numericConfigs) {
    if (isNaN(value) || value < 0) {
      throw new Error(`Invalid numeric configuration value: ${value}`);
    }
  }

  // Ensure sample rates are between 0 and 1
  const sampleRates = [sentry.tracesSampleRateDev, sentry.tracesSampleRateProd, sentry.profileSessionSampleRateDev, sentry.profileSessionSampleRateProd];

  for (const rate of sampleRates) {
    if (isNaN(rate) || rate < 0 || rate > 1) {
      throw new Error(`Invalid sample rate configuration: ${rate}. Must be between 0 and 1.`);
    }
  }

  // Ensure required paths exist
  if (!filePaths.tempDir) {
    throw new Error('tempDir configuration is required');
  }

  return true;
}

// Export a function to get all configurations as an object (useful for debugging)
export function getAllConfigurations() {
  return {
    timeouts,
    autoContinue,
    githubLimits,
    systemLimits,
    retryLimits,
    claudeCode,
    cacheTtl,
    filePaths,
    textProcessing,
    display,
    sentry,
    externalUrls,
    modelConfig,
    version,
    mergeQueue,
  };
}

// Export a function to print current configuration (useful for debugging)
export function printConfiguration() {
  console.log('Current Configuration:');
  console.log(JSON.stringify(getAllConfigurations(), null, 2));
}
