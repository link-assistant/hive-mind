#!/usr/bin/env node
// Early exit for --version (issue #1318: avoid dotenvx MISSING_ENV_FILE warnings)
if (process.argv.includes('--version')) {
  const v = await import('./version.lib.mjs').then(m => m.getVersion()).catch(() => 'unknown');
  console.log(v);
  process.exit(v === 'unknown' ? 1 : 0);
}

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { lino } = await import('./lino.lib.mjs');
const { buildUserMention } = await import('./buildUserMention.lib.mjs');
const { reportError, initializeSentry, addBreadcrumb } = await import('./sentry.lib.mjs');
const { loadLenvConfig } = await import('./lenv-reader.lib.mjs');
const { getLinoYargsFactory, getenv, hideBin } = await import('./cli-arguments.lib.mjs');

const dotenvxModule = await use('@dotenvx/dotenvx');
const dotenvx = dotenvxModule.default || dotenvxModule;

// Load .env/.lenv configuration (issue #1318)
dotenvx.config({ quiet: true, ignore: ['MISSING_ENV_FILE'] });
await loadLenvConfig({ override: true, quiet: true });

const yargs = getLinoYargsFactory();
const { createYargsConfig: createSolveYargsConfig, detectMalformedFlags } = await import('./solve.config.lib.mjs');
const { createYargsConfig: createHiveYargsConfig } = await import('./hive.config.lib.mjs');
const { parseGitHubUrl, validateGitHubEntityExistence } = await import('./github.lib.mjs');
const { validateModelName, buildModelOptionDescription } = await import('./models/index.mjs');
const { validateBranchInArgs } = await import('./solve.branch.lib.mjs');
const { extractIsolationFromArgs, isValidPerCommandIsolation, resolveIsolation, createIsolationAwareQueueCallback } = await import('./telegram-isolation.lib.mjs');
const limitsLib = await import('./limits.lib.mjs');
const { formatUsageMessage, formatCodexLimitsSection, getAllCachedLimits } = limitsLib;
const { handleShowLimitsFlag, captureStartSnapshotAndAppend } = await import('./telegram-show-limits.lib.mjs'); // #594
const { getVersionInfo, formatVersionMessage } = await import('./version-info.lib.mjs');
const { escapeMarkdown, escapeMarkdownV2, cleanNonPrintableChars, makeSpecialCharsVisible } = await import('./telegram-markdown.lib.mjs');
const { getSolveQueue, createQueueExecuteCallback } = await import('./telegram-solve-queue.lib.mjs');
const { applySolveToolAlias, getFirstParsedPositionalArg, getSolveCommandNameFromText, getSolveToolAliasFromText, moveArgumentToFront, parseArgsWithYargs, parseCommandArgs, SOLVE_COMMAND_NAMES } = await import('./telegram-solve-command.lib.mjs');
const { executeStartScreen: executeStartScreenCommand, buildExecuteAndUpdateMessage } = await import('./telegram-command-execution.lib.mjs');
const { isChatStopped, getChatStopInfo, getStoppedChatRejectMessage, DEFAULT_STOP_REASON } = await import('./telegram-start-stop-command.lib.mjs');
const { isOldMessage: _isOldMessage, isGroupChat: _isGroupChat, isChatAuthorized: _isChatAuthorized, isForwardedOrReply: _isForwardedOrReply, extractCommandFromText, extractGitHubUrl: _extractGitHubUrl } = await import('./telegram-message-filters.lib.mjs');
const { installTelegramFormattingFallback, isTelegramFormattingError, isTelegramMessageTooLongError, safeEditMessageText, safeReply, TELEGRAM_TEXT_LIMIT } = await import('./telegram-safe-reply.lib.mjs');
const { registerTerminalWatchCommand, startAutoTerminalWatchForSession } = await import('./telegram-terminal-watch-command.lib.mjs');
const { launchBotWithRetry } = await import('./telegram-bot-launcher.lib.mjs');
const { trackSession, startSessionMonitoring, hasActiveSessionForUrlAsync } = await import('./session-monitor.lib.mjs');
const { formatExecutingWorkSessionMessage, formatStartingWorkSessionMessage } = await import('./work-session-formatting.lib.mjs');
const { buildTelegramHelpMessage, buildTelegramInfoBlock, buildSolveQueuedMessage } = await import('./telegram-ui-messages.lib.mjs');

const config = yargs(hideBin(process.argv))
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
  .option('isolation', { type: 'string', description: "Isolation backend (screen/tmux/docker). Defaults to 'screen' so Telegram-bot work sessions survive bot restarts; pass --isolation '' (or set TELEGRAM_ISOLATION='') to disable.", default: getenv('TELEGRAM_ISOLATION', 'screen') })
  .help('h')
  .alias('h', 'help')
  .parserConfiguration({
    'boolean-negation': true,
    'strip-dashed': true, // Remove dashed keys from argv to simplify validation
  })
  .strict() // Enable strict mode to reject unknown options (consistent with solve.mjs and hive.mjs)
  .parse();

// Configuration priority: CLI option > --configuration LINO > .lenv > .env
if (config.configuration) {
  await loadLenvConfig({ configuration: config.configuration, override: true, quiet: true });
}

const BOT_TOKEN = config.token || getenv('TELEGRAM_BOT_TOKEN', '');
const VERBOSE = config.verbose || getenv('TELEGRAM_BOT_VERBOSE', 'false') === 'true';
const AUTO_WATCH_MESSAGE = config.autoStartScreenWatchMessage === true;
const SHOW_LIMITS_ENABLED = config.showLimits === true;
if (!BOT_TOKEN) {
  console.error('Error: TELEGRAM_BOT_TOKEN not set. Use --token or TELEGRAM_BOT_TOKEN env var.');
  process.exit(1);
}

// Resolve final config values (CLI option > environment variable)
const resolvedAllowedChats = config.allowedChats || getenv('TELEGRAM_ALLOWED_CHATS', '');
const allowedChats = resolvedAllowedChats ? lino.parseNumericIds(resolvedAllowedChats) : null;

// Parse allowed topics (chatId:topicId pairs in Links Notation)
const resolvedAllowedTopics = config.allowedTopics || getenv('TELEGRAM_ALLOWED_TOPICS', '');
const allowedTopics = resolvedAllowedTopics ? lino.parseLinks(resolvedAllowedTopics) : null;
const resolvedSolveOverrides = config.solveOverrides || getenv('TELEGRAM_SOLVE_OVERRIDES', '');
const solveOverrides = resolvedSolveOverrides
  ? lino
      .parseStringValues(resolvedSolveOverrides)
      .map(l => l.trim())
      .filter(l => l)
  : [];
const resolvedHiveOverrides = config.hiveOverrides || getenv('TELEGRAM_HIVE_OVERRIDES', '');
const hiveOverrides = resolvedHiveOverrides
  ? lino
      .parseStringValues(resolvedHiveOverrides)
      .map(l => l.trim())
      .filter(l => l)
  : [];
const solveEnabled = config.solve;
const hiveEnabled = config.hive;
const taskEnabled = config.task;
const authEnabled = config.auth;
// Isolation mode (experimental): uses `$` from start-command with specified backend
const ISOLATION_BACKEND = (config.isolation || getenv('TELEGRAM_ISOLATION', '')).trim().toLowerCase();
let isolationRunner = null;
if (ISOLATION_BACKEND) {
  if (!['screen', 'tmux', 'docker'].includes(ISOLATION_BACKEND)) {
    console.error(`Error: Invalid --isolation value '${ISOLATION_BACKEND}'. Must be: screen, tmux, or docker`);
    process.exit(1);
  }
  console.log(`🔒 Isolation mode enabled: ${ISOLATION_BACKEND} (experimental)`);
  isolationRunner = await import('./isolation-runner.lib.mjs');
}

// Validate solve overrides early using solve's yargs config
// Only validate if solve command is enabled
if (solveEnabled && solveOverrides.length > 0) {
  console.log('Validating solve overrides...');
  try {
    const { backend: solveOverrideIsolation, filteredArgs: solveOverridesForValidation } = extractIsolationFromArgs(solveOverrides);
    if (solveOverrideIsolation && !isValidPerCommandIsolation(solveOverrideIsolation)) {
      throw new Error(`Invalid --isolation value '${solveOverrideIsolation}'. Must be: screen, tmux, or docker`);
    }
    // Add a dummy URL as the first argument (required positional for solve)
    const testArgs = ['https://github.com/test/test/issues/1', ...solveOverridesForValidation];

    // Temporarily suppress stderr to avoid yargs error output during validation
    const originalStderrWrite = process.stderr.write;
    const stderrBuffer = [];
    process.stderr.write = chunk => {
      stderrBuffer.push(chunk);
      return true;
    };

    try {
      // Use .parse() instead of yargs(args).parseSync() to ensure .strict() mode works
      const testYargs = createSolveYargsConfig(yargs());
      // Suppress yargs error output - we'll handle errors ourselves
      testYargs
        .exitProcess(false)
        .showHelpOnFail(false)
        .fail((msg, err) => {
          if (err) throw err;
          throw new Error(msg);
        });
      await testYargs.parse(testArgs);
      // Issue #1482: Validate --base-branch in overrides early
      const overrideBranchError = validateBranchInArgs(solveOverridesForValidation);
      if (overrideBranchError) throw new Error(overrideBranchError);
      console.log('✅ Solve overrides validated successfully');
    } finally {
      // Restore stderr
      process.stderr.write = originalStderrWrite;
    }
  } catch (error) {
    console.error(`❌ Invalid solve-overrides: ${error.message || String(error)}`);
    console.error(`   Overrides: ${solveOverrides.join(' ')}`);
    process.exit(1);
  }
}

// Validate hive overrides early using hive's yargs config
// Only validate if hive command is enabled
if (hiveEnabled && hiveOverrides.length > 0) {
  console.log('Validating hive overrides...');
  try {
    const { backend: hiveOverrideIsolation, filteredArgs: hiveOverridesForValidation } = extractIsolationFromArgs(hiveOverrides);
    if (hiveOverrideIsolation && !isValidPerCommandIsolation(hiveOverrideIsolation)) {
      throw new Error(`Invalid --isolation value '${hiveOverrideIsolation}'. Must be: screen, tmux, or docker`);
    }
    // Add a dummy URL as the first argument (required positional for hive)
    const testArgs = ['https://github.com/test/test', ...hiveOverridesForValidation];

    // Temporarily suppress stderr to avoid yargs error output during validation
    const originalStderrWrite = process.stderr.write;
    const stderrBuffer = [];
    process.stderr.write = chunk => {
      stderrBuffer.push(chunk);
      return true;
    };

    try {
      // Use .parse() instead of yargs(args).parseSync() to ensure .strict() mode works
      const testYargs = createHiveYargsConfig(yargs());
      // Suppress yargs error output - we'll handle errors ourselves
      testYargs
        .exitProcess(false)
        .showHelpOnFail(false)
        .fail((msg, err) => {
          if (err) throw err;
          throw new Error(msg);
        });
      await testYargs.parse(testArgs);
      const overrideBranchError = validateBranchInArgs(hiveOverridesForValidation); // Issue #1482
      if (overrideBranchError) throw new Error(overrideBranchError);
      console.log('✅ Hive overrides validated successfully');
    } finally {
      // Restore stderr
      process.stderr.write = originalStderrWrite;
    }
  } catch (error) {
    console.error(`❌ Invalid hive-overrides: ${error.message || String(error)}`);
    console.error(`   Overrides: ${hiveOverrides.join(' ')}`);
    process.exit(1);
  }
}

// Handle dry-run mode - exit after validation WITHOUT loading heavy dependencies
// This significantly speeds up dry-run mode by skipping telegraf loading (~3-8 seconds)
// See issue #801 for details
if (config.dryRun) {
  console.log('\n✅ Dry-run mode: All validations passed successfully!');
  console.log('\nConfiguration summary:');
  console.log('  Token:', BOT_TOKEN ? `${BOT_TOKEN.substring(0, 10)}...` : 'not set');
  if (allowedChats && allowedChats.length > 0) {
    console.log('  Allowed chats:', lino.format(allowedChats));
  } else {
    console.log('  Allowed chats: All (no restrictions)');
  }
  if (allowedTopics && allowedTopics.length > 0) {
    console.log('  Allowed topics:', lino.formatLinks(allowedTopics));
  }
  console.log('  Commands enabled:', { solve: solveEnabled, hive: hiveEnabled, task: taskEnabled, auth: authEnabled });
  if (solveOverrides.length > 0) {
    console.log('  Solve overrides:', lino.format(solveOverrides));
  }
  if (hiveOverrides.length > 0) {
    console.log('  Hive overrides:', lino.format(hiveOverrides));
  }
  console.log('\n🎉 Bot configuration is valid. Exiting without starting the bot.');
  process.exit(0);
}

// === HEAVY DEPENDENCIES LOADED BELOW (skipped in dry-run mode) ===
// These imports are after dry-run check to speed up config validation. Telegraf can take 3-8s to load on cold start (issue #801).

// Initialize Sentry for error tracking
await initializeSentry({
  debug: VERBOSE,
  environment: process.env.NODE_ENV || 'production',
});

// Initialize i18n: pre-load every supported locale so per-user translations
// can resolve synchronously from the cache when handling Telegram updates.
const { initI18n, t, preloadAllLocales, resolveLocaleFromTelegramCtx } = await import('./i18n.lib.mjs');
await initI18n();
await preloadAllLocales();

const telegrafModule = await use('telegraf');
const { Telegraf } = telegrafModule;

const bot = new Telegraf(BOT_TOKEN, {
  handlerTimeout: Infinity, // Remove default 90s timeout; command handlers like /solve spawn long-running processes
});
installTelegramFormattingFallback(bot.telegram, { verbose: VERBOSE });

// Track bot startup time (Unix seconds to match Telegram's message.date format)
const BOT_START_TIME = Math.floor(Date.now() / 1000);
// Wrapper functions binding filter logic to bot state (actual logic in telegram-message-filters.lib.mjs, issue #1207)
function isChatAuthorized(chatId) {
  return _isChatAuthorized(chatId, allowedChats);
}

// Topic-level authorization (issue #1100): chat-level auth overrides topic-level
function isTopicAuthorized(ctx) {
  if (isChatAuthorized(ctx.chat?.id)) return true;
  if (!allowedTopics || allowedTopics.length === 0) return false;
  const chatId = ctx.chat?.id;
  const topicId = ctx.message?.message_thread_id;
  return allowedTopics.some(pair => pair.source === chatId && pair.target === topicId);
}
function buildAuthErrorMessage(ctx) {
  const chatId = ctx.chat?.id;
  const topicId = ctx.message?.message_thread_id;
  let msg = `❌ This chat (ID: ${chatId})`;
  if (topicId) msg += ` and topic (ID: ${topicId})`;
  return msg + ' is not authorized.\n\nUse /help to see your chat and topic IDs.';
}

function isOldMessage(ctx) {
  return _isOldMessage(ctx, BOT_START_TIME, { verbose: VERBOSE });
}

async function executeStartScreen(command, args) {
  return executeStartScreenCommand(command, args, { verbose: VERBOSE });
}

function isForwardedOrReply(ctx) {
  return _isForwardedOrReply(ctx, { verbose: VERBOSE });
}

/**
 * Validates the model name in the args array and returns an error message if invalid
 * @param {string[]} args - Array of command arguments
 * @param {string} tool - The tool to validate against ('claude', 'opencode', 'codex', 'agent', or 'gemini')
 * @returns {string|null} Error message if invalid, null if valid or no model specified
 */
function validateModelInArgs(args, tool = 'claude') {
  // Find --model or -m flag and its value
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' || args[i] === '-m') {
      if (i + 1 < args.length) {
        const modelName = args[i + 1];
        const validation = validateModelName(modelName, tool);
        if (!validation.valid) {
          return validation.message;
        }
      }
    } else if (args[i].startsWith('--model=')) {
      const modelName = args[i].substring('--model='.length);
      const validation = validateModelName(modelName, tool);
      if (!validation.valid) {
        return validation.message;
      }
    }
  }
  return null;
}

function mergeArgsWithOverrides(userArgs, overrides) {
  if (!overrides || overrides.length === 0) {
    return userArgs;
  }

  // Parse overrides to identify flags and their values
  const overrideFlags = new Map(); // Map of flag -> value (or null for boolean flags)

  for (let i = 0; i < overrides.length; i++) {
    const arg = overrides[i];
    if (arg.startsWith('--')) {
      // Check if next item is a value (doesn't start with --)
      if (i + 1 < overrides.length && !overrides[i + 1].startsWith('--')) {
        overrideFlags.set(arg, overrides[i + 1]);
        i++; // Skip the value in next iteration
      } else {
        overrideFlags.set(arg, null); // Boolean flag
      }
    }
  }

  // Filter user args to remove any that conflict with overrides
  const filteredArgs = [];
  for (let i = 0; i < userArgs.length; i++) {
    const arg = userArgs[i];
    if (arg.startsWith('--')) {
      // If this flag exists in overrides, skip it and its value
      if (overrideFlags.has(arg)) {
        // Skip the flag
        // Also skip next arg if it's a value (doesn't start with --)
        if (i + 1 < userArgs.length && !userArgs[i + 1].startsWith('--')) {
          i++; // Skip the value too
        }
        continue;
      }
    }
    filteredArgs.push(arg);
  }

  // Merge: filtered user args + overrides
  return [...filteredArgs, ...overrides];
}

// Inject --language LOCALE into spawn args if no language flag is already present.
// Issue #378: telegram bot resolves the user's effective locale and propagates
// it to spawned solve/hive sessions so the AI tool replies in the same language.
function injectLanguageIfMissing(args, locale) {
  if (!locale || !args || !Array.isArray(args)) return args;
  const langFlags = new Set(['--language', '--ui-language', '--work-language']);
  for (const arg of args) {
    const flag = arg.startsWith('--') ? arg.split('=')[0] : null;
    if (flag && langFlags.has(flag)) return args;
  }
  return [...args, '--language', locale];
}

/** Validate GitHub URL for Telegram bot commands. Returns { valid, error?, parsed?, normalizedUrl? } */
async function getCommandUrlArg(args, createYargsConfig, positionalNames) {
  const parsedUrl = createYargsConfig ? await getFirstParsedPositionalArg(args, yargs, createYargsConfig, positionalNames) : null;
  if (parsedUrl) return parsedUrl;
  return args.find(arg => cleanNonPrintableChars(arg).includes('github.com')) || (args[0] && !args[0].startsWith('-') ? args[0] : null);
}

async function validateGitHubUrl(args, options = {}) {
  const { allowedTypes = ['issue', 'pull'], commandName = 'solve', createYargsConfig = null, positionalNames = [], locale = null } = options;
  const rawUrl = await getCommandUrlArg(args, createYargsConfig, positionalNames);
  if (!rawUrl) return { valid: false, error: t('telegram.missing_github_url', { commandName }, { locale }) };
  // Issue #1102: Clean non-printable chars (Zero-Width Space, BOM, etc.) from URLs
  const url = cleanNonPrintableChars(rawUrl);
  if (!url.includes('github.com')) return { valid: false, error: t('telegram.first_arg_must_be_github_url', {}, { locale }) };
  const parsed = parseGitHubUrl(url);
  if (!parsed.valid) return { valid: false, error: parsed.error || 'Invalid GitHub URL', suggestion: parsed.suggestion };
  if (!allowedTypes.includes(parsed.type)) {
    const allowedTypesStr = allowedTypes.map(t => (t === 'pull' ? 'pull request' : t)).join(', ');
    const baseUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;
    const escapedUrl = escapeMarkdown(url),
      escapedBaseUrl = escapeMarkdown(baseUrl); // Issue #1102: escape for Markdown
    let error;
    if (parsed.type === 'issues_list') error = t('telegram.url_issues_list_error', { url: escapedUrl, example: `${escapedBaseUrl}/issues/1` }, { locale });
    else if (parsed.type === 'pulls_list') error = t('telegram.url_pulls_list_error', { url: escapedUrl, example: `${escapedBaseUrl}/pull/1` }, { locale });
    else if (parsed.type === 'repo') error = t('telegram.url_repo_error', { allowedTypes: allowedTypesStr, url: escapedUrl, example: `${escapedBaseUrl}/issues/1` }, { locale });
    else error = t('telegram.url_must_be_type', { allowedTypes: allowedTypesStr, type: parsed.type.replace('_', ' ') }, { locale });
    return { valid: false, error };
  }
  return { valid: true, parsed, normalizedUrl: url };
}

const executeAndUpdateMessage = buildExecuteAndUpdateMessage({ resolveIsolation, ISOLATION_BACKEND, isolationRunner, VERBOSE, executeStartScreen, trackSession, AUTO_WATCH_MESSAGE, startAutoTerminalWatchForSession, bot, formatExecutingWorkSessionMessage });

bot.command('help', async ctx => {
  VERBOSE && console.log('[VERBOSE] /help command received');

  // Ignore messages sent before bot started
  if (isOldMessage(ctx)) {
    VERBOSE && console.log('[VERBOSE] /help ignored: old message');
    return;
  }

  // Ignore forwarded or reply messages
  if (isForwardedOrReply(ctx)) {
    VERBOSE && console.log('[VERBOSE] /help ignored: forwarded or reply');
    return;
  }

  const chatId = ctx.chat.id;
  const chatType = ctx.chat.type;
  const chatTitle = ctx.chat.title || 'Private Chat';
  const topicId = ctx.message?.message_thread_id; // Forum topic ID (issue #1100)
  const helpLocale = resolveLocaleFromTelegramCtx(ctx);
  const stopped = isChatStopped(chatId);
  const stopInfo = stopped ? getChatStopInfo(chatId) : null;
  const restrictedMode = Boolean(allowedChats || allowedTopics);
  const authorized = restrictedMode ? isTopicAuthorized(ctx) : null;
  const message = buildTelegramHelpMessage({
    locale: helpLocale,
    chatId,
    chatType,
    chatTitle,
    topicId,
    isStopped: stopped,
    stopInfo,
    stopReason: stopInfo?.reason || DEFAULT_STOP_REASON,
    solveEnabled,
    taskEnabled,
    hiveEnabled,
    solveOverrides,
    hiveOverrides,
    showLimitsEnabled: SHOW_LIMITS_ENABLED,
    isolationBackend: ISOLATION_BACKEND,
    modelDescription: buildModelOptionDescription(),
    restrictedMode,
    authorized,
    allowTopicHint: topicId ? `TELEGRAM_ALLOWED_TOPICS="(${chatId} ${topicId})"` : '',
  });

  await safeReply(ctx, message, { fallbackLocale: helpLocale });
});

bot.command('limits', async ctx => {
  VERBOSE && console.log('[VERBOSE] /limits command received');

  // Add breadcrumb for error tracking
  await addBreadcrumb({ category: 'telegram.command', message: '/limits command received', level: 'info', data: { chatId: ctx.chat?.id, chatType: ctx.chat?.type, userId: ctx.from?.id, username: ctx.from?.username } });

  // Ignore messages sent before bot started
  if (isOldMessage(ctx)) {
    VERBOSE && console.log('[VERBOSE] /limits ignored: old message');
    return;
  }

  // Ignore forwarded or reply messages
  if (isForwardedOrReply(ctx)) {
    VERBOSE && console.log('[VERBOSE] /limits ignored: forwarded or reply');
    return;
  }

  const userLocale = resolveLocaleFromTelegramCtx(ctx);
  if (!_isGroupChat(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /limits ignored: not a group chat');
    }
    await ctx.reply(t('telegram.limits_only_in_groups', {}, { locale: userLocale }), { reply_to_message_id: ctx.message.message_id });
    return;
  }

  if (!isTopicAuthorized(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /limits ignored: not authorized');
    }
    await ctx.reply(buildAuthErrorMessage(ctx), { reply_to_message_id: ctx.message.message_id });
    return;
  }

  // Send "fetching" message to indicate work is in progress
  const fetchingMessage = await ctx.reply(t('telegram.fetching_limits', {}, { locale: userLocale }), {
    reply_to_message_id: ctx.message.message_id,
  });

  // Get all limits using shared cache (3min for API, 2min for system)
  const limits = await getAllCachedLimits(VERBOSE);

  // Format message with usage limits and queue status (issues #1343, #1267)
  const claudeError = limits.claude.success ? null : limits.claude.error;
  const codexError = limits.codex.success ? null : limits.codex.error;
  const solveQueue = getSolveQueue({ verbose: VERBOSE });
  const queueStatus = await solveQueue.formatStatus({ locale: userLocale });
  const claudeSubscription = limits.claudeSubscription?.success ? limits.claudeSubscription.subscription : null;
  const codexSubscription = limits.codexSubscription?.success ? limits.codexSubscription.subscription : null;
  const codexSection = formatCodexLimitsSection(limits.codex.success ? limits.codex : null, codexError, { locale: userLocale, subscription: codexSubscription });
  const message = t('telegram.usage_limits_title', {}, { locale: userLocale }) + '\n\n' + formatUsageMessage(limits.claude.success ? limits.claude.usage : null, limits.disk.success ? limits.disk.diskSpace : null, limits.github.success ? limits.github.githubRateLimit : null, limits.cpu.success ? limits.cpu.cpuLoad : null, limits.memory.success ? limits.memory.memory : null, claudeError, [codexSection, queueStatus], { locale: userLocale, subscription: claudeSubscription });
  await safeEditMessageText(ctx.telegram, fetchingMessage.chat.id, fetchingMessage.message_id, undefined, message, { parse_mode: 'Markdown', fallbackLocale: userLocale, verbose: VERBOSE });
});
bot.command('version', async ctx => {
  VERBOSE && console.log('[VERBOSE] /version command received');
  await addBreadcrumb({
    category: 'telegram.command',
    message: '/version command received',
    level: 'info',
    data: { chatId: ctx.chat?.id, chatType: ctx.chat?.type, userId: ctx.from?.id, username: ctx.from?.username },
  });
  if (isOldMessage(ctx) || isForwardedOrReply(ctx)) return;
  const versionLocale = resolveLocaleFromTelegramCtx(ctx);
  if (!_isGroupChat(ctx)) return await ctx.reply(t('telegram.version_only_in_groups', {}, { locale: versionLocale }), { reply_to_message_id: ctx.message.message_id });
  if (!isTopicAuthorized(ctx)) return await ctx.reply(buildAuthErrorMessage(ctx), { reply_to_message_id: ctx.message.message_id });
  const fetchingMessage = await ctx.reply(t('telegram.gathering_version', {}, { locale: versionLocale }), {
    reply_to_message_id: ctx.message.message_id,
  });
  const result = await getVersionInfo(VERBOSE);
  if (!result.success) return await safeEditMessageText(ctx.telegram, fetchingMessage.chat.id, fetchingMessage.message_id, undefined, `❌ ${escapeMarkdownV2(result.error, { preserveCodeBlocks: true })}`, { parse_mode: 'MarkdownV2', fallbackLocale: versionLocale, verbose: VERBOSE });
  await safeEditMessageText(ctx.telegram, fetchingMessage.chat.id, fetchingMessage.message_id, undefined, t('telegram.version_information_title', {}, { locale: versionLocale }) + '\n\n' + formatVersionMessage(result.versions, { locale: versionLocale }), { parse_mode: 'Markdown', fallbackLocale: versionLocale, verbose: VERBOSE });
});

const { registerLanguageCommand } = await import('./telegram-language-command.lib.mjs');
registerLanguageCommand(bot, { VERBOSE, isOldMessage, isForwardedOrReply });

const { registerAcceptInvitesCommand } = await import('./telegram-accept-invitations.lib.mjs');
const sharedCommandOpts = { VERBOSE, isOldMessage, isForwardedOrReply, isGroupChat: _isGroupChat, isChatAuthorized, isTopicAuthorized, buildAuthErrorMessage, addBreadcrumb, isChatStopped, getStoppedChatRejectMessage };
registerAcceptInvitesCommand(bot, sharedCommandOpts);
const { registerMergeCommand } = await import('./telegram-merge-command.lib.mjs');
registerMergeCommand(bot, sharedCommandOpts);
const { registerSolveQueueCommand } = await import('./telegram-solve-queue-command.lib.mjs');
const { handleSolveQueueCommand } = registerSolveQueueCommand(bot, { ...sharedCommandOpts, getSolveQueue, safeReply, resolveLocale: resolveLocaleFromTelegramCtx });
const { registerSubscribeCommands } = await import('./telegram-subscribers.lib.mjs'); // #1688
registerSubscribeCommands(bot, sharedCommandOpts);
const { registerTaskCommands } = await import('./telegram-task-command.lib.mjs');
const { handleTaskCommand, TASK_COMMAND_NAMES } = registerTaskCommands(bot, { ...sharedCommandOpts, taskEnabled, safeReply, executeAndUpdateMessage, resolveLocale: resolveLocaleFromTelegramCtx });
const { registerAuthCommand } = await import('./telegram-auth-command.lib.mjs');
const { handleAuthCommand } = registerAuthCommand(bot, { ...sharedCommandOpts, allowedChats, authEnabled, safeReply });

// Named handler for /solve command - extracted for reuse by text-based fallback (issue #1207)
async function handleSolveCommand(ctx) {
  const solveCommandName = getSolveCommandNameFromText(ctx.message?.text) || 'solve';
  const solveCommandDisplay = `/${solveCommandName}`;
  VERBOSE && console.log(`[VERBOSE] ${solveCommandDisplay} command received`);

  // Add breadcrumb for error tracking
  await addBreadcrumb({
    category: 'telegram.command',
    message: `${solveCommandDisplay} command received`,
    level: 'info',
    data: {
      chatId: ctx.chat?.id,
      chatType: ctx.chat?.type,
      userId: ctx.from?.id,
      username: ctx.from?.username,
    },
  });

  const solveLocale = resolveLocaleFromTelegramCtx(ctx);
  if (!solveEnabled) {
    if (VERBOSE) {
      console.log(`[VERBOSE] ${solveCommandDisplay} ignored: command disabled`);
    }
    await ctx.reply(t('telegram.solve_disabled', {}, { locale: solveLocale }));
    return;
  }

  // Ignore messages sent before bot started
  if (isOldMessage(ctx)) {
    if (VERBOSE) {
      console.log(`[VERBOSE] ${solveCommandDisplay} ignored: old message`);
    }
    return;
  }

  // Check if this is a forwarded message (not allowed)
  // But allow reply messages for URL extraction feature
  const message = ctx.message;
  const isForwarded = message.forward_origin && message.forward_origin.type;
  const isOldApiForwarded = message.forward_from || message.forward_from_chat || message.forward_from_message_id || message.forward_signature || message.forward_sender_name || message.forward_date;

  if (isForwarded || isOldApiForwarded) {
    if (VERBOSE) {
      console.log(`[VERBOSE] ${solveCommandDisplay} ignored: forwarded message`);
    }
    return;
  }

  if (!_isGroupChat(ctx)) {
    if (VERBOSE) {
      console.log(`[VERBOSE] ${solveCommandDisplay} ignored: not a group chat`);
    }
    await ctx.reply(t('telegram.solve_only_in_groups', { commandDisplay: solveCommandDisplay }, { locale: solveLocale }), { reply_to_message_id: ctx.message.message_id });
    return;
  }

  if (!isTopicAuthorized(ctx)) {
    if (VERBOSE) {
      console.log(`[VERBOSE] ${solveCommandDisplay} ignored: not authorized`);
    }
    await ctx.reply(buildAuthErrorMessage(ctx), { reply_to_message_id: ctx.message.message_id });
    return;
  }

  // Check if chat is stopped (issue #1081) - reject with same style as queue rejected mode
  const chatId = ctx.chat.id;
  if (isChatStopped(chatId)) {
    VERBOSE && console.log('[VERBOSE] /solve rejected: chat is stopped');
    await safeReply(ctx, getStoppedChatRejectMessage(chatId, 'Solve'), { reply_to_message_id: ctx.message.message_id });
    return;
  }

  VERBOSE && console.log(`[VERBOSE] ${solveCommandDisplay} passed all checks, executing...`);

  const solveToolAlias = getSolveToolAliasFromText(ctx.message.text);
  let userArgs = parseCommandArgs(ctx.message.text);

  // Issue #594: strip --show-limits from userArgs (hive-telegram-bot virtual option).
  const solveSL = await handleShowLimitsFlag({ ctx, safeReply, args: userArgs, enabled: SHOW_LIMITS_ENABLED, locale: solveLocale });
  if (solveSL.handled) return;
  const solveShowLimits = solveSL.showLimits;
  userArgs = solveSL.args;

  // Check if this is a reply to a message and user didn't provide URL as first argument
  // In that case, try to extract GitHub URL from the replied message
  // Issue #1325: Support all options via /solve command when replying (e.g., "/solve --model opus")
  const isReply = message.reply_to_message && message.reply_to_message.message_id && !message.reply_to_message.forum_topic_created;

  // Check if yargs sees a command URL. If not, try to extract it from the replied message.
  const commandUrlArg = await getCommandUrlArg(userArgs, createSolveYargsConfig, ['issue-url']);
  const commandUrlText = commandUrlArg ? cleanNonPrintableChars(commandUrlArg) : '';
  const commandHasUrl = commandUrlText.includes('github.com') || /^https?:\/\//.test(commandUrlText);

  if (isReply && !commandHasUrl) {
    if (VERBOSE) {
      console.log('[VERBOSE] /solve is a reply without URL in args, extracting from replied message...');
      console.log('[VERBOSE] User args:', userArgs);
    }

    const replyText = message.reply_to_message.text || '';
    const extraction = _extractGitHubUrl(replyText, { parseGitHubUrl, cleanNonPrintableChars });

    if (extraction.error) {
      // Multiple links found
      if (VERBOSE) {
        console.log('[VERBOSE] Multiple GitHub URLs found in replied message');
      }
      await safeReply(ctx, `❌ ${escapeMarkdown(extraction.error)}`, {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    } else if (extraction.url) {
      // Single link found - prepend it to existing user args (issue #1325)
      if (VERBOSE) {
        console.log('[VERBOSE] Extracted URL from reply:', extraction.url);
      }
      // Prepend the extracted URL to user's options (e.g., ['--model', 'opus'] -> ['url', '--model', 'opus'])
      userArgs = [extraction.url, ...userArgs];
    } else {
      // No link found
      if (VERBOSE) {
        console.log('[VERBOSE] No GitHub URL found in replied message');
      }
      await safeReply(ctx, t('telegram.no_github_link_in_reply', {}, { locale: solveLocale }), { reply_to_message_id: ctx.message.message_id });
      return;
    }
  }

  userArgs = applySolveToolAlias(userArgs, solveToolAlias);

  const { malformed, errors: malformedErrors } = detectMalformedFlags(userArgs);
  if (malformed.length > 0) {
    await safeReply(ctx, `❌ ${escapeMarkdown(malformedErrors.join('\n'))}\n\n${t('telegram.option_syntax_check', {}, { locale: solveLocale })}`, { reply_to_message_id: ctx.message.message_id });
    return;
  }

  const validation = await validateGitHubUrl(userArgs, { createYargsConfig: createSolveYargsConfig, positionalNames: ['issue-url'], locale: solveLocale });
  if (!validation.valid) {
    let errorMsg = `❌ ${validation.error}`;
    if (validation.suggestion) {
      errorMsg += `\n\n${t('telegram.did_you_mean', { suggestion: validation.suggestion }, { locale: solveLocale })}`;
    }
    errorMsg += `\n\n${t('telegram.solve_invalid_url_help', {}, { locale: solveLocale })}`;
    await safeReply(ctx, errorMsg, { reply_to_message_id: ctx.message.message_id });
    return;
  }
  userArgs = moveArgumentToFront(userArgs, validation.normalizedUrl, cleanNonPrintableChars);
  const { backend: solvePerCommandIsolation, filteredArgs: userArgsWithoutIsolation } = extractIsolationFromArgs(userArgs); // issue #1534
  if (solvePerCommandIsolation && !isValidPerCommandIsolation(solvePerCommandIsolation)) {
    await safeReply(ctx, t('telegram.invalid_isolation', { value: escapeMarkdown(solvePerCommandIsolation) }, { locale: solveLocale }), { reply_to_message_id: ctx.message.message_id });
    return;
  }
  const mergedSolveArgs = mergeArgsWithOverrides(userArgsWithoutIsolation, solveOverrides);
  const { backend: solveOverrideIsolation, filteredArgs: args } = extractIsolationFromArgs(mergedSolveArgs);
  if (solveOverrideIsolation && !isValidPerCommandIsolation(solveOverrideIsolation)) {
    await safeReply(ctx, t('telegram.invalid_locked_isolation', { value: escapeMarkdown(solveOverrideIsolation) }, { locale: solveLocale }), { reply_to_message_id: ctx.message.message_id });
    return;
  }
  const effectiveSolveIsolation = solveOverrideIsolation || solvePerCommandIsolation;

  // Determine tool from args (default: claude)
  let solveTool = 'claude';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tool' && i + 1 < args.length) {
      solveTool = args[i + 1];
    } else if (args[i].startsWith('--tool=')) {
      solveTool = args[i].substring('--tool='.length);
    }
  }

  // Validate model name with helpful error message (before yargs validation)
  const modelError = validateModelInArgs(args, solveTool);
  if (modelError) {
    await safeReply(ctx, `❌ ${escapeMarkdown(modelError)}`, { reply_to_message_id: ctx.message.message_id });
    return;
  }
  // Issue #1482: Validate --base-branch early to reject URLs and invalid branch names
  const branchError = validateBranchInArgs(args);
  if (branchError) {
    await safeReply(ctx, `❌ ${escapeMarkdown(branchError)}`, { reply_to_message_id: ctx.message.message_id });
    return;
  }
  const { malformed: mergedMalformed, errors: mergedMalformedErrors } = detectMalformedFlags(args);
  if (mergedMalformed.length > 0) {
    await safeReply(ctx, `❌ ${escapeMarkdown(mergedMalformedErrors.join('\n'))}\n\n${t('telegram.option_syntax_check', {}, { locale: solveLocale })}`, { reply_to_message_id: ctx.message.message_id });
    return;
  }
  // Validate merged arguments using solve's yargs config
  let parsedSolveArgs;
  try {
    parsedSolveArgs = await parseArgsWithYargs(args, yargs, createSolveYargsConfig);
  } catch (error) {
    await safeReply(ctx, t('telegram.invalid_options', { message: escapeMarkdown(error.message || String(error)) }, { locale: solveLocale }), {
      reply_to_message_id: ctx.message.message_id,
    });
    return;
  }
  // Issue #1552 + #1694: Validate GitHub entity existence before queueing/executing.
  // Honor the parsed --auto-accept-invite (now default-on per #1694), so --no-auto-accept-invite
  // disables the pre-check while the default path still accepts pending invites for the target repo/org.
  if (parsedSolveArgs?.autoAcceptInvite && validation.parsed.owner && validation.parsed.repo) {
    try {
      await (await import('./solve.accept-invite.lib.mjs')).autoAcceptInviteForRepo(validation.parsed.owner, validation.parsed.repo, async () => {}, false);
    } catch (e) {
      VERBOSE && console.log(`[VERBOSE] Auto-accept invite pre-check failed: ${e.message}`);
    }
  }
  // Issue #1714: read the parsed argv (default-on per #1694) instead of the raw args list,
  // so the invite hint is suppressed on the default-on path where the literal flag is absent.
  const entityCheck = await validateGitHubEntityExistence({ owner: validation.parsed.owner, repo: validation.parsed.repo, number: validation.parsed.number, type: validation.parsed.type, verbose: VERBOSE, autoAcceptInvite: !!parsedSolveArgs?.autoAcceptInvite });
  if (!entityCheck.valid) {
    await safeReply(ctx, `❌ ${escapeMarkdown(entityCheck.error)}`, { reply_to_message_id: ctx.message.message_id });
    return;
  }
  // Use normalized URL from validation to ensure consistent duplicate detection (issue #1080)
  const normalizedUrl = validation.parsed.normalized;

  const requester = buildUserMention({ user: ctx.from, parseMode: 'Markdown' });
  // #1228: only user options; #1460: escape; #1688: 'Issue:' / 'Pull request:' label so completion can append PR link.
  const userOptionsRaw = userArgs.slice(1).join(' ');
  let infoBlock = buildTelegramInfoBlock({
    locale: solveLocale,
    requester,
    urlKind: validation.parsed?.type === 'pull' ? 'pullRequest' : 'issue',
    url: escapeMarkdown(normalizedUrl),
    optionsRaw: userOptionsRaw ? escapeMarkdown(userOptionsRaw) : '',
    lockedOptions: solveOverrides.length > 0 ? escapeMarkdown(solveOverrides.join(' ')) : '',
  });
  const solveQueue = getSolveQueue({ verbose: VERBOSE });

  // Check for duplicate URL in queue (issue #1080)
  const existingItem = solveQueue.findByUrl(normalizedUrl);
  if (existingItem) {
    const statusText = existingItem.status === 'starting' || existingItem.status === 'started' ? 'being processed' : 'already in the queue';
    await safeReply(ctx, t('telegram.url_status_active', { statusText, url: escapeMarkdown(normalizedUrl), status: existingItem.status }, { locale: solveLocale }), { reply_to_message_id: ctx.message.message_id });
    return;
  }
  // Issue #1567: Prevent concurrent sessions on the same PR/issue
  const activeSession = await hasActiveSessionForUrlAsync(normalizedUrl, VERBOSE);
  if (activeSession.isActive) {
    await safeReply(ctx, t('telegram.url_session_running', { url: escapeMarkdown(normalizedUrl), session: activeSession.sessionName }, { locale: solveLocale }), { reply_to_message_id: ctx.message.message_id });
    return;
  }
  const check = await solveQueue.canStartCommand({ tool: solveTool, locale: solveLocale }); // Skip Claude limits for agent (#1159)
  const queueStats = solveQueue.getStats();
  // Handle rejection: threshold strategy is 'reject' — fail immediately (issue #1267)
  if (check.rejected) {
    await safeReply(ctx, t('telegram.solve_rejected', { infoBlock, reason: escapeMarkdown(check.rejectReason || 'Unknown') }, { locale: solveLocale }), { reply_to_message_id: ctx.message.message_id });
    return;
  }

  // Issue #1688: parsed URL context lets the completion message look up linked PRs.
  const solveUrlContext = validation.parsed ? { owner: validation.parsed.owner, repo: validation.parsed.repo, number: validation.parsed.number, type: validation.parsed.type, normalized: validation.parsed.normalized || normalizedUrl } : null;

  const toolQueuedCount = queueStats.queuedByTool[solveTool] || 0; // tool-specific queue count (#1551)
  // Issue #378: propagate user's effective Telegram locale to the spawned solve session.
  const argsWithLocale = injectLanguageIfMissing(args, solveLocale);

  // Issue #594: append "Limits at start" to infoBlock; thread snapshot via sessionInfo.
  let solveLimitsAtStart = null;
  if (solveShowLimits) ({ infoBlock, limitsAtStart: solveLimitsAtStart } = await captureStartSnapshotAndAppend({ infoBlock, tool: solveTool, verbose: VERBOSE, limitsLib, commandLabel: '/solve', locale: solveLocale }));

  if (check.canStart && toolQueuedCount === 0) {
    const startingMessage = await safeReply(ctx, formatStartingWorkSessionMessage({ infoBlock, locale: solveLocale }), { reply_to_message_id: ctx.message.message_id });
    await executeAndUpdateMessage(ctx, startingMessage, 'solve', argsWithLocale, infoBlock, effectiveSolveIsolation, solveTool, solveUrlContext, { showLimits: solveShowLimits, limitsAtStart: solveLimitsAtStart, locale: solveLocale });
  } else {
    const queueItem = solveQueue.enqueue({ url: normalizedUrl, args: argsWithLocale, ctx, requester, infoBlock, tool: solveTool, perCommandIsolation: effectiveSolveIsolation, urlContext: solveUrlContext, showLimits: solveShowLimits, limitsAtStart: solveLimitsAtStart, locale: solveLocale });
    const queueMessage = buildSolveQueuedMessage({ locale: solveLocale, tool: solveTool, position: toolQueuedCount + 1, infoBlock, reason: check.reason ? escapeMarkdown(check.reason) : '' }); // tool-specific position (#1551)
    const queuedMessage = await safeReply(ctx, queueMessage, { reply_to_message_id: ctx.message.message_id });
    queueItem.messageInfo = { chatId: queuedMessage.chat.id, messageId: queuedMessage.message_id };
    if (!solveQueue.executeCallback) {
      const _t = (s, i) => trackSession(s, i, VERBOSE);
      solveQueue.executeCallback = createIsolationAwareQueueCallback(ISOLATION_BACKEND, isolationRunner, _t, createQueueExecuteCallback(executeStartScreen, _t), VERBOSE);
    }
  }
}

bot.command(
  SOLVE_COMMAND_NAMES.map(command => new RegExp(`^${command}$`, 'i')),
  handleSolveCommand
);

// Named handler for /hive command - extracted for reuse by text-based fallback (issue #1207)
async function handleHiveCommand(ctx) {
  if (VERBOSE) {
    console.log('[VERBOSE] /hive command received');
  }

  // Add breadcrumb for error tracking
  await addBreadcrumb({
    category: 'telegram.command',
    message: '/hive command received',
    level: 'info',
    data: {
      chatId: ctx.chat?.id,
      chatType: ctx.chat?.type,
      userId: ctx.from?.id,
      username: ctx.from?.username,
    },
  });

  const hiveLocale = resolveLocaleFromTelegramCtx(ctx);
  if (!hiveEnabled) {
    if (VERBOSE) {
      console.log('[VERBOSE] /hive ignored: command disabled');
    }
    await ctx.reply(t('telegram.hive_disabled', {}, { locale: hiveLocale }));
    return;
  }

  // Ignore messages sent before bot started
  if (isOldMessage(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /hive ignored: old message');
    }
    return;
  }

  // Ignore forwarded or reply messages
  if (isForwardedOrReply(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /hive ignored: forwarded or reply');
    }
    return;
  }

  if (!_isGroupChat(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /hive ignored: not a group chat');
    }
    await ctx.reply(t('telegram.hive_only_in_groups', {}, { locale: hiveLocale }), { reply_to_message_id: ctx.message.message_id });
    return;
  }

  if (!isTopicAuthorized(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /hive ignored: not authorized');
    }
    await ctx.reply(buildAuthErrorMessage(ctx), { reply_to_message_id: ctx.message.message_id });
    return;
  }

  // Check if chat is stopped (issue #1081) - reject with same style as queue rejected mode
  const chatId = ctx.chat.id;
  if (isChatStopped(chatId)) {
    VERBOSE && console.log('[VERBOSE] /hive rejected: chat is stopped');
    await safeReply(ctx, getStoppedChatRejectMessage(chatId, 'Hive'), { reply_to_message_id: ctx.message.message_id });
    return;
  }

  VERBOSE && console.log('[VERBOSE] /hive passed all checks, executing...');

  let userArgs = parseCommandArgs(ctx.message.text);

  // Issue #594: see /solve handler.
  const hiveSL = await handleShowLimitsFlag({ ctx, safeReply, args: userArgs, enabled: SHOW_LIMITS_ENABLED, locale: hiveLocale });
  if (hiveSL.handled) return;
  const hiveShowLimits = hiveSL.showLimits;
  userArgs = hiveSL.args;

  // Issue #1102: Allow issues_list/pulls_list URLs and normalize to repo URLs
  const validation = await validateGitHubUrl(userArgs, { allowedTypes: ['repo', 'organization', 'user', 'issues_list', 'pulls_list'], commandName: 'hive', createYargsConfig: createHiveYargsConfig, positionalNames: ['github-url'], locale: hiveLocale });
  if (!validation.valid) {
    let errorMsg = `❌ ${validation.error}`;
    if (validation.suggestion) errorMsg += `\n\n${t('telegram.did_you_mean', { suggestion: escapeMarkdown(validation.suggestion) }, { locale: hiveLocale })}`;
    errorMsg += `\n\n${t('telegram.hive_invalid_url_help', {}, { locale: hiveLocale })}`;
    await safeReply(ctx, errorMsg, { reply_to_message_id: ctx.message.message_id });
    return;
  }
  // Normalize issues_list/pulls_list to base repo URL, or use cleaned URL
  let normalizedArgs = moveArgumentToFront(userArgs, validation.normalizedUrl, cleanNonPrintableChars);
  const p = validation.parsed;
  if (p && (p.type === 'issues_list' || p.type === 'pulls_list')) {
    normalizedArgs[0] = `https://github.com/${p.owner}/${p.repo}`;
    if (VERBOSE) console.log(`[VERBOSE] /hive: Normalized ${p.type} URL to repo URL: ${normalizedArgs[0]}`);
  } else if (validation.normalizedUrl && validation.normalizedUrl !== userArgs[0]) normalizedArgs[0] = validation.normalizedUrl;

  const { backend: hivePerCommandIsolation, filteredArgs: normalizedArgsWithoutIsolation } = extractIsolationFromArgs(normalizedArgs); // issue #1534
  if (hivePerCommandIsolation && !isValidPerCommandIsolation(hivePerCommandIsolation)) {
    await safeReply(ctx, t('telegram.invalid_isolation', { value: escapeMarkdown(hivePerCommandIsolation) }, { locale: hiveLocale }), { reply_to_message_id: ctx.message.message_id });
    return;
  }
  const mergedHiveArgs = mergeArgsWithOverrides(normalizedArgsWithoutIsolation, hiveOverrides);
  const { backend: hiveOverrideIsolation, filteredArgs: args } = extractIsolationFromArgs(mergedHiveArgs);
  if (hiveOverrideIsolation && !isValidPerCommandIsolation(hiveOverrideIsolation)) {
    await safeReply(ctx, t('telegram.invalid_locked_isolation', { value: escapeMarkdown(hiveOverrideIsolation) }, { locale: hiveLocale }), { reply_to_message_id: ctx.message.message_id });
    return;
  }
  const effectiveHiveIsolation = hiveOverrideIsolation || hivePerCommandIsolation;

  // Determine tool from args (default: claude)
  let hiveTool = 'claude';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tool' && i + 1 < args.length) {
      hiveTool = args[i + 1];
    } else if (args[i].startsWith('--tool=')) {
      hiveTool = args[i].substring('--tool='.length);
    }
  }

  // Validate model name with helpful error message (before yargs validation)
  const hiveModelError = validateModelInArgs(args, hiveTool);
  if (hiveModelError) {
    await safeReply(ctx, `❌ ${escapeMarkdown(hiveModelError)}`, { reply_to_message_id: ctx.message.message_id });
    return;
  }
  // Issue #1482: Validate branch flags early to reject URLs and invalid branch names
  const hiveBranchError = validateBranchInArgs(args);
  if (hiveBranchError) {
    await safeReply(ctx, `❌ ${escapeMarkdown(hiveBranchError)}`, { reply_to_message_id: ctx.message.message_id });
    return;
  }

  // Validate merged arguments using hive's yargs config
  try {
    await parseArgsWithYargs(args, yargs, createHiveYargsConfig);
  } catch (error) {
    await safeReply(ctx, t('telegram.invalid_options', { message: escapeMarkdown(error.message || String(error)) }, { locale: hiveLocale }), {
      reply_to_message_id: ctx.message.message_id,
    });
    return;
  }

  const requester = buildUserMention({ user: ctx.from, parseMode: 'Markdown' });
  // Issue #1228: Show only user-provided options (exclude locked overrides to avoid duplication)
  // Issue #1460: Escape options text to prevent Markdown parsing errors
  const userOptionsRaw = normalizedArgs.slice(1).join(' ');
  let infoBlock = buildTelegramInfoBlock({
    locale: hiveLocale,
    requester,
    urlKind: 'url',
    url: escapeMarkdown(args[0]),
    optionsRaw: userOptionsRaw ? escapeMarkdown(userOptionsRaw) : '',
    lockedOptions: hiveOverrides.length > 0 ? escapeMarkdown(hiveOverrides.join(' ')) : '',
  });

  // Issue #594: see /solve handler.
  let hiveLimitsAtStart = null;
  if (hiveShowLimits) ({ infoBlock, limitsAtStart: hiveLimitsAtStart } = await captureStartSnapshotAndAppend({ infoBlock, tool: hiveTool, verbose: VERBOSE, limitsLib, commandLabel: '/hive', locale: hiveLocale }));

  const startingMessage = await safeReply(ctx, formatStartingWorkSessionMessage({ infoBlock, locale: hiveLocale }), { reply_to_message_id: ctx.message.message_id });
  // Issue #378: propagate user's effective Telegram locale to the spawned hive session.
  const hiveArgsWithLocale = injectLanguageIfMissing(args, hiveLocale);
  await executeAndUpdateMessage(ctx, startingMessage, 'hive', hiveArgsWithLocale, infoBlock, effectiveHiveIsolation, hiveTool, null, { showLimits: hiveShowLimits, limitsAtStart: hiveLimitsAtStart, locale: hiveLocale });
}

bot.command(/^hive$/i, handleHiveCommand);

const { registerTopCommand } = await import('./telegram-top-command.lib.mjs');
const { registerStartStopCommands } = await import('./telegram-start-stop-command.lib.mjs');
const { registerLogCommand } = await import('./telegram-log-command.lib.mjs');
registerTopCommand(bot, sharedCommandOpts);
registerStartStopCommands(bot, { ...sharedCommandOpts, getSolveQueue });
await registerLogCommand(bot, sharedCommandOpts);
await registerTerminalWatchCommand(bot, sharedCommandOpts);

// Issue #1745: hidden /tokens command for chat owners (private DMs only,
// undocumented, masked output). Lets operators audit which local tokens are
// live in the bot's environment so they can search for accidental leaks.
const { registerTokensCommand } = await import('./telegram-tokens-command.lib.mjs');
registerTokensCommand(bot, { ...sharedCommandOpts, allowedChats });

// Issue #1745: register the leak-warning DM hook. The interactive bridge
// fires reportInteractiveLeak() whenever it has to mask a known-local token
// in an outbound PR comment. We DM every operator (chat creator) of every
// allowlisted chat so at least one of them sees it quickly.
const { registerLeakNotifier } = await import('./telegram-leak-notifier.lib.mjs');
registerLeakNotifier(async ({ owner, repo, prNumber, tokenHits = [] }) => {
  if (!allowedChats || allowedChats.length === 0) return;
  const where = prNumber ? `${owner}/${repo}#${prNumber}` : `${owner}/${repo}`;
  const sources = tokenHits.length ? tokenHits.map(h => `${h.name} (${h.source})`).join(', ') : 'unknown';
  const text = `🚨 *Token-leak event*\n\nA known local token was about to be published in *${where}* and was masked by the sanitizer just in time.\n\nTokens detected: ${sources}\n\nRotate the affected secret(s) now and check public surfaces (GitHub comments, gists, Slack) for any prior copies.`;
  for (const chatId of allowedChats) {
    try {
      const member = await bot.telegram.getChatMember(chatId, chatId).catch(() => null);
      // For groups, getChatMember(chatId, chatId) returns the chat itself; we
      // really want the creator. Fall back to getChatAdministrators.
      let ownerUserId = null;
      if (member && member.status === 'creator' && member.user?.id) {
        ownerUserId = member.user.id;
      } else {
        const admins = await bot.telegram.getChatAdministrators(chatId).catch(() => []);
        const creator = (admins || []).find(a => a.status === 'creator');
        if (creator && creator.user?.id) ownerUserId = creator.user.id;
      }
      if (ownerUserId) {
        await bot.telegram.sendMessage(ownerUserId, text, { parse_mode: 'Markdown' }).catch(err => {
          console.warn(`[telegram-leak-notifier] DM to user ${ownerUserId} (chat ${chatId}) failed: ${err.message}`);
        });
      }
    } catch (err) {
      console.warn(`[telegram-leak-notifier] could not notify owner of chat ${chatId}: ${err.message}`);
    }
  }
});

// Add message listener for verbose debugging
if (VERBOSE) {
  bot.on('message', (ctx, next) => {
    const msg = ctx.message;
    console.log('[VERBOSE] Message:', {
      chatId: ctx.chat?.id,
      chatType: ctx.chat?.type,
      isForum: ctx.chat?.is_forum,
      isTopicMsg: msg?.is_topic_message,
      threadId: msg?.message_thread_id,
      date: msg?.date,
      text: msg?.text?.substring(0, 100),
      user: ctx.from?.username || ctx.from?.id,
      botStartTime: BOT_START_TIME,
      isOld: isOldMessage(ctx),
      isForwarded: isForwardedOrReply(ctx),
      isAuthorized: isChatAuthorized(ctx.chat?.id),
    });
    if (msg) {
      console.log('[VERBOSE] Msg fields:', Object.keys(msg));
      // Log entities for command matching diagnostics (issue #1207)
      if (msg.entities) {
        console.log('[VERBOSE] Entities:', JSON.stringify(msg.entities));
      }
      console.log('[VERBOSE] Forward/reply:', {
        forward_origin: msg.forward_origin,
        forward_from: msg.forward_from,
        forward_from_chat: msg.forward_from_chat,
        forward_date: msg.forward_date,
        reply_to_message: msg.reply_to_message,
        reply_id: msg.reply_to_message?.message_id,
        forum_topic_created: msg.reply_to_message?.forum_topic_created,
      });
    }
    return next();
  });
}

// Text-based fallback for command matching (issue #1207)
// Telegraf's bot.command() relies on Telegram's bot_command entities. In rare cases,
// messages may not have the expected entity at offset 0 (e.g., certain clients, edge cases
// with message formatting, or entity ordering), causing bot.command() to silently skip
// the message. This fallback uses text pattern matching to catch those missed commands.
// It runs AFTER bot.command() handlers, so it only fires when entity-based matching fails.
bot.on('message', async (ctx, next) => {
  const text = ctx.message?.text;
  if (!text) return next();

  // Extract command from text using the testable filter function
  // Note: We pass null for botUsername here and check it separately with ctx.me
  // which is set by Telegraf after bot initialization
  const extracted = extractCommandFromText(text);
  if (!extracted) return next();

  // If command mentions a specific bot, verify it's us
  if (extracted.botMention) {
    const myUsername = ctx.me; // Telegraf sets this from getMe()
    if (!myUsername || extracted.botMention.toLowerCase() !== myUsername.toLowerCase()) {
      return next(); // Command is for a different bot or we can't verify
    }
  }

  // /subscribe + /unsubscribe (#1688) are intentionally not in the text fallback — Telegraf's bot.command() is sufficient.
  const solveHandlers = Object.fromEntries(SOLVE_COMMAND_NAMES.map(command => [command, handleSolveCommand]));
  const taskHandlers = Object.fromEntries(TASK_COMMAND_NAMES.map(command => [command, handleTaskCommand]));
  // /queue is the short alias for /solve_queue (issue #1837)
  const handlers = { ...solveHandlers, ...taskHandlers, auth: handleAuthCommand, hive: handleHiveCommand, solve_queue: handleSolveQueueCommand, solvequeue: handleSolveQueueCommand, queue: handleSolveQueueCommand };

  const handler = handlers[extracted.command];
  if (!handler) return next();

  // Log that fallback was triggered - this indicates bot.command() entity matching failed
  console.warn(`[WARNING] Command /${extracted.command} matched by text fallback, not by entity-based bot.command(). ` + `Entities: ${JSON.stringify(ctx.message.entities || [])}. ` + `User: ${ctx.from?.username || ctx.from?.id}. ` + `This may indicate a Telegram client entity issue (issue #1207).`);

  await handler(ctx);
});

// Add global error handler for uncaught errors in middleware
bot.catch((error, ctx) => {
  console.error('Unhandled error while processing update', ctx.update.update_id);
  console.error('Error:', error);
  console.error('Error details:', {
    name: error.name,
    message: error.message,
    stack: error.stack?.split('\n').slice(0, 10).join('\n'),
  });
  if (VERBOSE) {
    console.log('[VERBOSE] Error context:', {
      chatId: ctx.chat?.id,
      chatType: ctx.chat?.type,
      messageText: ctx.message?.text?.substring(0, 100),
      fromUser: ctx.from?.username || ctx.from?.id,
      updateId: ctx.update.update_id,
    });
  }

  // Report error to Sentry with context
  reportError(error, {
    telegramContext: {
      chatId: ctx.chat?.id,
      chatType: ctx.chat?.type,
      updateId: ctx.update.update_id,
      command: ctx.message?.text?.split(' ')[0],
      userId: ctx.from?.id,
      username: ctx.from?.username,
    },
  });

  // Try to notify the user about the error with more details
  if (ctx?.reply) {
    const isTelegramParsingError = isTelegramFormattingError(error);
    const isTelegramTextLimitError = isTelegramMessageTooLongError(error);

    let errorMessage;

    if (isTelegramParsingError || isTelegramTextLimitError) {
      // Issue #1460: Log detailed context for root cause analysis (always logged, not just in verbose mode)
      const userInfo = ctx.from ? { id: ctx.from.id, username: ctx.from.username, first_name: ctx.from.first_name, last_name: ctx.from.last_name } : 'unknown';
      const errorKind = isTelegramTextLimitError ? 'Message length error' : 'Parsing error';
      console.error(`[telegram-bot] ${errorKind}: ${error.message}`);
      console.error(`[telegram-bot] ${errorKind} context - user: ${JSON.stringify(userInfo)}, command: ${ctx.message?.text?.split(' ')[0] || 'unknown'}`);
      console.error(`[telegram-bot] User input text: ${ctx.message?.text || 'none'}`);
      if (ctx.message?.text) {
        const visibleInput = makeSpecialCharsVisible(ctx.message.text, { maxLength: 500 });
        console.error(`[telegram-bot] User input (special chars visible): ${visibleInput}`);
        const cleanedInput = cleanNonPrintableChars(ctx.message.text);
        if (cleanedInput !== ctx.message.text) {
          console.error(`[telegram-bot] ${ctx.message.text.length - cleanedInput.length} hidden character(s) detected in input`);
        }
      }

      if (isTelegramTextLimitError) {
        errorMessage = `❌ Telegram rejected an oversized bot message.\n\nThe bot splits messages above ${TELEGRAM_TEXT_LIMIT} characters automatically. Please try your command again.\n\nIf the issue persists, contact support with Update ID: ${ctx.update.update_id}`;
      } else {
        errorMessage = `❌ Telegram rejected a formatted bot message, and the fallback handler could not recover automatically.\n\nPlease try your command again.\n\nIf the issue persists, contact support with Update ID: ${ctx.update.update_id}`;
      }
    } else {
      errorMessage = '❌ An error occurred while processing your request.\n\n';
      if (error.message) {
        // Filter out sensitive info and escape markdown
        const sanitizedMessage = escapeMarkdown(
          error.message
            .replace(/token[s]?\s*[:=]\s*[\w-]+/gi, 'token: [REDACTED]')
            .replace(/password[s]?\s*[:=]\s*[\w-]+/gi, 'password: [REDACTED]')
            .replace(/api[_-]?key[s]?\s*[:=]\s*[\w-]+/gi, 'api_key: [REDACTED]')
        );
        errorMessage += `Details: ${sanitizedMessage}\n`;
      }
      errorMessage += '\n💡 Troubleshooting:\n• Try running the command again\n• Check if all required parameters are correct\n• Use /help to see command examples\n• If the issue persists, contact support with the error details above';
      if (VERBOSE) errorMessage += `\n\n🔍 Debug info: Update ID: ${ctx.update.update_id}`;
    }

    safeReply(ctx, errorMessage, { fallbackLocale: resolveLocaleFromTelegramCtx(ctx), verbose: VERBOSE }).catch(replyError => {
      console.error('Failed to send error message to user:', replyError);
      const plainMessage = `An error occurred while processing your request. Please try again or contact support.\n\nError: ${error.message || 'Unknown error'}`;
      ctx.reply(plainMessage).catch(fallbackError => {
        console.error('Failed to send fallback error message:', fallbackError);
      });
    });
  }
});

// Track shutdown state to prevent startup messages after shutdown
let isShuttingDown = false;

console.log('🤖 SwarmMindBot is starting...');
console.log('Bot token:', BOT_TOKEN.substring(0, 10) + '...');
if (allowedChats && allowedChats.length > 0) {
  console.log('Allowed chats (lino):', lino.format(allowedChats));
} else {
  console.log('Allowed chats: All (no restrictions)');
}
if (allowedTopics && allowedTopics.length > 0) {
  console.log('Allowed topics (lino):', lino.formatLinks(allowedTopics));
}
console.log('Commands enabled:', { solve: solveEnabled, hive: hiveEnabled, task: taskEnabled, auth: authEnabled });
if (solveOverrides.length > 0) console.log('Solve overrides (lino):', lino.format(solveOverrides));
if (hiveOverrides.length > 0) console.log('Hive overrides (lino):', lino.format(hiveOverrides));
if (VERBOSE) {
  console.log('[VERBOSE] Verbose logging enabled');
  console.log('[VERBOSE] Bot start time (Unix):', BOT_START_TIME);
  console.log('[VERBOSE] Bot start time (ISO):', new Date(BOT_START_TIME * 1000).toISOString());
}

// Launch bot with retry logic (issue #1240: handle 409 Conflict with exponential backoff)
// The launcher handles deleteWebhook + bot.launch() with retry on transient errors.
// Non-retryable errors (401 Unauthorized) cause immediate exit.
const launchAbortController = new AbortController();
let sessionMonitoringTimer = null;
let launchAnnouncementShown = false;

function startSessionMonitoringOnce() {
  if (sessionMonitoringTimer) return;
  sessionMonitoringTimer = startSessionMonitoring(bot, VERBOSE);
}

async function onBotLaunched() {
  if (isShuttingDown || launchAnnouncementShown) return;
  launchAnnouncementShown = true;

  console.log('✅ SwarmMindBot is now running!');
  console.log('Press Ctrl+C to stop');
  startSessionMonitoringOnce();

  if (VERBOSE) {
    console.log('[VERBOSE] Bot launched successfully');
    console.log('[VERBOSE] Polling is active, waiting for messages...');

    // Get bot info and webhook status for diagnostics
    try {
      const botInfo = await bot.telegram.getMe();
      const webhookInfo = await bot.telegram.getWebhookInfo();

      console.log('[VERBOSE] Bot info:');
      console.log('[VERBOSE]   Username: @' + botInfo.username);
      console.log('[VERBOSE]   Bot ID:', botInfo.id);
      console.log('[VERBOSE] Webhook info:');
      console.log('[VERBOSE]   URL:', webhookInfo.url || 'none (polling mode)');
      console.log('[VERBOSE]   Pending updates:', webhookInfo.pending_update_count);
      if (webhookInfo.last_error_date) {
        console.log('[VERBOSE]   Last error:', new Date(webhookInfo.last_error_date * 1000).toISOString());
        console.log('[VERBOSE]   Error message:', webhookInfo.last_error_message);
      }

      console.log('[VERBOSE]');
      console.log('[VERBOSE] ⚠️  IMPORTANT: If bot is not receiving messages in group chats:');
      console.log('[VERBOSE]   1. Privacy Mode: Check if bot has privacy mode enabled in @BotFather');
      console.log('[VERBOSE]      - Send /setprivacy to @BotFather');
      console.log('[VERBOSE]      - Select @' + botInfo.username);
      console.log('[VERBOSE]      - Choose "Disable" to receive all group messages');
      console.log('[VERBOSE]      - IMPORTANT: Remove bot from group and re-add after changing!');
      console.log('[VERBOSE]   2. Admin Status: Make bot an admin in the group (admins see all messages)');
      console.log('[VERBOSE]   3. Run diagnostic: node experiments/test-telegram-bot-privacy-mode.mjs');
      console.log('[VERBOSE]');
    } catch (err) {
      console.log('[VERBOSE] Could not fetch bot info:', err.message);
    }

    console.log('[VERBOSE] Send a message to the bot to test message reception');
  }
}

// Start completion polling before entering Telegraf long polling. The active
// session map is empty until commands are received, but bot.launch() may stay
// pending while polling is active.
startSessionMonitoringOnce();

launchBotWithRetry(
  bot,
  {
    allowedUpdates: ['message', 'callback_query'], // Receive messages and callback queries
    dropPendingUpdates: true, // Drop pending updates sent before bot started
  },
  {
    verbose: VERBOSE,
    signal: launchAbortController.signal,
    onLaunch: onBotLaunched,
  }
)
  .then(() => {
    if (!isShuttingDown && VERBOSE) console.log('[VERBOSE] Bot launch promise resolved');
  })
  .catch(error => {
    console.error('❌ Failed to start bot:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
    });
    if (VERBOSE) {
      console.error('[VERBOSE] Full error:', error);
    }
    process.exit(1);
  });

// Helper to stop solve queue gracefully on shutdown (see issue #1083)
const stopSolveQueue = () => {
  try {
    getSolveQueue({ verbose: VERBOSE }).stop();
  } catch {
    /* ignore errors during shutdown */
  }
};

process.once('SIGINT', () => {
  isShuttingDown = true;
  console.log('\n🛑 Received SIGINT (Ctrl+C), stopping bot...');
  if (VERBOSE) console.log(`[VERBOSE] Signal: SIGINT, PID: ${process.pid}, PPID: ${process.ppid}`);
  launchAbortController.abort(); // Cancel retry loop if still retrying (issue #1240)
  if (sessionMonitoringTimer) clearInterval(sessionMonitoringTimer);
  stopSolveQueue();
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  isShuttingDown = true;
  console.log('\n🛑 Received SIGTERM, stopping bot... (Check system logs: journalctl -u <service> or dmesg)');
  if (VERBOSE) console.log(`[VERBOSE] Signal: SIGTERM, PID: ${process.pid}, PPID: ${process.ppid}`);
  launchAbortController.abort(); // Cancel retry loop if still retrying (issue #1240)
  if (sessionMonitoringTimer) clearInterval(sessionMonitoringTimer);
  stopSolveQueue();
  bot.stop('SIGTERM');
});
