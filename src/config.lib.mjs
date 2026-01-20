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
// Claude models support up to 64K output tokens, but Claude Code CLI defaults to 32K
// Setting a higher limit allows Claude to generate longer responses without hitting the limit
export const claudeCode = {
  // Maximum output tokens for Claude Code CLI responses
  // Default: 64000 (matches Claude Sonnet/Opus/Haiku 4.5 model capabilities)
  // Set via CLAUDE_CODE_MAX_OUTPUT_TOKENS or HIVE_MIND_CLAUDE_CODE_MAX_OUTPUT_TOKENS
  maxOutputTokens: parseIntWithDefault('CLAUDE_CODE_MAX_OUTPUT_TOKENS', parseIntWithDefault('HIVE_MIND_CLAUDE_CODE_MAX_OUTPUT_TOKENS', 64000)),
};

// Thinking level translation constants (see issue #1146)
// These values are evenly distributed between 0 and 31999 (Claude Code default max)
// off=0, low=~8000, medium=~16000, high=~24000, max=31999
export const thinkingLevelToTokens = {
  off: 0,
  low: 7999, // 31999/4 ≈ 8000
  medium: 15999, // 31999/2 ≈ 16000
  high: 23999, // 31999*3/4 ≈ 24000
  max: 31999, // Claude Code default max
};

// Reverse mapping: tokens to thinking level (for back translation)
// Uses midpoint ranges to determine the level
export const tokensToThinkingLevel = tokens => {
  if (tokens === 0) return 'off';
  if (tokens <= 11999) return 'low'; // 0-11999 -> low (midpoint between low and medium)
  if (tokens <= 19999) return 'medium'; // 12000-19999 -> medium (midpoint between medium and high)
  if (tokens <= 27999) return 'high'; // 20000-27999 -> high (midpoint between high and max)
  return 'max'; // 28000+ -> max
};

// Compare semver versions (returns -1 if a < b, 0 if a == b, 1 if a > b)
export const compareSemver = (a, b) => {
  const parseVersion = v => {
    const match = v.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return [0, 0, 0];
    return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
  };

  const [aMajor, aMinor, aPatch] = parseVersion(a);
  const [bMajor, bMinor, bPatch] = parseVersion(b);

  if (aMajor !== bMajor) return aMajor < bMajor ? -1 : 1;
  if (aMinor !== bMinor) return aMinor < bMinor ? -1 : 1;
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
  return 0;
};

// Check if a version supports thinking budget (>= minimum version)
export const supportsThinkingBudget = (version, minVersion = '2.1.12') => {
  return compareSemver(version, minVersion) >= 0;
};

// Helper function to get Claude CLI environment with CLAUDE_CODE_MAX_OUTPUT_TOKENS set
// Optionally sets MAX_THINKING_TOKENS when thinkingBudget is provided (see issue #1146)
export const getClaudeEnv = (options = {}) => {
  const env = { ...process.env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(claudeCode.maxOutputTokens) };
  // Set MAX_THINKING_TOKENS if thinkingBudget is provided
  // This controls Claude Code's extended thinking feature (Claude Code >= 2.1.12)
  // Default is 31999, set to 0 to disable thinking, max is 63999 for 64K output models
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
  usageApi: parseIntWithDefault('HIVE_MIND_USAGE_API_CACHE_TTL_MS', 20 * 60 * 1000), // 20 minutes
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
  };
}

// Export a function to print current configuration (useful for debugging)
export function printConfiguration() {
  console.log('Current Configuration:');
  console.log(JSON.stringify(getAllConfigurations(), null, 2));
}
