#!/usr/bin/env node
/**
 * Token sanitization utilities for log content
 * Handles masking of sensitive tokens while avoiding false positives
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
 * Sanitize log content by masking GitHub tokens while avoiding false positives
 * @param {string} logContent - The log content to sanitize
 * @returns {Promise<string>} Sanitized log content with tokens masked
 */
export const sanitizeLogContent = async logContent => {
  let sanitized = logContent;

  try {
    // Get tokens from both sources
    const fileTokens = await getGitHubTokensFromFiles();
    const commandTokens = await getGitHubTokensFromCommand();
    const allTokens = [...new Set([...fileTokens, ...commandTokens])];

    // Mask each token found
    for (const token of allTokens) {
      if (token && token.length >= 12) {
        const maskedToken = maskToken(token);
        // Use global replace to mask all occurrences
        sanitized = sanitized.split(token).join(maskedToken);
      }
    }

    // Also look for and mask common GitHub token patterns directly in the log
    // IMPORTANT: Be careful not to mask legitimate identifiers (Issue #1037)
    const tokenPatterns = [
      // GitHub tokens with known prefixes - these are definitely sensitive
      /gh[pou]_[a-zA-Z0-9_]{20,}/g,
      // GitHub fine-grained PAT tokens
      /github_pat_[a-zA-Z0-9_]{20,}/g,
    ];

    for (const pattern of tokenPatterns) {
      sanitized = sanitized.replace(pattern, match => {
        return maskToken(match);
      });
    }

    // Handle 40-char hex tokens specially - only mask if NOT in safe context
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

      // Only mask if NOT in a safe git/gist context
      if (!isHexInSafeContext(tempContent, token, position)) {
        hexReplacements.push({ token, masked: maskToken(token) });
      }
    }

    // Second pass: apply replacements
    for (const { token, masked } of hexReplacements) {
      sanitized = sanitized.split(token).join(masked);
    }

    // NOTE: Removed the overly broad pattern /[a-zA-Z0-9_]{20,}/ that was causing
    // false positives with legitimate identifiers like 'browser_take_screenshot'
    // (Issue #1037). Now we only mask tokens with known sensitive prefixes.

    await log(`  🔒 Sanitized ${allTokens.length} detected GitHub tokens in log content`, { verbose: true });
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
