#!/usr/bin/env node
// Early exit for --version (issue #1318: avoid dotenvx MISSING_ENV_FILE warnings)
if (process.argv.includes('--version')) {
  const v = await import('./version.lib.mjs').then(m => m.getVersion()).catch(() => 'unknown');
  console.log(v);
  process.exit(v === 'unknown' ? 1 : 0);
}

import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { lino } = await import('./lino.lib.mjs');
const { buildUserMention } = await import('./buildUserMention.lib.mjs');
const { reportError, initializeSentry, addBreadcrumb } = await import('./sentry.lib.mjs');
const { loadLenvConfig } = await import('./lenv-reader.lib.mjs');

const dotenvxModule = await use('@dotenvx/dotenvx');
const dotenvx = dotenvxModule.default || dotenvxModule;
const getenvModule = await use('getenv');
const getenv = typeof getenvModule === 'function' ? getenvModule : getenvModule.default || getenvModule;

// Load .env/.lenv configuration (issue #1318)
dotenvx.config({ quiet: true, ignore: ['MISSING_ENV_FILE'] });
loadLenvConfig({ override: true, quiet: true });

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const helpersModuleBot = await use('yargs@17.7.2/helpers');
const _helpersBot = helpersModuleBot.default || helpersModuleBot;
const hideBin = _helpersBot.hideBin || (argv => argv.slice(2));
const { createYargsConfig: createSolveYargsConfig, detectMalformedFlags } = await import('./solve.config.lib.mjs');
const { createYargsConfig: createHiveYargsConfig } = await import('./hive.config.lib.mjs');
const { parseGitHubUrl, validateGitHubEntityExistence } = await import('./github.lib.mjs');
const { validateModelName, buildModelOptionDescription } = await import('./models/index.mjs');
const { validateBranchInArgs } = await import('./solve.branch.lib.mjs');
const { extractIsolationFromArgs, isValidPerCommandIsolation, resolveIsolation, createIsolationAwareQueueCallback } = await import('./telegram-isolation.lib.mjs');
const { formatUsageMessage, getAllCachedLimits } = await import('./limits.lib.mjs');
const { getVersionInfo, formatVersionMessage } = await import('./version-info.lib.mjs');
const { escapeMarkdown, escapeMarkdownV2, cleanNonPrintableChars, makeSpecialCharsVisible } = await import('./telegram-markdown.lib.mjs');
const { getSolveQueue, createQueueExecuteCallback } = await import('./telegram-solve-queue.lib.mjs');
const { isChatStopped, getChatStopInfo, getStoppedChatRejectMessage, DEFAULT_STOP_REASON } = await import('./telegram-start-stop-command.lib.mjs');
const { isOldMessage: _isOldMessage, isGroupChat: _isGroupChat, isChatAuthorized: _isChatAuthorized, isForwardedOrReply: _isForwardedOrReply, extractCommandFromText, extractGitHubUrl: _extractGitHubUrl } = await import('./telegram-message-filters.lib.mjs');
const { launchBotWithRetry } = await import('./telegram-bot-launcher.lib.mjs');
const { trackSession, startSessionMonitoring, hasActiveSessionForUrl } = await import('./session-monitor.lib.mjs');

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
  .option('isolation', { type: 'string', description: 'Experimental: isolation backend (screen/tmux/docker)', default: getenv('TELEGRAM_ISOLATION', '') })
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
  loadLenvConfig({ configuration: config.configuration, override: true, quiet: true });
}

const BOT_TOKEN = config.token || getenv('TELEGRAM_BOT_TOKEN', '');
const VERBOSE = config.verbose || getenv('TELEGRAM_BOT_VERBOSE', 'false') === 'true';
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
    // Add a dummy URL as the first argument (required positional for solve)
    const testArgs = ['https://github.com/test/test/issues/1', ...solveOverrides];

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
      const overrideBranchError = validateBranchInArgs(solveOverrides);
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
    // Add a dummy URL as the first argument (required positional for hive)
    const testArgs = ['https://github.com/test/test', ...hiveOverrides];

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
      const overrideBranchError = validateBranchInArgs(hiveOverrides); // Issue #1482
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
  console.log('  Commands enabled:', { solve: solveEnabled, hive: hiveEnabled });
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

const telegrafModule = await use('telegraf');
const { Telegraf } = telegrafModule;

const bot = new Telegraf(BOT_TOKEN, {
  handlerTimeout: Infinity, // Remove default 90s timeout; command handlers like /solve spawn long-running processes
});

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

function isForwardedOrReply(ctx) {
  return _isForwardedOrReply(ctx, { verbose: VERBOSE });
}

async function findStartScreenCommand() {
  try {
    const { stdout } = await exec('which start-screen');
    return stdout.trim();
  } catch {
    return null;
  }
}

async function executeStartScreen(command, args) {
  try {
    // Check if start-screen is available BEFORE first execution
    const whichPath = await findStartScreenCommand();

    if (!whichPath) {
      const warningMsg = '⚠️  WARNING: start-screen command not found in PATH\n' + 'Please ensure @link-assistant/hive-mind is properly installed\n' + 'You may need to run: npm install -g @link-assistant/hive-mind';
      console.warn(warningMsg);

      // Still try to execute with 'start-screen' in case it's available in PATH but 'which' failed
      return {
        success: false,
        warning: warningMsg,
        error: 'start-screen command not found in PATH',
      };
    }

    // Use the resolved path from which
    if (VERBOSE) {
      console.log(`[VERBOSE] Found start-screen at: ${whichPath}`);
    }

    return await executeWithCommand(whichPath, command, args);
  } catch (error) {
    console.error('Error executing start-screen:', error);
    return {
      success: false,
      output: '',
      error: error.message,
    };
  }
}

function executeWithCommand(startScreenCmd, command, args) {
  return new Promise(resolve => {
    const allArgs = [command, ...args];

    if (VERBOSE) {
      console.log(`[VERBOSE] Executing: ${startScreenCmd} ${allArgs.join(' ')}`);
    } else {
      console.log(`Executing: ${startScreenCmd} ${allArgs.join(' ')}`);
    }

    const child = spawn(startScreenCmd, allArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => {
      stdout += data.toString();
    });

    child.stderr.on('data', data => {
      stderr += data.toString();
    });

    child.on('error', error => {
      resolve({
        success: false,
        output: stdout,
        error: error.message,
      });
    });

    child.on('close', code => {
      if (code === 0) {
        resolve({
          success: true,
          output: stdout,
        });
      } else {
        resolve({
          success: false,
          output: stdout,
          error: stderr || `Command exited with code ${code}`,
        });
      }
    });
  });
}

/**
 * Validates the model name in the args array and returns an error message if invalid
 * @param {string[]} args - Array of command arguments
 * @param {string} tool - The tool to validate against ('claude' or 'opencode')
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

function parseCommandArgs(text) {
  // Use only first line and trim it
  const firstLine = text.split('\n')[0].trim();
  const argsText = firstLine.replace(/^\/\w+\s*/, '');

  if (!argsText.trim()) {
    return [];
  }

  // Replace em-dash (—) with double-dash (--) to fix Telegram auto-replacement
  const normalizedArgsText = argsText.replace(/—/g, '--');

  const args = [];
  let currentArg = '';
  let inQuotes = false;
  let quoteChar = null;

  for (let i = 0; i < normalizedArgsText.length; i++) {
    const char = normalizedArgsText[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = null;
    } else if (char === ' ' && !inQuotes) {
      if (currentArg) {
        args.push(currentArg);
        currentArg = '';
      }
    } else {
      currentArg += char;
    }
  }

  if (currentArg) {
    args.push(currentArg);
  }

  return args;
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

/** Validate GitHub URL for Telegram bot commands. Returns { valid, error?, parsed?, normalizedUrl? } */
function validateGitHubUrl(args, options = {}) {
  const { allowedTypes = ['issue', 'pull'], commandName = 'solve' } = options;
  if (args.length === 0) return { valid: false, error: `Missing GitHub URL. Usage: /${commandName} <github-url> [options]` };
  // Issue #1102: Clean non-printable chars (Zero-Width Space, BOM, etc.) from URLs
  const url = cleanNonPrintableChars(args[0]);
  if (!url.includes('github.com')) return { valid: false, error: 'First argument must be a GitHub URL' };
  const parsed = parseGitHubUrl(url);
  if (!parsed.valid) return { valid: false, error: parsed.error || 'Invalid GitHub URL', suggestion: parsed.suggestion };
  if (!allowedTypes.includes(parsed.type)) {
    const allowedTypesStr = allowedTypes.map(t => (t === 'pull' ? 'pull request' : t)).join(', ');
    const baseUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;
    const escapedUrl = escapeMarkdown(url),
      escapedBaseUrl = escapeMarkdown(baseUrl); // Issue #1102: escape for Markdown
    let error;
    if (parsed.type === 'issues_list') error = `URL points to the issues list page, but you need a specific issue\n\n💡 How to fix:\n1. Open the repository: ${escapedUrl}\n2. Click on a specific issue\n3. Copy the URL (it should end with /issues/NUMBER)\n\nExample: \`${escapedBaseUrl}/issues/1\``;
    else if (parsed.type === 'pulls_list') error = `URL points to the pull requests list page, but you need a specific pull request\n\n💡 How to fix:\n1. Open the repository: ${escapedUrl}\n2. Click on a specific pull request\n3. Copy the URL (it should end with /pull/NUMBER)\n\nExample: \`${escapedBaseUrl}/pull/1\``;
    else if (parsed.type === 'repo') error = `URL points to a repository, but you need a specific ${allowedTypesStr}\n\n💡 How to fix:\n1. Go to: ${escapedUrl}/issues\n2. Click on an issue to solve\n3. Use the full URL with the issue number\n\nExample: \`${escapedBaseUrl}/issues/1\``;
    else error = `URL must be a GitHub ${allowedTypesStr} (not ${parsed.type.replace('_', ' ')})`;
    return { valid: false, error };
  }
  return { valid: true, parsed, normalizedUrl: url };
}

// Issue #1460/#1497: safeReply - try Markdown first, fall back to plain text on parsing errors
async function safeReply(ctx, text, options = {}) {
  try {
    return await ctx.reply(text, { parse_mode: 'Markdown', ...options });
  } catch (error) {
    const isParsingError = error.message && (error.message.includes("can't parse entities") || error.message.includes("Can't parse entities") || error.message.includes("can't find end of") || (error.message.includes('Bad Request') && error.message.includes('400')));
    if (!isParsingError) throw error;
    console.error(`[telegram-bot] safeReply: Markdown parsing failed: ${error.message}`);
    console.error(`[telegram-bot] safeReply: Failing message (${Buffer.byteLength(text, 'utf-8')} bytes): ${text}`);
    const plainText = text
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .replace(/\\_/g, '_')
      .replace(/\\\*/g, '*')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1');
    return await ctx.reply(plainText, { ...options, parse_mode: undefined });
  }
}

async function executeAndUpdateMessage(ctx, startingMessage, commandName, args, infoBlock, perCommandIsolation = null) {
  const { chat, message_id: msgId } = startingMessage;
  const safeEdit = async text => {
    try {
      await ctx.telegram.editMessageText(chat.id, msgId, undefined, text, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error(`[telegram-bot] Failed to update message for ${commandName}: ${e.message}`);
    }
  };
  const iso = await resolveIsolation(perCommandIsolation, ISOLATION_BACKEND, isolationRunner, VERBOSE);
  let result,
    session,
    extraInfo = '';
  if (iso) {
    session = iso.runner.generateSessionId();
    VERBOSE && console.log(`[VERBOSE] Using isolation (${iso.backend}), session: ${session}`);
    result = await iso.runner.executeWithIsolation(commandName, args, { backend: iso.backend, sessionId: session, verbose: VERBOSE });
    extraInfo = `\n🔒 Isolation: \`${iso.backend}\``;
    if (result.success) trackSession(session, { chatId: ctx.chat.id, messageId: msgId, startTime: new Date(), url: args[0], command: commandName, isolationBackend: iso.backend, sessionId: session }, VERBOSE);
  } else {
    result = await executeStartScreen(commandName, args);
    const match = result.success && (result.output.match(/session:\s*(\S+)/i) || result.output.match(/screen -R\s+(\S+)/));
    session = match ? match[1] : 'unknown';
    if (result.success && session !== 'unknown') trackSession(session, { chatId: ctx.chat.id, messageId: msgId, startTime: new Date(), url: args[0], command: commandName }, VERBOSE);
  }
  if (result.warning) return safeEdit(`⚠️  ${result.warning}`);
  if (result.success) await safeEdit(`✅ ${commandName.charAt(0).toUpperCase() + commandName.slice(1)} command started successfully!\n\n📊 Session: \`${session}\`${extraInfo}\n\n${infoBlock}\n\n🔔 You will receive a notification when the session finishes.`);
  else await safeEdit(`❌ Error executing ${commandName} command:\n\n\`\`\`\n${result.error || result.output}\n\`\`\``);
}

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
  let message = '🤖 *SwarmMindBot Help*\n\n';

  // Show stopped status if chat is stopped (issue #1081)
  if (isChatStopped(chatId)) {
    const stopInfo = getChatStopInfo(chatId);
    const reason = stopInfo?.reason || DEFAULT_STOP_REASON;
    message += '🛑 *Bot Status: STOPPED*\n';
    message += `Reason: ${reason}\n`;
    if (stopInfo?.stoppedAt) {
      message += `Stopped: ${stopInfo.stoppedAt.toISOString()}\n`;
    }
    message += 'Use /start (chat owner only) to resume.\n\n';
  }

  message += '📋 *Diagnostic Information:*\n';
  message += `• Chat ID: \`${chatId}\`\n`;
  if (topicId) message += `• Topic ID: \`${topicId}\`\n`;
  message += `• Chat Type: ${chatType}\n`;
  message += `• Chat Title: ${chatTitle}\n\n`;
  message += '📝 *Available Commands:*\n\n';

  if (solveEnabled) {
    message += '*/solve* (aliases: */do*, */continue*) - Solve a GitHub issue\n';
    message += 'Usage: `/solve <github-url> [options]`\n';
    message += 'Example: `/solve https://github.com/owner/repo/issues/123 --model sonnet`\n';
    message += 'Or reply to a message with a GitHub link: `/solve`\n';
    if (solveOverrides.length > 0) {
      message += `🔒 Locked options: \`${solveOverrides.join(' ')}\`\n`;
    }
    message += '\n';
  } else {
    message += '*/solve* (aliases: */do*, */continue*) - ❌ Disabled\n\n';
  }

  if (hiveEnabled) {
    message += '*/hive* - Run hive command\n';
    message += 'Usage: `/hive <github-url> [options]`\n';
    message += 'Example: `/hive https://github.com/owner/repo`\n';
    if (hiveOverrides.length > 0) {
      message += `🔒 Locked options: \`${hiveOverrides.join(' ')}\`\n`;
    }
    message += '\n';
  } else {
    message += '*/hive* - ❌ Disabled\n\n';
  }

  message += '`/solve_queue` - Show solve queue status\n';
  message += '*/limits* - Show usage limits\n';
  message += '*/version* - Show bot and runtime versions\n';
  message += '`/accept_invites` - Accept all pending GitHub invitations\n';
  message += '*/merge* - Merge queue (experimental)\n';
  message += 'Usage: `/merge <github-repo-url>`\n';
  message += "Merges all PRs with 'ready' label sequentially.\n";
  message += '*/help* - Show this help message\n';
  message += '*/stop* - Stop accepting new tasks (owner only)\n';
  message += '*/start* - Resume accepting tasks (owner only)\n\n';
  message += '🔔 *Session Notifications:* The bot monitors sessions and notifies when they complete.\n';
  if (ISOLATION_BACKEND) message += `🔒 *Isolation Mode:* \`${ISOLATION_BACKEND}\` (experimental)\n`;
  message += '\n';
  message += '⚠️ *Note:* /solve, /do, /continue, /hive, /solve\\_queue, /limits, /version, /accept\\_invites, /merge, /stop and /start commands only work in group chats.\n\n';
  message += '🔧 *Common Options:*\n';
  message += `• \`--model <model>\` or \`-m\` - ${buildModelOptionDescription()}\n`;
  message += '• `--base-branch <branch>` or `-b` - Target branch for PR (default: repo default branch)\n';
  message += '• `--think <level>` - Thinking level (off/low/medium/high/max) | `--thinking-budget <num>` - Token budget (0-63999)\n';
  message += '• `--verbose` or `-v` - Verbose output | `--attach-logs` - Attach logs to PR\n';
  message += '\n💡 *Tip:* Many more options available. See full documentation for complete list.\n';

  if (allowedChats || allowedTopics) {
    const authorized = isTopicAuthorized(ctx);
    message += `\n🔒 *Restricted Mode:* Authorized: ${authorized ? '✅ Yes' : '❌ No'}`;
    if (!authorized && topicId) message += `\n💡 To allow this topic: \`TELEGRAM_ALLOWED_TOPICS="(${chatId} ${topicId})"\``;
  }

  message += '\n\n🔧 *Troubleshooting:*\n';
  message += 'If bot is not receiving messages:\n';
  message += '1. Check privacy mode in @BotFather\n';
  message += '   • Send `/setprivacy` to @BotFather\n';
  message += '   • Choose "Disable" for your bot\n';
  message += '   • Remove bot from group and re-add\n';
  message += '2. Or make bot an admin in the group\n';
  message += '3. Restart bot with `--verbose` flag for diagnostics';

  await ctx.reply(message, { parse_mode: 'Markdown' });
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

  if (!_isGroupChat(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /limits ignored: not a group chat');
    }
    await ctx.reply('❌ The /limits command only works in group chats. Please add this bot to a group and make it an admin.', { reply_to_message_id: ctx.message.message_id });
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
  const fetchingMessage = await ctx.reply('🔄 Fetching usage limits...', {
    reply_to_message_id: ctx.message.message_id,
  });

  // Get all limits using shared cache (3min for API, 2min for system)
  const limits = await getAllCachedLimits(VERBOSE);

  // Format message with usage limits and queue status (issues #1343, #1267)
  const claudeError = limits.claude.success ? null : limits.claude.error;
  const solveQueue = getSolveQueue({ verbose: VERBOSE });
  const queueStatus = await solveQueue.formatStatus();
  const message = '📊 *Usage Limits*\n\n' + formatUsageMessage(limits.claude.success ? limits.claude.usage : null, limits.disk.success ? limits.disk.diskSpace : null, limits.github.success ? limits.github.githubRateLimit : null, limits.cpu.success ? limits.cpu.cpuLoad : null, limits.memory.success ? limits.memory.memory : null, claudeError, [queueStatus]);
  await ctx.telegram.editMessageText(fetchingMessage.chat.id, fetchingMessage.message_id, undefined, message, { parse_mode: 'Markdown' });
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
  if (!_isGroupChat(ctx)) return await ctx.reply('❌ The /version command only works in group chats. Please add this bot to a group and make it an admin.', { reply_to_message_id: ctx.message.message_id });
  if (!isTopicAuthorized(ctx)) return await ctx.reply(buildAuthErrorMessage(ctx), { reply_to_message_id: ctx.message.message_id });
  const fetchingMessage = await ctx.reply('🔄 Gathering version information...', {
    reply_to_message_id: ctx.message.message_id,
  });
  const result = await getVersionInfo(VERBOSE);
  if (!result.success) return await ctx.telegram.editMessageText(fetchingMessage.chat.id, fetchingMessage.message_id, undefined, `❌ ${escapeMarkdownV2(result.error, { preserveCodeBlocks: true })}`, { parse_mode: 'MarkdownV2' });
  await ctx.telegram.editMessageText(fetchingMessage.chat.id, fetchingMessage.message_id, undefined, '🤖 *Version Information*\n\n' + formatVersionMessage(result.versions), { parse_mode: 'Markdown' });
});

// Register external command modules (keeps telegram-bot.mjs under line limit)
const { registerAcceptInvitesCommand } = await import('./telegram-accept-invitations.lib.mjs');
const sharedCommandOpts = { VERBOSE, isOldMessage, isForwardedOrReply, isGroupChat: _isGroupChat, isChatAuthorized, isTopicAuthorized, buildAuthErrorMessage, addBreadcrumb, isChatStopped, getStoppedChatRejectMessage };
registerAcceptInvitesCommand(bot, sharedCommandOpts);
const { registerMergeCommand } = await import('./telegram-merge-command.lib.mjs');
registerMergeCommand(bot, sharedCommandOpts);
const { registerSolveQueueCommand } = await import('./telegram-solve-queue-command.lib.mjs');
const { handleSolveQueueCommand } = registerSolveQueueCommand(bot, { ...sharedCommandOpts, getSolveQueue });

// Named handler for /solve command - extracted for reuse by text-based fallback (issue #1207)
async function handleSolveCommand(ctx) {
  VERBOSE && console.log('[VERBOSE] /solve command received');

  // Add breadcrumb for error tracking
  await addBreadcrumb({
    category: 'telegram.command',
    message: '/solve command received',
    level: 'info',
    data: {
      chatId: ctx.chat?.id,
      chatType: ctx.chat?.type,
      userId: ctx.from?.id,
      username: ctx.from?.username,
    },
  });

  if (!solveEnabled) {
    if (VERBOSE) {
      console.log('[VERBOSE] /solve ignored: command disabled');
    }
    await ctx.reply('❌ The /solve command is disabled on this bot instance.');
    return;
  }

  // Ignore messages sent before bot started
  if (isOldMessage(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /solve ignored: old message');
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
      console.log('[VERBOSE] /solve ignored: forwarded message');
    }
    return;
  }

  if (!_isGroupChat(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /solve ignored: not a group chat');
    }
    await ctx.reply('❌ The /solve command only works in group chats. Please add this bot to a group and make it an admin.', { reply_to_message_id: ctx.message.message_id });
    return;
  }

  if (!isTopicAuthorized(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /solve ignored: not authorized');
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

  VERBOSE && console.log('[VERBOSE] /solve passed all checks, executing...');

  let userArgs = parseCommandArgs(ctx.message.text);

  // Check if this is a reply to a message and user didn't provide URL as first argument
  // In that case, try to extract GitHub URL from the replied message
  // Issue #1325: Support all options via /solve command when replying (e.g., "/solve --model opus")
  const isReply = message.reply_to_message && message.reply_to_message.message_id && !message.reply_to_message.forum_topic_created;

  // Check if the first argument looks like a GitHub URL
  // If not, we should try to extract the URL from the replied message
  const firstArgIsUrl = userArgs.length > 0 && (userArgs[0].includes('github.com') || userArgs[0].match(/^https?:\/\//));

  if (isReply && !firstArgIsUrl) {
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
      await safeReply(ctx, '❌ No GitHub issue/PR link found in the replied message.\n\nExample: Reply to a message containing a GitHub issue link with `/solve`\n\nOr with options: `/solve --model opus`', { reply_to_message_id: ctx.message.message_id });
      return;
    }
  }

  const validation = validateGitHubUrl(userArgs);
  if (!validation.valid) {
    let errorMsg = `❌ ${validation.error}`;
    if (validation.suggestion) {
      errorMsg += `\n\n💡 Did you mean: \`${validation.suggestion}\``;
    }
    errorMsg += '\n\nExample: `/solve https://github.com/owner/repo/issues/123`\n\nOr reply to a message containing a GitHub link with `/solve`';
    await safeReply(ctx, errorMsg, { reply_to_message_id: ctx.message.message_id });
    return;
  }
  const { backend: solvePerCommandIsolation, filteredArgs: userArgsWithoutIsolation } = extractIsolationFromArgs(userArgs); // issue #1534
  if (solvePerCommandIsolation && !isValidPerCommandIsolation(solvePerCommandIsolation)) {
    await safeReply(ctx, `❌ Invalid --isolation value '${escapeMarkdown(solvePerCommandIsolation)}'. Must be: screen, tmux, or docker`, { reply_to_message_id: ctx.message.message_id });
    return;
  }
  const args = mergeArgsWithOverrides(userArgsWithoutIsolation, solveOverrides);

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
  // Issue #1092: Detect malformed flag patterns like "-- model" (space after --)
  const { malformed, errors: malformedErrors } = detectMalformedFlags(args);
  if (malformed.length > 0) {
    await safeReply(ctx, `❌ ${escapeMarkdown(malformedErrors.join('\n'))}\n\nPlease check your option syntax.`, { reply_to_message_id: ctx.message.message_id });
    return;
  }
  // Validate merged arguments using solve's yargs config
  try {
    // Use .parse() instead of yargs(args).parseSync() to ensure .strict() mode works
    const testYargs = createSolveYargsConfig(yargs());

    // Configure yargs to throw errors instead of trying to exit the process
    // This prevents confusing error messages when validation fails but execution continues
    let failureMessage = null;
    testYargs.exitProcess(false).fail((msg, err) => {
      // Capture the failure message instead of letting yargs print it
      failureMessage = msg || (err && err.message) || 'Unknown validation error';
      throw new Error(failureMessage);
    });

    testYargs.parse(args);
  } catch (error) {
    await safeReply(ctx, `❌ Invalid options: ${escapeMarkdown(error.message || String(error))}\n\nUse /help to see available options`, {
      reply_to_message_id: ctx.message.message_id,
    });
    return;
  }
  // Issue #1552: Validate GitHub entity existence before queueing/executing
  if (args.some(a => a === '--auto-accept-invite') && validation.parsed.owner && validation.parsed.repo) {
    try {
      await (await import('./solve.accept-invite.lib.mjs')).autoAcceptInviteForRepo(validation.parsed.owner, validation.parsed.repo, async () => {}, false);
    } catch (e) {
      VERBOSE && console.log(`[VERBOSE] Auto-accept invite pre-check failed: ${e.message}`);
    }
  }
  const entityCheck = await validateGitHubEntityExistence({ owner: validation.parsed.owner, repo: validation.parsed.repo, number: validation.parsed.number, type: validation.parsed.type, verbose: VERBOSE });
  if (!entityCheck.valid) {
    await safeReply(ctx, `❌ ${escapeMarkdown(entityCheck.error)}`, { reply_to_message_id: ctx.message.message_id });
    return;
  }
  // Use normalized URL from validation to ensure consistent duplicate detection (issue #1080)
  const normalizedUrl = validation.parsed.normalized;

  const requester = buildUserMention({ user: ctx.from, parseMode: 'Markdown' });
  // Issue #1228: Show only user-provided options (exclude locked overrides to avoid duplication)
  // Issue #1460: Escape options text to prevent Markdown parsing errors
  const userOptionsRaw = userArgs.slice(1).join(' ');
  let infoBlock = `Requested by: ${requester}\nURL: ${escapeMarkdown(normalizedUrl)}`;
  if (userOptionsRaw) infoBlock += `\n\n🛠 Options: ${escapeMarkdown(userOptionsRaw)}`;
  if (solveOverrides.length > 0) infoBlock += `${userOptionsRaw ? '\n' : '\n\n'}🔒 Locked options: ${escapeMarkdown(solveOverrides.join(' '))}`;
  const solveQueue = getSolveQueue({ verbose: VERBOSE });

  // Check for duplicate URL in queue (issue #1080)
  const existingItem = solveQueue.findByUrl(normalizedUrl);
  if (existingItem) {
    const statusText = existingItem.status === 'starting' || existingItem.status === 'started' ? 'being processed' : 'already in the queue';
    await safeReply(ctx, `❌ This URL is ${statusText}.\n\nURL: ${escapeMarkdown(normalizedUrl)}\nStatus: ${existingItem.status}\n\n💡 Use /solve_queue to check the queue status.`, { reply_to_message_id: ctx.message.message_id });
    return;
  }
  // Issue #1567: Prevent concurrent sessions on the same PR/issue
  const activeSession = hasActiveSessionForUrl(normalizedUrl, VERBOSE);
  if (activeSession.isActive) {
    await safeReply(ctx, `❌ A working session is already running for this URL.\n\nURL: ${escapeMarkdown(normalizedUrl)}\nSession: \`${activeSession.sessionName}\`\n\n💡 Wait for the current session to complete, or use /solve\\_stop to cancel it.`, { reply_to_message_id: ctx.message.message_id });
    return;
  }
  const check = await solveQueue.canStartCommand({ tool: solveTool }); // Skip Claude limits for agent (#1159)
  const queueStats = solveQueue.getStats();
  // Handle rejection: threshold strategy is 'reject' — fail immediately (issue #1267)
  if (check.rejected) {
    await safeReply(ctx, `❌ Solve command rejected.\n\n${infoBlock}\n\n🚫 Reason: ${escapeMarkdown(check.rejectReason || 'Unknown')}`, { reply_to_message_id: ctx.message.message_id });
    return;
  }

  const toolQueuedCount = queueStats.queuedByTool[solveTool] || 0; // tool-specific queue count (#1551)
  if (check.canStart && toolQueuedCount === 0) {
    const startingMessage = await safeReply(ctx, `🚀 Starting solve command...\n\n${infoBlock}`, { reply_to_message_id: ctx.message.message_id });
    await executeAndUpdateMessage(ctx, startingMessage, 'solve', args, infoBlock, solvePerCommandIsolation);
  } else {
    const queueItem = solveQueue.enqueue({ url: normalizedUrl, args, ctx, requester, infoBlock, tool: solveTool, perCommandIsolation: solvePerCommandIsolation });
    let queueMessage = `📋 Solve command queued (${solveTool} queue position #${toolQueuedCount + 1})\n\n${infoBlock}`; // tool-specific position (#1551)
    if (check.reason) queueMessage += `\n\n⏳ Waiting: ${escapeMarkdown(check.reason)}`;
    const queuedMessage = await safeReply(ctx, queueMessage, { reply_to_message_id: ctx.message.message_id });
    queueItem.messageInfo = { chatId: queuedMessage.chat.id, messageId: queuedMessage.message_id };
    if (!solveQueue.executeCallback) {
      const _t = (s, i) => trackSession(s, i, VERBOSE);
      solveQueue.executeCallback = createIsolationAwareQueueCallback(ISOLATION_BACKEND, isolationRunner, _t, createQueueExecuteCallback(executeStartScreen, _t), VERBOSE);
    }
  }
}

bot.command([/^solve$/i, /^do$/i, /^continue$/i], handleSolveCommand); // /do and /continue are aliases (issue #525)

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

  if (!hiveEnabled) {
    if (VERBOSE) {
      console.log('[VERBOSE] /hive ignored: command disabled');
    }
    await ctx.reply('❌ The /hive command is disabled on this bot instance.');
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
    await ctx.reply('❌ The /hive command only works in group chats. Please add this bot to a group and make it an admin.', { reply_to_message_id: ctx.message.message_id });
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

  const userArgs = parseCommandArgs(ctx.message.text);

  // Issue #1102: Allow issues_list/pulls_list URLs and normalize to repo URLs
  const validation = validateGitHubUrl(userArgs, { allowedTypes: ['repo', 'organization', 'user', 'issues_list', 'pulls_list'], commandName: 'hive' });
  if (!validation.valid) {
    let errorMsg = `❌ ${validation.error}`;
    if (validation.suggestion) errorMsg += `\n\n💡 Did you mean: \`${escapeMarkdown(validation.suggestion)}\``;
    errorMsg += '\n\nExample: `/hive https://github.com/owner/repo`';
    await safeReply(ctx, errorMsg, { reply_to_message_id: ctx.message.message_id });
    return;
  }
  // Normalize issues_list/pulls_list to base repo URL, or use cleaned URL
  let normalizedArgs = [...userArgs];
  const p = validation.parsed;
  if (p && (p.type === 'issues_list' || p.type === 'pulls_list')) {
    normalizedArgs[0] = `https://github.com/${p.owner}/${p.repo}`;
    if (VERBOSE) console.log(`[VERBOSE] /hive: Normalized ${p.type} URL to repo URL: ${normalizedArgs[0]}`);
  } else if (validation.normalizedUrl && validation.normalizedUrl !== userArgs[0]) normalizedArgs[0] = validation.normalizedUrl;

  const { backend: hivePerCommandIsolation, filteredArgs: normalizedArgsWithoutIsolation } = extractIsolationFromArgs(normalizedArgs); // issue #1534
  if (hivePerCommandIsolation && !isValidPerCommandIsolation(hivePerCommandIsolation)) {
    await safeReply(ctx, `❌ Invalid --isolation value '${escapeMarkdown(hivePerCommandIsolation)}'. Must be: screen, tmux, or docker`, { reply_to_message_id: ctx.message.message_id });
    return;
  }
  const args = mergeArgsWithOverrides(normalizedArgsWithoutIsolation, hiveOverrides);

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
    // Use .parse() instead of yargs(args).parseSync() to ensure .strict() mode works
    const testYargs = createHiveYargsConfig(yargs());

    // Configure yargs to throw errors instead of trying to exit the process
    // This prevents confusing error messages when validation fails but execution continues
    let failureMessage = null;
    testYargs.exitProcess(false).fail((msg, err) => {
      // Capture the failure message instead of letting yargs print it
      failureMessage = msg || (err && err.message) || 'Unknown validation error';
      throw new Error(failureMessage);
    });

    testYargs.parse(args);
  } catch (error) {
    await safeReply(ctx, `❌ Invalid options: ${escapeMarkdown(error.message || String(error))}\n\nUse /help to see available options`, {
      reply_to_message_id: ctx.message.message_id,
    });
    return;
  }

  const requester = buildUserMention({ user: ctx.from, parseMode: 'Markdown' });
  const escapedUrl = escapeMarkdown(args[0]);
  // Issue #1228: Show only user-provided options (exclude locked overrides to avoid duplication)
  // Issue #1460: Escape options text to prevent Markdown parsing errors
  const userOptionsRaw = normalizedArgs.slice(1).join(' ');
  let infoBlock = `Requested by: ${requester}\nURL: ${escapedUrl}`;
  if (userOptionsRaw) infoBlock += `\n\n🛠 Options: ${escapeMarkdown(userOptionsRaw)}`;
  if (hiveOverrides.length > 0) {
    infoBlock += `${userOptionsRaw ? '\n' : '\n\n'}🔒 Locked options: ${escapeMarkdown(hiveOverrides.join(' '))}`;
  }

  const startingMessage = await safeReply(ctx, `🚀 Starting hive command...\n\n${infoBlock}`, { reply_to_message_id: ctx.message.message_id });
  await executeAndUpdateMessage(ctx, startingMessage, 'hive', args, infoBlock, hivePerCommandIsolation);
}

bot.command(/^hive$/i, handleHiveCommand);

const { registerTopCommand } = await import('./telegram-top-command.lib.mjs');
const { registerStartStopCommands } = await import('./telegram-start-stop-command.lib.mjs');
registerTopCommand(bot, sharedCommandOpts);
registerStartStopCommands(bot, sharedCommandOpts);

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

  // Check if this is a command we handle
  // /do and /continue are aliases for /solve (issue #525)
  const handlers = { solve: handleSolveCommand, do: handleSolveCommand, continue: handleSolveCommand, hive: handleHiveCommand, solve_queue: handleSolveQueueCommand, solvequeue: handleSolveQueueCommand };

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
    const isTelegramParsingError = error.message && (error.message.includes("can't parse entities") || error.message.includes("Can't parse entities") || error.message.includes("can't find end of") || (error.message.includes('Bad Request') && error.message.includes('400')));

    let errorMessage;

    if (isTelegramParsingError) {
      // Issue #1460: Log detailed context for root cause analysis (always logged, not just in verbose mode)
      const userInfo = ctx.from ? { id: ctx.from.id, username: ctx.from.username, first_name: ctx.from.first_name, last_name: ctx.from.last_name } : 'unknown';
      console.error(`[telegram-bot] Parsing error: ${error.message}`);
      console.error(`[telegram-bot] Parsing error context - user: ${JSON.stringify(userInfo)}, command: ${ctx.message?.text?.split(' ')[0] || 'unknown'}`);
      console.error(`[telegram-bot] User input text: ${ctx.message?.text || 'none'}`);
      if (ctx.message?.text) {
        const visibleInput = makeSpecialCharsVisible(ctx.message.text, { maxLength: 500 });
        console.error(`[telegram-bot] User input (special chars visible): ${visibleInput}`);
        const cleanedInput = cleanNonPrintableChars(ctx.message.text);
        if (cleanedInput !== ctx.message.text) {
          console.error(`[telegram-bot] ${ctx.message.text.length - cleanedInput.length} hidden character(s) detected in input`);
        }
      }

      // Issue #1460: Show user a simple, non-confusing message — all details are in the logs
      errorMessage = `❌ Failed to send formatted message. Please try your command again.\n\nIf the issue persists, contact support with Update ID: ${ctx.update.update_id}`;
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

    // Issue #1460: For parsing errors send plain text; otherwise try Markdown first
    if (isTelegramParsingError) {
      ctx.reply(errorMessage).catch(fallbackError => {
        console.error('Failed to send plain text error message:', fallbackError);
      });
    } else {
      ctx.reply(errorMessage, { parse_mode: 'Markdown' }).catch(replyError => {
        console.error('Failed to send error message to user:', replyError);
        const plainMessage = `An error occurred while processing your request. Please try again or contact support.\n\nError: ${error.message || 'Unknown error'}`;
        ctx.reply(plainMessage).catch(fallbackError => {
          console.error('Failed to send fallback error message:', fallbackError);
        });
      });
    }
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
console.log('Commands enabled:', { solve: solveEnabled, hive: hiveEnabled });
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

launchBotWithRetry(
  bot,
  {
    allowedUpdates: ['message', 'callback_query'], // Receive messages and callback queries
    dropPendingUpdates: true, // Drop pending updates sent before bot started
  },
  {
    verbose: VERBOSE,
    signal: launchAbortController.signal,
  }
)
  .then(async () => {
    if (isShuttingDown) return; // Skip success messages if shutting down

    console.log('✅ SwarmMindBot is now running!');
    console.log('Press Ctrl+C to stop');
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

    // Start session monitoring - check for completed sessions every 30 seconds
    startSessionMonitoring(bot, VERBOSE);
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
  stopSolveQueue();
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  isShuttingDown = true;
  console.log('\n🛑 Received SIGTERM, stopping bot... (Check system logs: journalctl -u <service> or dmesg)');
  if (VERBOSE) console.log(`[VERBOSE] Signal: SIGTERM, PID: ${process.pid}, PPID: ${process.ppid}`);
  launchAbortController.abort(); // Cancel retry loop if still retrying (issue #1240)
  stopSolveQueue();
  bot.stop('SIGTERM');
});
