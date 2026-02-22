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

const getenv = await use('getenv');

// Use semver package for version comparison (see issue #1146)
import semver from 'semver';

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
  codexCli: parseIntWithDefault('HIVE_MIND_CODEX_TIMEOUT_SECONDS', 60) * 1000,
  githubApiDelay: parseIntWithDefault('HIVE_MIND_GITHUB_API_DELAY_MS', 5000),
  githubRepoDelay: parseIntWithDefault('HIVE_MIND_GITHUB_REPO_DELAY_MS', 2000),
  retryBaseDelay: parseIntWithDefault('HIVE_MIND_RETRY_BASE_DELAY_MS', 5000),
  retryBackoffDelay: parseIntWithDefault('HIVE_MIND_RETRY_BACKOFF_DELAY_MS', 1000),
  // Issue #1280: Timeout (ms) to wait for stream close after result event before force-killing
  // command-stream's stream() waits for process exit + pipe close; if stdout stays open, it hangs
  resultStreamCloseMs: parseIntWithDefault('HIVE_MIND_RESULT_STREAM_CLOSE_MS', 30000),
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
// 10 max retries, 1 minute initial delay, 30 minute max delay (exponential backoff), session preserved
export const retryLimits = {
  maxForkRetries: parseIntWithDefault('HIVE_MIND_MAX_FORK_RETRIES', 5),
  maxVerifyRetries: parseIntWithDefault('HIVE_MIND_MAX_VERIFY_RETRIES', 5),
  maxApiRetries: parseIntWithDefault('HIVE_MIND_MAX_API_RETRIES', 3),
  retryBackoffMultiplier: parseFloatWithDefault('HIVE_MIND_RETRY_BACKOFF_MULTIPLIER', 2),
  // Unified retry config for all transient API errors (Overloaded, 503, Internal Server Error)
  maxTransientErrorRetries: parseIntWithDefault('HIVE_MIND_MAX_TRANSIENT_ERROR_RETRIES', 10),
  initialTransientErrorDelayMs: parseIntWithDefault('HIVE_MIND_INITIAL_TRANSIENT_ERROR_DELAY_MS', 60 * 1000), // 1 minute
  maxTransientErrorDelayMs: parseIntWithDefault('HIVE_MIND_MAX_TRANSIENT_ERROR_DELAY_MS', 30 * 60 * 1000), // 30 minutes
};

// Claude Code CLI configurations
// See: https://github.com/link-assistant/hive-mind/issues/1076
// Claude models support different max output tokens:
// - Opus 4.6: 128K tokens (Issue #1221)
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
 * Check if a model is Opus 4.6 or later (Issue #1221, updated in Issue #1238)
 * @param {string} model - The model name or ID
 * @returns {boolean} True if the model is Opus 4.6 or later
 */
export const isOpus46OrLater = model => {
  if (!model) return false;
  const normalizedModel = model.toLowerCase();
  // Check for explicit opus-4-6 or later versions
  // Note: The 'opus' alias now maps to Opus 4.5 (Issue #1238), so we only check explicit version identifiers
  return normalizedModel.includes('opus-4-6') || normalizedModel.includes('opus-4-7') || normalizedModel.includes('opus-5');
};

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
 * Valid effort levels for Opus 4.6 (Issue #1238)
 * Opus 4.6 uses CLAUDE_CODE_EFFORT_LEVEL for thinking depth control
 * @type {string[]}
 */
export const OPUS_46_EFFORT_LEVELS = ['low', 'medium', 'high'];

/**
 * Convert thinking level to Opus 4.6 effort level (Issue #1238)
 * Opus 4.6 uses CLAUDE_CODE_EFFORT_LEVEL (low/medium/high) instead of MAX_THINKING_TOKENS
 * @param {string|undefined} thinkLevel - The thinking level (off/low/medium/high/max)
 * @returns {string|undefined} The effort level (low/medium/high) or undefined if thinking is off
 */
export const thinkLevelToEffortLevel = thinkLevel => {
  if (!thinkLevel || thinkLevel === 'off') {
    // No effort level when thinking is disabled
    return undefined;
  }

  // Map hive-mind thinking levels to Opus 4.6 effort levels
  // Note: Opus 4.6 only supports low/medium/high, not 'max'
  // We map 'max' to 'high' as it's the highest available level
  switch (thinkLevel) {
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
    case 'max':
      return 'high';
    default:
      return undefined;
  }
};

/**
 * Convert thinking budget (tokens) to Opus 4.6 effort level (Issue #1238)
 * Uses token thresholds to determine the appropriate effort level
 * @param {number|undefined} thinkingBudget - The thinking budget in tokens
 * @param {number} maxBudget - Maximum thinking budget (default: 31999)
 * @returns {string|undefined} The effort level (low/medium/high) or undefined if thinking is off
 */
export const thinkingBudgetToEffortLevel = (thinkingBudget, maxBudget = DEFAULT_MAX_THINKING_BUDGET) => {
  if (thinkingBudget === undefined || thinkingBudget === 0) {
    // No effort level when thinking is disabled
    return undefined;
  }

  // Convert tokens to thinking level, then to effort level
  const thinkLevel = getTokensToThinkingLevel(maxBudget)(thinkingBudget);
  return thinkLevelToEffortLevel(thinkLevel);
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
export const getClaudeEnv = (options = {}) => {
  // Get max output tokens based on model (Issue #1221)
  const maxOutputTokens = options.model ? getMaxOutputTokensForModel(options.model) : claudeCode.maxOutputTokens;

  const env = {
    ...process.env,
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(maxOutputTokens),
    // MCP timeout configurations to prevent tool calls from hanging indefinitely
    // See: https://github.com/link-assistant/hive-mind/issues/1066
    // MCP_TIMEOUT: Timeout for MCP server startup
    // MCP_TOOL_TIMEOUT: Timeout for MCP tool execution (the one that prevents stuck tools)
    MCP_TIMEOUT: String(claudeCode.mcpTimeout),
    MCP_TOOL_TIMEOUT: String(claudeCode.mcpToolTimeout),
  };

  // Set MAX_THINKING_TOKENS to control Claude Code's extended thinking feature (Claude Code >= 2.1.12)
  // Default is 0 (thinking disabled) per Issue #1238. Set to 0 to disable thinking.
  // Users can explicitly enable thinking via --think or --thinking-budget options.
  env.MAX_THINKING_TOKENS = String(options.thinkingBudget ?? 0);

  // For Opus 4.6+, also set CLAUDE_CODE_EFFORT_LEVEL to control thinking depth (Issue #1238)
  // Opus 4.6 uses effort level (low/medium/high) instead of MAX_THINKING_TOKENS for thinking depth.
  // MAX_THINKING_TOKENS is only used to disable thinking (when set to 0).
  if (options.model && isOpus46OrLater(options.model)) {
    // Convert thinkLevel or thinkingBudget to effort level
    let effortLevel;
    if (options.thinkLevel) {
      effortLevel = thinkLevelToEffortLevel(options.thinkLevel);
    } else if (options.thinkingBudget !== undefined && options.thinkingBudget > 0) {
      effortLevel = thinkingBudgetToEffortLevel(options.thinkingBudget, options.maxBudget);
    }

    if (effortLevel) {
      env.CLAUDE_CODE_EFFORT_LEVEL = effortLevel;
    }
  }

  return env;
};

// Cache TTL configurations (in milliseconds)
// The Usage API (Claude limits) has stricter rate limiting than regular APIs
// See: https://github.com/link-assistant/hive-mind/issues/1074
export const cacheTtl = {
  // General API cache TTL (GitHub API, etc.)
  api: parseIntWithDefault('HIVE_MIND_API_CACHE_TTL_MS', 3 * 60 * 1000), // 3 minutes
  // Claude Usage API cache TTL - must be at least 20 minutes to avoid rate limiting
  // The API returns null values when called too frequently
  usageApi: parseIntWithDefault('HIVE_MIND_USAGE_API_CACHE_TTL_MS', 10 * 60 * 1000), // 10 minutes
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

// (no additional auto-restart config entries needed for issue #1335 — see solve.auto-merge.lib.mjs)

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
