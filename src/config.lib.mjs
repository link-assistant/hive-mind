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
  minDiskSpaceMb: parseIntWithDefault('HIVE_MIND_MIN_DISK_SPACE_MB', 500),
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
  const numericConfigs = [
    ...Object.values(timeouts),
    ...Object.values(githubLimits),
    ...Object.values(systemLimits),
    ...Object.values(retryLimits).filter(v => typeof v === 'number'),
    ...Object.values(textProcessing),
    display.labelWidth,
    autoContinue.ageThresholdHours,
  ];

  for (const value of numericConfigs) {
    if (isNaN(value) || value < 0) {
      throw new Error(`Invalid numeric configuration value: ${value}`);
    }
  }

  // Ensure sample rates are between 0 and 1
  const sampleRates = [
    sentry.tracesSampleRateDev,
    sentry.tracesSampleRateProd,
    sentry.profileSessionSampleRateDev,
    sentry.profileSessionSampleRateProd,
  ];

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