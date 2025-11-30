// CLI configuration module for solve command
// Extracted from solve.mjs to keep files under 1500 lines

// This module expects 'use' to be passed in from the parent module
// to avoid duplicate use-m initialization issues

// Note: Strict options validation is now handled by yargs built-in .strict() mode (see below)
// This approach was adopted per issue #482 feedback to minimize custom code maintenance

// Export an initialization function that accepts 'use'
export const initializeConfig = async (use) => {
  // Import yargs with specific version for hideBin support
  const yargsModule = await use('yargs@17.7.2');
  const yargs = yargsModule.default || yargsModule;
  const { hideBin } = await use('yargs@17.7.2/helpers');

  return { yargs, hideBin };
};

// Function to create yargs configuration - avoids duplication
export const createYargsConfig = (yargsInstance) => {
  return yargsInstance
    .usage('Usage: solve.mjs <issue-url> [options]')
    .command('$0 <issue-url>', 'Solve a GitHub issue or pull request', (yargs) => {
      yargs.positional('issue-url', {
        type: 'string',
        description: 'The GitHub issue URL to solve'
      });
    })
    .fail((msg, err) => {
      // Custom fail handler to suppress yargs error output
      // Errors will be handled in the parseArguments catch block
      if (err) throw err; // Rethrow actual errors
      // For validation errors, throw a clean error object with the message
      const error = new Error(msg);
      error.name = 'YargsValidationError';
      throw error;
    })
    .option('resume', {
      type: 'string',
      description: 'Resume from a previous session ID (when limit was reached)',
      alias: 'r'
    })
    .option('only-prepare-command', {
      type: 'boolean',
      description: 'Only prepare and print the claude command without executing it',
    })
    .option('dry-run', {
      type: 'boolean',
      description: 'Prepare everything but do not execute Claude (alias for --only-prepare-command)',
      alias: 'n'
    })
    .option('skip-tool-check', {
      type: 'boolean',
      description: 'Skip tool connection check (useful in CI environments)',
      default: false
    })
    .option('skip-claude-check', {
      type: 'boolean',
      description: 'Alias for --skip-tool-check (kept for backward compatibility with CI/tests)',
      default: false
    })
    .option('tool-check', {
      type: 'boolean',
      description: 'Perform tool connection check (enabled by default, use --no-tool-check to skip)',
      default: true,
      hidden: true
    })
    .option('model', {
      type: 'string',
      description: 'Model to use (for claude: opus, sonnet, haiku; for opencode: grok, gpt4o; for codex: gpt5, gpt5-codex, o3; for openai: gpt-4o, gpt-4o-mini, etc.)',
      alias: 'm',
      default: (currentParsedArgs) => {
        // Dynamic default based on tool selection
        if (currentParsedArgs?.tool === 'opencode') {
          return 'grok-code-fast-1';
        } else if (currentParsedArgs?.tool === 'codex') {
          return 'gpt-5';
        } else if (currentParsedArgs?.tool === 'openai') {
          return 'gpt-4o';
        }
        return 'sonnet';
      }
    })
    .option('openai-endpoint', {
      type: 'string',
      description: 'Full URL to OpenAI-compatible Chat Completions endpoint (e.g., https://api.openai.com/v1/chat/completions or https://host/api/v1/chat/completions)'
    })
    .option('openai-api-key', {
      type: 'string',
      description: 'API key (Bearer token) for OpenAI-compatible endpoint'
    })
    .option('auto-pull-request-creation', {
      type: 'boolean',
      description: 'Automatically create a draft pull request before running Claude',
      default: true
    })
    .option('verbose', {
      type: 'boolean',
      description: 'Enable verbose logging for debugging',
      alias: 'v',
      default: false
    })
    .option('fork', {
      type: 'boolean',
      description: 'Fork the repository if you don\'t have write access',
      alias: 'f',
      default: false
    })
    .option('auto-fork', {
      type: 'boolean',
      description: 'Automatically fork public repositories without write access (fails for private repos)',
      default: false
    })
    .option('attach-logs', {
      type: 'boolean',
      description: 'Upload the solution draft log file to the Pull Request on completion (⚠️ WARNING: May expose sensitive data)',
      default: false
    })
    .option('auto-close-pull-request-on-fail', {
      type: 'boolean',
      description: 'Automatically close the pull request if execution fails',
      default: false
    })
    .option('auto-continue', {
      type: 'boolean',
      description: 'Continue with existing PR when issue URL is provided (instead of creating new PR)',
      default: false
    })
    .option('auto-continue-on-limit-reset', {
      type: 'boolean',
      description: 'Automatically continue when AI tool limit resets (calculates reset time and waits)',
      default: false
    })
    .option('auto-resume-on-errors', {
      type: 'boolean',
      description: 'Automatically resume on network errors (503, etc.) with exponential backoff',
      default: false
    })
    .option('auto-continue-only-on-new-comments', {
      type: 'boolean',
      description: 'Explicitly fail on absence of new comments in auto-continue or continue mode',
      default: false
    })
    .option('auto-commit-uncommitted-changes', {
      type: 'boolean',
      description: 'Automatically commit and push uncommitted changes made by Claude (disabled by default)',
      default: false
    })
    .option('auto-restart-on-uncommitted-changes', {
      type: 'boolean',
      description: 'Automatically restart when uncommitted changes are detected to allow the tool to handle them (default: true, use --no-auto-restart-on-uncommitted-changes to disable)',
      default: true
    })
    .option('auto-restart-max-iterations', {
      type: 'number',
      description: 'Maximum number of auto-restart iterations when uncommitted changes are detected (default: 3)',
      default: 3
    })
    .option('continue-only-on-feedback', {
      type: 'boolean',
      description: 'Only continue if feedback is detected (works only with pull request link or issue link with --auto-continue)',
      default: false
    })
    .option('watch', {
      type: 'boolean',
      description: 'Monitor continuously for feedback and auto-restart when detected (stops when PR is merged)',
      alias: 'w',
      default: false
    })
    .option('watch-interval', {
      type: 'number',
      description: 'Interval in seconds for checking feedback in watch mode (default: 60)',
      default: 60
    })
    .option('min-disk-space', {
      type: 'number',
      description: 'Minimum required disk space in MB (default: 500)',
      default: 500
    })
    .option('log-dir', {
      type: 'string',
      description: 'Directory to save log files (defaults to current working directory)',
      alias: 'l'
    })
    .option('think', {
      type: 'string',
      description: 'Thinking level: low (Think.), medium (Think hard.), high (Think harder.), max (Ultrathink.)',
      choices: ['low', 'medium', 'high', 'max'],
      default: undefined
    })
    .option('base-branch', {
      type: 'string',
      description: 'Target branch for the pull request (defaults to repository default branch)',
      alias: 'b'
    })
    .option('sentry', {
      type: 'boolean',
      description: 'Enable Sentry error tracking and monitoring (use --no-sentry to disable)',
      default: true
    })
    .option('auto-cleanup', {
      type: 'boolean',
      description: 'Automatically delete temporary working directory on completion (error, success, or CTRL+C). Default: true for private repos, false for public repos. Use explicit flag to override.',
      default: undefined
    })
    .option('auto-merge-default-branch-to-pull-request-branch', {
      type: 'boolean',
      description: 'Automatically merge the default branch to the pull request branch when continuing work (only in continue mode)',
      default: false
    })
    .option('allow-fork-divergence-resolution-using-force-push-with-lease', {
      type: 'boolean',
      description: 'Allow automatic force-push (--force-with-lease) when fork diverges from upstream (DANGEROUS: can overwrite fork history)',
      default: false
    })
    .option('allow-to-push-to-contributors-pull-requests-as-maintainer', {
      type: 'boolean',
      description: 'When continuing a fork PR as a maintainer, attempt to push directly to the contributor\'s fork if "Allow edits by maintainers" is enabled. Requires --auto-fork to be enabled.',
      default: false
    })
    .option('prefix-fork-name-with-owner-name', {
      type: 'boolean',
      description: 'Prefix fork name with original owner name (e.g., "owner-repo" instead of "repo"). Useful when forking repositories with same name from different owners. Experimental feature.',
      default: false
    })
    .option('tool', {
      type: 'string',
      description: 'AI tool to use for solving issues',
      choices: ['claude', 'opencode', 'codex', 'openai'],
      default: 'claude'
    })
    .parserConfiguration({
      'boolean-negation': true
    })
    // Use yargs built-in strict mode to reject unrecognized options
    // This prevents issues like #453 and #482 where unknown options are silently ignored
    .strict()
    .help('h')
    .alias('h', 'help');
};

// Parse command line arguments - now needs yargs and hideBin passed in
export const parseArguments = async (yargs, hideBin) => {
  const rawArgs = hideBin(process.argv);
  // Use .parse() instead of .argv to ensure .strict() mode works correctly
  // When you call yargs(args) and use .argv, strict mode doesn't trigger
  // See: https://github.com/yargs/yargs/issues - .strict() only works with .parse()

  let argv;
  try {
    // Suppress stderr output from yargs during parsing to prevent validation errors from appearing
    // This prevents "YError: Not enough arguments" from polluting stderr (issue #583)
    // Save the original stderr.write
    const originalStderrWrite = process.stderr.write;
    const stderrBuffer = [];

    // Temporarily override stderr.write to capture output
    process.stderr.write = function(chunk, encoding, callback) {
      stderrBuffer.push(chunk.toString());
      // Call the callback if provided (for compatibility)
      if (typeof encoding === 'function') {
        encoding();
      } else if (typeof callback === 'function') {
        callback();
      }
      return true;
    };

    try {
      argv = await createYargsConfig(yargs()).parse(rawArgs);
    } finally {
      // Always restore stderr.write
      process.stderr.write = originalStderrWrite;

      // In verbose mode, show what was captured from stderr (for debugging)
      if (global.verboseMode && stderrBuffer.length > 0) {
        const captured = stderrBuffer.join('');
        if (captured.trim()) {
          console.error('[Suppressed yargs stderr]:', captured);
        }
      }
    }
  } catch (error) {
    // Yargs throws errors for validation issues
    // If the error is about unknown arguments (strict mode), re-throw it
    if (error.message && error.message.includes('Unknown arguments')) {
      throw error;
    }
    // For other validation errors, show a warning in verbose mode
    if (error.message && global.verboseMode) {
      console.error('Yargs parsing warning:', error.message);
    }
    // Try to get the argv even with the error
    argv = error.argv || {};
  }

  // Post-processing: Fix model default for opencode and codex tools
  // Yargs doesn't properly handle dynamic defaults based on other arguments,
  // so we need to handle this manually after parsing
  const modelExplicitlyProvided = rawArgs.includes('--model') || rawArgs.includes('-m');

  // Normalize alias flags: --skip-claude-check behaves like --skip-tool-check
  if (argv && argv.skipClaudeCheck) {
    argv.skipToolCheck = true;
  }

  if (argv.tool === 'opencode' && !modelExplicitlyProvided) {
    // User did not explicitly provide --model, so use the correct default for opencode
    argv.model = 'grok-code-fast-1';
  } else if (argv.tool === 'codex' && !modelExplicitlyProvided) {
    // User did not explicitly provide --model, so use the correct default for codex
    argv.model = 'gpt-5';
  }

  return argv;
};
