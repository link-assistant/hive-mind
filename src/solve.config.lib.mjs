// CLI configuration module for solve command
// Extracted from solve.mjs to keep files under 1500 lines

// This module expects 'use' to be passed in from the parent module
// to avoid duplicate use-m initialization issues

// Note: Strict options validation is now handled by yargs built-in .strict() mode (see below)
// This approach was adopted per issue #482 feedback to minimize custom code maintenance

import { enhanceErrorMessage, detectMalformedFlags } from './option-suggestions.lib.mjs';
import { defaultModels, buildModelOptionDescription, resolveDefaultFallbackModel, resolveRuntimeDefaultModel } from './models/index.mjs';
import { validateBranchName } from './solve.branch.lib.mjs';
import { getLinoYargsFactory, hideBin, parseCliArgumentsWithLino } from './cli-arguments.lib.mjs';

// Re-export for use by telegram-bot.mjs (avoids extra import lines there)
export { detectMalformedFlags };

// Export an initialization function that accepts 'use'
export const initializeConfig = async () => ({ yargs: getLinoYargsFactory(), hideBin });

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
    description: 'Create CLAUDE.md file for task details (mutually exclusive with --gitkeep-file)',
    default: false,
  },
  'gitkeep-file': {
    type: 'boolean',
    description: 'Create .gitkeep file instead of CLAUDE.md (default for all --tool values, mutually exclusive with --claude-file)',
    default: true,
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
    description: 'Maximum number of auto-restart iterations before stopping (default: 5, 0 = unlimited)',
    default: 5,
  },
  'auto-resume-max-iterations': {
    type: 'number',
    description: 'Maximum number of automatic resume/restart continuations after usage-limit resets (default: 5, 0 = unlimited)',
    default: 5,
  },
  'auto-resume-iteration': {
    type: 'number',
    description: 'Internal: current automatic resume/restart continuation count',
    default: 0,
    hidden: true,
  },
  'auto-merge': {
    type: 'boolean',
    description: 'Automatically merge the pull request when the working session is finished and all CI/CD statuses pass and PR is mergeable. Implies --auto-restart-until-mergeable.',
    default: false,
  },
  'auto-restart-until-mergeable': {
    type: 'boolean',
    description: 'Auto-restart until PR becomes mergeable (no iteration limit). Restarts on new comments from non-bot users, CI failures, merge conflicts, or other issues. Does NOT auto-merge.',
    default: true,
  },
  // Issue #1708: Stage 1 introduces this flag inert — it parses, appears in
  // --help, and is read by validateAutoInputUntilMergeable below, but does not
  // change the runtime loop yet. Stages 2-6 will wire it into watchUntilMergeable
  // and the bidirectional NDJSON pipe (see docs/case-studies/issue-1708/).
  'auto-input-until-mergeable': {
    type: 'boolean',
    description: '[EXPERIMENTAL] Extend a single AI tool session as long as possible by streaming new input (uncommitted changes, CI/CD failures, PR/issue comments, issue title/body updates) directly into the running session, instead of restarting it. Implies --accept-incomming-comments-as-input and --queue-comments-to-input by default (comments are deferred until the AI finishes the current step and is waiting for input). Existing auto-restart/auto-resume loops remain enabled as a fallback, but the goal is to keep them dormant. The full streaming-aware watchUntilMergeable replacement and per-tool wiring is staged in subsequent PRs (see docs/case-studies/issue-1708/). Falls back gracefully on non-Claude tools and on streaming errors. Disabled by default.',
    default: false,
  },
  'wait-for-all-actions-in-repository-before-mergeable': {
    type: 'boolean',
    description: 'Wait for ALL active GitHub Actions workflow runs in the entire repository to complete before declaring PR mergeable. When enabled, blocks merge if ANY CI/CD run in the repository is active, regardless of branch — this is a strict safety mode for repositories with cross-branch CI/CD coupling. Disabled by default.',
    default: false,
  },
  'wait-for-all-actions-in-repository-before-mergable': {
    type: 'boolean',
    description: 'Deprecated alias for --wait-for-all-actions-in-repository-before-mergeable (fixes typo).',
    hidden: true,
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
    description: 'Thinking level hint. For Claude, translated to --thinking-budget for Claude Code >= 2.1.12 (off=0, low=~8000, medium=~16000, high=~24000, xhigh/max=31999) and to CLAUDE_CODE_EFFORT_LEVEL when supported. Opus 4.7 supports xhigh and max; Opus 4.6/Sonnet 4.6/Mythos support max; Opus 4.5 uses high for xhigh/max. For Codex, mapped to reasoning effort (off=none, low=low, medium=medium, high=high, xhigh/max=xhigh).',
    choices: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
    default: undefined,
  },
  'thinking-budget': {
    type: 'number',
    description: 'Thinking token budget. For Claude Code, controls MAX_THINKING_TOKENS (0-31999 by default). For Codex, enables finer reasoning-effort mapping including minimal/low/medium/high/xhigh.',
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
  'sub-session-size': {
    type: 'string',
    description: 'Cap on sub-session size between auto-compaction events. Accepts a token count (e.g. 150k, 1m, 200000), a percentage of the model context window (e.g. 50%), or "default" to keep the tool\'s built-in threshold. Default: 150k. For Claude this maps to CLAUDE_CODE_AUTO_COMPACT_WINDOW + CLAUDE_AUTOCOMPACT_PCT_OVERRIDE env vars. For Codex this maps to -c model_auto_compact_token_limit. (Issue #1706)',
    default: '150k',
  },
  'disable-1m-context': {
    type: 'boolean',
    description: 'Disable 1M extended context window so the model uses its standard 200K-400K window. Helps preserve reasoning quality and reduces cost. Default: true. For Claude this sets CLAUDE_CODE_DISABLE_1M_CONTEXT=1 (also forbids the [1m] model-name suffix). For Codex this sets -c model_context_window=200000. Use --no-disable-1m-context to allow the 1M window. (Issue #1706)',
    default: true,
  },
  'fallback-model': {
    type: 'string',
    description: 'Fallback model to switch to on model capacity/overload errors. When supported, retries resume the same session with this model. Defaults: claude opus/opus-4-7 -> opus-4-6; codex gpt-5.5 -> gpt-5.4; all others unset.',
    default: undefined,
  },
  'show-thinking-content': {
    type: 'boolean',
    description: 'Show thinking content in Claude responses. Opus 4.7 omits thinking content by default; this option opts in to receive summarized thinking blocks. Disabled by default. Only affects --tool claude.',
    default: false,
  },
  'prompt-plan-sub-agent': {
    type: 'boolean',
    description: 'Encourage AI to use a planning sub-agent or planning workflow for initial planning. Supported for --tool claude and --tool codex.',
    default: false,
  },
  'base-branch': {
    type: 'string',
    description: 'Target branch for the pull request (defaults to repository default branch)',
    alias: 'b',
  },
  sentry: {
    type: 'boolean',
    description: 'Enable Sentry error tracking and monitoring (disabled by default for privacy; use --sentry to enable)',
    default: false,
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
  'allow-force-non-fork-repository-deletion': {
    type: 'boolean',
    description: 'Allow deletion of non-fork repositories even when they contain additional commits that would be lost (DANGEROUS: data loss possible)',
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
    choices: ['claude', 'opencode', 'codex', 'agent', 'qwen'],
    default: 'claude',
  },
  plan: {
    type: 'boolean',
    description: 'Enable plan mode: uses opus for planning, sonnet for execution (shortcut for --plan-model opus --worker-model sonnet). Only works with --tool claude.',
    default: false,
  },
  'plan-model': {
    type: 'string',
    description: 'Model to use for plan mode (e.g., opus). When specified, auto-switches to opusplan mode and sets ANTHROPIC_DEFAULT_OPUS_MODEL. Use with --model/--worker-model to set separate plan and execution models (e.g., --plan-model opus --model sonnet). Only works with --tool claude.',
    default: undefined,
  },
  'worker-model': {
    type: 'string',
    description: 'Alias for --model: Model to use for execution/worker mode when --plan-model is specified. When used with --plan-model, sets ANTHROPIC_DEFAULT_SONNET_MODEL for Claude Code opusplan mode.',
    default: undefined,
  },
  'execute-tool-with-bun': {
    type: 'boolean',
    description: 'Execute the AI tool using bunx (experimental, may improve speed and memory usage)',
    default: false,
  },
  'enable-workspaces': {
    type: 'boolean',
    description: 'Use separate workspace directory structure with repository/ and tmp/ folders. Works with all tools (claude, opencode, codex, agent, qwen). Experimental feature.',
    default: false,
  },
  'interactive-mode': {
    type: 'boolean',
    description: '[EXPERIMENTAL] Post tool output as PR comments in real-time. Supported for --tool claude and --tool codex.',
    default: false,
  },
  // Issue #817: Bidirectional interactive options
  'accept-incomming-comments-as-input': {
    type: 'boolean',
    description: '[EXPERIMENTAL] Accept new PR/issue comments as input for Claude during execution (excludes outgoing comments generated by solve itself). Does not require --interactive-mode; disabled by default. Only supported for --tool claude.',
    default: false,
  },
  'exclude-all-own-incomming-comments-from-input': {
    type: 'boolean',
    description: '[EXPERIMENTAL] When combined with --accept-incomming-comments-as-input, also exclude comments written by the same GitHub user that solve runs as (prevents self-talk). Disabled by default.',
    default: false,
  },
  'bidirectional-interactive-mode': {
    type: 'boolean',
    description: '[EXPERIMENTAL] Convenience flag that enables --interactive-mode, --accept-incomming-comments-as-input and --exclude-all-own-incomming-comments-from-input together. Only supported for --tool claude.',
    default: false,
  },
  // Issue #1708: Comment delivery mode for --accept-incomming-comments-as-input.
  // --stream-comments-to-input: forward comments immediately as they arrive
  //   (the default for --accept-incomming-comments-as-input on its own; matches
  //   the existing #817 behavior of pushing comments to Claude as soon as
  //   pollIncomingComments sees them).
  // --queue-comments-to-input: hold comments until the AI signals it is idle
  //   (waiting for input), then flush the queue. Used by
  //   --auto-input-until-mergeable so the model finishes the current step
  //   before getting interrupted with new instructions.
  // The two flags are mutually exclusive; if both are set, queue mode wins.
  'stream-comments-to-input': {
    type: 'boolean',
    description: '[EXPERIMENTAL] When --accept-incomming-comments-as-input is enabled, forward each new PR/issue comment to the AI immediately as it arrives (real-time streaming). This is the default behavior for --accept-incomming-comments-as-input on its own. Mutually exclusive with --queue-comments-to-input; queue mode wins if both are set. Only supported for --tool claude.',
    default: false,
  },
  'queue-comments-to-input': {
    type: 'boolean',
    description: '[EXPERIMENTAL] When --accept-incomming-comments-as-input is enabled, queue new PR/issue comments and only flush them once the AI signals it is idle (waiting for input). This is the default mode implied by --auto-input-until-mergeable so the AI completes the current step before being interrupted with new instructions. Mutually exclusive with --stream-comments-to-input; queue mode wins if both are set. Only supported for --tool claude.',
    default: false,
  },
  'prompt-explore-sub-agent': {
    type: 'boolean',
    description: 'Encourage AI to use Explore-style sub-agent workflow for codebase exploration. Supported for --tool claude and --tool codex.',
    default: false,
  },
  'prompt-general-purpose-sub-agent': {
    type: 'boolean',
    description: 'Prompt AI to use general-purpose sub agents for processing large tasks with multiple files/folders. Supported for --tool claude and --tool codex.',
    default: false,
  },
  'tokens-budget-stats': {
    type: 'boolean',
    description: 'Show detailed token budget statistics including context window usage and ratios (enabled by default, use --no-tokens-budget-stats to disable). Supported for --tool claude, --tool codex, and any tool that returns detailed token usage.',
    default: true,
  },
  'prompt-issue-reporting': {
    type: 'boolean',
    description: 'Enable automatic issue creation for spotted bugs/errors not related to main task. Issues will include reproducible examples, workarounds, and fix suggestions. Works for both current and third-party repositories. Supported for --tool claude and --tool codex.',
    default: false,
  },
  'prompt-architecture-care': {
    type: 'boolean',
    description: '[EXPERIMENTAL] Include guidance for managing REQUIREMENTS.md and ARCHITECTURE.md files. When enabled, agents will update these documentation files when changes affect requirements or architecture.',
    default: false,
  },
  'prompt-case-studies': {
    type: 'boolean',
    description: 'Create comprehensive case study documentation for the issue including logs, analysis, timeline, root cause investigation, and proposed solutions. Organizes findings into ./docs/case-studies/issue-{id}/ directory. Supported for --tool claude and --tool codex.',
    default: false,
  },
  'prompt-playwright-mcp': {
    type: 'boolean',
    description: 'Enable Playwright MCP browser automation hints in system prompt (enabled by default, only takes effect if Playwright MCP is installed). Use --no-prompt-playwright-mcp to disable. Supported for --tool claude, --tool codex, --tool opencode, --tool agent, and --tool qwen.',
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
  'playwright-mcp': {
    type: 'boolean',
    description: 'Enable Playwright MCP server connection for this session (enabled by default). Use --no-playwright-mcp to physically disable the Playwright MCP server without affecting the global MCP registration. When disabled, also disables --prompt-playwright-mcp and --playwright-mcp-auto-cleanup. Supported for --tool claude, --tool codex, --tool opencode, --tool agent, and --tool qwen.',
    default: true,
  },
  'playwright-mcp-auto-cleanup': {
    type: 'boolean',
    description: 'Automatically remove .playwright-mcp/ folder before checking for uncommitted changes. This prevents browser automation artifacts from triggering auto-restart. Use --no-playwright-mcp-auto-cleanup to keep the folder for debugging.',
    default: true,
  },
  'useless-tools-disabled': {
    type: 'boolean',
    description: 'Disable Claude Code built-in tools and MCP servers that have no value (and may be harmful) in autonomous headless runs: AskUserQuestion, CronCreate/Delete/List, EnterPlanMode/ExitPlanMode, EnterWorktree/ExitWorktree, Monitor, NotebookEdit, PushNotification, RemoteTrigger, ScheduleWakeup, and the claude.ai Gmail/Drive/Calendar OAuth connectors. Default: true. Use --no-useless-tools-disabled to keep them enabled. Supported for --tool claude (issue #1627).',
    default: true,
  },
  'auto-gh-configuration-repair': {
    type: 'boolean',
    description: 'Automatically repair git configuration using gh-setup-git-identity --repair when git identity is not configured. Requires gh-setup-git-identity to be installed.',
    default: false,
  },
  'prompt-subagents-via-agent-commander': {
    type: 'boolean',
    description: 'Guide AI to use agent-commander CLI (start-agent) instead of native tool-specific delegation for subagent work. Allows using any supported agent type (claude, opencode, codex, agent, qwen) with a unified API. Supported for --tool claude and --tool codex and requires agent-commander to be installed.',
    default: false,
  },
  'auto-init-repository': {
    type: 'boolean',
    description: 'Automatically initialize empty repositories by creating a simple README.md file. Only works when you have write access to the repository. This allows branch creation and pull request workflows to proceed on repositories that have no commits.',
    default: false,
  },
  'auto-report-issue': {
    type: 'boolean',
    description: 'Automatically create a GitHub issue on failure without prompting (non-interactive mode). The issue includes error details, logs, and case study analysis instructions. Sets issue type and label to bug.',
    default: false,
  },
  'disable-report-issue': {
    type: 'boolean',
    description: 'Disable error issue creation entirely (no prompt, no automatic creation). Overrides --auto-report-issue if both are specified.',
    default: false,
  },
  'attach-solution-summary': {
    type: 'boolean',
    description: 'Attach the AI working session summary (from the result field) as a comment to the PR/issue after every working session. The summary is extracted from the AI tool JSON output and posted under a "Working session summary" header. Applies to the top-level run, auto-restart-until-mergeable iterations, and watch-mode iterations.',
    default: false,
  },
  'auto-attach-solution-summary': {
    type: 'boolean',
    description: 'Automatically attach a "Working session summary" comment at the end of any working session in which the AI did not create any comments itself. This provides visible feedback when the AI completes silently, including inside auto-restart-until-mergeable and watch-mode iterations. Enabled by default; use --no-auto-attach-solution-summary to disable.',
    default: true,
  },
  'auto-accept-invite': {
    type: 'boolean',
    description: 'Automatically accept the pending GitHub repository or organization invitation for the specific repository/organization being solved, before checking write access. Unlike /accept_invites which accepts all pending invitations, this only accepts the invite for the target repo/org. Enabled by default; use --no-auto-accept-invite to disable.',
    default: true,
  },
  'prompt-ensure-all-requirements-are-met': {
    type: 'boolean',
    description: '[EXPERIMENTAL] Add a prompt hint to the system prompt to ensure all changes are correct, consistent, validated, tested, logged and fully meet all discussed requirements. Enabled automatically by --finalize during finalize cycle iterations only.',
    default: false,
  },
  finalize: {
    type: 'number',
    description: '[EXPERIMENTAL] After the main solve completes, automatically restart the AI tool N times (default: 1) with a requirements-check prompt to verify all requirements are met. Use --finalize-model to override the model for finalize iterations.',
    default: 0,
  },
  'finalize-model': {
    type: 'string',
    description: '[EXPERIMENTAL] Model to use for --finalize iterations. Defaults to the same model as --model.',
    default: undefined,
  },
  'working-session-live-progress': {
    type: 'string',
    description: '[EXPERIMENTAL] Enable live progress monitoring. Accepts "comment" (default, updates a per-session PR comment) or "pr" (updates PR description). Plain --working-session-live-progress means "comment". Works with or without --interactive-mode.',
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
      description: buildModelOptionDescription(),
      alias: ['m', 'worker-model'],
      default: currentParsedArgs => {
        // Dynamic default based on tool selection (Issue #1473: centralized in models/index.mjs)
        return defaultModels[currentParsedArgs?.tool] || defaultModels.claude;
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
export const parseArguments = async (yargs = getLinoYargsFactory(), hideBinFn = hideBin) => {
  const rawArgs = hideBinFn(process.argv);

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
      argv = parseCliArgumentsWithLino({
        argv: process.argv,
        commandName: 'solve',
        createYargsConfig,
        positionalAliases: ['issue-url'],
      });
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
  const modelExplicitlyProvided = rawArgs.includes('--model') || rawArgs.includes('-m') || rawArgs.includes('--worker-model');
  const fallbackModelExplicitlyProvided = rawArgs.includes('--fallback-model');
  const planModelExplicitlyProvided = rawArgs.includes('--plan-model');

  // --plan flag expansion (Issue #1223)
  // When --plan is set, it acts as a shortcut for --plan-model opus --worker-model sonnet
  // Explicit --plan-model and --model/--worker-model values take precedence
  if (argv && argv.plan) {
    if (!planModelExplicitlyProvided) {
      argv.planModel = 'opus';
    }
    if (!modelExplicitlyProvided) {
      argv.model = 'sonnet';
    }
  }

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

  // --finalize normalization
  // Issue #1383: When finalize is enabled (as boolean or number), normalize to iteration count
  // NOTE: promptEnsureAllRequirementsAreMet is NOT set here — it is only enabled during
  // the finalize cycle iterations themselves (not the first regular worker model run)
  if (argv && argv.finalize) {
    // Normalize: if passed as boolean true (flag without value), treat as 1 iteration
    if (argv.finalize === true) {
      argv.finalize = 1;
    }
  }

  // --working-session-live-progress normalization
  // When passed as --working-session-live-progress (no value), yargs gives true for string type
  // Normalize: true → "comment", validate known values
  if (argv && argv.workingSessionLiveProgress) {
    const val = argv.workingSessionLiveProgress;
    if (val === true || val === 'true') {
      argv.workingSessionLiveProgress = 'comment';
    } else if (typeof val === 'string' && !['comment', 'pr'].includes(val.toLowerCase())) {
      throw new Error(`Invalid --working-session-live-progress value: "${val}". Expected "comment" or "pr".`);
    } else if (typeof val === 'string') {
      argv.workingSessionLiveProgress = val.toLowerCase();
    }
  }

  // Validate --base-branch value (issue #1482: reject URLs and invalid git branch names)
  if (argv.baseBranch) {
    const branchValidation = validateBranchName(argv.baseBranch);
    if (!branchValidation.valid) {
      throw new Error(`Invalid --base-branch value: ${branchValidation.reason}`);
    }
  }

  if (argv.tool && !modelExplicitlyProvided && defaultModels[argv.tool]) {
    // User did not explicitly provide --model, so use the correct default for the tool
    // (Issue #1473: centralized in models/index.mjs)
    argv.model = await resolveRuntimeDefaultModel(argv.tool);
  }

  if (argv.tool && !fallbackModelExplicitlyProvided) {
    const defaultFallbackModel = resolveDefaultFallbackModel(argv.tool, argv.model);
    argv.fallbackModel = defaultFallbackModel || undefined;
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

  // If user explicitly set --no-gitkeep-file, enable claude-file
  if (noGitkeepFile && !argv.claudeFile) {
    argv.claudeFile = true;
    argv.gitkeepFile = false;
  }

  return argv;
};
