// CLI configuration module for solve command
// Extracted from solve.mjs to keep files under 1500 lines

// This module expects 'use' to be passed in from the parent module
// to avoid duplicate use-m initialization issues

// Note: Strict options validation is now handled by yargs built-in .strict() mode (see below)
// This approach was adopted per issue #482 feedback to minimize custom code maintenance

import { enhanceErrorMessage, detectMalformedFlags } from './option-suggestions.lib.mjs';

// Re-export for use by telegram-bot.mjs (avoids extra import lines there)
export { detectMalformedFlags };

// Export an initialization function that accepts 'use'
export const initializeConfig = async use => {
  // Import yargs with specific version for hideBin support
  const yargsModule = await use('yargs@17.7.2');
  const yargs = yargsModule.default || yargsModule;
  const { hideBin } = await use('yargs@17.7.2/helpers');

  return { yargs, hideBin };
};

// Solve option definitions as a plain data structure.
// This is the single source of truth for all solve command options.
// Exported so hive.config.lib.mjs can automatically register solve options
// without manual duplication (see issue #1209).
// NOTE: Options with function defaults (like 'model') are defined inline in createYargsConfig
// and excluded from this map since functions cannot be cleanly shared as data.
export const SOLVE_OPTION_DEFINITIONS = {
  resume: {
    type: 'string',
    description: 'Resume from a previous session ID (when limit was reached)',
    alias: 'r',
  },
  'working-directory': {
    type: 'string',
    description: 'Use specified working directory instead of creating a new temp directory. If directory does not exist, it will be created and the repository will be cloned. Essential for --resume to work correctly with Claude Code sessions.',
    alias: 'd',
  },
  'only-prepare-command': {
    type: 'boolean',
    description: 'Only prepare and print the claude command without executing it',
  },
  'dry-run': {
    type: 'boolean',
    description: 'Prepare everything but do not execute Claude (alias for --only-prepare-command)',
    alias: 'n',
  },
  'skip-tool-connection-check': {
    type: 'boolean',
    description: 'Skip tool connection check (useful in CI environments). Does NOT skip model validation.',
    default: false,
  },
  'skip-tool-check': {
    type: 'boolean',
    description: 'Alias for --skip-tool-connection-check (deprecated, use --skip-tool-connection-check instead)',
    default: false,
    hidden: true,
  },
  'skip-claude-check': {
    type: 'boolean',
    description: 'Alias for --skip-tool-connection-check (deprecated)',
    default: false,
    hidden: true,
  },
  'tool-connection-check': {
    type: 'boolean',
    description: 'Perform tool connection check (enabled by default, use --no-tool-connection-check to skip). Does NOT affect model validation.',
    default: true,
    hidden: true,
  },
  'tool-check': {
    type: 'boolean',
    description: 'Alias for --tool-connection-check (deprecated)',
    default: true,
    hidden: true,
  },
  'auto-pull-request-creation': {
    type: 'boolean',
    description: 'Automatically create a draft pull request before running Claude',
    default: true,
  },
  verbose: {
    type: 'boolean',
    description: 'Enable verbose logging for debugging',
    alias: 'v',
    default: false,
  },
  fork: {
    type: 'boolean',
    description: "Fork the repository if you don't have write access",
    alias: 'f',
    default: false,
  },
  'auto-fork': {
    type: 'boolean',
    description: 'Automatically fork public repositories without write access (fails for private repos)',
    default: true,
  },
  'claude-file': {
    type: 'boolean',
    description: 'Create CLAUDE.md file for task details (default for --tool claude, mutually exclusive with --gitkeep-file)',
    default: true,
  },
  'gitkeep-file': {
    type: 'boolean',
    description: 'Create .gitkeep file instead of CLAUDE.md (default for --tool agent/opencode/codex, mutually exclusive with --claude-file)',
    default: false,
  },
  'auto-gitkeep-file': {
    type: 'boolean',
    description: 'Automatically use .gitkeep if CLAUDE.md is in .gitignore (pre-checks before creating file)',
    default: true,
  },
  'attach-logs': {
    type: 'boolean',
    description: 'Upload the solution draft log file to the Pull Request on completion (⚠️ WARNING: May expose sensitive data)',
    default: false,
  },
  'auto-close-pull-request-on-fail': {
    type: 'boolean',
    description: 'Automatically close the pull request if execution fails',
    default: false,
  },
  'auto-continue': {
    type: 'boolean',
    description: 'Continue with existing PR when issue URL is provided (instead of creating new PR)',
    default: true,
  },
  'auto-resume-on-limit-reset': {
    type: 'boolean',
    description: 'Automatically resume when AI tool limit resets (maintains session context with --resume flag)',
    default: true,
  },
  'auto-restart-on-limit-reset': {
    type: 'boolean',
    description: 'Automatically restart when AI tool limit resets (fresh start without --resume flag)',
    default: false,
  },
  'session-type': {
    type: 'string',
    description: 'Internal: Session type for comment differentiation (new, resume, auto-resume, auto-restart)',
    choices: ['new', 'resume', 'auto-resume', 'auto-restart'],
    default: 'new',
    hidden: true,
  },
  'auto-resume-on-errors': {
    type: 'boolean',
    description: 'Automatically resume on network errors (503, etc.) with exponential backoff',
    default: false,
  },
  'auto-continue-only-on-new-comments': {
    type: 'boolean',
    description: 'Explicitly fail on absence of new comments in auto-continue or continue mode',
    default: false,
  },
  'auto-commit-uncommitted-changes': {
    type: 'boolean',
    description: 'Automatically commit and push uncommitted changes made by Claude (disabled by default)',
    default: false,
  },
  'auto-restart-on-uncommitted-changes': {
    type: 'boolean',
    description: 'Automatically restart when uncommitted changes are detected to allow the tool to handle them (default: true, use --no-auto-restart-on-uncommitted-changes to disable)',
    default: true,
  },
  'auto-restart-max-iterations': {
    type: 'number',
    description: 'Maximum number of auto-restart iterations when uncommitted changes are detected (default: 3)',
    default: 3,
  },
  'auto-merge': {
    type: 'boolean',
    description: 'Automatically merge the pull request when the working session is finished and all CI/CD statuses pass and PR is mergeable. Implies --auto-restart-until-mergable.',
    default: false,
  },
  'auto-restart-until-mergable': {
    type: 'boolean',
    description: 'Auto-restart until PR becomes mergeable (no iteration limit). Restarts on new comments from non-bot users, CI failures, merge conflicts, or other issues. Does NOT auto-merge.',
    default: false,
  },
  'auto-restart-on-non-updated-pull-request-description': {
    type: 'boolean',
    description: 'Automatically restart if PR title or description still contains auto-generated placeholder text after agent execution. Restarts with a hint about what was not updated.',
    default: false,
  },
  'continue-only-on-feedback': {
    type: 'boolean',
    description: 'Only continue if feedback is detected (works only with pull request link or issue link with --auto-continue)',
    default: false,
  },
  watch: {
    type: 'boolean',
    description: 'Monitor continuously for feedback and auto-restart when detected (stops when PR is merged)',
    alias: 'w',
    default: false,
  },
  'watch-interval': {
    type: 'number',
    description: 'Interval in seconds for checking feedback in watch mode (default: 60)',
    default: 60,
  },
  'min-disk-space': {
    type: 'number',
    description: 'Minimum required disk space in MB (default: 2048)',
    default: 2048,
  },
  'log-dir': {
    type: 'string',
    description: 'Directory to save log files (defaults to current working directory)',
    alias: 'l',
  },
  think: {
    type: 'string',
    description: 'Thinking level for Claude. Translated to --thinking-budget for Claude Code >= 2.1.12 (off=0, low=~8000, medium=~16000, high=~24000, max=31999). For older versions, uses thinking keywords.',
    choices: ['off', 'low', 'medium', 'high', 'max'],
    default: undefined,
  },
  'thinking-budget': {
    type: 'number',
    description: 'Thinking token budget for Claude Code (0-31999). Controls MAX_THINKING_TOKENS. Default: 0 (thinking disabled). For older Claude Code versions, translated back to --think level.',
    default: undefined,
  },
  'thinking-budget-claude-minimum-version': {
    type: 'string',
    description: 'Minimum Claude Code version that supports --thinking-budget (MAX_THINKING_TOKENS env var). Versions below this use thinking keywords instead.',
    default: '2.1.12',
  },
  'max-thinking-budget': {
    type: 'number',
    description: 'Maximum thinking budget for calculating --think level mappings (default: 31999 for Claude Code). Values: off=0, low=max/4, medium=max/2, high=max*3/4, max=max.',
    default: 31999,
  },
  'prompt-plan-sub-agent': {
    type: 'boolean',
    description: 'Encourage AI to use Plan sub-agent for initial planning (only works with --tool claude)',
    default: false,
  },
  'base-branch': {
    type: 'string',
    description: 'Target branch for the pull request (defaults to repository default branch)',
    alias: 'b',
  },
  sentry: {
    type: 'boolean',
    description: 'Enable Sentry error tracking and monitoring (use --no-sentry to disable)',
    default: true,
  },
  'auto-cleanup': {
    type: 'boolean',
    description: 'Automatically delete temporary working directory on completion (error, success, or CTRL+C). Default: true for private repos, false for public repos. Use explicit flag to override.',
    default: undefined,
  },
  'auto-merge-default-branch-to-pull-request-branch': {
    type: 'boolean',
    description: 'Automatically merge the default branch to the pull request branch when continuing work (only in continue mode)',
    default: false,
  },
  'allow-fork-divergence-resolution-using-force-push-with-lease': {
    type: 'boolean',
    description: 'Allow automatic force-push (--force-with-lease) when fork diverges from upstream (DANGEROUS: can overwrite fork history)',
    default: false,
  },
  'allow-to-push-to-contributors-pull-requests-as-maintainer': {
    type: 'boolean',
    description: 'When continuing a fork PR as a maintainer, attempt to push directly to the contributor\'s fork if "Allow edits by maintainers" is enabled. Requires --auto-fork to be enabled.',
    default: false,
  },
  'prefix-fork-name-with-owner-name': {
    type: 'boolean',
    description: 'Prefix fork name with original owner name (e.g., "owner-repo" instead of "repo"). Useful when forking repositories with same name from different owners.',
    default: true,
  },
  tool: {
    type: 'string',
    description: 'AI tool to use for solving issues',
    choices: ['claude', 'opencode', 'codex', 'agent'],
    default: 'claude',
  },
  'execute-tool-with-bun': {
    type: 'boolean',
    description: 'Execute the AI tool using bunx (experimental, may improve speed and memory usage)',
    default: false,
  },
  'enable-workspaces': {
    type: 'boolean',
    description: 'Use separate workspace directory structure with repository/ and tmp/ folders. Works with all tools (claude, opencode, codex, agent). Experimental feature.',
    default: false,
  },
  'interactive-mode': {
    type: 'boolean',
    description: '[EXPERIMENTAL] Post Claude output as PR comments in real-time. Only supported for --tool claude.',
    default: false,
  },
  'prompt-explore-sub-agent': {
    type: 'boolean',
    description: 'Encourage Claude to use Explore sub-agent for codebase exploration. Only supported for --tool claude.',
    default: false,
  },
  'prompt-general-purpose-sub-agent': {
    type: 'boolean',
    description: 'Prompt AI to use general-purpose sub agents for processing large tasks with multiple files/folders. Only supported for --tool claude.',
    default: false,
  },
  'tokens-budget-stats': {
    type: 'boolean',
    description: '[EXPERIMENTAL] Show detailed token budget statistics including context window usage and ratios. Only supported for --tool claude.',
    default: false,
  },
  'prompt-issue-reporting': {
    type: 'boolean',
    description: 'Enable automatic issue creation for spotted bugs/errors not related to main task. Issues will include reproducible examples, workarounds, and fix suggestions. Works for both current and third-party repositories. Only supported for --tool claude.',
    default: false,
  },
  'prompt-architecture-care': {
    type: 'boolean',
    description: '[EXPERIMENTAL] Include guidance for managing REQUIREMENTS.md and ARCHITECTURE.md files. When enabled, agents will update these documentation files when changes affect requirements or architecture.',
    default: false,
  },
  'prompt-case-studies': {
    type: 'boolean',
    description: 'Create comprehensive case study documentation for the issue including logs, analysis, timeline, root cause investigation, and proposed solutions. Organizes findings into ./docs/case-studies/issue-{id}/ directory. Only supported for --tool claude.',
    default: false,
  },
  'prompt-playwright-mcp': {
    type: 'boolean',
    description: 'Enable Playwright MCP browser automation hints in system prompt (enabled by default, only takes effect if Playwright MCP is installed). Use --no-prompt-playwright-mcp to disable. Only supported for --tool claude.',
    default: true,
  },
  'prompt-check-sibling-pull-requests': {
    type: 'boolean',
    description: 'Include prompt to check related/sibling pull requests when studying related work. Enabled by default, use --no-prompt-check-sibling-pull-requests to disable.',
    default: true,
  },
  'prompt-experiments-folder': {
    type: 'string',
    description: 'Path to experiments folder used in system prompt. Set to empty string to disable experiments folder prompt. Default: ./experiments',
    default: './experiments',
  },
  'prompt-examples-folder': {
    type: 'string',
    description: 'Path to examples folder used in system prompt. Set to empty string to disable examples folder prompt. Default: ./examples',
    default: './examples',
  },
  'playwright-mcp-auto-cleanup': {
    type: 'boolean',
    description: 'Automatically remove .playwright-mcp/ folder before checking for uncommitted changes. This prevents browser automation artifacts from triggering auto-restart. Use --no-playwright-mcp-auto-cleanup to keep the folder for debugging.',
    default: true,
  },
  'auto-gh-configuration-repair': {
    type: 'boolean',
    description: 'Automatically repair git configuration using gh-setup-git-identity --repair when git identity is not configured. Requires gh-setup-git-identity to be installed.',
    default: false,
  },
  'prompt-subagents-via-agent-commander': {
    type: 'boolean',
    description: 'Guide Claude to use agent-commander CLI (start-agent) instead of native Task tool for subagent delegation. Allows using any supported agent type (claude, opencode, codex, agent) with unified API. Only works with --tool claude and requires agent-commander to be installed.',
    default: false,
  },
  'attach-solution-summary': {
    type: 'boolean',
    description: 'Attach the AI solution summary (from the result field) as a comment to the PR/issue after completion. The summary is extracted from the AI tool JSON output and posted under a "Solution summary" header.',
    default: false,
  },
  'auto-attach-solution-summary': {
    type: 'boolean',
    description: 'Automatically attach solution summary only if the AI did not create any comments during the session. This provides visible feedback when the AI completes silently.',
    default: false,
  },
};

// Function to create yargs configuration - avoids duplication
export const createYargsConfig = yargsInstance => {
  let config = yargsInstance
    .usage('Usage: solve.mjs <issue-url> [options]')
    .command('$0 <issue-url>', 'Solve a GitHub issue or pull request', yargs => {
      yargs.positional('issue-url', {
        type: 'string',
        description: 'The GitHub issue URL to solve',
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
    });

  // Register all options from the definitions map
  for (const [name, def] of Object.entries(SOLVE_OPTION_DEFINITIONS)) {
    config = config.option(name, def);
  }

  // 'model' has a dynamic default function, so it's defined inline (not in SOLVE_OPTION_DEFINITIONS)
  config = config
    .option('model', {
      type: 'string',
      description: 'Model to use (for claude: opus, sonnet, haiku, haiku-3-5, haiku-3; for opencode: grok, gpt4o; for codex: gpt5, gpt5-codex, o3; for agent: grok, grok-code, big-pickle, gpt-5-nano, glm-4.7-free, minimax-m2.1-free, kimi-k2.5-free)',
      alias: 'm',
      default: currentParsedArgs => {
        // Dynamic default based on tool selection
        if (currentParsedArgs?.tool === 'opencode') {
          return 'grok-code-fast-1';
        } else if (currentParsedArgs?.tool === 'codex') {
          return 'gpt-5';
        } else if (currentParsedArgs?.tool === 'agent') {
          return 'kimi-k2.5-free';
        }
        return 'sonnet';
      },
    })
    .parserConfiguration({
      'boolean-negation': true,
    })
    // Use yargs built-in strict mode to reject unrecognized options
    // This prevents issues like #453 and #482 where unknown options are silently ignored
    .strict()
    .help('h')
    .alias('h', 'help');

  return config;
};

// Parse command line arguments - now needs yargs and hideBin passed in
export const parseArguments = async (yargs, hideBin) => {
  const rawArgs = hideBin(process.argv);

  // Issue #1092: Detect malformed flag patterns BEFORE yargs parsing
  // This catches cases like "-- model" which yargs silently treats as positional arguments
  const malformedResult = detectMalformedFlags(rawArgs);
  if (malformedResult.malformed.length > 0) {
    const error = new Error(malformedResult.errors.join('\n'));
    error.name = 'MalformedArgumentError';
    throw error;
  }

  // Use .parse() instead of .argv to ensure .strict() mode works correctly
  // When you call yargs(args) and use .argv, strict mode doesn't trigger
  // See: https://github.com/yargs/yargs/issues - .strict() only works with .parse()

  let argv;
  let yargsInstance;
  try {
    // Suppress stderr output from yargs during parsing to prevent validation errors from appearing
    // This prevents "YError: Not enough arguments" from polluting stderr (issue #583)
    // Save the original stderr.write
    const originalStderrWrite = process.stderr.write;
    const stderrBuffer = [];

    // Temporarily override stderr.write to capture output
    process.stderr.write = function (chunk, encoding, callback) {
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
      yargsInstance = createYargsConfig(yargs());
      argv = await yargsInstance.parse(rawArgs);
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
    // If the error is about unknown arguments (strict mode), enhance it with suggestions
    // Check if this error has already been enhanced to avoid re-processing
    if (error.message && /Unknown argument/.test(error.message) && !error._enhanced) {
      try {
        // Enhance the error message with helpful suggestions
        // Use the yargsInstance we already created, or create a new one if needed
        const yargsWithConfig = yargsInstance || createYargsConfig(yargs());
        const enhancedMessage = enhanceErrorMessage(error.message, yargsWithConfig);
        const enhancedError = new Error(enhancedMessage);
        enhancedError.name = error.name;
        enhancedError._enhanced = true; // Mark as enhanced to prevent re-processing
        throw enhancedError;
      } catch (enhanceErr) {
        // If enhancing fails, just throw the original error
        if (global.verboseMode) {
          console.error('[VERBOSE] Failed to enhance error message:', enhanceErr.message);
        }
        // If the enhance error itself is already enhanced, throw it
        if (enhanceErr._enhanced) {
          throw enhanceErr;
        }
        throw error;
      }
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

  // Normalize alias flags: legacy --skip-tool-check and --skip-claude-check behave like --skip-tool-connection-check
  if (argv) {
    // Support deprecated flags
    if (argv.skipToolCheck || argv.skipClaudeCheck) {
      argv.skipToolConnectionCheck = true;
    }
    // Support negated deprecated flag: --no-tool-check becomes --no-tool-connection-check
    if (argv.toolCheck === false) {
      argv.toolConnectionCheck = false;
    }
  }

  if (argv.tool === 'opencode' && !modelExplicitlyProvided) {
    // User did not explicitly provide --model, so use the correct default for opencode
    argv.model = 'grok-code-fast-1';
  } else if (argv.tool === 'codex' && !modelExplicitlyProvided) {
    // User did not explicitly provide --model, so use the correct default for codex
    argv.model = 'gpt-5';
  } else if (argv.tool === 'agent' && !modelExplicitlyProvided) {
    // User did not explicitly provide --model, so use the correct default for agent
    argv.model = 'kimi-k2.5-free';
  }

  // Tool-specific defaults for --claude-file and --gitkeep-file
  // For non-Claude tools, use .gitkeep by default to avoid polluting CLAUDE.md
  // (CLAUDE.md has special meaning for Claude Code as a project-level instruction file)
  // See: https://github.com/link-assistant/hive-mind/issues/1158
  const claudeFileExplicitlyProvided = rawArgs.includes('--claude-file') || rawArgs.includes('--no-claude-file');
  const gitkeepFileExplicitlyProvided = rawArgs.includes('--gitkeep-file') || rawArgs.includes('--no-gitkeep-file');

  if (argv.tool !== 'claude' && !claudeFileExplicitlyProvided && !gitkeepFileExplicitlyProvided) {
    // User did not explicitly provide either option, so use the correct defaults for non-Claude tools
    // Non-Claude tools (agent, opencode, codex) should use .gitkeep by default
    argv.claudeFile = false;
    argv.gitkeepFile = true;
  }

  // Validate mutual exclusivity of --claude-file and --gitkeep-file
  // Check if both are explicitly enabled (user passed both --claude-file and --gitkeep-file)
  if (argv.claudeFile && argv.gitkeepFile) {
    // Check if they were explicitly set via command line
    const claudeFileExplicit = rawArgs.includes('--claude-file');
    const gitkeepFileExplicit = rawArgs.includes('--gitkeep-file');

    if (claudeFileExplicit && gitkeepFileExplicit) {
      throw new Error('--claude-file and --gitkeep-file are mutually exclusive. Please use only one.');
    }

    // If only one is explicit, turn off the other
    if (gitkeepFileExplicit && !claudeFileExplicit) {
      argv.claudeFile = false;
    } else if (claudeFileExplicit && !gitkeepFileExplicit) {
      argv.gitkeepFile = false;
    }
  }

  // Check for both being disabled (both --no-claude-file and --no-gitkeep-file)
  const noClaudeFile = rawArgs.includes('--no-claude-file');
  const noGitkeepFile = rawArgs.includes('--no-gitkeep-file');

  if (noClaudeFile && noGitkeepFile) {
    throw new Error('Cannot disable both --claude-file and --gitkeep-file. At least one must be enabled for PR creation.');
  }

  // If user explicitly set --no-claude-file, enable gitkeep-file
  if (noClaudeFile && !argv.gitkeepFile) {
    argv.gitkeepFile = true;
    argv.claudeFile = false;
  }

  // If user explicitly set --no-gitkeep-file, enable claude-file (this is the default anyway)
  if (noGitkeepFile && !argv.claudeFile) {
    argv.claudeFile = true;
    argv.gitkeepFile = false;
  }

  return argv;
};
