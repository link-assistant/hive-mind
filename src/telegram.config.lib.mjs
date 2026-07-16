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
    // Issue #594: bot-owner toggle for --show-limits virtual option in /solve and /hive.
    .option('showLimits', { type: 'boolean', description: 'Experimental: allow /solve and /hive callers to use --show-limits to embed Claude/Codex usage at start, end, and delta in the completion message', alias: 'show-limits', default: getenv('TELEGRAM_SHOW_LIMITS', 'true') !== 'false' })
    .option('isolation', { type: 'string', description: "Isolation backend (screen/tmux/docker). Defaults to 'docker' so Telegram-bot work sessions run in Docker isolation; pass --isolation '' (or set TELEGRAM_ISOLATION='') to disable.", default: getenv('TELEGRAM_ISOLATION', 'docker') })
    .help('h')
    .alias('h', 'help')
    .parserConfiguration({
      'boolean-negation': true,
      'strip-dashed': true, // Remove dashed keys from argv to simplify validation
    })
    .strict(); // Enable strict mode to reject unknown options (consistent with solve.mjs and hive.mjs)
