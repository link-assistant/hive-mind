#!/usr/bin/env node

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

const getenv = await use('getenv');

// Load .env configuration as base
dotenvx.config({ quiet: true });

// Load .lenv configuration (if exists)
// .lenv overrides .env
loadLenvConfig({ override: true, quiet: true });

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await use('yargs@17.7.2/helpers');

// Import solve and hive yargs configurations for validation
const { createYargsConfig: createSolveYargsConfig, detectMalformedFlags } = await import('./solve.config.lib.mjs');
const { createYargsConfig: createHiveYargsConfig } = await import('./hive.config.lib.mjs');
// Import GitHub URL parser for extracting URLs from messages
const { parseGitHubUrl } = await import('./github.lib.mjs');
// Import model validation for early validation with helpful error messages
const { validateModelName } = await import('./model-validation.lib.mjs');
// Import libraries for /limits, /version, and markdown escaping
const { formatUsageMessage, getAllCachedLimits } = await import('./limits.lib.mjs');
const { getVersionInfo, formatVersionMessage } = await import('./version-info.lib.mjs');
const { escapeMarkdown, escapeMarkdownV2, cleanNonPrintableChars, makeSpecialCharsVisible } = await import('./telegram-markdown.lib.mjs');
const { getSolveQueue, getRunningClaudeProcesses, createQueueExecuteCallback } = await import('./telegram-solve-queue.lib.mjs');

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
  .help('h')
  .alias('h', 'help')
  .parserConfiguration({
    'boolean-negation': true,
    'strip-dashed': true, // Remove dashed keys from argv to simplify validation
  })
  .strict() // Enable strict mode to reject unknown options (consistent with solve.mjs and hive.mjs)
  .parse();

// Load configuration from --configuration option if provided
// This allows users to pass environment variables via command line
//
// Complete configuration priority order (highest priority last):
// 1. .env (base configuration, loaded first - already loaded above at line 24)
// 2. .lenv (overrides .env - already loaded above at line 28)
// 3. yargs CLI options parsed above (lines 41-102) use getenv() for defaults,
//    which reads from process.env populated by .env and .lenv
// 4. --configuration option (overrides process.env, affecting getenv() calls below)
// 5. Final resolution (lines 116+): CLI option values > environment variables
//    Pattern: config.X || getenv('VAR') means CLI options have highest priority
if (config.configuration) {
  loadLenvConfig({ configuration: config.configuration, override: true, quiet: true });
}

// After loading configuration, resolve final values
// Priority: CLI option > environment variable
const BOT_TOKEN = config.token || getenv('TELEGRAM_BOT_TOKEN', '');
const VERBOSE = config.verbose || getenv('TELEGRAM_BOT_VERBOSE', 'false') === 'true';

if (!BOT_TOKEN) {
  console.error('Error: TELEGRAM_BOT_TOKEN environment variable or --token option is not set');
  console.error('Please set it with: export TELEGRAM_BOT_TOKEN=your_bot_token');
  console.error('Or use: hive-telegram-bot --token your_bot_token');
  process.exit(1);
}

// After loading configuration, resolve final values from environment or config
// Priority: CLI option > environment variable (from .lenv or .env)
// NOTE: This section moved BEFORE loading telegraf for faster dry-run mode (issue #801)
const resolvedAllowedChats = config.allowedChats || getenv('TELEGRAM_ALLOWED_CHATS', '');
const allowedChats = resolvedAllowedChats ? lino.parseNumericIds(resolvedAllowedChats) : null;

// Parse override options
const resolvedSolveOverrides = config.solveOverrides || getenv('TELEGRAM_SOLVE_OVERRIDES', '');
const solveOverrides = resolvedSolveOverrides
  ? lino
      .parseStringValues(resolvedSolveOverrides)
      .map(line => line.trim())
      .filter(line => line)
  : [];

const resolvedHiveOverrides = config.hiveOverrides || getenv('TELEGRAM_HIVE_OVERRIDES', '');
const hiveOverrides = resolvedHiveOverrides
  ? lino
      .parseStringValues(resolvedHiveOverrides)
      .map(line => line.trim())
      .filter(line => line)
  : [];

// Command enable/disable flags
// Note: yargs automatically supports --no-solve and --no-hive for negation
// Priority: CLI option > environment variable
const solveEnabled = config.solve;
const hiveEnabled = config.hive;

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
// These imports are placed after the dry-run check to significantly speed up
// configuration validation. The telegraf module in particular can take 3-8 seconds
// to load on cold start due to network fetch from unpkg.com CDN.
// See issue #801 for details.

// Initialize Sentry for error tracking
await initializeSentry({
  debug: VERBOSE,
  environment: process.env.NODE_ENV || 'production',
});

const telegrafModule = await use('telegraf');
const { Telegraf } = telegrafModule;

const bot = new Telegraf(BOT_TOKEN, {
  // Remove the default 90-second timeout for message handlers
  // This is important because command handlers (like /solve) spawn long-running processes
  handlerTimeout: Infinity,
});

// Track bot startup time to ignore messages sent before bot started
// Using Unix timestamp (seconds since epoch) to match Telegram's message.date format
const BOT_START_TIME = Math.floor(Date.now() / 1000);

function isChatAuthorized(chatId) {
  if (!allowedChats) {
    return true;
  }
  return allowedChats.includes(chatId);
}

function isOldMessage(ctx) {
  // Ignore messages sent before the bot started
  // This prevents processing old/pending messages from before current bot instance startup
  const messageDate = ctx.message?.date;
  if (!messageDate) {
    return false;
  }
  return messageDate < BOT_START_TIME;
}

function isGroupChat(ctx) {
  const chatType = ctx.chat?.type;
  return chatType === 'group' || chatType === 'supergroup';
}

function isForwardedOrReply(ctx) {
  const message = ctx.message;
  if (!message) {
    if (VERBOSE) {
      console.log('[VERBOSE] isForwardedOrReply: No message object');
    }
    return false;
  }

  if (VERBOSE) {
    console.log('[VERBOSE] isForwardedOrReply: Checking message fields...');
    console.log('[VERBOSE]   message.forward_origin:', JSON.stringify(message.forward_origin));
    console.log('[VERBOSE]   message.forward_origin?.type:', message.forward_origin?.type);
    console.log('[VERBOSE]   message.forward_from:', JSON.stringify(message.forward_from));
    console.log('[VERBOSE]   message.forward_from_chat:', JSON.stringify(message.forward_from_chat));
    console.log('[VERBOSE]   message.forward_from_message_id:', message.forward_from_message_id);
    console.log('[VERBOSE]   message.forward_signature:', message.forward_signature);
    console.log('[VERBOSE]   message.forward_sender_name:', message.forward_sender_name);
    console.log('[VERBOSE]   message.forward_date:', message.forward_date);
    console.log('[VERBOSE]   message.reply_to_message:', JSON.stringify(message.reply_to_message));
    console.log('[VERBOSE]   message.reply_to_message?.message_id:', message.reply_to_message?.message_id);
  }

  // Check if message is forwarded (has forward_origin field with actual content)
  // Note: We check for .type because Telegram might send empty objects {}
  // which are truthy in JavaScript but don't indicate a forwarded message
  if (message.forward_origin && message.forward_origin.type) {
    if (VERBOSE) {
      console.log('[VERBOSE] isForwardedOrReply: TRUE - forward_origin.type exists:', message.forward_origin.type);
    }
    return true;
  }
  // Also check old forwarding API fields for backward compatibility
  if (message.forward_from || message.forward_from_chat || message.forward_from_message_id || message.forward_signature || message.forward_sender_name || message.forward_date) {
    if (VERBOSE) {
      console.log('[VERBOSE] isForwardedOrReply: TRUE - old forwarding API field detected');
      if (message.forward_from) console.log('[VERBOSE]     Triggered by: forward_from');
      if (message.forward_from_chat) console.log('[VERBOSE]     Triggered by: forward_from_chat');
      if (message.forward_from_message_id) console.log('[VERBOSE]     Triggered by: forward_from_message_id');
      if (message.forward_signature) console.log('[VERBOSE]     Triggered by: forward_signature');
      if (message.forward_sender_name) console.log('[VERBOSE]     Triggered by: forward_sender_name');
      if (message.forward_date) console.log('[VERBOSE]     Triggered by: forward_date');
    }
    return true;
  }
  // Check if message is a reply (has reply_to_message field with actual content)
  // Note: We check for .message_id because Telegram might send empty objects {}
  // IMPORTANT: In forum groups, messages in topics have reply_to_message pointing to the topic's
  // first message (with forum_topic_created). These are NOT user replies, just part of the thread.
  // We must exclude these to allow commands in forum topics.
  if (message.reply_to_message && message.reply_to_message.message_id) {
    // If the reply_to_message is a forum topic creation message, this is NOT a user reply
    if (message.reply_to_message.forum_topic_created) {
      if (VERBOSE) {
        console.log('[VERBOSE] isForwardedOrReply: FALSE - reply is to forum topic creation, not user reply');
        console.log('[VERBOSE]   Forum topic:', message.reply_to_message.forum_topic_created);
      }
      // This is just a message in a forum topic, not a reply to another user
      // Allow the message to proceed
    } else {
      // This is an actual reply to another user's message
      if (VERBOSE) {
        console.log('[VERBOSE] isForwardedOrReply: TRUE - reply_to_message.message_id exists:', message.reply_to_message.message_id);
      }
      return true;
    }
  }

  if (VERBOSE) {
    console.log('[VERBOSE] isForwardedOrReply: FALSE - no forwarding or reply detected');
  }
  return false;
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

/**
 * Escape special characters for Telegram's legacy Markdown parser.
 * In Telegram's Markdown, these characters need escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
 * However, for plain text (not inside markup), we primarily need to escape _ and *
 * to prevent them from being interpreted as formatting.
 *
 * @param {string} text - Text to escape
 * @returns {string} Escaped text safe for Markdown parse_mode
 */
/**
 * Execute a start-screen command and update the initial message with the result.
 * Used by both /solve and /hive commands to reduce code duplication.
 *
 * @param {Object} ctx - Telegram context
 * @param {Object} startingMessage - The initial message to update
 * @param {string} commandName - Command name (e.g., 'solve' or 'hive')
 * @param {string[]} args - Command arguments
 * @param {string} infoBlock - Info block with request details
 */
async function executeAndUpdateMessage(ctx, startingMessage, commandName, args, infoBlock) {
  const result = await executeStartScreen(commandName, args);
  const { chat, message_id } = startingMessage;

  // Safely edit message - catch errors to prevent stuck "Starting..." messages (issue #1062)
  const safeEdit = async text => {
    try {
      await ctx.telegram.editMessageText(chat.id, message_id, undefined, text, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error(`[telegram-bot] Failed to update message for ${commandName}: ${e.message}`);
    }
  };

  if (result.warning) return safeEdit(`⚠️  ${result.warning}`);

  if (result.success) {
    const match = result.output.match(/session:\s*(\S+)/i) || result.output.match(/screen -R\s+(\S+)/);
    const session = match ? match[1] : 'unknown';
    await safeEdit(`✅ ${commandName.charAt(0).toUpperCase() + commandName.slice(1)} command started successfully!\n\n📊 Session: \`${session}\`\n\n${infoBlock}`);
  } else {
    await safeEdit(`❌ Error executing ${commandName} command:\n\n\`\`\`\n${result.error || result.output}\n\`\`\``);
  }
}

/**
 * Extract GitHub issue/PR URL from message text
 * Validates that message contains exactly one GitHub issue/PR link
 *
 * @param {string} text - Message text to search
 * @returns {{ url: string|null, error: string|null, linkCount: number }}
 */
function extractGitHubUrl(text) {
  if (!text || typeof text !== 'string') {
    return { url: null, error: null, linkCount: 0 };
  }

  text = cleanNonPrintableChars(text); // Clean non-printable chars before processing
  const words = text.split(/\s+/);
  const foundUrls = [];

  for (const word of words) {
    // Try to parse as GitHub URL
    const parsed = parseGitHubUrl(word);

    // Accept issue or PR URLs
    if (parsed.valid && (parsed.type === 'issue' || parsed.type === 'pull')) {
      foundUrls.push(parsed.normalized);
    }
  }

  // Check if multiple links were found
  if (foundUrls.length === 0) {
    return { url: null, error: null, linkCount: 0 };
  } else if (foundUrls.length === 1) {
    return { url: foundUrls[0], error: null, linkCount: 1 };
  } else {
    return {
      url: null,
      error: `Found ${foundUrls.length} GitHub links in the message. Please reply to a message with only one GitHub issue or PR link.`,
      linkCount: foundUrls.length,
    };
  }
}

bot.command('help', async ctx => {
  if (VERBOSE) {
    console.log('[VERBOSE] /help command received');
  }

  // Ignore messages sent before bot started
  if (isOldMessage(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /help ignored: old message');
    }
    return;
  }

  // Ignore forwarded or reply messages
  if (isForwardedOrReply(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /help ignored: forwarded or reply');
    }
    return;
  }

  const chatId = ctx.chat.id;
  const chatType = ctx.chat.type;
  const chatTitle = ctx.chat.title || 'Private Chat';

  let message = '🤖 *SwarmMindBot Help*\n\n';
  message += '📋 *Diagnostic Information:*\n';
  message += `• Chat ID: \`${chatId}\`\n`;
  message += `• Chat Type: ${chatType}\n`;
  message += `• Chat Title: ${chatTitle}\n\n`;
  message += '📝 *Available Commands:*\n\n';

  if (solveEnabled) {
    message += '*/solve* - Solve a GitHub issue\n';
    message += 'Usage: `/solve <github-url> [options]`\n';
    message += 'Example: `/solve https://github.com/owner/repo/issues/123 --model sonnet`\n';
    message += 'Or reply to a message with a GitHub link: `/solve`\n';
    if (solveOverrides.length > 0) {
      message += `🔒 Locked options: \`${solveOverrides.join(' ')}\`\n`;
    }
    message += '\n';
  } else {
    message += '*/solve* - ❌ Disabled\n\n';
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

  message += '*/limits* - Show usage limits\n';
  message += '*/version* - Show bot and runtime versions\n';
  message += '*/accept\\_invites* - Accept all pending GitHub invitations\n';
  message += '*/merge* - Merge queue (experimental)\n';
  message += 'Usage: `/merge <github-repo-url>`\n';
  message += "Merges all PRs with 'ready' label sequentially.\n";
  message += '*/help* - Show this help message\n\n';
  message += '⚠️ *Note:* /solve, /hive, /limits, /version, /accept\\_invites and /merge commands only work in group chats.\n\n';
  message += '🔧 *Common Options:*\n';
  message += '• `--model <model>` or `-m` - Specify AI model (sonnet, opus, haiku, haiku-3-5, haiku-3)\n';
  message += '• `--base-branch <branch>` or `-b` - Target branch for PR (default: repo default branch)\n';
  message += '• `--think <level>` - Thinking level (off/low/medium/high/max). Translated to --thinking-budget for Claude >= 2.1.12\n';
  message += '• `--thinking-budget <num>` - Thinking token budget for Claude Code (0-63999)\n';
  message += '• `--verbose` or `-v` - Verbose output | `--attach-logs` - Attach logs to PR\n';
  message += '\n💡 *Tip:* Many more options available. See full documentation for complete list.\n';

  if (allowedChats) {
    message += '\n🔒 *Restricted Mode:* This bot only accepts commands from authorized chats.\n';
    message += `Authorized: ${isChatAuthorized(chatId) ? '✅ Yes' : '❌ No'}`;
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
  if (VERBOSE) {
    console.log('[VERBOSE] /limits command received');
  }

  // Add breadcrumb for error tracking
  await addBreadcrumb({
    category: 'telegram.command',
    message: '/limits command received',
    level: 'info',
    data: {
      chatId: ctx.chat?.id,
      chatType: ctx.chat?.type,
      userId: ctx.from?.id,
      username: ctx.from?.username,
    },
  });

  // Ignore messages sent before bot started
  if (isOldMessage(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /limits ignored: old message');
    }
    return;
  }

  // Ignore forwarded or reply messages
  if (isForwardedOrReply(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /limits ignored: forwarded or reply');
    }
    return;
  }

  if (!isGroupChat(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /limits ignored: not a group chat');
    }
    await ctx.reply('❌ The /limits command only works in group chats. Please add this bot to a group and make it an admin.', { reply_to_message_id: ctx.message.message_id });
    return;
  }

  const chatId = ctx.chat.id;
  if (!isChatAuthorized(chatId)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /limits ignored: chat not authorized');
    }
    await ctx.reply(`❌ This chat (ID: ${chatId}) is not authorized to use this bot. Please contact the bot administrator.`, { reply_to_message_id: ctx.message.message_id });
    return;
  }

  // Send "fetching" message to indicate work is in progress
  const fetchingMessage = await ctx.reply('🔄 Fetching usage limits...', {
    reply_to_message_id: ctx.message.message_id,
  });

  // Get all limits using shared cache (3min for API, 2min for system)
  const limits = await getAllCachedLimits(VERBOSE);

  if (!limits.claude.success) {
    const escapedError = escapeMarkdownV2(limits.claude.error, { preserveCodeBlocks: true });
    await ctx.telegram.editMessageText(fetchingMessage.chat.id, fetchingMessage.message_id, undefined, `❌ ${escapedError}`, { parse_mode: 'MarkdownV2' });
    return;
  }

  // Format the message with usage limits and queue status
  let message = '📊 *Usage Limits*\n\n' + formatUsageMessage(limits.claude.usage, limits.disk.success ? limits.disk.diskSpace : null, limits.github.success ? limits.github.githubRateLimit : null, limits.cpu.success ? limits.cpu.cpuLoad : null, limits.memory.success ? limits.memory.memory : null);
  const solveQueue = getSolveQueue({ verbose: VERBOSE });
  const queueStats = solveQueue.getStats();
  const claudeProcs = await getRunningClaudeProcesses(VERBOSE);
  // Calculate total processing: queue-internal + external claude processes
  // This provides a uniform view of all processing happening
  // See: https://github.com/link-assistant/hive-mind/issues/1133
  const totalProcessing = queueStats.processing + claudeProcs.count;
  const codeBlockEnd = message.lastIndexOf('```');
  if (codeBlockEnd !== -1) {
    const queueStatus = queueStats.queued > 0 || totalProcessing > 0 ? `Pending: ${queueStats.queued}, Processing: ${totalProcessing}` : 'Empty (no pending commands)';
    message = message.slice(0, codeBlockEnd) + `\nSolve Queue\n${queueStatus}\nClaude processes: ${claudeProcs.count}\n` + message.slice(codeBlockEnd);
  }
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
  if (!isGroupChat(ctx)) return await ctx.reply('❌ The /version command only works in group chats. Please add this bot to a group and make it an admin.', { reply_to_message_id: ctx.message.message_id });
  const chatId = ctx.chat.id;
  if (!isChatAuthorized(chatId)) return await ctx.reply(`❌ This chat (ID: ${chatId}) is not authorized to use this bot. Please contact the bot administrator.`, { reply_to_message_id: ctx.message.message_id });
  const fetchingMessage = await ctx.reply('🔄 Gathering version information...', {
    reply_to_message_id: ctx.message.message_id,
  });
  const result = await getVersionInfo(VERBOSE);
  if (!result.success) return await ctx.telegram.editMessageText(fetchingMessage.chat.id, fetchingMessage.message_id, undefined, `❌ ${escapeMarkdownV2(result.error, { preserveCodeBlocks: true })}`, { parse_mode: 'MarkdownV2' });
  await ctx.telegram.editMessageText(fetchingMessage.chat.id, fetchingMessage.message_id, undefined, '🤖 *Version Information*\n\n' + formatVersionMessage(result.versions), { parse_mode: 'Markdown' });
});

// Register /accept_invites command from separate module
// This keeps telegram-bot.mjs under the 1500 line limit
const { registerAcceptInvitesCommand } = await import('./telegram-accept-invitations.lib.mjs');
registerAcceptInvitesCommand(bot, {
  VERBOSE,
  isOldMessage,
  isForwardedOrReply,
  isGroupChat,
  isChatAuthorized,
  addBreadcrumb,
});

// Register /merge command from separate module (experimental, see issue #1143)
const { registerMergeCommand } = await import('./telegram-merge-command.lib.mjs');
registerMergeCommand(bot, {
  VERBOSE,
  isOldMessage,
  isForwardedOrReply,
  isGroupChat,
  isChatAuthorized,
  addBreadcrumb,
});

bot.command(/^solve$/i, async ctx => {
  if (VERBOSE) {
    console.log('[VERBOSE] /solve command received');
  }

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

  if (!isGroupChat(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /solve ignored: not a group chat');
    }
    await ctx.reply('❌ The /solve command only works in group chats. Please add this bot to a group and make it an admin.', { reply_to_message_id: ctx.message.message_id });
    return;
  }

  const chatId = ctx.chat.id;
  if (!isChatAuthorized(chatId)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /solve ignored: chat not authorized');
    }
    await ctx.reply(`❌ This chat (ID: ${chatId}) is not authorized to use this bot. Please contact the bot administrator.`, { reply_to_message_id: ctx.message.message_id });
    return;
  }

  if (VERBOSE) {
    console.log('[VERBOSE] /solve passed all checks, executing...');
  }

  let userArgs = parseCommandArgs(ctx.message.text);

  // Check if this is a reply to a message and user didn't provide URL
  // In that case, try to extract GitHub URL from the replied message
  const isReply = message.reply_to_message && message.reply_to_message.message_id && !message.reply_to_message.forum_topic_created;

  if (isReply && userArgs.length === 0) {
    if (VERBOSE) {
      console.log('[VERBOSE] /solve is a reply without URL, extracting from replied message...');
    }

    const replyText = message.reply_to_message.text || '';
    const extraction = extractGitHubUrl(replyText);

    if (extraction.error) {
      // Multiple links found
      if (VERBOSE) {
        console.log('[VERBOSE] Multiple GitHub URLs found in replied message');
      }
      await ctx.reply(`❌ ${extraction.error}`, {
        parse_mode: 'Markdown',
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    } else if (extraction.url) {
      // Single link found
      if (VERBOSE) {
        console.log('[VERBOSE] Extracted URL from reply:', extraction.url);
      }
      // Add the extracted URL as the first argument
      userArgs = [extraction.url];
    } else {
      // No link found
      if (VERBOSE) {
        console.log('[VERBOSE] No GitHub URL found in replied message');
      }
      await ctx.reply('❌ No GitHub issue/PR link found in the replied message.\n\nExample: Reply to a message containing a GitHub issue link with `/solve`', { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
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
    await ctx.reply(errorMsg, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
    return;
  }

  // Merge user args with overrides
  const args = mergeArgsWithOverrides(userArgs, solveOverrides);

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
    await ctx.reply(`❌ ${modelError}`, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
    return;
  }
  // Issue #1092: Detect malformed flag patterns like "-- model" (space after --)
  const { malformed, errors: malformedErrors } = detectMalformedFlags(args);
  if (malformed.length > 0) {
    await ctx.reply(`❌ ${malformedErrors.join('\n')}\n\nPlease check your option syntax.`, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
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
    await ctx.reply(`❌ Invalid options: ${error.message || String(error)}\n\nUse /help to see available options`, {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message.message_id,
    });
    return;
  }

  // Use normalized URL from validation to ensure consistent duplicate detection
  // See: https://github.com/link-assistant/hive-mind/issues/1080
  const normalizedUrl = validation.parsed.normalized;

  const requester = buildUserMention({ user: ctx.from, parseMode: 'Markdown' });
  const optionsText = args.slice(1).join(' ') || 'none';
  let infoBlock = `Requested by: ${requester}\nURL: ${escapeMarkdown(normalizedUrl)}\nOptions: ${optionsText}`;
  if (solveOverrides.length > 0) infoBlock += `\n🔒 Locked options: ${solveOverrides.join(' ')}`;
  const solveQueue = getSolveQueue({ verbose: VERBOSE });

  // Check for duplicate URL in queue
  // See: https://github.com/link-assistant/hive-mind/issues/1080
  const existingItem = solveQueue.findByUrl(normalizedUrl);
  if (existingItem) {
    const statusText = existingItem.status === 'starting' || existingItem.status === 'started' ? 'being processed' : 'already in the queue';
    await ctx.reply(`❌ This URL is ${statusText}.\n\nURL: ${escapeMarkdown(normalizedUrl)}\nStatus: ${existingItem.status}\n\n💡 Use /solve-queue to check the queue status.`, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
    return;
  }

  const check = await solveQueue.canStartCommand();
  const queueStats = solveQueue.getStats();
  if (check.canStart && queueStats.queued === 0) {
    const startingMessage = await ctx.reply(`🚀 Starting solve command...\n\n${infoBlock}`, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
    await executeAndUpdateMessage(ctx, startingMessage, 'solve', args, infoBlock);
  } else {
    const queueItem = solveQueue.enqueue({ url: normalizedUrl, args, ctx, requester, infoBlock, tool: solveTool });
    let queueMessage = `📋 Solve command queued (position #${queueStats.queued + 1})\n\n${infoBlock}`;
    if (check.reason) queueMessage += `\n\n⏳ Waiting: ${check.reason}`;
    const queuedMessage = await ctx.reply(queueMessage, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
    queueItem.messageInfo = { chatId: queuedMessage.chat.id, messageId: queuedMessage.message_id };
    if (!solveQueue.executeCallback) solveQueue.executeCallback = createQueueExecuteCallback(executeStartScreen);
  }
});

bot.command(/^hive$/i, async ctx => {
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

  if (!isGroupChat(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /hive ignored: not a group chat');
    }
    await ctx.reply('❌ The /hive command only works in group chats. Please add this bot to a group and make it an admin.', { reply_to_message_id: ctx.message.message_id });
    return;
  }

  const chatId = ctx.chat.id;
  if (!isChatAuthorized(chatId)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /hive ignored: chat not authorized');
    }
    await ctx.reply(`❌ This chat (ID: ${chatId}) is not authorized to use this bot. Please contact the bot administrator.`, { reply_to_message_id: ctx.message.message_id });
    return;
  }

  if (VERBOSE) {
    console.log('[VERBOSE] /hive passed all checks, executing...');
  }

  const userArgs = parseCommandArgs(ctx.message.text);

  // Issue #1102: Allow issues_list/pulls_list URLs and normalize to repo URLs
  const validation = validateGitHubUrl(userArgs, { allowedTypes: ['repo', 'organization', 'user', 'issues_list', 'pulls_list'], commandName: 'hive' });
  if (!validation.valid) {
    let errorMsg = `❌ ${validation.error}`;
    if (validation.suggestion) errorMsg += `\n\n💡 Did you mean: \`${escapeMarkdown(validation.suggestion)}\``;
    errorMsg += '\n\nExample: `/hive https://github.com/owner/repo`';
    await ctx.reply(errorMsg, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
    return;
  }
  // Normalize issues_list/pulls_list to base repo URL, or use cleaned URL
  let normalizedArgs = [...userArgs];
  const p = validation.parsed;
  if (p && (p.type === 'issues_list' || p.type === 'pulls_list')) {
    normalizedArgs[0] = `https://github.com/${p.owner}/${p.repo}`;
    if (VERBOSE) console.log(`[VERBOSE] /hive: Normalized ${p.type} URL to repo URL: ${normalizedArgs[0]}`);
  } else if (validation.normalizedUrl && validation.normalizedUrl !== userArgs[0]) normalizedArgs[0] = validation.normalizedUrl;

  // Merge user args with overrides
  const args = mergeArgsWithOverrides(normalizedArgs, hiveOverrides);

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
    await ctx.reply(`❌ ${hiveModelError}`, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
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
    await ctx.reply(`❌ Invalid options: ${error.message || String(error)}\n\nUse /help to see available options`, {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message.message_id,
    });
    return;
  }

  const requester = buildUserMention({ user: ctx.from, parseMode: 'Markdown' });
  const escapedUrl = escapeMarkdown(args[0]);
  const optionsText = args.slice(1).join(' ') || 'none';
  let infoBlock = `Requested by: ${requester}\nURL: ${escapedUrl}\nOptions: ${optionsText}`;
  if (hiveOverrides.length > 0) {
    infoBlock += `\n🔒 Locked options: ${hiveOverrides.join(' ')}`;
  }

  const startingMessage = await ctx.reply(`🚀 Starting hive command...\n\n${infoBlock}`, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
  await executeAndUpdateMessage(ctx, startingMessage, 'hive', args, infoBlock);
});

// Register /top command from separate module
// This keeps telegram-bot.mjs under the 1500 line limit
const { registerTopCommand } = await import('./telegram-top-command.lib.mjs');
registerTopCommand(bot, {
  VERBOSE,
  isOldMessage,
  isForwardedOrReply,
  isGroupChat,
  isChatAuthorized,
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

// Add global error handler for uncaught errors in middleware
bot.catch((error, ctx) => {
  console.error('Unhandled error while processing update', ctx.update.update_id);
  console.error('Error:', error);
  // Log detailed error information
  console.error('Error details:', {
    name: error.name,
    message: error.message,
    stack: error.stack?.split('\n').slice(0, 10).join('\n'),
  });
  // Log context information for debugging
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
    // Detect if this is a Telegram API parsing error
    const isTelegramParsingError = error.message && (error.message.includes("can't parse entities") || error.message.includes("Can't parse entities") || error.message.includes("can't find end of") || (error.message.includes('Bad Request') && error.message.includes('400')));

    let errorMessage;

    if (isTelegramParsingError) {
      // Special handling for Telegram API parsing errors caused by unescaped special characters
      errorMessage = `❌ A message formatting error occurred.\n\n💡 This usually means there was a problem with special characters in the response.\nPlease try your command again with a different URL or contact support.`;
      // Show the user's input with special characters visible (if available)
      if (ctx.message?.text) {
        const cleanedInput = cleanNonPrintableChars(ctx.message.text);
        const visibleInput = makeSpecialCharsVisible(cleanedInput, { maxLength: 150 });
        if (visibleInput !== cleanedInput) errorMessage += `\n\n📝 Your input (with special chars visible):\n\`${escapeMarkdown(visibleInput)}\``;
      }
      if (VERBOSE) {
        const escapedError = escapeMarkdown(error.message || 'Unknown error');
        errorMessage += `\n\n🔍 Debug info: ${escapedError}\nUpdate ID: ${ctx.update.update_id}`;
      }
    } else {
      // Build informative error message for other errors
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

    ctx.reply(errorMessage, { parse_mode: 'Markdown' }).catch(replyError => {
      console.error('Failed to send error message to user:', replyError);
      // Try sending a simple text message without Markdown if Markdown parsing failed
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
console.log('Commands enabled:', { solve: solveEnabled, hive: hiveEnabled });
if (solveOverrides.length > 0) console.log('Solve overrides (lino):', lino.format(solveOverrides));
if (hiveOverrides.length > 0) console.log('Hive overrides (lino):', lino.format(hiveOverrides));
if (VERBOSE) {
  console.log('[VERBOSE] Verbose logging enabled');
  console.log('[VERBOSE] Bot start time (Unix):', BOT_START_TIME);
  console.log('[VERBOSE] Bot start time (ISO):', new Date(BOT_START_TIME * 1000).toISOString());
}

// Delete existing webhook (critical: webhooks prevent polling from working)
if (VERBOSE) console.log('[VERBOSE] Deleting webhook...');
bot.telegram
  .deleteWebhook({ drop_pending_updates: true })
  .then(result => {
    if (VERBOSE) {
      console.log('[VERBOSE] Webhook deletion result:', result);
    }
    console.log('🔄 Webhook deleted (if existed), starting polling mode...');
    if (VERBOSE) {
      console.log('[VERBOSE] Launching bot with config:', {
        allowedUpdates: ['message'],
        dropPendingUpdates: true,
      });
    }
    return bot.launch({
      allowedUpdates: ['message', 'callback_query'], // Receive messages and callback queries
      dropPendingUpdates: true, // Drop pending updates sent before bot started
    });
  })
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
  stopSolveQueue();
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  isShuttingDown = true;
  console.log('\n🛑 Received SIGTERM, stopping bot... (Check system logs: journalctl -u <service> or dmesg)');
  if (VERBOSE) console.log(`[VERBOSE] Signal: SIGTERM, PID: ${process.pid}, PPID: ${process.ppid}`);
  stopSolveQueue();
  bot.stop('SIGTERM');
});
