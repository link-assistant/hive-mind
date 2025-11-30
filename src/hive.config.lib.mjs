// CLI configuration module for hive command
// Extracted from hive.mjs to avoid loading heavy dependencies (instrument.mjs, etc.)
// when only the yargs configuration is needed (e.g., in telegram-bot.mjs)
// This module has no heavy dependencies to allow fast loading for --help

export const createYargsConfig = (yargsInstance) => {
  return yargsInstance
    .command('$0 [github-url]', 'Monitor GitHub issues and create PRs', (yargs) => {
      yargs.positional('github-url', {
        type: 'string',
        description: 'GitHub organization, repository, or user URL to monitor (or GitHub repo URL when using --youtrack-mode)'
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
    })
    .option('monitor-tag', {
      type: 'string',
      description: 'GitHub label to monitor for issues',
      default: 'help wanted',
      alias: 't'
    })
    .option('all-issues', {
      type: 'boolean',
      description: 'Process all open issues regardless of labels',
      default: false,
      alias: 'a'
    })
    .option('skip-issues-with-prs', {
      type: 'boolean',
      description: 'Skip issues that already have open pull requests',
      default: false,
      alias: 's'
    })
    .option('concurrency', {
      type: 'number',
      description: 'Number of concurrent solve instances',
      default: 2,
      alias: 'c'
    })
    .option('pull-requests-per-issue', {
      type: 'number',
      description: 'Number of pull requests to generate per issue',
      default: 1,
      alias: 'p'
    })
    .option('model', {
      type: 'string',
      description: 'Model to use for solve (opus, sonnet, haiku, or any model ID supported by the tool)',
      alias: 'm',
      default: (currentParsedArgs) => {
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
    .option('interval', {
      type: 'number',
      description: 'Polling interval in seconds',
      default: 300, // 5 minutes
      alias: 'i'
    })
    .option('max-issues', {
      type: 'number',
      description: 'Maximum number of issues to process (0 = unlimited)',
      default: 0
    })
    .option('dry-run', {
      type: 'boolean',
      description: 'List issues that would be processed without actually processing them',
      default: false
    })
    .option('skip-tool-check', {
      type: 'boolean',
      description: 'Skip tool connection check (useful in CI environments)',
      default: false
    })
    .option('skip-claude-check', {
      type: 'boolean',
      description: 'Alias for --skip-tool-check (kept for CI/tests compatibility)',
      default: false
    })
    .option('tool-check', {
      type: 'boolean',
      description: 'Perform tool connection check (enabled by default, use --no-tool-check to skip)',
      default: true,
      hidden: true
    })
    .option('tool', {
      type: 'string',
      description: 'AI tool to use for solving issues',
      choices: ['claude', 'opencode', 'openai'],
      default: 'claude'
    })
    .option('verbose', {
      type: 'boolean',
      description: 'Enable verbose logging',
      alias: 'v',
      default: false
    })
    .option('once', {
      type: 'boolean',
      description: 'Run once and exit instead of continuous monitoring',
      default: false
    })
    .option('min-disk-space', {
      type: 'number',
      description: 'Minimum required disk space in MB (default: 500)',
      default: 500
    })
    .option('auto-cleanup', {
      type: 'boolean',
      description: 'Automatically clean temporary directories (/tmp/* /var/tmp/*) when finished successfully',
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
      description: 'Automatically fork public repos without write access (passed to solve command)',
      default: false
    })
    .option('attach-logs', {
      type: 'boolean',
      description: 'Upload the solution draft log file to the Pull Request on completion (⚠️ WARNING: May expose sensitive data)',
      default: false
    })
    .option('project-number', {
      type: 'number',
      description: 'GitHub Project number to monitor',
      alias: 'pn'
    })
    .option('project-owner', {
      type: 'string',
      description: 'GitHub Project owner (organization or user)',
      alias: 'po'
    })
    .option('project-status', {
      type: 'string',
      description: 'Project status column to monitor (e.g., "Ready", "To Do")',
      alias: 'ps',
      default: 'Ready'
    })
    .option('project-mode', {
      type: 'boolean',
      description: 'Enable project-based monitoring instead of label-based',
      alias: 'pm',
      default: false
    })
    .option('youtrack-mode', {
      type: 'boolean',
      description: 'Enable YouTrack mode instead of GitHub issues',
      default: false
    })
    .option('youtrack-stage', {
      type: 'string',
      description: 'Override YouTrack stage to monitor (overrides YOUTRACK_STAGE env var)'
    })
    .option('youtrack-project', {
      type: 'string',
      description: 'Override YouTrack project code (overrides YOUTRACK_PROJECT_CODE env var)'
    })
    .option('target-branch', {
      type: 'string',
      description: 'Target branch for pull requests (defaults to repository default branch)',
      alias: 'tb'
    })
    .option('log-dir', {
      type: 'string',
      description: 'Directory to save log files (defaults to current working directory)',
      alias: 'l'
    })
    .option('auto-continue', {
      type: 'boolean',
      description: 'Pass --auto-continue to solve for each issue (continues with existing PRs instead of creating new ones)',
      default: false
    })
    .option('think', {
      type: 'string',
      description: 'Thinking level: low (Think.), medium (Think hard.), high (Think harder.), max (Ultrathink.)',
      choices: ['low', 'medium', 'high', 'max'],
      default: undefined
    })
    .option('sentry', {
      type: 'boolean',
      description: 'Enable Sentry error tracking and monitoring (use --no-sentry to disable)',
      default: true
    })
    .option('watch', {
      type: 'boolean',
      description: 'Monitor continuously for feedback and auto-restart when detected (stops when PR is merged)',
      alias: 'w',
      default: false
    })
    .option('issue-order', {
      type: 'string',
      description: 'Order issues by publication date: "asc" (oldest first) or "desc" (newest first)',
      alias: 'o',
      default: 'asc',
      choices: ['asc', 'desc']
    })
    .parserConfiguration({
      'boolean-negation': true,
      'strip-dashed': false,
      'strip-aliased': false,
      'populate--': false
    })
    .showHelpOnFail(false)  // Don't show help on validation failures
    .strict()
    .help('h')
    .alias('h', 'help');
};
