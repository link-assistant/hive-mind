/**
 * Telegram /terminal_watch command.
 *
 * Watches the text log reported by `$ --status <uuid>` and edits a separate
 * Telegram message with the latest terminal-sized snapshot.
 */

import fs from 'fs/promises';
import { extractSessionIdFromText, decideLogDestination, resolveLogPath } from './telegram-log-command.lib.mjs';

const DEFAULT_WIDTH = 120;
const DEFAULT_HEIGHT = 25;
const DEFAULT_INTERVAL_MS = 2500;
const DEFAULT_MAX_CHARS = 3400;
const GITHUB_URL_RE = /https:\/\/github\.com\/[^\s"'`<>]+/i;
const activeWatches = new Map();

function splitCommandArgs(text) {
  const body = String(text || '')
    .replace(/^\/terminal_watch(?:@\w+)?\b/i, '')
    .trim();
  return body.match(/"[^"]*"|'[^']*'|\S+/g)?.map(token => token.replace(/^(['"])(.*)\1$/, '$2')) || [];
}

function readOptionValue(tokens, index, inlineValue, optionName, errors) {
  if (inlineValue !== null) return { value: inlineValue, nextIndex: index };
  const next = tokens[index + 1];
  if (!next || next.startsWith('--')) {
    errors.push(`${optionName} requires a value`);
    return { value: null, nextIndex: index };
  }
  return { value: next, nextIndex: index + 1 };
}

function parseIntegerOption(value, optionName, errors, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== String(value).trim() || parsed < min || parsed > max) {
    errors.push(`${optionName} must be an integer from ${min} to ${max}`);
    return null;
  }
  return parsed;
}

export function parseTerminalWatchArgs(text) {
  const tokens = splitCommandArgs(text);
  const options = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, intervalMs: DEFAULT_INTERVAL_MS, maxChars: DEFAULT_MAX_CHARS };
  const errors = [];
  let sessionId = extractSessionIdFromText(text);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (extractSessionIdFromText(token)) {
      sessionId ||= extractSessionIdFromText(token);
      continue;
    }
    if (!token.startsWith('--')) {
      errors.push(`Unexpected argument: ${token}`);
      continue;
    }

    const eq = token.indexOf('=');
    const name = eq === -1 ? token : token.slice(0, eq);
    const inlineValue = eq === -1 ? null : token.slice(eq + 1);
    const read = () => {
      const result = readOptionValue(tokens, i, inlineValue, name, errors);
      i = result.nextIndex;
      return result.value;
    };

    if (['--width', '--columns', '--cols', '--terminal-width'].includes(name)) {
      const value = read();
      if (value !== null) options.width = parseIntegerOption(value, name, errors, { min: 20, max: 240 }) || options.width;
    } else if (['--height', '--lines', '--rows', '--terminal-height'].includes(name)) {
      const value = read();
      if (value !== null) options.height = parseIntegerOption(value, name, errors, { min: 5, max: 80 }) || options.height;
    } else if (['--interval', '--interval-ms'].includes(name)) {
      const value = read();
      if (value !== null) options.intervalMs = parseIntegerOption(value, name, errors, { min: 1000, max: 60000 }) || options.intervalMs;
    } else if (name === '--max-chars') {
      const value = read();
      if (value !== null) options.maxChars = parseIntegerOption(value, name, errors, { min: 500, max: 3800 }) || options.maxChars;
    } else if (name === '--size') {
      const value = read();
      const match = value?.match(/^(\d+)x(\d+)$/i);
      if (!match) errors.push('--size must use WIDTHxHEIGHT format, for example --size 120x25');
      else {
        options.width = parseIntegerOption(match[1], '--size width', errors, { min: 20, max: 240 }) || options.width;
        options.height = parseIntegerOption(match[2], '--size height', errors, { min: 5, max: 80 }) || options.height;
      }
    } else {
      errors.push(`Unknown option: ${name}`);
    }
  }

  return { sessionId, options, errors };
}

export function tailTextForTerminal(text, { width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, maxChars = DEFAULT_MAX_CHARS } = {}) {
  const normalized = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const visibleLines = lines.slice(-height).map(line => {
    const expanded = line.replace(/\t/g, '    ');
    return expanded.length > width ? `...${expanded.slice(-(width - 3))}` : expanded;
  });
  let result = visibleLines.join('\n').trimEnd();
  if (!result) return '(no log output yet)';
  if (result.length > maxChars) {
    result = result.slice(-maxChars);
    const firstNewline = result.indexOf('\n');
    if (firstNewline > 0) result = result.slice(firstNewline + 1);
    result = `...[truncated]\n${result}`;
  }
  return result;
}

function sanitizeCodeBlock(text) {
  return String(text || '').replace(/```/g, "'''");
}

export function formatTerminalWatchMessage({ sessionId, statusResult = null, logText = '', options = {}, updateCount = 0, completed = false, repoDescription = null }) {
  const status = statusResult?.status || 'unknown';
  const width = options.width || DEFAULT_WIDTH;
  const height = options.height || DEFAULT_HEIGHT;
  const snapshot = sanitizeCodeBlock(tailTextForTerminal(logText, options));
  const title = completed ? '✅ Terminal watch complete' : '🔄 Live terminal watch';
  const lines = [title, `Session: \`${sessionId}\``, `Status: \`${status}\``, `Terminal: \`${width}x${height}\``];
  if (repoDescription) lines.push(`Repo: \`${repoDescription}\``);
  if (!completed) lines.push(`Updates: ${updateCount}`);
  lines.push('', '```', snapshot, '```');
  return lines.join('\n');
}

async function readLogFile(logPath) {
  try {
    return await fs.readFile(logPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

function extractGitHubUrlFromStatus(statusResult) {
  const match = String(statusResult?.command || '').match(GITHUB_URL_RE);
  return match ? match[0].replace(/[),.;]+$/, '') : null;
}

export async function resolveTerminalWatchRepository({ sessionInfo = null, statusResult = null, parseGitHubUrl, detectRepositoryVisibility }) {
  const url = sessionInfo?.url || extractGitHubUrlFromStatus(statusResult);
  if (!url || !parseGitHubUrl || !detectRepositoryVisibility) return { repoVisibility: null, repoDescription: null };
  const parsed = parseGitHubUrl(url);
  if (!parsed?.valid || !parsed.owner || !parsed.repo) return { repoVisibility: null, repoDescription: null };
  try {
    return {
      repoVisibility: await detectRepositoryVisibility(parsed.owner, parsed.repo),
      repoDescription: `${parsed.owner}/${parsed.repo}`,
    };
  } catch (error) {
    console.error('[ERROR] /terminal_watch: detectRepositoryVisibility failed:', error);
    return { repoVisibility: null, repoDescription: `${parsed.owner}/${parsed.repo}` };
  }
}

async function querySessionStatusWithRetry(querySessionStatus, sessionId, verbose, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const statusResult = await querySessionStatus(sessionId, verbose);
    if (statusResult?.exists || attempt === attempts) return statusResult;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return null;
}

// Note: /terminal_watch never uploads the full session log itself (issue #1720).
// Use /log <uuid> if you want the log file delivered as a document.
function getDisplayedTerminalSnapshot(logText, options) {
  return sanitizeCodeBlock(tailTextForTerminal(logText, options));
}

export function watchTerminalLogSession({ bot, chatId, messageId, sessionId, logPath, querySessionStatus, isTerminalSessionStatus, options = {}, repoDescription = null, verbose = false, initialStatusResult = null, initialLogText = null, initialMessage = '' }) {
  const key = `${chatId}:${messageId}:${sessionId}`;
  activeWatches.get(key)?.stop();

  let stopped = false;
  const hasInitialLogText = initialLogText !== null && initialLogText !== undefined;
  let lastSnapshot = hasInitialLogText ? getDisplayedTerminalSnapshot(initialLogText, options) : null;
  let lastMessage = initialMessage || (hasInitialLogText ? formatTerminalWatchMessage({ sessionId, statusResult: initialStatusResult, logText: initialLogText, options, updateCount: 0, completed: !!initialStatusResult?.status && isTerminalSessionStatus(initialStatusResult.status), repoDescription }) : '');
  let updateCount = 0;
  let timer = null;
  const intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;

  const tick = async () => {
    if (stopped) return;
    try {
      const statusResult = await querySessionStatus(sessionId, verbose);
      const completed = !!statusResult?.status && isTerminalSessionStatus(statusResult.status);
      const logText = await readLogFile(logPath);
      const snapshot = getDisplayedTerminalSnapshot(logText, options);
      const snapshotChanged = snapshot !== lastSnapshot;
      if (snapshotChanged) updateCount++;
      const message = formatTerminalWatchMessage({ sessionId, statusResult, logText, options, updateCount, completed, repoDescription });
      const shouldEdit = !lastMessage || snapshotChanged || (completed && message !== lastMessage);
      if (shouldEdit && message !== lastMessage) {
        await bot.telegram.editMessageText(chatId, messageId, undefined, message, { parse_mode: 'Markdown' });
        lastMessage = message;
      }
      lastSnapshot = snapshot;
      if (completed) {
        stopped = true;
        activeWatches.delete(key);
        return;
      }
    } catch (error) {
      console.error(`[terminal-watch] Error while watching ${sessionId}:`, error);
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  const control = {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      activeWatches.delete(key);
    },
  };
  activeWatches.set(key, control);
  timer = setTimeout(tick, 0);
  return control;
}

function buildUsage() {
  return 'Usage:\n• `/terminal_watch <UUID>`\n• Reply to a session message with `/terminal_watch`\n\nOptions: `--size 120x25`, `--width 120`, `--height 25`, `--interval-ms 2500`, `--max-chars 3400`';
}

async function createWatchMessage({ ctx, targetChatId, replyToMessageId, text }) {
  if (targetChatId === ctx.chat.id) {
    return await ctx.reply(text, { parse_mode: 'Markdown', reply_to_message_id: replyToMessageId });
  }
  return await ctx.telegram.sendMessage(targetChatId, text, replyToMessageId ? { parse_mode: 'Markdown', reply_to_message_id: replyToMessageId } : { parse_mode: 'Markdown' });
}

async function forwardOrCopyToDm(ctx, sourceMessage) {
  const userId = ctx.from?.id;
  if (!userId || !sourceMessage) return null;
  try {
    const forwarded = await ctx.telegram.forwardMessage(userId, ctx.chat.id, sourceMessage.message_id);
    return forwarded?.message_id || null;
  } catch (forwardError) {
    try {
      const copied = await ctx.telegram.copyMessage(userId, ctx.chat.id, sourceMessage.message_id);
      return copied?.message_id || null;
    } catch (copyError) {
      console.error('[ERROR] /terminal_watch: forward/copyMessage to DM failed:', forwardError, copyError);
      return null;
    }
  }
}

async function startWatchFromResolvedSession({ bot, ctx, sessionId, statusResult, sessionInfo, decision, logPath, watchOptions, querySessionStatus, isTerminalSessionStatus, repoDescription, auto = false, verbose = false }) {
  if (auto && decision.destination !== 'chat') {
    verbose && console.log(`[VERBOSE] Auto terminal watch skipped for ${sessionId}: ${decision.reason}`);
    return { started: false, reason: decision.reason };
  }

  const targetChatId = decision.destination === 'chat' ? ctx.chat.id : ctx.from?.id;
  if (!targetChatId) return { started: false, reason: 'Missing target chat id' };

  const initialLogText = await readLogFile(logPath);
  const initialCompleted = !!statusResult?.status && isTerminalSessionStatus(statusResult.status);
  const initialText = formatTerminalWatchMessage({ sessionId, statusResult, logText: initialLogText, options: watchOptions, completed: initialCompleted, repoDescription });
  let replyToMessageId = ctx.message?.message_id || undefined;
  if (decision.destination === 'dm' && ctx.chat.type !== 'private') {
    replyToMessageId = await forwardOrCopyToDm(ctx, ctx.message?.reply_to_message || ctx.message);
  }

  const watchMessage = await createWatchMessage({ ctx, targetChatId, replyToMessageId, text: initialText });
  watchTerminalLogSession({ bot, chatId: targetChatId, messageId: watchMessage.message_id, sessionId, logPath, querySessionStatus, isTerminalSessionStatus, options: watchOptions, repoDescription, verbose, initialStatusResult: statusResult, initialLogText, initialMessage: initialText });

  if (!auto && decision.destination === 'dm' && ctx.chat.type !== 'private') {
    await ctx.reply(`📬 Started terminal watch for \`${sessionId}\` in your direct messages.`, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
  }
  return { started: true, messageId: watchMessage.message_id, sessionInfo };
}

export async function startAutoTerminalWatchForSession({ bot, ctx, sessionId, sessionInfo, verbose = false, options = {} }) {
  try {
    const runner = await import('./isolation-runner.lib.mjs');
    const { parseGitHubUrl, detectRepositoryVisibility } = await import('./github.lib.mjs');
    const statusResult = await querySessionStatusWithRetry(runner.querySessionStatus, sessionId, verbose);
    if (!statusResult?.exists) return { started: false, reason: 'Unknown session id' };
    const { repoVisibility, repoDescription } = await resolveTerminalWatchRepository({ sessionInfo, statusResult, parseGitHubUrl, detectRepositoryVisibility });
    const decision = decideLogDestination({ statusResult, sessionInfo, repoVisibility, chatType: ctx.chat?.type });
    if (decision.destination !== 'chat') return { started: false, reason: decision.reason };
    const logPath = resolveLogPath({ statusResult, isolationBackend: decision.isolationBackend });
    if (!logPath) return { started: false, reason: 'Missing log path' };
    return await startWatchFromResolvedSession({ bot, ctx, sessionId, statusResult, sessionInfo, decision, logPath, watchOptions: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, intervalMs: DEFAULT_INTERVAL_MS, maxChars: DEFAULT_MAX_CHARS, ...options }, querySessionStatus: runner.querySessionStatus, isTerminalSessionStatus: runner.isTerminalSessionStatus, repoDescription, auto: true, verbose });
  } catch (error) {
    console.error('[terminal-watch] Auto-start failed:', error);
    return { started: false, reason: error.message || String(error) };
  }
}

export async function registerTerminalWatchCommand(bot, options) {
  const { VERBOSE = false, isOldMessage, isChatAuthorized, isTopicAuthorized, buildAuthErrorMessage } = options;
  const runner = await import('./isolation-runner.lib.mjs');
  const getTrackedSessionInfo = options.getTrackedSessionInfo || (await import('./session-monitor.lib.mjs')).getTrackedSessionInfo;
  const detectRepositoryVisibility = options.detectRepositoryVisibility || (await import('./github.lib.mjs')).detectRepositoryVisibility;
  const parseGitHubUrl = options.parseGitHubUrl || (await import('./github.lib.mjs')).parseGitHubUrl;

  bot.command('terminal_watch', async ctx => {
    VERBOSE && console.log('[VERBOSE] /terminal_watch command received');
    if (isOldMessage && isOldMessage(ctx)) return;

    const chat = ctx.chat;
    const message = ctx.message;
    if (!chat || !message) return;

    const parsedArgs = parseTerminalWatchArgs(message.text || '');
    if (parsedArgs.errors.length > 0) {
      await ctx.reply(`❌ Invalid /terminal_watch options:\n${parsedArgs.errors.map(e => `• ${e}`).join('\n')}\n\n${buildUsage()}`, { parse_mode: 'Markdown', reply_to_message_id: message.message_id });
      return;
    }

    const sessionId = parsedArgs.sessionId || extractSessionIdFromText(message.reply_to_message?.text || message.reply_to_message?.caption || '');
    if (!sessionId) {
      await ctx.reply(`❌ /terminal_watch requires a session id.\n\n${buildUsage()}`, { parse_mode: 'Markdown', reply_to_message_id: message.message_id });
      return;
    }

    if (chat.type !== 'private') {
      try {
        const member = await ctx.telegram.getChatMember(chat.id, ctx.from.id);
        if (!member || member.status !== 'creator') {
          await ctx.reply('❌ /terminal_watch is only available to the chat owner.', { reply_to_message_id: message.message_id });
          return;
        }
      } catch (error) {
        console.error('[ERROR] /terminal_watch: getChatMember failed:', error);
        await ctx.reply('❌ Failed to verify permissions for /terminal_watch.', { reply_to_message_id: message.message_id });
        return;
      }
    }

    if (isChatAuthorized && !isChatAuthorized(chat.id) && (!isTopicAuthorized || !isTopicAuthorized(ctx))) {
      const errMsg = buildAuthErrorMessage ? buildAuthErrorMessage(ctx) : `❌ This chat (ID: ${chat.id}) is not authorized.`;
      await ctx.reply(errMsg, { reply_to_message_id: message.message_id });
      return;
    }

    let statusResult;
    try {
      statusResult = await runner.querySessionStatus(sessionId, VERBOSE);
    } catch (error) {
      console.error('[ERROR] /terminal_watch: querySessionStatus failed:', error);
      await ctx.reply(`❌ Failed to query session status: ${error.message || String(error)}`, { reply_to_message_id: message.message_id });
      return;
    }

    if (!statusResult?.exists) {
      await ctx.reply(`❌ Session \`${sessionId}\` is not known to start-command.`, { parse_mode: 'Markdown', reply_to_message_id: message.message_id });
      return;
    }

    const sessionInfo = getTrackedSessionInfo ? getTrackedSessionInfo(sessionId) : null;
    const { repoVisibility, repoDescription } = await resolveTerminalWatchRepository({ sessionInfo, statusResult, parseGitHubUrl, detectRepositoryVisibility });
    const decision = decideLogDestination({ statusResult, sessionInfo, repoVisibility, chatType: chat.type });
    if (decision.destination === 'reject') {
      // Surface enough state to diagnose false-rejections like issue #1700.
      VERBOSE && console.log(`[VERBOSE] /terminal_watch rejected session ${sessionId}: reason="${decision.reason}" parsedIsolation=${JSON.stringify(statusResult?.isolation)} sessionInfoBackend=${JSON.stringify(sessionInfo?.isolationBackend)} rawHead=${JSON.stringify((statusResult?.raw || '').slice(0, 240))}`);
      await ctx.reply(`❌ ${decision.reason}`, { reply_to_message_id: message.message_id });
      return;
    }

    const logPath = resolveLogPath({ statusResult, isolationBackend: decision.isolationBackend });
    if (!logPath) {
      await ctx.reply('❌ Could not determine the log file path for this session.', { reply_to_message_id: message.message_id });
      return;
    }

    try {
      await startWatchFromResolvedSession({ bot, ctx, sessionId, statusResult, sessionInfo, decision, logPath, watchOptions: parsedArgs.options, querySessionStatus: runner.querySessionStatus, isTerminalSessionStatus: runner.isTerminalSessionStatus, repoDescription, verbose: VERBOSE });
    } catch (error) {
      console.error('[ERROR] /terminal_watch: failed to start watch:', error);
      const friendly = error?.code === 403 || /chat not found|bot can't initiate conversation/i.test(error?.message || '') ? 'I could not send you a DM. Please open a private chat with me and send /start, then try again.' : `Failed to start terminal watch: ${error.message || String(error)}`;
      await ctx.reply(`❌ ${friendly}`, { reply_to_message_id: message.message_id });
    }
  });
}

export const __INTERNAL_FOR_TESTS__ = {
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_INTERVAL_MS,
  DEFAULT_MAX_CHARS,
  GITHUB_URL_RE,
};
