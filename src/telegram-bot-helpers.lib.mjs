/**
 * Helper utilities for Telegram bot
 * Extracted from telegram-bot.mjs to keep file size under 1500 lines
 */

/**
 * Parse command arguments from Telegram message text
 * Handles quoted arguments and Telegram's em-dash replacement
 * @param {string} text - The message text (e.g., "/solve https://github.com/owner/repo/issues/1 --fork")
 * @returns {string[]} Array of parsed arguments
 */
export function parseCommandArgs(text) {
  // Use only first line and trim it
  const firstLine = text.split('\n')[0].trim();
  const argsText = firstLine.replace(/^\/\w+\s*/, '');

  if (!argsText.trim()) {
    return [];
  }

  // Replace em-dash (—) with double-dash (--) to fix Telegram auto-replacement
  const normalizedArgsText = argsText.replace(/—/g, '--');

  const args = [];
  let currentArg = '';
  let inQuotes = false;
  let quoteChar = null;

  for (let i = 0; i < normalizedArgsText.length; i++) {
    const char = normalizedArgsText[i];

    if ((char === '"' || char === '\'') && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = null;
    } else if (char === ' ' && !inQuotes) {
      if (currentArg) {
        args.push(currentArg);
        currentArg = '';
      }
    } else {
      currentArg += char;
    }
  }

  if (currentArg) {
    args.push(currentArg);
  }

  return args;
}

/**
 * Merge user-provided arguments with locked override options
 * Override options take precedence and cannot be changed by users
 * @param {string[]} userArgs - Arguments provided by the user
 * @param {string[]} overrides - Locked override options from config
 * @returns {string[]} Merged arguments with overrides taking precedence
 */
export function mergeArgsWithOverrides(userArgs, overrides) {
  if (!overrides || overrides.length === 0) {
    return userArgs;
  }

  // Parse overrides to identify flags and their values
  const overrideFlags = new Map(); // Map of flag -> value (or null for boolean flags)

  for (let i = 0; i < overrides.length; i++) {
    const arg = overrides[i];
    if (arg.startsWith('--')) {
      // Check if next item is a value (doesn't start with --)
      if (i + 1 < overrides.length && !overrides[i + 1].startsWith('--')) {
        overrideFlags.set(arg, overrides[i + 1]);
        i++; // Skip the value in next iteration
      } else {
        overrideFlags.set(arg, null); // Boolean flag
      }
    }
  }

  // Filter user args to remove any that conflict with overrides
  const filteredArgs = [];
  for (let i = 0; i < userArgs.length; i++) {
    const arg = userArgs[i];
    if (arg.startsWith('--')) {
      // If this flag exists in overrides, skip it and its value
      if (overrideFlags.has(arg)) {
        // Skip the flag
        // Also skip next arg if it's a value (doesn't start with --)
        if (i + 1 < userArgs.length && !userArgs[i + 1].startsWith('--')) {
          i++; // Skip the value too
        }
        continue;
      }
    }
    filteredArgs.push(arg);
  }

  // Merge: filtered user args + overrides
  return [...filteredArgs, ...overrides];
}

/**
 * Validate model name in command arguments
 * @param {string[]} args - Command arguments
 * @param {string} tool - Tool name ('claude' or other)
 * @param {Function} validateModelName - Model validation function
 * @returns {string|null} Error message if invalid, null if valid
 */
export function validateModelInArgs(args, tool, validateModelName) {
  // Find --model or -m flag and its value
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' || args[i] === '-m') {
      if (i + 1 < args.length) {
        const modelName = args[i + 1];
        const validation = validateModelName(modelName, tool);
        if (!validation.valid) {
          return validation.message;
        }
      }
    } else if (args[i].startsWith('--model=')) {
      const modelName = args[i].substring('--model='.length);
      const validation = validateModelName(modelName, tool);
      if (!validation.valid) {
        return validation.message;
      }
    }
  }
  return null;
}

/**
 * Validate GitHub URL in command arguments
 * @param {string[]} args - Command arguments
 * @param {Object} options - Validation options
 * @param {Function} parseGitHubUrl - GitHub URL parser function
 * @returns {Object} Validation result with valid flag and error message
 */
export function validateGitHubUrl(args, options, parseGitHubUrl) {
  // Default options for /solve command (backward compatibility)
  const {
    allowedTypes = ['issue', 'pull'],
    commandName = 'solve'
  } = options;

  if (args.length === 0) {
    return {
      valid: false,
      error: `Missing GitHub URL. Usage: /${commandName} <github-url> [options]`
    };
  }

  const url = args[0];
  if (!url.includes('github.com')) {
    return {
      valid: false,
      error: 'First argument must be a GitHub URL'
    };
  }

  // Parse the URL to validate structure
  const parsed = parseGitHubUrl(url);
  if (!parsed.valid) {
    return {
      valid: false,
      error: parsed.error || 'Invalid GitHub URL',
      suggestion: parsed.suggestion
    };
  }

  // Check if the URL type is allowed for this command
  if (!allowedTypes.includes(parsed.type)) {
    const allowedTypesStr = allowedTypes.map(t => t === 'pull' ? 'pull request' : t).join(', ');
    return {
      valid: false,
      error: `URL must be a GitHub ${allowedTypesStr} (not ${parsed.type})`
    };
  }

  return { valid: true };
}

/**
 * Extract GitHub URL from message text
 * @param {string} text - Message text that might contain a GitHub URL
 * @returns {string|null} Extracted GitHub URL or null if not found
 */
export function extractGitHubUrl(text) {
  // Match GitHub URLs in various formats
  const urlRegex = /https?:\/\/github\.com\/[^\s]+/i;
  const match = text.match(urlRegex);

  if (match) {
    // Remove trailing punctuation that's not part of the URL
    return match[0].replace(/[.,;!?)]+$/, '');
  }

  return null;
}
