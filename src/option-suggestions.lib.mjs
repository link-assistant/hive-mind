// Option suggestion utility for providing helpful error messages
// when users mistype command-line option names

/**
 * Calculate Levenshtein distance between two strings
 * Measures the minimum number of single-character edits (insertions, deletions, or substitutions)
 * required to change one string into the other.
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Levenshtein distance
 */
export function calculateLevenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];

  // Initialize first column of matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first row of matrix
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

const normalizeOptionName = option =>
  String(option || '')
    .trim()
    .replace(/^-+/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();

const compactOptionName = option => normalizeOptionName(option).replace(/-/g, '');

function getAvailableOptionNames(yargsInstance, includeShortAliases) {
  const availableOptions = yargsInstance.getOptions();
  const allOptions = new Set();
  const rawHiddenOptions = availableOptions.hiddenOptions || [];
  const hiddenOptionNames = Array.isArray(rawHiddenOptions) ? rawHiddenOptions : Object.keys(rawHiddenOptions);
  const hiddenOptions = new Set(hiddenOptionNames.map(normalizeOptionName));

  const addOption = option => {
    const normalized = normalizeOptionName(option);
    if (!normalized || hiddenOptions.has(normalized)) return;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) return;
    if (!includeShortAliases && normalized.length === 1) return;
    allOptions.add(normalized);
  };

  if (availableOptions.key) {
    const keys = Array.isArray(availableOptions.key) ? availableOptions.key : Object.keys(availableOptions.key || {});
    keys.forEach(addOption);
  }

  if (availableOptions.alias) {
    Object.entries(availableOptions.alias).forEach(([key, aliases]) => {
      addOption(key);
      if (Array.isArray(aliases)) {
        aliases.forEach(addOption);
      } else if (aliases) {
        addOption(aliases);
      }
    });
  }

  return allOptions;
}

/**
 * Find similar option names based on Levenshtein distance
 *
 * @param {string} unknownOption - The option name that was not recognized (e.g., "branch")
 * @param {Object} yargsInstance - The yargs instance with defined options
 * @param {number} maxSuggestions - Maximum number of suggestions to return (default: 5)
 * @param {number} distanceThreshold - Maximum distance to consider for suggestions (default: 5)
 * @returns {string[]} - Array of suggested option names, sorted by similarity
 */
export function findSimilarOptions(unknownOption, yargsInstance, maxSuggestions = 5, distanceThreshold = 5) {
  const cleanUnknown = normalizeOptionName(unknownOption);
  const compactUnknown = compactOptionName(unknownOption);
  const includeShortAliases = cleanUnknown.length === 1;
  const allOptions = getAvailableOptionNames(yargsInstance, includeShortAliases);

  const distances = [];
  allOptions.forEach(option => {
    const distance = Math.min(calculateLevenshteinDistance(cleanUnknown, option), calculateLevenshteinDistance(compactUnknown, compactOptionName(option)));
    const unknownInOption = option.includes(cleanUnknown) || compactOptionName(option).includes(compactUnknown);
    const optionInUnknown = cleanUnknown.includes(option) || compactUnknown.includes(compactOptionName(option));

    if (distance <= distanceThreshold || unknownInOption || optionInUnknown) {
      const substringBonus = unknownInOption ? -10 : optionInUnknown ? -5 : 0;
      const lengthDiff = Math.abs(option.length - cleanUnknown.length);
      const lengthBonus = lengthDiff < 3 ? -1 : 0;

      distances.push({
        option,
        distance,
        lengthDiff,
        effectiveDistance: distance + substringBonus + lengthBonus,
      });
    }
  });

  return distances
    .sort((a, b) => {
      if (a.effectiveDistance !== b.effectiveDistance) {
        return a.effectiveDistance - b.effectiveDistance;
      }
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      if (a.lengthDiff !== b.lengthDiff) {
        return a.lengthDiff - b.lengthDiff;
      }
      return a.option.localeCompare(b.option);
    })
    .slice(0, maxSuggestions)
    .map(item => item.option);
}

/**
 * Format suggestions into a user-friendly error message
 *
 * @param {string[]} suggestions - Array of suggested option names
 * @returns {string} - Formatted suggestion message
 */
export function formatSuggestions(suggestions) {
  if (suggestions.length === 0) {
    return '';
  }

  const formattedOptions = suggestions.map(opt => {
    // If it's a single character, show as -x, otherwise --option-name
    return opt.length === 1 ? `-${opt}` : `--${opt}`;
  });
  const [primarySuggestion, ...alternatives] = formattedOptions;

  if (alternatives.length === 0) {
    return `\n\nDid you mean \`${primarySuggestion}\` option?`;
  }

  return `\n\nDid you mean \`${primarySuggestion}\` option?\n\nOther close matches:\n${alternatives.map(opt => `  • \`${opt}\``).join('\n')}`;
}

/**
 * Known valid option names that we use for detecting "-- optionname" typos.
 * These are common options that users might accidentally type with a space after --.
 */
const KNOWN_OPTION_NAMES = [
  'model',
  'verbose',
  'help',
  'version',
  'resume',
  'fork',
  'dry-run',
  'tool',
  'think',
  'thinking-budget',
  'thinking-budget-claude-minimum-version',
  'max-thinking-budget',
  'watch',
  'sentry',
  'attach-logs',
  'auto-continue',
  'auto-fork',
  'auto-cleanup',
  'base-branch',
  'log-dir',
  'skip-tool-check',
  'skip-tool-connection-check',
  'auto-resume-on-limit-reset',
  'auto-resume-on-errors',
  'auto-close-pull-request-on-fail',
  'auto-pull-request-creation',
  'auto-commit-uncommitted-changes',
  'auto-restart-on-uncommitted-changes',
  'continue-only-on-feedback',
  'claude-file',
  'gitkeep-file',
  'interactive-mode',
  'prompt-plan-sub-agent',
  'prompt-explore-sub-agent',
  'prompt-general-purpose-sub-agent',
  'prompt-issue-reporting',
  'prompt-architecture-care',
  'prompt-case-studies',
  'development-log',
  'use-handoff',
  'prompt-playwright-mcp',
  'prompt-check-sibling-pull-requests',
  'enable-workspaces',
  'execute-tool-with-bun',
  'tokens-budget-stats',
  'min-disk-space',
  'watch-interval',
  'only-prepare-command',
  'auto-merge-default-branch-to-pull-request-branch',
  'allow-fork-divergence-resolution-using-force-push-with-lease',
  'allow-force-non-fork-repository-deletion',
  'allow-to-push-to-contributors-pull-requests-as-maintainer',
  'prefix-fork-name-with-owner-name',
  'auto-restart-max-iterations',
  'auto-resume-max-iterations',
  'auto-continue-only-on-new-comments',
  'auto-restart-on-limit-reset',
  'auto-restart-on-non-updated-pull-request-description',
  'auto-restart-until-mergeable',
  'auto-merge',
  'auto-gitkeep-file',
  'playwright-mcp-auto-cleanup',
  'auto-gh-configuration-repair',
  'prompt-subagents-via-agent-commander',
  'prompt-experiments-folder',
  'prompt-examples-folder',
  'session-type',
  'working-directory',
  'auto-init-repository',
  'prompt-ensure-all-requirements-are-met',
  'finalize',
  'finalize-model',
  'keep-working-until-all-requirements-are-fully-done',
  'keep-going-until-all-requirements-are-fully-done',
  'keep-working',
  'keep-going',
];

/**
 * Detect malformed flag patterns in command line arguments.
 * These are arguments that look like they were intended to be flags
 * but have incorrect formatting (e.g., "-- model" instead of "--model").
 *
 * Issue #1092: When user types "-- model" (with space), yargs silently ignores it
 * as a positional argument instead of producing an error.
 *
 * @param {string[]} args - Array of command line arguments
 * @returns {{ malformed: string[], errors: string[] }} - Detected malformed arguments and error messages
 */
export function detectMalformedFlags(args) {
  const malformed = [];
  const errors = [];

  // Patterns that suggest user intended to type a flag but made a mistake
  const malformedPatterns = [
    // "-- option" - space between dashes and option name (Issue #1092)
    { regex: /^-- +\w/, description: 'Space after "--"', suggestion: arg => `--${arg.replace(/^-- +/, '')}` },
    // "- -option" - space between dashes
    { regex: /^- +-/, description: 'Space between dashes', suggestion: arg => arg.replace(/^- +/, '') },
    // "-option" for what looks like a long option (more than 1 char after single dash)
    // Only flag this for known-looking patterns to avoid false positives
    {
      regex: /^-[a-z][a-z]+-?[a-z]*$/i,
      description: 'Single dash for long option',
      suggestion: arg => `-${arg}`,
    },
    // "---option" - triple dash or more
    { regex: /^---+\w/, description: 'Too many dashes', suggestion: arg => arg.replace(/^-+/, '--') },
  ];

  for (const arg of args) {
    for (const pattern of malformedPatterns) {
      if (pattern.regex.test(arg)) {
        malformed.push(arg);
        const suggestion = pattern.suggestion(arg);
        errors.push(`Malformed option "${arg}": ${pattern.description}. Did you mean "${suggestion}"?`);
        break; // Don't double-report the same argument
      }
    }
  }

  // Issue #1092: Detect "-- optionname" pattern where the space caused
  // the argument to be split into ['--', 'optionname'] by the tokenizer.
  // Look for standalone '--' followed by a known option name.
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '--') {
      const nextArg = args[i + 1];
      // Check if next argument looks like an option name (not a URL or path)
      // and is a known option name
      if (nextArg && !nextArg.startsWith('-') && !nextArg.includes('/') && !nextArg.includes(':')) {
        const lowerNextArg = nextArg.toLowerCase();
        if (KNOWN_OPTION_NAMES.includes(lowerNextArg)) {
          malformed.push(`-- ${nextArg}`);
          errors.push(`Malformed option "-- ${nextArg}": Space after "--". Did you mean "--${nextArg}"?`);
        }
      }
    }
  }

  return { malformed, errors };
}

/**
 * Create an enhanced error message with suggestions for unknown arguments
 *
 * @param {string} originalError - The original error message from yargs
 * @param {Object} yargsInstance - The yargs instance with defined options
 * @returns {string} - Enhanced error message with suggestions
 */
export function enhanceErrorMessage(originalError, yargsInstance) {
  if (/Did you mean/i.test(originalError)) {
    return originalError;
  }

  // Extract the unknown option name from the error message
  // Typical format: "Unknown argument: branch" or "Unknown arguments: branch, test"
  const unknownMatch = originalError.match(/Unknown arguments?:\s*([^\n]+)/i);

  if (!unknownMatch) {
    return originalError;
  }

  // Get the first unknown argument (if multiple, focus on the first)
  const unknownArgs = unknownMatch[1].split(',').map(arg => arg.trim());
  const firstUnknown = unknownArgs[0];

  // Find similar options
  const suggestions = findSimilarOptions(firstUnknown, yargsInstance);

  // Format the enhanced message
  let enhancedMessage = originalError;

  if (suggestions.length > 0) {
    enhancedMessage += formatSuggestions(suggestions);
  }

  return enhancedMessage;
}

export function enhanceUnknownArgumentError(error, yargsInstance) {
  if (!error || error._enhanced || !yargsInstance || !/Unknown arguments?/i.test(error.message || '')) {
    return error;
  }

  const enhancedMessage = enhanceErrorMessage(error.message, yargsInstance);
  if (enhancedMessage === error.message) {
    return error;
  }

  const enhancedError = new Error(enhancedMessage);
  enhancedError.name = error.name;
  enhancedError.cause = error;
  for (const key of Object.keys(error)) {
    enhancedError[key] = error[key];
  }
  enhancedError._enhanced = true;
  return enhancedError;
}
