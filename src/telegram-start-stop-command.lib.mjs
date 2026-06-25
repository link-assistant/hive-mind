/**
 * Telegram /start and /stop command implementation
 *
 * This module provides the /start and /stop command functionality for the Telegram bot,
 * allowing chat owners to control whether the bot accepts new tasks in a specific chat.
 *
 * Features:
 * - Per-chat stop state management
 * - Owner-only access control (creator only, not admins)
 * - Graceful stop: existing queue items continue to process
 * - Read-only commands (/help, /limits, /version) remain available when stopped
 * - Write commands (/solve, /hive) are rejected when stopped
 * - `/stop <UUID>` or reply-to-message-with-UUID forwards CTRL+C to the
 *   matching isolated solve/hive session via `$ --stop <UUID>` from
 *   link-foundation/start (issue #524).
 * - `/stop <issue-or-pr-url>` (or reply to a message that contains one) looks
 *   the URL up in the in-memory solve queue and either cancels the queued
 *   item or forwards CTRL+C to the running isolated session (issue #1780).
 * - `/stop <issue-or-pr-url>` also consults the session-monitor registry of
 *   running detached sessions, so it can interrupt a task that started
 *   immediately (queue empty) and was therefore never left in the queue's
 *   `processing` Map — the case shown in issue #1871's screenshots.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1081
 * @see https://github.com/link-assistant/hive-mind/issues/524
 * @see https://github.com/link-assistant/hive-mind/issues/1780
 * @see https://github.com/link-assistant/hive-mind/issues/1871
 * @see https://github.com/link-foundation/start/issues/112
 */

import { extractSessionIdFromText } from './telegram-log-command.lib.mjs';
import { parseGitHubUrl } from './github.lib.mjs';
import { cleanNonPrintableChars } from './telegram-markdown.lib.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Store stopped chats: Map<chatId, { stoppedAt: Date, stoppedBy: { id, username, firstName }, reason?: string }>
const stoppedChats = new Map();

/**
 * Check if a chat is currently stopped
 * @param {number} chatId - The chat ID to check
 * @returns {boolean} True if the chat is stopped
 */
export function isChatStopped(chatId) {
  return stoppedChats.has(chatId);
}

/**
 * Get stop information for a chat
 * @param {number} chatId - The chat ID
 * @returns {Object|null} Stop info or null if not stopped
 */
export function getChatStopInfo(chatId) {
  return stoppedChats.get(chatId) || null;
}

/**
 * Set chat stopped state
 * @param {number} chatId - The chat ID
 * @param {boolean} stopped - Whether to stop or start the chat
 * @param {Object} user - The user who issued the command (for stop)
 * @param {string} [reason] - Optional reason for stopping (only used when stopped=true)
 */
export function setChatStopped(chatId, stopped, user = null, reason = null) {
  if (stopped) {
    stoppedChats.set(chatId, {
      stoppedAt: new Date(),
      stoppedBy: user
        ? {
            id: user.id,
            username: user.username,
            firstName: user.first_name,
          }
        : null,
      reason: reason || null,
    });
  } else {
    stoppedChats.delete(chatId);
  }
}

/**
 * Get all stopped chats (for debugging/admin purposes)
 * @returns {Map} Map of stopped chats
 */
export function getStoppedChats() {
  return stoppedChats;
}

/**
 * Default reason used when no custom reason is provided for /stop
 */
export const DEFAULT_STOP_REASON = 'This bot is currently not accepting new tasks.';

/**
 * Get rejection message for when a command is used on a stopped chat.
 * Matches the style of queue `rejected` mode output for consistency.
 * @param {number} chatId - The chat ID
 * @param {string} commandName - The command that was rejected (e.g., 'Solve', 'Hive')
 * @returns {string} Markdown-formatted rejection message
 */
export function getStoppedChatRejectMessage(chatId, commandName = 'Command') {
  const stopInfo = getChatStopInfo(chatId);
  const reason = stopInfo?.reason || DEFAULT_STOP_REASON;
  return `❌ ${commandName} command rejected.\n\n🚫 Reason: ${reason}\n\nUse /start to resume (chat owner only).`;
}

/**
 * Extract a session UUID for `/stop`. Priority:
 *   1. UUID literal anywhere in the `/stop` message text.
 *   2. UUID in the text/caption of the message being replied to.
 *
 * The `text` argument is the raw `/stop ...` command text. `repliedTo`, when
 * present, is the Telegram message object that the user replied to with `/stop`.
 *
 * @param {string} text
 * @param {Object|null|undefined} repliedTo
 * @returns {{ sessionId: string|null, source: 'argument'|'reply'|null }}
 */
export function extractStopSessionId(text, repliedTo) {
  // Strip the leading `/stop` (or `/stop@botname`) before looking for a UUID,
  // so we don't accidentally match digits inside the command name itself.
  const argText = String(text || '').replace(/^\/stop(?:@\w+)?\s*/i, '');
  const direct = extractSessionIdFromText(argText);
  if (direct) return { sessionId: direct, source: 'argument' };
  const replyText = repliedTo ? `${repliedTo.text || ''}\n${repliedTo.caption || ''}` : '';
  const fromReply = extractSessionIdFromText(replyText);
  if (fromReply) return { sessionId: fromReply, source: 'reply' };
  return { sessionId: null, source: null };
}

/**
 * Walk arbitrary text and return the first GitHub issue or pull-request URL
 * found, or null. Tolerates multiple URLs (returns the first issue/pull URL
 * in source order). Uses the same `parseGitHubUrl` validator as the rest of
 * the bot so the result is always a normalized URL string.
 *
 * @param {string} text
 * @returns {string|null}
 */
function findFirstIssueOrPullUrl(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = cleanNonPrintableChars(text);
  for (const word of cleaned.split(/\s+/)) {
    if (!word) continue;
    const parsed = parseGitHubUrl(word);
    if (parsed.valid && (parsed.type === 'issue' || parsed.type === 'pull')) {
      return parsed.normalized;
    }
  }
  return null;
}

/**
 * Extract the target of a `/stop` invocation. Returns the most specific
 * target found among the four possible sources, in this priority order:
 *
 *   1. UUID in the `/stop` argument        (kind='uuid', source='argument')
 *   2. UUID in the replied-to message      (kind='uuid', source='reply')
 *   3. Issue/PR URL in the `/stop` argument (kind='url',  source='argument')
 *   4. Issue/PR URL in the replied-to text  (kind='url',  source='reply')
 *
 * UUIDs win over URLs because UUIDs are globally unique whereas a single
 * issue URL can map to several in-flight requests if the user enqueued the
 * same issue twice. Argument wins over reply because the argument is the
 * more deliberate signal (the user explicitly typed it).
 *
 * @param {string} text - Raw `/stop ...` command text
 * @param {Object|null|undefined} repliedTo - Telegram message object being replied to
 * @returns {{ kind: 'uuid'|'url'|null, value: string|null, source: 'argument'|'reply'|null }}
 * @see https://github.com/link-assistant/hive-mind/issues/1780
 */
export function extractStopTarget(text, repliedTo) {
  const argText = String(text || '').replace(/^\/stop(?:@\w+)?\s*/i, '');
  const replyText = repliedTo ? `${repliedTo.text || ''}\n${repliedTo.caption || ''}` : '';

  const argUuid = extractSessionIdFromText(argText);
  if (argUuid) return { kind: 'uuid', value: argUuid, source: 'argument' };

  const replyUuid = extractSessionIdFromText(replyText);
  if (replyUuid) return { kind: 'uuid', value: replyUuid, source: 'reply' };

  const argUrl = findFirstIssueOrPullUrl(argText);
  if (argUrl) return { kind: 'url', value: argUrl, source: 'argument' };

  const replyUrl = findFirstIssueOrPullUrl(replyText);
  if (replyUrl) return { kind: 'url', value: replyUrl, source: 'reply' };

  return { kind: null, value: null, source: null };
}

/**
 * Update the queue card message in Telegram to show that the task was
 * cancelled via /stop. Best-effort: silently swallows edit failures (e.g.,
 * the card was already cleared by the consumer loop) — the dispatcher still
 * sends its own ack reply, so the user always gets feedback.
 *
 * @param {Object} item - SolveQueueItem; reads .messageInfo and .ctx
 * @param {string} url - GitHub issue/PR URL of the cancelled task
 * @param {string|null} tool - Per-tool queue name (claude/agent/codex/...)
 * @param {string} stopperName - Display name of the user who ran /stop
 * @returns {Promise<boolean>} true when the card was edited
 * @see https://github.com/link-assistant/hive-mind/issues/1783
 */
export async function updateQueueCardForCancellation(item, url, tool, stopperName) {
  if (!item || !item.messageInfo || !item.ctx) return false;
  const toolSuffix = tool ? ` from \`${tool}\` queue` : '';
  const stopperSuffix = stopperName ? ` by ${stopperName}` : '';
  const text = `🗑 *Cancelled*\n\n${url}\n\nRemoved${toolSuffix}${stopperSuffix} via /stop.`;
  try {
    const { chatId, messageId } = item.messageInfo;
    await item.ctx.telegram.editMessageText(chatId, messageId, undefined, text, { parse_mode: 'Markdown' });
    // Match the consumer's contract: once a card reaches a terminal state we
    // forget the message coordinates so nothing else tries to edit it.
    item.messageInfo = null;
    return true;
  } catch (error) {
    console.error('[ERROR] /stop: failed to update queue card for cancellation:', error?.message || error);
    return false;
  }
}

/**
 * Returns true when the user issuing /stop is the same user who originally
 * requested the targeted task. Mirrors `isTerminalWatchSessionRequester` from
 * /terminal_watch (PR #1779) so the two commands behave consistently.
 *
 * Accepts the requester either from a `SolveQueueItem` (URL flow) or from
 * a tracked session info record (UUID flow).
 *
 * @param {Object} args
 * @param {number|string|null|undefined} args.userId - ctx.from.id of the /stop sender
 * @param {Object|null} [args.queueItem] - matched SolveQueueItem, if any
 * @param {Object|null} [args.sessionInfo] - tracked session info, if any
 * @returns {boolean}
 * @see https://github.com/link-assistant/hive-mind/issues/1783
 */
export function isStopTargetRequester({ userId, queueItem = null, sessionInfo = null } = {}) {
  if (userId === null || userId === undefined) return false;
  const candidates = [queueItem?.requesterUserId, sessionInfo?.requesterUserId];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    if (String(candidate) === String(userId)) return true;
  }
  return false;
}

/**
 * Registers the /start and /stop command handlers with the bot
 * @param {Object} bot - The Telegraf bot instance
 * @param {Object} options - Options object
 * @param {boolean} options.VERBOSE - Whether to enable verbose logging
 * @param {Function} options.isOldMessage - Function to check if message is old
 * @param {Function} options.isForwardedOrReply - Function to check if message is forwarded/reply
 * @param {Function} options.isGroupChat - Function to check if chat is a group
 * @param {Function} options.isChatAuthorized - Function to check if chat is authorized
 * @param {Function} [options.isTopicAuthorized] - Topic-level authorization fallback
 * @param {Function} [options.buildAuthErrorMessage] - Builds the chat-not-authorized message
 * @param {Function} [options.stopIsolatedSession] - Override for tests; calls `$ --stop <uuid>`
 * @param {Function} [options.getSolveQueue] - Returns the in-memory SolveQueue (for `/stop <url>`).
 *   When omitted, the URL flow degrades gracefully to a "no queue available"
 *   message so unit tests for non-URL paths don't need to construct a queue.
 *   See https://github.com/link-assistant/hive-mind/issues/1780.
 * @param {Function} [options.findRunningSessionByUrl] - Override for tests; looks
 *   the URL up in the session-monitor registry of running detached sessions so
 *   `/stop <url>` can interrupt tasks that started immediately (queue empty) and
 *   were therefore never left in the queue's `processing` Map. When omitted, the
 *   real `findStoppableSessionByUrl` from session-monitor is lazy-imported.
 *   See https://github.com/link-assistant/hive-mind/issues/1871.
 */
export function registerStartStopCommands(bot, options) {
  const { VERBOSE = false, isOldMessage, isForwarded, isForwardedOrReply, isGroupChat, isChatAuthorized, isTopicAuthorized, buildAuthErrorMessage, getSolveQueue } = options;
  const stopIsolatedSessionImpl = options.stopIsolatedSession || (async (...args) => (await import('./isolation-runner.lib.mjs')).stopIsolatedSession(...args));
  // Issue #1783: look the UUID up in the session monitor so /stop can let the
  // user who started the task stop it (mirrors /terminal_watch from PR #1779).
  // Test stubs can inject getTrackedSessionInfo directly via options.
  // The real session-monitor.getTrackedSessionInfo is sync; we wrap it in an
  // async tolerant helper so tests can pass either a sync or async stub.
  async function lookupTrackedSessionInfo(sessionId) {
    if (typeof options.getTrackedSessionInfo === 'function') {
      return await options.getTrackedSessionInfo(sessionId);
    }
    const mod = await import('./session-monitor.lib.mjs');
    return mod.getTrackedSessionInfo(sessionId);
  }

  // Issue #1871: look a URL up in the session-monitor registry of running
  // detached sessions. A /solve or /codex that started immediately (queue
  // empty) is dispatched straight to an isolation session and removed from the
  // queue's `processing` Map, so the queue lookup alone reports "no task found"
  // for a task that is clearly running. The session monitor still knows the
  // URL → start-command-UUID mapping, which lets /stop <url> recover and
  // interrupt the session. Test stubs can inject findRunningSessionByUrl.
  async function lookupRunningSessionByUrl(url) {
    try {
      if (typeof options.findRunningSessionByUrl === 'function') {
        return await options.findRunningSessionByUrl(url, VERBOSE);
      }
      const mod = await import('./session-monitor.lib.mjs');
      return mod.findStoppableSessionByUrl(url, VERBOSE);
    } catch (error) {
      console.error('[ERROR] /stop: findStoppableSessionByUrl failed:', error);
      return null;
    }
  }

  /**
   * Validate command context: checks old message, forwarded, group chat, authorized, and owner status.
   * @param {Object} ctx - Telegraf context
   * @param {string} cmdName - Command name for logging (e.g., '/stop', '/start')
   * @param {Object} [opts] - Options
   * @param {boolean} [opts.allowPrivate] - If true, skip group chat check (for /start welcome)
   * @returns {Promise<{valid: boolean, chatId?: number, isPrivate?: boolean}>}
   */
  async function validateOwnerCommand(ctx, cmdName, opts = {}) {
    VERBOSE && console.log(`[VERBOSE] ${cmdName} command received`);
    if (isOldMessage(ctx)) {
      VERBOSE && console.log(`[VERBOSE] ${cmdName} ignored: old message`);
      return { valid: false };
    }
    if (isForwardedOrReply(ctx)) {
      VERBOSE && console.log(`[VERBOSE] ${cmdName} ignored: forwarded or reply`);
      return { valid: false };
    }
    if (!isGroupChat(ctx)) {
      if (opts.allowPrivate) return { valid: false, isPrivate: true };
      VERBOSE && console.log(`[VERBOSE] ${cmdName} ignored: not a group chat`);
      await ctx.reply(`❌ The ${cmdName} command only works in group chats.`, { reply_to_message_id: ctx.message.message_id });
      return { valid: false };
    }
    const chatId = ctx.chat.id;
    if (!isChatAuthorized(chatId)) {
      VERBOSE && console.log(`[VERBOSE] ${cmdName} ignored: chat not authorized`);
      await ctx.reply(`❌ This chat (ID: ${chatId}) is not authorized to use this bot.`, { reply_to_message_id: ctx.message.message_id });
      return { valid: false };
    }
    try {
      const chatMember = await ctx.telegram.getChatMember(chatId, ctx.from.id);
      if (chatMember.status !== 'creator') {
        VERBOSE && console.log(`[VERBOSE] ${cmdName} ignored: user is not chat owner`);
        await ctx.reply('❌ This command is only available to the chat owner.', { reply_to_message_id: ctx.message.message_id });
        return { valid: false };
      }
    } catch (error) {
      console.error('[ERROR] Failed to check chat member status:', error);
      await ctx.reply('❌ Failed to verify permissions.', { reply_to_message_id: ctx.message.message_id });
      return { valid: false };
    }
    VERBOSE && console.log(`[VERBOSE] ${cmdName} passed all checks`);
    return { valid: true, chatId };
  }

  /**
   * Authorization check for the /stop UUID and /stop URL flows.
   *
   * In private DMs the user is implicitly authorized. In group chats the user
   * is authorized when EITHER:
   *   - They are the chat creator, OR
   *   - They are the original requester of the task being stopped (the user
   *     who ran the /solve or /hive that produced the queue item / session).
   *
   * This mirrors /terminal_watch and /watch (PR #1779) which already let the
   * task requester act on their own session without requiring chat-owner
   * privileges. See https://github.com/link-assistant/hive-mind/issues/1783.
   *
   * @param {Object} ctx - Telegraf context
   * @param {string} label - Short human-readable label for the variant ('UUID', 'URL')
   * @param {Object} [opts]
   * @param {Object|null} [opts.queueItem] - matched SolveQueueItem, if known
   * @param {Object|null} [opts.sessionInfo] - tracked session info, if known
   * @returns {Promise<boolean>} true when authorized
   */
  async function authorizeTargetedStop(ctx, label, { queueItem = null, sessionInfo = null } = {}) {
    const message = ctx.message;
    const chatId = ctx.chat?.id;
    const chatType = ctx.chat?.type;
    if (chatType === 'private') return true;
    if (!isGroupChat(ctx)) {
      await ctx.reply('❌ The /stop command only works in group chats or private chats with the bot.', { reply_to_message_id: message.message_id });
      return false;
    }
    if (!isChatAuthorized(chatId)) {
      if (!isTopicAuthorized || !isTopicAuthorized(ctx)) {
        const errMsg = buildAuthErrorMessage ? buildAuthErrorMessage(ctx) : `❌ This chat (ID: ${chatId}) is not authorized to use this bot.`;
        await ctx.reply(errMsg, { reply_to_message_id: message.message_id });
        return false;
      }
    }

    if (isStopTargetRequester({ userId: ctx.from?.id, queueItem, sessionInfo })) {
      VERBOSE && console.log(`[VERBOSE] /stop <${label}> allowed for task requester ${ctx.from?.id}`);
      return true;
    }

    try {
      const member = await ctx.telegram.getChatMember(chatId, ctx.from.id);
      if (!member || member.status !== 'creator') {
        VERBOSE && console.log(`[VERBOSE] /stop <${label}> ignored: user is not chat owner or task requester`);
        await ctx.reply(`❌ /stop <${label}> is only available to the chat owner or the user who started this task.`, { reply_to_message_id: message.message_id });
        return false;
      }
    } catch (error) {
      console.error(`[ERROR] /stop <${label}>: getChatMember failed:`, error);
      await ctx.reply('❌ Failed to verify permissions for /stop.', { reply_to_message_id: message.message_id });
      return false;
    }
    return true;
  }

  /**
   * Forward CTRL+C to a running isolated session via `$ --stop <uuid>`.
   * Posts an ack reply, edits it with the result. Used by both the
   * `/stop <UUID>` path (issue #524) and the `/stop <url>` path when the
   * matched queue item is already executing in an isolated session
   * (issue #1780).
   *
   * @param {Object} ctx - Telegraf context
   * @param {string} sessionId - UUID of the session to stop
   */
  async function runStopIsolatedSessionFlow(ctx, sessionId) {
    const message = ctx.message;
    const ack = await ctx.reply(`⏹️ Asking session \`${sessionId}\` to stop (sending CTRL+C via \`$ --stop\`)…`, {
      parse_mode: 'Markdown',
      reply_to_message_id: message.message_id,
    });

    let result;
    try {
      result = await stopIsolatedSessionImpl(sessionId, VERBOSE);
    } catch (error) {
      console.error('[ERROR] /stop: stopIsolatedSession threw:', error);
      result = { success: false, output: '', error: error?.message || String(error) };
    }

    const trimmedOutput = (result.output || '').toString().trim();
    const trimmedError = (result.error || '').toString().trim();
    const lines = [];
    if (result.success) {
      lines.push(`✅ Stop request sent to session \`${sessionId}\`.`);
      lines.push('');
      lines.push('The session should terminate shortly.');
      if (trimmedOutput) {
        lines.push('');
        lines.push('```');
        lines.push(trimmedOutput.slice(0, 1000));
        lines.push('```');
      }
    } else {
      lines.push(`❌ Failed to stop session \`${sessionId}\`.`);
      if (trimmedError) {
        lines.push('');
        lines.push('```');
        lines.push(trimmedError.slice(0, 1000));
        lines.push('```');
      }
    }

    try {
      await ctx.telegram.editMessageText(ack.chat.id, ack.message_id, undefined, lines.join('\n'), { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('[ERROR] /stop: editMessageText failed, falling back to reply:', error);
      await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown', reply_to_message_id: message.message_id });
    }
  }

  /**
   * Find the candidate queue/processing item for a `/stop <url>` request
   * without mutating queue state. Used by the dispatcher to look up the
   * task's requesterUserId for authorization before any cancellation
   * happens (#1783).
   *
   * @param {string} url - Normalized GitHub issue or PR URL
   * @returns {{ action: 'no-queue'|'not-found'|'candidate', item?: Object, queue?: Object }}
   */
  function findQueueCandidateForUrl(url) {
    if (typeof getSolveQueue !== 'function') {
      return { action: 'no-queue' };
    }
    const queue = getSolveQueue({ verbose: VERBOSE });
    const item = queue?.findByUrl?.(url);
    if (!item) return { action: 'not-found' };
    return { action: 'candidate', item, queue };
  }

  /**
   * Resolve a `/stop <url>` request against the in-memory solve queue.
   * Returns an action descriptor that the dispatcher executes.
   *
   * @param {string} url - Normalized GitHub issue or PR URL
   * @returns {{ action: 'no-queue'|'not-found'|'cancel-queued'|'stop-running'|'running-not-isolated', item?: Object, sessionId?: string|null, tool?: string|null }}
   */
  function resolveQueueLookupForUrl(url) {
    const candidate = findQueueCandidateForUrl(url);
    if (candidate.action !== 'candidate') return candidate;
    const { item, queue } = candidate;

    // Queued items have a defined .id and live in one of the per-tool queues.
    // The cancel(id) call walks every per-tool queue and returns true on hit.
    const cancelled = queue.cancel(item.id);
    if (cancelled) {
      return { action: 'cancel-queued', item, tool: item.tool || null };
    }

    // Not in a per-tool queue → must be in `processing`. If it was started
    // via an isolation backend, item.sessionName is the start-command UUID
    // and we can forward CTRL+C to it. Non-isolated runs have a screen name
    // that is not UUID-shaped — we can't safely interrupt those from here.
    const sessionId = item.sessionName && UUID_RE.test(item.sessionName) ? item.sessionName : null;
    if (sessionId) {
      return { action: 'stop-running', item, sessionId, tool: item.tool || null };
    }
    return { action: 'running-not-isolated', item, tool: item.tool || null };
  }

  // /stop command. Three modes (checked in this order, before any reply
  // rejection so the queue-card-reply ergonomics from issue #1780 work):
  //   1. `/stop <UUID>` or reply with UUID — forward CTRL+C via
  //      `$ --stop <UUID>` (issue #524).
  //   2. `/stop <issue-or-pr-url>` or reply containing that URL — look up
  //      the matching solve queue item; cancel it if queued, forward
  //      CTRL+C if running with isolation (issue #1780).
  //   3. bare `/stop` (optionally with a free-text reason) — pause new task
  //      acceptance for the chat (issue #1081).
  // Only accessible by chat owner (creator) in modes 1, 2 (in groups).
  bot.command('stop', async ctx => {
    VERBOSE && console.log('[VERBOSE] /stop command received');
    if (isOldMessage(ctx)) {
      VERBOSE && console.log('[VERBOSE] /stop ignored: old message');
      return;
    }
    // Issue #1922: a forwarded /stop (even a targeted `/stop <uuid>`) must never
    // be re-executed. Replies are still allowed because the targeted modes use
    // them on purpose (#524, #1780), so we use the forwarded-only filter here.
    if (isForwarded && isForwarded(ctx)) {
      VERBOSE && console.log('[VERBOSE] /stop ignored: forwarded message');
      return;
    }

    // Detect UUID/URL targets BEFORE the forwarded/reply rejection used by
    // the chat-level stop, because both targeted modes are intentionally
    // delivered as replies (issues #524, #1780).
    const message = ctx.message;
    const repliedTo = message?.reply_to_message || null;
    const target = extractStopTarget(message?.text || '', repliedTo);

    if (target.kind === 'uuid') {
      const sessionId = target.value;
      VERBOSE && console.log(`[VERBOSE] /stop: detected UUID ${sessionId} (source=${target.source})`);
      // Look up the session's owner before auth so the original task requester
      // can /stop their own session in a group even if they aren't the chat
      // creator (#1783). Lookup failures are non-fatal: we fall through to the
      // chat-owner-only check.
      let sessionInfo = null;
      try {
        sessionInfo = await lookupTrackedSessionInfo(sessionId);
      } catch (error) {
        console.error('[ERROR] /stop: getTrackedSessionInfo failed:', error);
      }
      const ok = await authorizeTargetedStop(ctx, 'UUID', { sessionInfo });
      if (!ok) return;
      await runStopIsolatedSessionFlow(ctx, sessionId);
      return;
    }

    if (target.kind === 'url') {
      const url = target.value;
      VERBOSE && console.log(`[VERBOSE] /stop: detected URL ${url} (source=${target.source})`);

      // Look up the queue item AND any running detached session BEFORE auth so
      // we can allow the original task requester to cancel their own task in a
      // group (#1783), regardless of whether the task is still queued or already
      // dispatched to an isolation session (#1871). Neither lookup mutates
      // state — actual cancel/stop happens below after auth has passed.
      const candidate = findQueueCandidateForUrl(url);
      const runningSession = await lookupRunningSessionByUrl(url);
      const ok = await authorizeTargetedStop(ctx, 'URL', { queueItem: candidate.item || null, sessionInfo: runningSession?.sessionInfo || null });
      if (!ok) return;

      const lookup = resolveQueueLookupForUrl(url);
      VERBOSE && console.log(`[VERBOSE] /stop: queue lookup for ${url} → ${lookup.action}`);

      // Issue #1871: when the queue has no record of the task (it started
      // immediately and was dispatched to a detached session) but the session
      // monitor still tracks a running isolated session for this URL, forward
      // CTRL+C to its start-command UUID. This is the common case for tasks
      // that begin executing right away with an isolation backend.
      const queueHasTask = lookup.action === 'cancel-queued' || lookup.action === 'stop-running';
      if (!queueHasTask && runningSession?.stoppable && runningSession.sessionId) {
        VERBOSE && console.log(`[VERBOSE] /stop: forwarding CTRL+C to tracked session ${runningSession.sessionId} for ${url} (queue action=${lookup.action})`);
        await runStopIsolatedSessionFlow(ctx, runningSession.sessionId);
        return;
      }

      if (lookup.action === 'no-queue') {
        // No solve queue in this context. If the session monitor found a
        // running-but-non-stoppable (non-isolation) session, say so; otherwise
        // fall back to the UUID hint.
        if (runningSession) {
          await ctx.reply(`⚠️ Found a running task for ${url}, but it was not started with an isolation backend, so \`/stop\` cannot forward CTRL+C to it.\n\nNext time run it with the default isolation backend or pass \`--isolation docker\` to make this task interruptible via \`/stop\`.`, {
            parse_mode: 'Markdown',
            reply_to_message_id: message.message_id,
          });
          return;
        }
        await ctx.reply(`ℹ️ Cannot look up tasks by URL right now (the bot has no solve queue available in this context).\n\nIf you have the session UUID, you can use \`/stop <UUID>\` instead.`, {
          parse_mode: 'Markdown',
          reply_to_message_id: message.message_id,
        });
        return;
      }

      if (lookup.action === 'not-found') {
        // The session monitor also had no stoppable session (otherwise we would
        // have forwarded CTRL+C above). If it tracked a non-isolation session,
        // explain why it can't be stopped; otherwise report not found.
        if (runningSession) {
          await ctx.reply(`⚠️ Found a running task for ${url}, but it was not started with an isolation backend, so \`/stop\` cannot forward CTRL+C to it.\n\nNext time run it with the default isolation backend or pass \`--isolation docker\` to make this task interruptible via \`/stop\`.`, {
            parse_mode: 'Markdown',
            reply_to_message_id: message.message_id,
          });
          return;
        }
        await ctx.reply(`ℹ️ No queued or running task found for ${url}.\n\nIf the task is running with an isolation backend, try \`/stop <UUID>\` (the UUID is shown in the bot's session-id message).`, {
          parse_mode: 'Markdown',
          reply_to_message_id: message.message_id,
        });
        return;
      }

      if (lookup.action === 'cancel-queued') {
        VERBOSE && console.log(`[VERBOSE] /stop: cancelled queued item ${lookup.item?.id} for ${url}`);
        const toolLabel = lookup.tool ? ` from \`${lookup.tool}\` queue` : '';

        // Update the original queue card ("⏳ Waiting (claude queue #3)") to
        // reflect that the task was cancelled. The queue stores the message
        // coordinates on the item itself when the card was first posted —
        // see telegram-bot.mjs where `item.messageInfo` is wired up.
        const stopperName = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name || `user ${ctx.from?.id}`;
        await updateQueueCardForCancellation(lookup.item, url, lookup.tool, stopperName);

        await ctx.reply(`🗑 Removed queued task for ${url}${toolLabel}.`, {
          parse_mode: 'Markdown',
          reply_to_message_id: message.message_id,
        });
        return;
      }

      if (lookup.action === 'stop-running') {
        VERBOSE && console.log(`[VERBOSE] /stop: forwarding CTRL+C to running session ${lookup.sessionId} for ${url}`);
        await runStopIsolatedSessionFlow(ctx, lookup.sessionId);
        return;
      }

      // running-not-isolated: a started, non-isolated screen session. We
      // could shell out to `screen -X -S <name> stuff $'\003'`, but that's
      // brittle and out of scope for #1780. Tell the user how to recover.
      await ctx.reply(`⚠️ Found a running task for ${url}, but it was not started with an isolation backend, so \`/stop\` cannot forward CTRL+C to it.\n\nNext time run it with the default isolation backend or pass \`--isolation docker\` to make this task interruptible via \`/stop\`.`, {
        parse_mode: 'Markdown',
        reply_to_message_id: message.message_id,
      });
      return;
    }

    // No UUID or URL — fall through to the chat-level pause flow. That flow
    // rejects forwards/replies on purpose (#1081) so a stray reply doesn't
    // pause the chat.
    if (isForwardedOrReply(ctx)) {
      VERBOSE && console.log('[VERBOSE] /stop ignored: forwarded or reply');
      return;
    }

    const check = await validateOwnerCommand(ctx, '/stop');
    if (!check.valid) return;
    const chatId = check.chatId;

    // Check if already stopped
    if (isChatStopped(chatId)) {
      const stopInfo = getChatStopInfo(chatId);
      const stoppedAtStr = stopInfo?.stoppedAt ? stopInfo.stoppedAt.toISOString() : 'unknown';
      let alreadyStoppedMsg = `ℹ️ Bot is already stopped in this chat.\n\nStopped at: ${stoppedAtStr}`;
      if (stopInfo?.reason) {
        alreadyStoppedMsg += `\nReason: ${stopInfo.reason}`;
      }
      alreadyStoppedMsg += '\n\nUse /start to resume accepting tasks.';
      await ctx.reply(alreadyStoppedMsg, {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    // Parse optional reason from message text (anything after "/stop ")
    // Supports: /stop reason, /stop "reason", /stop 'reason'
    const messageText = ctx.message.text || '';
    let reason = messageText.replace(/^\/stop(@\w+)?\s*/i, '').trim() || null;
    // Strip surrounding quotes (single or double) from reason
    if (reason && ((reason.startsWith('"') && reason.endsWith('"')) || (reason.startsWith("'") && reason.endsWith("'")))) {
      reason = reason.slice(1, -1).trim() || null;
    }

    if (VERBOSE && reason) {
      console.log(`[VERBOSE] /stop reason: ${reason}`);
    }

    // Set chat as stopped with optional reason
    setChatStopped(chatId, true, ctx.from, reason);

    if (VERBOSE) {
      console.log(`[VERBOSE] Chat ${chatId} is now stopped`);
    }

    let stopMessage = '🛑 *Bot Stopped*\n\n' + 'This bot is now in read-only mode for this chat.\n\n';
    if (reason) {
      stopMessage += `*Reason:* ${reason}\n\n`;
    }
    stopMessage += '*Disabled commands:*\n' + '• /solve - No new issues will be accepted\n' + '• /hive - No new hive commands will be accepted\n' + '• /merge - No new merge operations will be accepted\n\n' + '*Still available:*\n' + '• /help - Show help\n' + '• /limits - Show usage limits\n' + '• /version - Show version info\n' + '• /start - Resume accepting tasks (owner only)\n\n' + '💡 Any tasks already in queue will continue to process.';

    await ctx.reply(stopMessage, {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message.message_id,
    });
  });

  // /start command - resume accepting new tasks in this chat
  // Only accessible by chat owner (creator)
  // Note: This overrides Telegram's default /start behavior, but that's intentional
  // as in group chats we want this to control the bot's task acceptance
  bot.command('start', async ctx => {
    const check = await validateOwnerCommand(ctx, '/start', { allowPrivate: true });
    if (!check.valid) {
      // In private chats, show a welcome message instead
      if (check.isPrivate) {
        VERBOSE && console.log('[VERBOSE] /start in private chat: showing welcome');
        await ctx.reply('👋 *Welcome to SwarmMindBot!*\n\n' + 'This bot helps solve GitHub issues using AI.\n\n' + 'To use this bot:\n' + '1. Add me to a group chat\n' + '2. Make me an admin\n' + '3. Use /solve to solve GitHub issues\n\n' + 'Use /help in a group chat for more information.', { parse_mode: 'Markdown' });
      }
      return;
    }
    const chatId = check.chatId;

    // Check if already running (not stopped)
    if (!isChatStopped(chatId)) {
      await ctx.reply('ℹ️ Bot is already accepting tasks in this chat.\n\nUse /help to see available commands.', {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    // Get stop info for the message
    const stopInfo = getChatStopInfo(chatId);
    const stoppedDuration = stopInfo?.stoppedAt ? Math.round((Date.now() - stopInfo.stoppedAt.getTime()) / 1000) : 0;

    // Clear the stopped state
    setChatStopped(chatId, false);

    if (VERBOSE) {
      console.log(`[VERBOSE] Chat ${chatId} is now started`);
    }

    let durationStr = '';
    if (stoppedDuration > 0) {
      if (stoppedDuration < 60) {
        durationStr = `${stoppedDuration} seconds`;
      } else if (stoppedDuration < 3600) {
        durationStr = `${Math.round(stoppedDuration / 60)} minutes`;
      } else {
        durationStr = `${Math.round(stoppedDuration / 3600)} hours`;
      }
    }

    await ctx.reply('✅ *Bot Started*\n\n' + 'This bot is now accepting tasks in this chat.\n\n' + (durationStr ? `Bot was stopped for ${durationStr}.\n\n` : '') + 'Use /help to see available commands.', {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message.message_id,
    });
  });
}
