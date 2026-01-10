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

/**
 * Find similar option names based on Levenshtein distance
 *
 * @param {string} unknownOption - The option name that was not recognized (e.g., "branch")
 * @param {Object} yargsInstance - The yargs instance with defined options
 * @param {number} maxSuggestions - Maximum number of suggestions to return (default: 3)
 * @param {number} distanceThreshold - Maximum distance to consider for suggestions (default: 5)
 * @returns {string[]} - Array of suggested option names, sorted by similarity
 */
export function findSimilarOptions(unknownOption, yargsInstance, maxSuggestions = 3, distanceThreshold = 5) {
  // Remove leading dashes from the unknown option
  const cleanUnknown = unknownOption.replace(/^-+/, '');

  // Get all available options from yargs
  const availableOptions = yargsInstance.getOptions();
  const allOptions = new Set();

  // Collect all option names (both long form and aliases)
  if (availableOptions.key) {
    // Ensure it's an array before iterating
    const keys = Array.isArray(availableOptions.key) ? availableOptions.key : Object.keys(availableOptions.key || {});
    keys.forEach(opt => {
      allOptions.add(opt);
    });
  }

  // Collect aliases
  if (availableOptions.alias) {
    Object.entries(availableOptions.alias).forEach(([key, aliases]) => {
      allOptions.add(key);
      if (Array.isArray(aliases)) {
        aliases.forEach(alias => allOptions.add(alias));
      } else if (aliases) {
        // If it's not an array but exists, add it as a single alias
        allOptions.add(String(aliases));
      }
    });
  }

  // Calculate distance for each option
  const distances = [];
  allOptions.forEach(option => {
    const distance = calculateLevenshteinDistance(cleanUnknown, option);
    if (distance <= distanceThreshold) {
      // Calculate bonus score for substring matches
      // If the unknown option is a substring of the valid option, it's likely what the user meant
      // Check both directions: is unknown a substring of option, or is option a substring of unknown
      const unknownInOption = option.includes(cleanUnknown);
      const optionInUnknown = cleanUnknown.includes(option);

      // Strong bonus for when user typed a word that appears in the option name
      // e.g., "branch" appears in "base-branch"
      const substringBonus = unknownInOption ? -10 : optionInUnknown ? -5 : 0;

      // Also prioritize options with similar length (user likely tried to type the full name)
      const lengthDiff = Math.abs(option.length - cleanUnknown.length);
      const lengthBonus = lengthDiff < 3 ? -1 : 0;

      distances.push({
        option,
        distance,
        effectiveDistance: distance + substringBonus + lengthBonus,
      });
    }
  });

  // Sort by effective distance (closest first), then by actual distance
  return distances
    .sort((a, b) => {
      if (a.effectiveDistance !== b.effectiveDistance) {
        return a.effectiveDistance - b.effectiveDistance;
      }
      return a.distance - b.distance;
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

  if (suggestions.length === 1) {
    return `\n\nDid you mean --${suggestions[0]}?`;
  }

  // For multiple suggestions, format them nicely
  const formattedOptions = suggestions.map(opt => {
    // If it's a single character, show as -x, otherwise --option-name
    return opt.length === 1 ? `-${opt}` : `--${opt}`;
  });

  return `\n\nDid you mean one of these?\n${formattedOptions.map(opt => `  • ${opt}`).join('\n')}`;
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
  'allow-to-push-to-contributors-pull-requests-as-maintainer',
  'prefix-fork-name-with-owner-name',
  'auto-restart-max-iterations',
  'auto-continue-only-on-new-comments',
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
  // Extract the unknown option name from the error message
  // Typical format: "Unknown argument: branch" or "Unknown arguments: branch, test"
  const unknownMatch = originalError.match(/Unknown arguments?:\s*(.+?)(?:\s|$)/i);

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
