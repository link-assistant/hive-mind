#!/usr/bin/env node
/**
 * Token sanitization utilities for log content
 * Dual approach: Uses both secretlint AND custom patterns for comprehensive coverage
 *
 * Architecture:
 * 1. Custom patterns (our logic) - patterns we define and maintain
 * 2. Secretlint patterns - battle-tested community patterns
 *
 * Both approaches run independently, and if only one detects a secret,
 * a warning is logged (especially when secretlint finds something our logic misses).
 * This helps us improve our custom patterns over time.
 *
 * @module token-sanitization
 */

// Import shared utility from lib.mjs
import { maskToken, log } from './lib.mjs';
import { reportError } from './sentry.lib.mjs';

// Dynamic imports for runtime dependencies
const getOsModule = async () => (await import('os')).default;
const getPathModule = async () => (await import('path')).default;
const getFsModule = async () => (await import('fs')).promises;

// Lazy-loaded secretlint modules (initialized on first use)
let secretlintCore = null;
let secretlintConfig = null;

/**
 * Initialize secretlint modules lazily
 * @returns {Promise<boolean>} True if secretlint is available
 */
const initSecretlint = async () => {
  if (secretlintConfig !== null) {
    return secretlintConfig !== false;
  }

  try {
    const [core, preset] = await Promise.all([import('@secretlint/core'), import('@secretlint/secretlint-rule-preset-recommend')]);

    secretlintCore = core;
    secretlintConfig = {
      rules: [
        {
          id: '@secretlint/secretlint-rule-preset-recommend',
          rule: preset.creator,
        },
      ],
    };

    return true;
  } catch (error) {
    // secretlint not available - fall back to custom patterns only
    if (global.verboseMode) {
      await log(`  ⚠️  Secretlint not available, using fallback patterns: ${error.message}`, { verbose: true });
    }
    secretlintConfig = false;
    return false;
  }
};

/**
 * Patterns that indicate a string is NOT a sensitive token (false positive patterns)
 * These are used to prevent masking legitimate identifiers
 */
const SAFE_TOKEN_PATTERNS = [
  // MCP tool names (Playwright, etc.)
  /^mcp__[a-z_]+$/i,
  // Browser/Playwright tool names
  /^browser_[a-z_]+$/i,
  // Common function/tool name patterns with underscores
  /^[a-z]+_[a-z]+_[a-z_]+$/i,
  // UUID patterns (not sensitive)
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
];

/**
 * Context patterns that indicate the surrounding text is NOT a sensitive context
 * These patterns help identify when a 40-char hex string is just a git commit hash
 */
const SAFE_CONTEXT_PATTERNS = [
  // Git commands containing commit hashes
  /\bgh\s+gist\s+view\b/i,
  /\bgit\s+(log|show|diff|cherry-pick|revert|checkout|reset)\b/i,
  /\bgit\s+commit\s+-m\b/i,
  // Commit SHA in common git output contexts
  /\bcommit\s+[a-f0-9]{7,40}\b/i,
  /\bSHA\s*:\s*[a-f0-9]{7,40}\b/i,
  // Git log output format
  /^commit\s+[a-f0-9]{40}/m,
  // Short commit hashes in various contexts
  /\b[a-f0-9]{7,40}\s+Author:/i,
];

// Note: Custom token patterns are now defined in detectSecretsWithCustomPatterns()
// with named patterns for tracking and comparison with secretlint results.

/**
 * Check if a token matches any safe pattern (not a sensitive token)
 * @param {string} token - The token to check
 * @returns {boolean} True if the token is safe and should NOT be masked
 */
export const isSafeToken = token => {
  if (!token) return false;
  return SAFE_TOKEN_PATTERNS.some(pattern => pattern.test(token));
};

/**
 * Check if a 40-char hex string appears in a safe context (like git commands)
 * @param {string} content - The full content to search
 * @param {string} hexString - The 40-char hex string found
 * @param {number} position - The position where the hex string was found
 * @returns {boolean} True if the hex string is in a safe context
 */
export const isHexInSafeContext = (content, hexString, position) => {
  // Get surrounding context (100 chars before and after)
  const contextStart = Math.max(0, position - 100);
  const contextEnd = Math.min(content.length, position + hexString.length + 100);
  const context = content.substring(contextStart, contextEnd);

  // Check if any safe context pattern matches
  return SAFE_CONTEXT_PATTERNS.some(pattern => pattern.test(context));
};

/**
 * Get GitHub tokens from local config files
 * @returns {Promise<string[]>} Array of tokens found
 */
export const getGitHubTokensFromFiles = async () => {
  const os = await getOsModule();
  const path = await getPathModule();
  const fs = await getFsModule();
  const tokens = [];

  try {
    // Check ~/.config/gh/hosts.yml
    const hostsFile = path.join(os.homedir(), '.config/gh/hosts.yml');
    if (
      await fs
        .access(hostsFile)
        .then(() => true)
        .catch(() => false)
    ) {
      const hostsContent = await fs.readFile(hostsFile, 'utf8');

      // Look for oauth_token and api_token patterns
      const oauthMatches = hostsContent.match(/oauth_token:\s*([^\s\n]+)/g);
      if (oauthMatches) {
        for (const match of oauthMatches) {
          const token = match.split(':')[1].trim();
          if (token && !tokens.includes(token)) {
            tokens.push(token);
          }
        }
      }

      const apiMatches = hostsContent.match(/api_token:\s*([^\s\n]+)/g);
      if (apiMatches) {
        for (const match of apiMatches) {
          const token = match.split(':')[1].trim();
          if (token && !tokens.includes(token)) {
            tokens.push(token);
          }
        }
      }
    }
  } catch (error) {
    // File access errors are expected when config doesn't exist
    if (global.verboseMode) {
      reportError(error, {
        context: 'github_token_file_access',
        level: 'debug',
      });
    }
  }

  return tokens;
};

/**
 * Get GitHub tokens from gh command output
 * @returns {Promise<string[]>} Array of tokens found
 */
export const getGitHubTokensFromCommand = async () => {
  if (typeof globalThis.use === 'undefined') {
    globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
  }
  const { $ } = await globalThis.use('command-stream');
  const tokens = [];

  try {
    // Run gh auth status to get token info
    const authResult = await $`gh auth status 2>&1`.catch(() => ({ stdout: '', stderr: '' }));
    const authOutput = authResult.stdout?.toString() + authResult.stderr?.toString() || '';

    // Look for token patterns in the output
    const tokenPatterns = [/(?:token|oauth|api)[:\s]*([a-zA-Z0-9_]{20,})/gi, /gh[pou]_[a-zA-Z0-9_]{20,}/gi];

    for (const pattern of tokenPatterns) {
      const matches = authOutput.match(pattern);
      if (matches) {
        for (let match of matches) {
          // Clean up the match
          const token = match.replace(/^(?:token|oauth|api)[:\s]*/, '').trim();
          if (token && token.length >= 20 && !tokens.includes(token)) {
            tokens.push(token);
          }
        }
      }
    }
  } catch (error) {
    // Command errors are expected when gh is not configured
    if (global.verboseMode) {
      reportError(error, {
        context: 'github_token_gh_auth',
        level: 'debug',
      });
    }
  }

  return tokens;
};

/**
 * Use secretlint to detect secrets in content
 * @param {string} content - Content to scan
 * @returns {Promise<Array<{start: number, end: number, token: string, ruleId: string}>>} Array of detected secrets with rule info
 */
const detectSecretsWithSecretlint = async content => {
  const secrets = [];

  const available = await initSecretlint();
  if (!available || !secretlintCore || !secretlintConfig) {
    return secrets;
  }

  try {
    const result = await secretlintCore.lintSource({
      source: {
        filePath: '/virtual/content.txt',
        content: content,
        contentType: 'text',
      },
      options: {
        config: secretlintConfig,
        maskSecrets: false, // We need raw positions to mask ourselves
      },
    });

    for (const message of result.messages) {
      if (message.range && message.range.length === 2) {
        const [start, end] = message.range;
        const token = content.substring(start, end);
        secrets.push({
          start,
          end,
          token,
          ruleId: message.ruleId || 'unknown',
          source: 'secretlint',
        });
      }
    }
  } catch (error) {
    if (global.verboseMode) {
      await log(`  ⚠️  Secretlint detection error: ${error.message}`, { verbose: true });
    }
  }

  return secrets;
};

/**
 * Use custom patterns to detect secrets in content
 * @param {string} content - Content to scan
 * @returns {Array<{start: number, end: number, token: string, patternName: string}>} Array of detected secrets with pattern info
 */
const detectSecretsWithCustomPatterns = content => {
  const secrets = [];

  // Named custom patterns for tracking what detected what
  const namedPatterns = [
    // OpenAI patterns
    { name: 'openai-project', pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]*T3BlbkFJ[A-Za-z0-9_-]+/g },

    // Anthropic patterns
    { name: 'anthropic-claude', pattern: /\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,}/g },

    // GitHub patterns
    { name: 'github-pat', pattern: /\bgithub_pat_[a-zA-Z0-9_]{20,}/g },
    { name: 'github-server', pattern: /\bghs_[a-zA-Z0-9_]{20,}/g },
    { name: 'github-refresh', pattern: /\bghr_[a-zA-Z0-9_]{20,}/g },
    { name: 'github-ghp', pattern: /\bghp_[a-zA-Z0-9_]{20,}/g },
    { name: 'github-gho', pattern: /\bgho_[a-zA-Z0-9_]{20,}/g },
    { name: 'github-ghu', pattern: /\bghu_[a-zA-Z0-9_]{20,}/g },

    // AWS patterns
    { name: 'aws-key', pattern: /\b(?:A3T[A-Z0-9]|AKIA|AGPA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g },

    // Stripe patterns
    { name: 'stripe', pattern: /\b(?:sk_live_|sk_test_|pk_live_|pk_test_)[a-zA-Z0-9]{20,}/g },

    // SendGrid patterns
    { name: 'sendgrid', pattern: /\bSG\.[a-zA-Z0-9_-]{15,}\.[a-zA-Z0-9_-]{30,}/g },

    // Twilio patterns
    { name: 'twilio', pattern: /\bSK[a-f0-9]{32}\b/g },

    // Mailchimp patterns
    { name: 'mailchimp', pattern: /\b[a-f0-9]{32}-us[0-9]{1,2}\b/g },

    // Square patterns
    { name: 'square', pattern: /\bsq0(?:atp|csp)-[a-zA-Z0-9_-]{22,}/g },

    // Databricks patterns
    { name: 'databricks', pattern: /\bdapi[a-f0-9]{32}\b/g },

    // PyPI patterns
    { name: 'pypi', pattern: /\bpypi-[A-Za-z0-9_-]{50,}/g },

    // Discord patterns
    { name: 'discord', pattern: /\b[MN][A-Za-z0-9_-]{23,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{20,}/g },

    // Telegram patterns
    { name: 'telegram', pattern: /\b[0-9]{8,10}:[a-zA-Z0-9_-]{30,}/g },

    // Google / Gemini patterns
    { name: 'google-gemini', pattern: /\bAIza[0-9A-Za-z_-]{32,40}\b/g },

    // HuggingFace patterns
    { name: 'huggingface', pattern: /\bhf_[a-zA-Z0-9]{30,}/g },

    // Slack patterns (not all covered by secretlint preset)
    { name: 'slack-xoxb', pattern: /\bxoxb-[0-9]{10,}-[0-9]{10,}-[a-zA-Z0-9]{20,}/g },
    { name: 'slack-xoxp', pattern: /\bxoxp-[0-9]{10,}-[0-9]{10,}-[0-9]{10,}-[a-zA-Z0-9]{20,}/g },

    // npm patterns
    { name: 'npm', pattern: /\bnpm_[a-zA-Z0-9]{30,}/g },

    // Shopify patterns
    { name: 'shopify', pattern: /\bshpat_[a-f0-9]{32}\b/g },
  ];

  for (const { name, pattern } of namedPatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const token = match[0];
      // Skip if already masked (contains consecutive asterisks)
      if (/\*{3,}/.test(token)) {
        continue;
      }
      secrets.push({
        start: match.index,
        end: match.index + token.length,
        token,
        patternName: name,
        source: 'custom',
      });
    }
  }

  return secrets;
};

/**
 * Compare detection results from both approaches and log warnings
 * @param {Array} secretlintSecrets - Secrets detected by secretlint
 * @param {Array} customSecrets - Secrets detected by custom patterns
 * @returns {Promise<{secretlintOnly: Array, customOnly: Array, both: Array}>}
 */
const compareDetectionResults = async (secretlintSecrets, customSecrets) => {
  const secretlintOnly = [];
  const customOnly = [];
  const both = [];

  // Create sets for easier comparison (normalize tokens)
  const secretlintTokens = new Map(secretlintSecrets.map(s => [s.token, s]));
  const customTokens = new Map(customSecrets.map(s => [s.token, s]));

  // Find secretlint-only detections (our custom patterns missed these)
  for (const [token, secret] of secretlintTokens) {
    if (!customTokens.has(token)) {
      secretlintOnly.push(secret);
    } else {
      both.push({ ...secret, customPattern: customTokens.get(token).patternName });
    }
  }

  // Find custom-only detections (secretlint missed these)
  for (const [token, secret] of customTokens) {
    if (!secretlintTokens.has(token)) {
      customOnly.push(secret);
    }
  }

  return { secretlintOnly, customOnly, both };
};

/**
 * Sanitize log content by masking sensitive tokens while avoiding false positives
 * Uses DUAL APPROACH: Both secretlint AND custom patterns run independently
 *
 * If only secretlint detects a secret (but our custom patterns miss it),
 * a warning is logged so we can improve our patterns.
 *
 * @param {string} logContent - The log content to sanitize
 * @param {Object} options - Optional configuration
 * @param {boolean} options.warnOnMismatch - Log warnings when detection approaches differ (default: true in verbose mode)
 * @returns {Promise<string>} Sanitized log content with tokens masked
 */
export const sanitizeLogContent = async (logContent, options = {}) => {
  let sanitized = logContent;
  const { warnOnMismatch = global.verboseMode } = options;

  // Statistics for dual approach
  const stats = {
    knownTokens: 0,
    secretlintDetections: 0,
    customDetections: 0,
    secretlintOnlyWarnings: [],
    customOnlyDetections: [],
  };

  try {
    // Step 1: Get known tokens from files and commands
    const fileTokens = await getGitHubTokensFromFiles();
    const commandTokens = await getGitHubTokensFromCommand();
    const allKnownTokens = [...new Set([...fileTokens, ...commandTokens])];

    // Mask known tokens first
    for (const token of allKnownTokens) {
      if (token && token.length >= 12) {
        const maskedToken = maskToken(token);
        sanitized = sanitized.split(token).join(maskedToken);
        stats.knownTokens++;
      }
    }

    // Step 2: DUAL APPROACH - Run both detection methods independently
    const [secretlintSecrets, customSecrets] = await Promise.all([detectSecretsWithSecretlint(sanitized), Promise.resolve(detectSecretsWithCustomPatterns(sanitized))]);

    // Compare results to find discrepancies
    const { secretlintOnly, customOnly } = await compareDetectionResults(secretlintSecrets, customSecrets);

    // Log warnings for secretlint-only detections (our patterns should catch these)
    if (warnOnMismatch && secretlintOnly.length > 0) {
      stats.secretlintOnlyWarnings = secretlintOnly;
      await log(`  ⚠️  PATTERN GAP: Secretlint found ${secretlintOnly.length} secret(s) that our custom patterns missed:`, { verbose: true });
      for (const secret of secretlintOnly) {
        // Show truncated token and rule that detected it
        const truncated = secret.token.length > 20 ? `${secret.token.substring(0, 10)}...${secret.token.substring(secret.token.length - 5)}` : secret.token;
        await log(`      • Rule: ${secret.ruleId}, Token preview: ${truncated}`, { verbose: true });
      }
      await log(`      Consider adding custom patterns for these secret types to improve our detection.`, { verbose: true });
    }

    // Log info about custom-only detections (we catch things secretlint doesn't)
    if (warnOnMismatch && customOnly.length > 0) {
      stats.customOnlyDetections = customOnly;
      await log(`  ℹ️  CUSTOM ADVANTAGE: Our patterns found ${customOnly.length} secret(s) that secretlint missed:`, { verbose: true });
      for (const secret of customOnly) {
        await log(`      • Pattern: ${secret.patternName}`, { verbose: true });
      }
    }

    // Step 3: Merge all unique secrets from both sources for masking
    const allSecrets = new Map();

    // Add secretlint detections
    for (const secret of secretlintSecrets) {
      const key = `${secret.start}-${secret.end}`;
      allSecrets.set(key, secret);
      stats.secretlintDetections++;
    }

    // Add custom detections (won't duplicate if same position)
    for (const secret of customSecrets) {
      const key = `${secret.start}-${secret.end}`;
      if (!allSecrets.has(key)) {
        allSecrets.set(key, secret);
      }
      stats.customDetections++;
    }

    // Apply all detections (from end to start to preserve positions)
    const sortedSecrets = [...allSecrets.values()].sort((a, b) => b.start - a.start);
    for (const secret of sortedSecrets) {
      const { start, end, token } = secret;
      // Verify the token is still in the content at the expected position
      const currentToken = sanitized.substring(start, end);
      if (currentToken === token) {
        const masked = maskToken(token);
        sanitized = sanitized.substring(0, start) + masked + sanitized.substring(end);
      }
    }

    // Step 4: Handle 40-char hex tokens specially - only mask if NOT in safe context
    // These could be GitHub tokens OR git commit hashes/gist IDs
    const hexPattern = /(?:^|[\s:=])([a-f0-9]{40})(?=[\s\n]|$)/gm;
    let hexMatch;
    const hexReplacements = [];

    // First pass: find all matches and determine which to mask
    const tempContent = sanitized;
    hexPattern.lastIndex = 0;
    while ((hexMatch = hexPattern.exec(tempContent)) !== null) {
      const token = hexMatch[1];
      const position = hexMatch.index;

      // Skip if already masked
      if (/\*{3,}/.test(token)) {
        continue;
      }

      // Only mask if NOT in a safe git/gist context
      if (!isHexInSafeContext(tempContent, token, position)) {
        hexReplacements.push({ token, masked: maskToken(token) });
      }
    }

    // Second pass: apply replacements
    for (const { token, masked } of hexReplacements) {
      sanitized = sanitized.split(token).join(masked);
    }

    // Summary logging
    const totalMasked = allSecrets.size + hexReplacements.length + stats.knownTokens;
    if (global.verboseMode && totalMasked > 0) {
      await log(`  🔒 Sanitized ${totalMasked} secrets using dual approach:`, { verbose: true });
      await log(`      • Known tokens: ${stats.knownTokens}`, { verbose: true });
      await log(`      • Secretlint: ${stats.secretlintDetections} detections`, { verbose: true });
      await log(`      • Custom patterns: ${stats.customDetections} detections`, { verbose: true });
      await log(`      • Hex tokens: ${hexReplacements.length}`, { verbose: true });
      if (stats.secretlintOnlyWarnings.length > 0) {
        await log(`      ⚠️  Pattern gaps to address: ${stats.secretlintOnlyWarnings.length}`, { verbose: true });
      }
    }
  } catch (error) {
    // Issue #1212: Detect ENOSPC specifically and log at non-verbose level
    const isNoSpace = error?.code === 'ENOSPC' || error?.message?.includes('ENOSPC') || error?.message?.includes('no space left on device');
    reportError(error, {
      context: 'sanitize_log_content',
      level: isNoSpace ? 'error' : 'warning',
    });
    if (isNoSpace) {
      await log(`  ❌ ENOSPC: No space left on device during log sanitization. Skipping sanitization.`);
      await log(`     Consider freeing disk space (e.g., rm -rf ~/.claude/debug/*.txt) and retrying.`);
    } else {
      await log(`  ⚠️  Warning: Could not fully sanitize log content: ${error.message}`, { verbose: true });
    }
  }

  return sanitized;
};

// Export detection functions for testing and visibility
export { detectSecretsWithSecretlint, detectSecretsWithCustomPatterns, compareDetectionResults };

// Default export for convenience
export default {
  isSafeToken,
  isHexInSafeContext,
  getGitHubTokensFromFiles,
  getGitHubTokensFromCommand,
  sanitizeLogContent,
  detectSecretsWithSecretlint,
  detectSecretsWithCustomPatterns,
  compareDetectionResults,
};
