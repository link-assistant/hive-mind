// CLI configuration module for the telegram-bot command.
// Extracted from telegram-bot.mjs so the option surface can be reviewed, tested
// and reused without loading the bot itself.
//
// Defaults read the environment through getenv() when createYargsConfig() runs,
// so callers must load .env/.lenv configuration before calling it.

import { getenv } from './cli-arguments.lib.mjs';

export const createYargsConfig = yargsInstance =>
  yargsInstance
    .usage('Usage: hive-telegram-bot [options]')
    .option('configuration', {
      type: 'string',
      description: 'LINO configuration string for environment variables',
      alias: 'c',
      default: getenv('TELEGRAM_CONFIGURATION', ''),
    })
    .option('configurationFile', {
      type: 'string',
      description: 'Path to a private LINO configuration file (chmod 600)',
      alias: 'configuration-file',
      default: getenv('HIVE_MIND_CONFIGURATION_FILE', ''),
    })
    .option('token', {
      type: 'string',
      description: 'Telegram bot token from @BotFather',
      alias: 't',
      default: getenv('TELEGRAM_BOT_TOKEN', ''),
    })
    .option('allowedChats', {
      type: 'string',
      description: 'Allowed chat IDs in lino notation, e.g., "(\n  123456789\n  987654321\n)"',
      alias: 'allowed-chats',
      default: getenv('TELEGRAM_ALLOWED_CHATS', ''),
    })
    .option('allowedTopics', {
      type: 'string',
      description: 'Allowed topic IDs in Links Notation format "chatId topicId" pairs',
      alias: 'allowed-topics',
      default: getenv('TELEGRAM_ALLOWED_TOPICS', ''),
    })
    .option('peerBots', {
      type: 'string',
      description: 'Known Hive Mind peers in Links Notation (chat ID, bot ID pairs)',
      alias: 'peer-bots',
      default: getenv('TELEGRAM_HIVE_MIND_PEER_BOTS', ''),
    })
    .option('solveOverrides', {
      type: 'string',
      description: 'Override options for /solve command in lino notation, e.g., "(\n  --auto-continue\n  --attach-logs\n)"',
      alias: 'solve-overrides',
      default: getenv('TELEGRAM_SOLVE_OVERRIDES', ''),
    })
    .option('hiveOverrides', {
      type: 'string',
      description: 'Override options for /hive command in lino notation, e.g., "(\n  --verbose\n  --all-issues\n)"',
      alias: 'hive-overrides',
      default: getenv('TELEGRAM_HIVE_OVERRIDES', ''),
    })
    .option('solve', {
      type: 'boolean',
      description: 'Enable /solve command (use --no-solve to disable)',
      default: getenv('TELEGRAM_SOLVE', 'true') !== 'false',
    })
    .option('hive', {
      type: 'boolean',
      description: 'Enable /hive command (use --no-hive to disable)',
      default: getenv('TELEGRAM_HIVE', 'true') !== 'false',
    })
    .option('task', {
      type: 'boolean',
      description: 'Enable /task and /split commands (use --no-task to disable)',
      default: getenv('TELEGRAM_TASK', 'true') !== 'false',
    })
    .option('fix', {
      type: 'boolean',
      description: 'Enable /fix command (use --no-fix to disable)',
      default: getenv('TELEGRAM_FIX', 'true') !== 'false',
    })
    .option('organize', {
      type: 'boolean',
      description: 'Enable /organize issue taxonomy command (use --no-organize to disable)',
      default: getenv('TELEGRAM_ORGANIZE', 'true') !== 'false',
    })
    .option('auth', {
      type: 'boolean',
      description: 'Enable experimental private /auth command for allowlisted chat owners (use --no-auth to disable)',
      default: getenv('TELEGRAM_AUTH', 'true') !== 'false',
    })
    .option('dryRun', {
      type: 'boolean',
      description: 'Validate configuration and options without starting the bot',
      alias: 'dry-run',
      default: false,
    })
    .option('verbose', {
      type: 'boolean',
      description: 'Enable verbose logging for debugging',
      alias: 'v',
      default: getenv('TELEGRAM_BOT_VERBOSE', 'false') === 'true',
    })
    .option('autoStartScreenWatchMessage', { type: 'boolean', description: 'Experimental: auto-start separate /terminal_watch messages for public /solve sessions', alias: 'auto-start-screen-watch-message', default: getenv('TELEGRAM_AUTO_START_SCREEN_WATCH_MESSAGE', getenv('TELEGRAM_AUTO_WATCH_MESSAGE', 'false')) === 'true' })
    // Issues #3354 to #3359: post-merge issue closing and the merged-PR sweeper, on by default.
    .option('autoCloseLinkedIssues', { type: 'boolean', description: 'After a merge (/merge, the merge queue, or a merge done outside Hive Mind found by the merged-PR sweeper), close every issue the PR description closes that GitHub left open; --no-auto-close-linked-issues only reports them', alias: 'auto-close-linked-issues', default: getenv('HIVE_MIND_AUTO_CLOSE_LINKED_ISSUES', 'true') !== 'false' })
    .option('allowCrossRepositoryClosing', { type: 'boolean', description: 'Allow an author-written closing reference to an issue in another repository and close it after the merge (the link repair never adds one)', alias: 'allow-cross-repository-closing', default: getenv('HIVE_MIND_ALLOW_CROSS_REPOSITORY_CLOSING', 'true') !== 'false' })
    .option('closeCompletedParents', { type: 'boolean', description: 'After closing issues on merge, close parent issues whose work is complete, otherwise post a status comment on them', alias: 'close-completed-parents', default: getenv('HIVE_MIND_CLOSE_COMPLETED_PARENTS', 'true') !== 'false' })
    // Issue #594: bot-owner toggle for --show-limits virtual option in /solve and /hive.
    .option('showLimits', { type: 'boolean', description: 'Experimental: allow /solve and /hive callers to use --show-limits to embed Claude/Codex usage at start, end, and delta in the completion message', alias: 'show-limits', default: getenv('TELEGRAM_SHOW_LIMITS', 'true') !== 'false' })
    // Issue #4069: GitHub blockers and sub-issues before a task starts. A single /solve
    // respects them only with --respect-blockers (experimental); a list of links does by default.
    .option('solveRespectBlockers', { type: 'boolean', description: 'Experimental: /solve, /claude, /codex and the other solve commands respect GitHub blockers and open sub-issues by default, as with --respect-blockers', alias: 'solve-respect-blockers', default: getenv('TELEGRAM_SOLVE_RESPECT_BLOCKERS', 'false') === 'true' })
    .option('batchRespectBlockers', { type: 'boolean', description: 'A solve command with several links starts unblocked issues first and queues the others after their blockers (--no-respect-blockers turns it off per command)', alias: 'batch-respect-blockers', default: getenv('TELEGRAM_BATCH_RESPECT_BLOCKERS', 'true') !== 'false' })
    .option('isolation', { type: 'string', description: "Isolation backend (screen/tmux/docker). Defaults to 'docker' so Telegram-bot work sessions run in Docker isolation; pass --isolation '' (or set TELEGRAM_ISOLATION='') to disable.", default: getenv('TELEGRAM_ISOLATION', 'docker') })
    .option('containerCpu', { type: 'string', description: 'Optional Docker task CPU limit as a core count (for example 1.5) or host percentage (for example 50%)', alias: 'container-cpu', default: getenv('TELEGRAM_CONTAINER_CPU', '') })
    .option('containerMemory', { type: 'string', description: 'Docker task RAM limit as a byte size (for example 2GiB) or host percentage; defaults to 25% for Docker tasks', alias: 'container-memory', default: getenv('TELEGRAM_CONTAINER_MEMORY', '') })
    .option('containerDisk', { type: 'string', description: 'Optional Docker task writable-layer disk limit as a byte size (for example 20GB) or available-filesystem percentage (for example 10%)', alias: 'container-disk', default: getenv('TELEGRAM_CONTAINER_DISK', '') })
    // Issue #2801: cap a Docker task that keeps every CPU busy for too long.
    .option('containerCpuPenalty', { type: 'boolean', description: 'Cap a Docker task to --container-cpu-penalty-cpus CPUs after it uses all CPUs for the trigger window, and lift the cap after the release window below the release threshold (on by default; --no-container-cpu-penalty disables it)', alias: 'container-cpu-penalty', default: getenv('TELEGRAM_CONTAINER_CPU_PENALTY', 'true') !== 'false' })
    .option('containerCpuPenaltyCpus', { type: 'string', description: 'CPUs a penalized Docker task is capped to (default: 2)', alias: 'container-cpu-penalty-cpus', default: getenv('TELEGRAM_CONTAINER_CPU_PENALTY_CPUS', '') })
    .option('containerCpuPenaltyTrigger', { type: 'string', description: "Average share of the task's CPUs (host CPUs, or --container-cpu when lower) that counts as using all of them (default: 95%)", alias: 'container-cpu-penalty-trigger', default: getenv('TELEGRAM_CONTAINER_CPU_PENALTY_TRIGGER', '') })
    .option('containerCpuPenaltyTriggerWindow', { type: 'string', description: 'How long the trigger average must hold before the cap is applied (default: 15m)', alias: 'container-cpu-penalty-trigger-window', default: getenv('TELEGRAM_CONTAINER_CPU_PENALTY_TRIGGER_WINDOW', '') })
    .option('containerCpuPenaltyRelease', { type: 'string', description: 'Average share of the penalty cap the task must stay below to have the cap lifted (default: 65%)', alias: 'container-cpu-penalty-release', default: getenv('TELEGRAM_CONTAINER_CPU_PENALTY_RELEASE', '') })
    .option('containerCpuPenaltyReleaseWindow', { type: 'string', description: 'How long the release average must hold before the cap is lifted (default: 15m)', alias: 'container-cpu-penalty-release-window', default: getenv('TELEGRAM_CONTAINER_CPU_PENALTY_RELEASE_WINDOW', '') })
    // Issue #4143: read-only instance status and drain for safe redeploys (no bot token needed).
    .option('status', { type: 'boolean', description: 'Print the state of the bot instance using this state directory (running, queued and waiting tasks, intake) and exit', default: false })
    .option('json', { type: 'boolean', description: 'With --status, --drain, --resume-intake or --wait-for-idle: print JSON', default: false })
    .option('drain', { type: 'boolean', description: 'Ask the running instance to stop taking new tasks; running tasks finish and queued ones are kept for the next instance', default: false })
    .option('drainReason', { type: 'string', description: 'Reason shown to users while draining (with --drain)', alias: 'drain-reason', default: '' })
    .option('resumeIntake', { type: 'boolean', description: 'Cancel a drain: the running instance accepts new tasks again', alias: 'resume-intake', default: false })
    .option('waitForIdle', { type: 'boolean', description: 'Wait until the instance has acknowledged a drain and has no running or starting tasks (exit 0), or until --wait-timeout (exit 1)', alias: 'wait-for-idle', default: false })
    .option('waitTimeout', { type: 'number', description: 'Seconds --wait-for-idle waits before failing (0 waits forever)', alias: 'wait-timeout', default: 0 })
    .option('stateDir', { type: 'string', description: 'Bot state directory holding hive-mind-state.lino and the link-cli store (default: $HIVE_MIND_STATE_DIR or ~/.hive-mind/state)', alias: 'state-dir', default: getenv('HIVE_MIND_STATE_DIR', '') })
    .help('h')
    .alias('h', 'help')
    .parserConfiguration({
      'boolean-negation': true,
      'strip-dashed': true, // Remove dashed keys from argv to simplify validation
    })
    .strict(); // Enable strict mode to reject unknown options (consistent with solve.mjs and hive.mjs)
