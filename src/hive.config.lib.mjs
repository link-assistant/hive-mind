// CLI configuration module for hive command
// Extracted from hive.mjs to avoid loading heavy dependencies (instrument.mjs, etc.)
// when only the yargs configuration is needed (e.g., in telegram-bot.mjs)
// This module has no heavy dependencies to allow fast loading for --help

export const createYargsConfig = yargsInstance => {
  return yargsInstance
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
    })
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
    .option('model', {
      type: 'string',
      description: 'Model to use for solve (opus, sonnet, haiku, haiku-3-5, haiku-3, or any model ID supported by the tool)',
      alias: 'm',
      default: 'sonnet',
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
    .option('dry-run', {
      type: 'boolean',
      description: 'List issues that would be processed without actually processing them',
      default: false,
    })
    .option('skip-tool-connection-check', {
      type: 'boolean',
      description: 'Skip tool connection check (useful in CI environments). Does NOT skip model validation.',
      default: false,
    })
    .option('skip-tool-check', {
      type: 'boolean',
      description: 'Alias for --skip-tool-connection-check (deprecated, use --skip-tool-connection-check instead)',
      default: false,
      hidden: true,
    })
    .option('skip-claude-check', {
      type: 'boolean',
      description: 'Alias for --skip-tool-connection-check (deprecated)',
      default: false,
      hidden: true,
    })
    .option('tool-connection-check', {
      type: 'boolean',
      description: 'Perform tool connection check (enabled by default, use --no-tool-connection-check to skip). Does NOT affect model validation.',
      default: true,
      hidden: true,
    })
    .option('tool-check', {
      type: 'boolean',
      description: 'Alias for --tool-connection-check (deprecated)',
      default: true,
      hidden: true,
    })
    .option('tool', {
      type: 'string',
      description: 'AI tool to use for solving issues',
      choices: ['claude', 'opencode', 'agent'],
      default: 'claude',
    })
    .option('verbose', {
      type: 'boolean',
      description: 'Enable verbose logging',
      alias: 'v',
      default: false,
    })
    .option('once', {
      type: 'boolean',
      description: 'Run once and exit instead of continuous monitoring',
      default: false,
    })
    .option('min-disk-space', {
      type: 'number',
      description: 'Minimum required disk space in MB (default: 2048)',
      default: 2048,
    })
    .option('auto-cleanup', {
      type: 'boolean',
      description: 'Automatically clean temporary directories (/tmp/* /var/tmp/*) when finished successfully',
      default: false,
    })
    .option('fork', {
      type: 'boolean',
      description: "Fork the repository if you don't have write access",
      alias: 'f',
      default: false,
    })
    .option('auto-fork', {
      type: 'boolean',
      description: 'Automatically fork public repos without write access (passed to solve command)',
      default: true,
    })
    .option('attach-logs', {
      type: 'boolean',
      description: 'Upload the solution draft log file to the Pull Request on completion (⚠️ WARNING: May expose sensitive data)',
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
    .option('log-dir', {
      type: 'string',
      description: 'Directory to save log files (defaults to current working directory)',
      alias: 'l',
    })
    .option('auto-continue', {
      type: 'boolean',
      description: 'Pass --auto-continue to solve for each issue (continues with existing PRs instead of creating new ones)',
      default: true,
    })
    .option('auto-resume-on-limit-reset', {
      type: 'boolean',
      description: 'Automatically resume when AI tool limit resets (calculates reset time and waits). Passed to solve command.',
      default: false,
    })
    .option('think', {
      type: 'string',
      description: 'Thinking level for Claude. Translated to --thinking-budget for Claude Code >= 2.1.12 (off=0, low=~8000, medium=~16000, high=~24000, max=31999). For older versions, uses thinking keywords.',
      choices: ['off', 'low', 'medium', 'high', 'max'],
      default: undefined,
    })
    .option('thinking-budget', {
      type: 'number',
      description: 'Thinking token budget for Claude Code (0-63999). Controls MAX_THINKING_TOKENS. Default: 31999 (Claude default). Set to 0 to disable thinking.',
      default: undefined,
    })
    .option('max-thinking-budget', {
      type: 'number',
      description: 'Maximum thinking budget for calculating --think level mappings (default: 31999 for Claude Code). Values: off=0, low=max/4, medium=max/2, high=max*3/4, max=max.',
      default: 31999,
    })
    .option('prompt-plan-sub-agent', {
      type: 'boolean',
      description: 'Encourage AI to use Plan sub-agent for initial planning (only works with --tool claude)',
      default: false,
    })
    .option('sentry', {
      type: 'boolean',
      description: 'Enable Sentry error tracking and monitoring (use --no-sentry to disable)',
      default: true,
    })
    .option('watch', {
      type: 'boolean',
      description: 'Monitor continuously for feedback and auto-restart when detected (stops when PR is merged)',
      alias: 'w',
      default: false,
    })
    .option('auto-merge', {
      type: 'boolean',
      description: 'Automatically merge the pull request when the working session is finished and all CI/CD statuses pass and PR is mergeable. Implies --auto-restart-until-mergable.',
      default: false,
    })
    .option('auto-restart-until-mergable', {
      type: 'boolean',
      description: 'Auto-restart until PR becomes mergeable (no iteration limit). Restarts on new comments from non-bot users, CI failures, merge conflicts, or other issues. Does NOT auto-merge.',
      default: false,
    })
    .option('issue-order', {
      type: 'string',
      description: 'Order issues by publication date: "asc" (oldest first) or "desc" (newest first)',
      alias: 'o',
      default: 'asc',
      choices: ['asc', 'desc'],
    })
    .option('prefix-fork-name-with-owner-name', {
      type: 'boolean',
      description: 'Prefix fork name with original owner name (e.g., "owner-repo" instead of "repo"). Useful when forking repositories with same name from different owners.',
      default: true,
    })
    .option('interactive-mode', {
      type: 'boolean',
      description: '[EXPERIMENTAL] Post Claude output as PR comments in real-time. Only supported for --tool claude.',
      default: false,
    })
    .option('prompt-explore-sub-agent', {
      type: 'boolean',
      description: 'Encourage Claude to use Explore sub-agent for codebase exploration. Only supported for --tool claude.',
      default: false,
    })
    .option('prompt-general-purpose-sub-agent', {
      type: 'boolean',
      description: 'Prompt AI to use general-purpose sub agents for processing large tasks with multiple files/folders. Only supported for --tool claude.',
      default: false,
    })
    .option('tokens-budget-stats', {
      type: 'boolean',
      description: '[EXPERIMENTAL] Show detailed token budget statistics including context window usage and ratios. Only supported for --tool claude.',
      default: false,
    })
    .option('prompt-issue-reporting', {
      type: 'boolean',
      description: 'Enable automatic issue creation for spotted bugs/errors not related to main task. Issues will include reproducible examples, workarounds, and fix suggestions. Works for both current and third-party repositories. Only supported for --tool claude.',
      default: false,
    })
    .option('prompt-case-studies', {
      type: 'boolean',
      description: 'Create comprehensive case study documentation for the issue including logs, analysis, timeline, root cause investigation, and proposed solutions. Organizes findings into ./docs/case-studies/issue-{id}/ directory. Only supported for --tool claude.',
      default: false,
    })
    .option('prompt-playwright-mcp', {
      type: 'boolean',
      description: 'Enable Playwright MCP browser automation hints in system prompt (enabled by default, only takes effect if Playwright MCP is installed). Use --no-prompt-playwright-mcp to disable. Only supported for --tool claude.',
      default: true,
    })
    .option('prompt-check-sibling-pull-requests', {
      type: 'boolean',
      description: 'Include prompt to check related/sibling pull requests when studying related work. Enabled by default, use --no-prompt-check-sibling-pull-requests to disable.',
      default: true,
    })
    .option('prompt-experiments-folder', {
      type: 'string',
      description: 'Path to experiments folder used in system prompt. Set to empty string to disable experiments folder prompt. Default: ./experiments',
      default: './experiments',
    })
    .option('prompt-examples-folder', {
      type: 'string',
      description: 'Path to examples folder used in system prompt. Set to empty string to disable examples folder prompt. Default: ./examples',
      default: './examples',
    })
    .option('prompt-architecture-care', {
      type: 'boolean',
      description: '[EXPERIMENTAL] Include guidance for managing REQUIREMENTS.md and ARCHITECTURE.md files. When enabled, agents will update these documentation files when changes affect requirements or architecture.',
      default: false,
    })
    .option('execute-tool-with-bun', {
      type: 'boolean',
      description: 'Execute the AI tool using bunx (experimental, may improve speed and memory usage) - passed to solve command',
      default: false,
    })
    // Solve-passthrough options: These options are forwarded to the solve command.
    // They are defined here so that TELEGRAM_HIVE_OVERRIDES can include them
    // and they can be passed through hive to solve without validation errors.
    // See: https://github.com/link-assistant/hive-mind/issues/1209
    .option('claude-file', {
      type: 'boolean',
      description: 'Create CLAUDE.md file for task details (passed to solve, default for --tool claude, mutually exclusive with --gitkeep-file)',
      default: undefined,
    })
    .option('gitkeep-file', {
      type: 'boolean',
      description: 'Create .gitkeep file instead of CLAUDE.md (passed to solve, default for --tool agent/opencode/codex, mutually exclusive with --claude-file)',
      default: undefined,
    })
    .option('auto-gitkeep-file', {
      type: 'boolean',
      description: 'Automatically use .gitkeep if CLAUDE.md is in .gitignore (passed to solve)',
      default: undefined,
    })
    .option('auto-close-pull-request-on-fail', {
      type: 'boolean',
      description: 'Automatically close the pull request if execution fails (passed to solve)',
      default: false,
    })
    .option('auto-restart-on-limit-reset', {
      type: 'boolean',
      description: 'Automatically restart when AI tool limit resets (fresh start without --resume flag, passed to solve)',
      default: false,
    })
    .option('auto-resume-on-errors', {
      type: 'boolean',
      description: 'Automatically resume on network errors (503, etc.) with exponential backoff (passed to solve)',
      default: false,
    })
    .option('auto-continue-only-on-new-comments', {
      type: 'boolean',
      description: 'Explicitly fail on absence of new comments in auto-continue or continue mode (passed to solve)',
      default: false,
    })
    .option('auto-commit-uncommitted-changes', {
      type: 'boolean',
      description: 'Automatically commit and push uncommitted changes made by AI tool (passed to solve)',
      default: false,
    })
    .option('auto-restart-on-uncommitted-changes', {
      type: 'boolean',
      description: 'Automatically restart when uncommitted changes are detected (passed to solve)',
      default: undefined,
    })
    .option('auto-restart-max-iterations', {
      type: 'number',
      description: 'Maximum number of auto-restart iterations when uncommitted changes are detected (passed to solve)',
      default: undefined,
    })
    .option('auto-restart-on-non-updated-pull-request-description', {
      type: 'boolean',
      description: 'Automatically restart if PR title or description still contains placeholder text (passed to solve)',
      default: false,
    })
    .option('continue-only-on-feedback', {
      type: 'boolean',
      description: 'Only continue if feedback is detected (passed to solve)',
      default: false,
    })
    .option('watch-interval', {
      type: 'number',
      description: 'Interval in seconds for checking feedback in watch mode (passed to solve)',
      default: undefined,
    })
    .option('thinking-budget-claude-minimum-version', {
      type: 'string',
      description: 'Minimum Claude Code version that supports --thinking-budget (passed to solve)',
      default: undefined,
    })
    .option('base-branch', {
      type: 'string',
      description: 'Target branch for the pull request (passed to solve as --base-branch, defaults to repository default branch)',
      alias: 'b',
    })
    .option('auto-merge-default-branch-to-pull-request-branch', {
      type: 'boolean',
      description: 'Automatically merge the default branch to the PR branch when continuing work (passed to solve)',
      default: false,
    })
    .option('allow-fork-divergence-resolution-using-force-push-with-lease', {
      type: 'boolean',
      description: 'Allow automatic force-push when fork diverges from upstream (passed to solve)',
      default: false,
    })
    .option('allow-to-push-to-contributors-pull-requests-as-maintainer', {
      type: 'boolean',
      description: 'Push directly to contributor fork if "Allow edits by maintainers" is enabled (passed to solve)',
      default: false,
    })
    .option('enable-workspaces', {
      type: 'boolean',
      description: 'Use separate workspace directory structure (passed to solve)',
      default: false,
    })
    .option('playwright-mcp-auto-cleanup', {
      type: 'boolean',
      description: 'Automatically remove .playwright-mcp/ folder before checking for uncommitted changes (passed to solve)',
      default: undefined,
    })
    .option('auto-gh-configuration-repair', {
      type: 'boolean',
      description: 'Automatically repair git configuration using gh-setup-git-identity (passed to solve)',
      default: false,
    })
    .option('prompt-subagents-via-agent-commander', {
      type: 'boolean',
      description: 'Guide Claude to use agent-commander CLI instead of native Task tool (passed to solve)',
      default: false,
    })
    .option('auto-pull-request-creation', {
      type: 'boolean',
      description: 'Automatically create a draft pull request before running AI tool (passed to solve)',
      default: undefined,
    })
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
};
