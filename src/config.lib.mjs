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
};

// Auto-continue configurations
export const autoContinue = {
  ageThresholdHours: parseIntWithDefault('HIVE_MIND_AUTO_CONTINUE_AGE_HOURS', 24),
};

// Auto-resume on limit reset configurations
// See: https://github.com/link-assistant/hive-mind/issues/1152
export const limitReset = {
  // Buffer time to wait after limit reset (in milliseconds)
  // Default: 5 minutes - accounts for server time differences
  bufferMs: parseIntWithDefault('HIVE_MIND_LIMIT_RESET_BUFFER_MS', 5 * 60 * 1000),
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
export const retryLimits = {
  maxForkRetries: parseIntWithDefault('HIVE_MIND_MAX_FORK_RETRIES', 5),
  maxVerifyRetries: parseIntWithDefault('HIVE_MIND_MAX_VERIFY_RETRIES', 5),
  maxApiRetries: parseIntWithDefault('HIVE_MIND_MAX_API_RETRIES', 3),
  retryBackoffMultiplier: parseFloatWithDefault('HIVE_MIND_RETRY_BACKOFF_MULTIPLIER', 2),
  max503Retries: parseIntWithDefault('HIVE_MIND_MAX_503_RETRIES', 3),
  initial503RetryDelayMs: parseIntWithDefault('HIVE_MIND_INITIAL_503_RETRY_DELAY_MS', 5 * 60 * 1000), // 5 minutes
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

// Default max thinking budget for Opus 4.6 (Issue #1221)
// Opus 4.6 supports higher thinking budgets due to 128K max output tokens
// Can be overridden via --max-thinking-budget option or HIVE_MIND_MAX_THINKING_BUDGET_OPUS_46
export const DEFAULT_MAX_THINKING_BUDGET_OPUS_46 = parseIntWithDefault('HIVE_MIND_MAX_THINKING_BUDGET_OPUS_46', 64000);

/**
 * Check if a model is Opus 4.6 or later (Issue #1221)
 * @param {string} model - The model name or ID
 * @returns {boolean} True if the model is Opus 4.6 or later
 */
export const isOpus46OrLater = model => {
  if (!model) return false;
  const normalizedModel = model.toLowerCase();
  // Check for opus alias (which maps to 4.6) or explicit opus-4-6
  return normalizedModel === 'opus' || normalizedModel.includes('opus-4-6') || normalizedModel.includes('opus-4-7') || normalizedModel.includes('opus-5');
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
  // Set MAX_THINKING_TOKENS if thinkingBudget is provided
  // This controls Claude Code's extended thinking feature (Claude Code >= 2.1.12)
  // Default is 31999 (or 64000 for Opus 4.6), set to 0 to disable thinking
  if (options.thinkingBudget !== undefined) {
    env.MAX_THINKING_TOKENS = String(options.thinkingBudget);
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

// Merge queue configurations
// See: https://github.com/link-assistant/hive-mind/issues/1143
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
