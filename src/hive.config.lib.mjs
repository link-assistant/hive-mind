// CLI configuration module for hive command
// Extracted from hive.mjs to avoid loading heavy dependencies (instrument.mjs, etc.)
// when only the yargs configuration is needed (e.g., in telegram-bot.mjs)
// This module has no heavy dependencies to allow fast loading for --help

import { SOLVE_OPTION_DEFINITIONS } from './solve.config.lib.mjs';

// Hive-only options that are NOT solve options (hive-specific functionality).
// These are excluded when auto-registering solve-passthrough options.
const HIVE_ONLY_OPTION_NAMES = new Set(['monitor-tag', 'all-issues', 'skip-issues-with-prs', 'concurrency', 'pull-requests-per-issue', 'interval', 'max-issues', 'once', 'project-number', 'project-owner', 'project-status', 'project-mode', 'youtrack-mode', 'youtrack-stage', 'youtrack-project', 'target-branch', 'issue-order']);

// Solve-only options that should NOT be registered in hive
// (they are internal to solve and not meaningful when passed from hive)
const SOLVE_ONLY_OPTION_NAMES = new Set(['resume', 'working-directory', 'only-prepare-command', 'session-type']);

// Options that hive defines with different defaults/descriptions than solve.
// These are registered manually in hive config to preserve hive-specific behavior.
// All other solve options are auto-registered from SOLVE_OPTION_DEFINITIONS.
const HIVE_CUSTOM_SOLVE_OPTIONS = {
  model: {
    type: 'string',
    description: 'Model to use for solve (opus, sonnet, haiku, haiku-3-5, haiku-3, or any model ID supported by the tool)',
    alias: 'm',
    default: 'sonnet',
  },
  'dry-run': {
    type: 'boolean',
    description: 'List issues that would be processed without actually processing them',
    default: false,
  },
  'auto-continue': {
    type: 'boolean',
    description: 'Pass --auto-continue to solve for each issue (continues with existing PRs instead of creating new ones)',
    default: true,
  },
  'auto-resume-on-limit-reset': {
    type: 'boolean',
    description: 'Automatically resume when AI tool limit resets (calculates reset time and waits). Passed to solve command.',
    default: true,
  },
  'auto-cleanup': {
    type: 'boolean',
    description: 'Automatically clean temporary directories (/tmp/* /var/tmp/*) when finished successfully',
    default: false,
  },
  tool: {
    type: 'string',
    description: 'AI tool to use for solving issues',
    choices: ['claude', 'opencode', 'agent'],
    default: 'claude',
  },
};

// Compute the set of solve options that hive auto-registers from SOLVE_OPTION_DEFINITIONS.
// This is exported so hive.mjs can use it for automatic argument forwarding.
// An option is auto-registered if it: (1) exists in solve, (2) is not hive-only,
// (3) is not solve-only, and (4) is not customized in hive.
export const getSolvePassthroughOptionNames = () => {
  const names = [];
  for (const name of Object.keys(SOLVE_OPTION_DEFINITIONS)) {
    if (HIVE_ONLY_OPTION_NAMES.has(name)) continue;
    if (SOLVE_ONLY_OPTION_NAMES.has(name)) continue;
    // Include both custom and auto-registered options as passthrough
    names.push(name);
  }
  return names;
};

export const createYargsConfig = yargsInstance => {
  let config = yargsInstance
    .command('$0 [github-url]', 'Monitor GitHub issues and create PRs', yargs => {
      yargs.positional('github-url', {
        type: 'string',
        description: 'GitHub organization, repository, or user URL to monitor (or GitHub repo URL when using --youtrack-mode)',
      });
    })
    .usage('Usage: $0 <github-url> [options]')
    .fail((msg, err) => {
      // Custom fail handler to suppress yargs' automatic error output to stderr
      // We handle errors in the calling code's try-catch block
      // If there's an existing error object, throw it as-is to preserve the full trace
      if (err) {
        throw err;
      }
      // For validation messages, throw them as-is without wrapping
      // This preserves the original error and its stack trace
      const error = new Error(msg);
      // Preserve the original error as the cause if yargs provided one
      if (err) {
        error.cause = err;
      }
      throw error;
    });

  // Register hive-only options
  config = config
    .option('monitor-tag', {
      type: 'string',
      description: 'GitHub label to monitor for issues',
      default: 'help wanted',
      alias: 't',
    })
    .option('all-issues', {
      type: 'boolean',
      description: 'Process all open issues regardless of labels',
      default: false,
      alias: 'a',
    })
    .option('skip-issues-with-prs', {
      type: 'boolean',
      description: 'Skip issues that already have open pull requests',
      default: false,
      alias: 's',
    })
    .option('concurrency', {
      type: 'number',
      description: 'Number of concurrent solve instances',
      default: 2,
      alias: 'c',
    })
    .option('pull-requests-per-issue', {
      type: 'number',
      description: 'Number of pull requests to generate per issue',
      default: 1,
      alias: 'p',
    })
    .option('interval', {
      type: 'number',
      description: 'Polling interval in seconds',
      default: 300, // 5 minutes
      alias: 'i',
    })
    .option('max-issues', {
      type: 'number',
      description: 'Maximum number of issues to process (0 = unlimited)',
      default: 0,
    })
    .option('once', {
      type: 'boolean',
      description: 'Run once and exit instead of continuous monitoring',
      default: false,
    })
    .option('project-number', {
      type: 'number',
      description: 'GitHub Project number to monitor',
      alias: 'pn',
    })
    .option('project-owner', {
      type: 'string',
      description: 'GitHub Project owner (organization or user)',
      alias: 'po',
    })
    .option('project-status', {
      type: 'string',
      description: 'Project status column to monitor (e.g., "Ready", "To Do")',
      alias: 'ps',
      default: 'Ready',
    })
    .option('project-mode', {
      type: 'boolean',
      description: 'Enable project-based monitoring instead of label-based',
      alias: 'pm',
      default: false,
    })
    .option('youtrack-mode', {
      type: 'boolean',
      description: 'Enable YouTrack mode instead of GitHub issues',
      default: false,
    })
    .option('youtrack-stage', {
      type: 'string',
      description: 'Override YouTrack stage to monitor (overrides YOUTRACK_STAGE env var)',
    })
    .option('youtrack-project', {
      type: 'string',
      description: 'Override YouTrack project code (overrides YOUTRACK_PROJECT_CODE env var)',
    })
    .option('target-branch', {
      type: 'string',
      description: 'Target branch for pull requests (defaults to repository default branch)',
      alias: 'tb',
    })
    .option('issue-order', {
      type: 'string',
      description: 'Order issues by publication date: "asc" (oldest first) or "desc" (newest first)',
      alias: 'o',
      default: 'asc',
      choices: ['asc', 'desc'],
    });

  // Register options with hive-specific customizations (different defaults/descriptions than solve)
  for (const [name, def] of Object.entries(HIVE_CUSTOM_SOLVE_OPTIONS)) {
    config = config.option(name, def);
  }

  // Auto-register all remaining solve options as passthrough options.
  // This ensures any new option added to solve.config.lib.mjs is automatically
  // available in hive (and TELEGRAM_HIVE_OVERRIDES) without manual code changes.
  // See: https://github.com/link-assistant/hive-mind/issues/1209
  for (const [name, def] of Object.entries(SOLVE_OPTION_DEFINITIONS)) {
    // Skip options that are hive-only, solve-only, or already registered with custom hive config
    if (HIVE_ONLY_OPTION_NAMES.has(name)) continue;
    if (SOLVE_ONLY_OPTION_NAMES.has(name)) continue;
    if (name in HIVE_CUSTOM_SOLVE_OPTIONS) continue;
    config = config.option(name, def);
  }

  config = config
    .parserConfiguration({
      'boolean-negation': true,
      'strip-dashed': false,
      'strip-aliased': false,
      'populate--': false,
    })
    .showHelpOnFail(false) // Don't show help on validation failures
    .strict()
    .help('h')
    .alias('h', 'help');

  return config;
};
