#!/usr/bin/env node
/**
 * Token sanitization utilities for log content
 * Uses secretlint for reliable detection with custom patterns for additional coverage
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
    return true;
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

/**
 * Additional token patterns not fully covered by secretlint
 * These supplement secretlint's detection for edge cases
 *
 * Note: secretlint has stricter patterns to avoid false positives.
 * These patterns provide broader coverage for tokens that may not
 * match secretlint's exact formats but are still sensitive.
 */
const ADDITIONAL_TOKEN_PATTERNS = [
  // OpenAI API tokens - contain T3BlbkFJ (base64 of "OpenAI")
  // Secretlint is stricter (requires specific lengths), we catch broader variants
  // Variants: sk-proj-, sk-svcacct-, sk-admin-, or just sk-
  /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]*T3BlbkFJ[A-Za-z0-9_-]+/g,

  // Anthropic (Claude) API tokens - start with sk-ant-
  // Secretlint requires ending with AA and 90-128 chars, we catch broader variants
  /\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,}/g,

  // GitHub fine-grained PAT tokens (secretlint preset may not cover all variations)
  /\bgithub_pat_[a-zA-Z0-9_]{20,}/g,

  // GitHub server-to-server tokens
  /\bghs_[a-zA-Z0-9_]{20,}/g,

  // GitHub refresh tokens
  /\bghr_[a-zA-Z0-9_]{20,}/g,

  // AWS Access Key IDs (all types - AKIA, ASIA, AGPA, AROA, AIPA, ANPA, ANVA)
  /\b(?:A3T[A-Z0-9]|AKIA|AGPA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g,

  // Stripe API keys (live and test, secret and publishable)
  /\b(?:sk_live_|sk_test_|pk_live_|pk_test_)[a-zA-Z0-9]{20,}/g,

  // SendGrid API keys (SG.{base64}.{base64} format)
  /\bSG\.[a-zA-Z0-9_-]{15,}\.[a-zA-Z0-9_-]{30,}/g,

  // Twilio API keys (SK followed by 32 hex chars)
  /\bSK[a-f0-9]{32}\b/g,

  // Mailchimp API keys (32 hex chars followed by -usNN)
  /\b[a-f0-9]{32}-us[0-9]{1,2}\b/g,

  // Square tokens
  /\bsq0(?:atp|csp)-[a-zA-Z0-9_-]{22,}/g,

  // Databricks tokens
  /\bdapi[a-f0-9]{32}\b/g,

  // PyPI tokens (variable length, typically 50+ chars)
  /\bpypi-[A-Za-z0-9_-]{50,}/g,

  // Discord bot tokens (base64 encoded, typically 59-72 chars)
  /\b[MN][A-Za-z0-9_-]{23,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{20,}/g,

  // Telegram bot tokens (bot ID:token format, token is 35 chars)
  /\b[0-9]{8,10}:[a-zA-Z0-9_-]{30,}/g,

  // Google API / Gemini tokens - start with AIza followed by 35+ chars
  /\bAIza[0-9A-Za-z_-]{32,40}\b/g,

  // HuggingFace API tokens - start with hf_ followed by alphanumeric
  /\bhf_[a-zA-Z0-9]{30,}/g,
];

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
 * @returns {Promise<Array<{start: number, end: number, token: string}>>} Array of detected secrets
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
        secrets.push({ start, end, token });
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
 * Sanitize log content by masking sensitive tokens while avoiding false positives
 * Uses secretlint as primary detection with custom patterns for additional coverage
 *
 * @param {string} logContent - The log content to sanitize
 * @returns {Promise<string>} Sanitized log content with tokens masked
 */
export const sanitizeLogContent = async logContent => {
  let sanitized = logContent;
  let secretsDetected = 0;

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
        secretsDetected++;
      }
    }

    // Step 2: Use secretlint for comprehensive detection
    const secretlintSecrets = await detectSecretsWithSecretlint(sanitized);

    // Apply secretlint detections (from end to start to preserve positions)
    const sortedSecrets = [...secretlintSecrets].sort((a, b) => b.start - a.start);
    for (const secret of sortedSecrets) {
      const { start, end, token } = secret;
      // Verify the token is still in the content at the expected position
      const currentToken = sanitized.substring(start, end);
      if (currentToken === token) {
        const masked = maskToken(token);
        sanitized = sanitized.substring(0, start) + masked + sanitized.substring(end);
        secretsDetected++;
      }
    }

    // Step 3: Apply additional custom patterns for tokens not covered by secretlint
    // Reset pattern lastIndex to ensure fresh matching
    for (const pattern of ADDITIONAL_TOKEN_PATTERNS) {
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, match => {
        // Skip if already masked (contains consecutive asterisks)
        if (/\*{3,}/.test(match)) {
          return match;
        }
        secretsDetected++;
        return maskToken(match);
      });
    }

    // Step 4: Handle GitHub tokens with known prefixes (always mask these)
    // prettier-ignore
    const githubPatterns = [/\bghp_[a-zA-Z0-9_]{20,}/g, /\bgho_[a-zA-Z0-9_]{20,}/g, /\bghu_[a-zA-Z0-9_]{20,}/g, /\bgithub_pat_[a-zA-Z0-9_]{20,}/g, /\bghs_[a-zA-Z0-9_]{20,}/g, /\bghr_[a-zA-Z0-9_]{20,}/g];

    for (const pattern of githubPatterns) {
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, match => {
        if (/\*{3,}/.test(match)) {
          return match;
        }
        secretsDetected++;
        return maskToken(match);
      });
    }

    // Step 5: Handle 40-char hex tokens specially - only mask if NOT in safe context
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
        secretsDetected++;
      }
    }

    // Second pass: apply replacements
    for (const { token, masked } of hexReplacements) {
      sanitized = sanitized.split(token).join(masked);
    }

    if (global.verboseMode && secretsDetected > 0) {
      await log(`  🔒 Sanitized ${secretsDetected} secrets in log content (secretlint + custom patterns)`, {
        verbose: true,
      });
    }
  } catch (error) {
    reportError(error, {
      context: 'sanitize_log_content',
      level: 'warning',
    });
    await log(`  ⚠️  Warning: Could not fully sanitize log content: ${error.message}`, { verbose: true });
  }

  return sanitized;
};

// Default export for convenience
export default {
  isSafeToken,
  isHexInSafeContext,
  getGitHubTokensFromFiles,
  getGitHubTokensFromCommand,
  sanitizeLogContent,
};
