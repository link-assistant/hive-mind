/**
 * Telegram /log command implementation
 *
 * Lets a chat owner pull the log of an isolation session that was launched
 * through the `$` (start-command) CLI. The session is identified by its UUID,
 * either passed as `/log <UUID>` or extracted from a message that the
 * `/log` command is replying to.
 *
 * Privacy guarantees:
 * - Only the chat creator (`status === 'creator'`) may invoke `/log`.
 * - Logs from public GitHub repositories may be uploaded into the chat where
 *   `/log` was issued.
 * - Logs from private GitHub repositories — and logs whose repository
 *   visibility we cannot determine — are sent to the user via direct message
 *   only, after forwarding the original message that contained the session id.
 * - Currently only sessions launched with one of the `$` isolation backends
 *   (`screen`, `tmux`, `docker`) are supported. Direct (non-isolation) sessions
 *   are rejected with a clear message.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1686
 */

import path from 'path';
import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';

const UUID_RE = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;
const ISOLATION_BACKENDS = new Set(['screen', 'tmux', 'docker']);
// Telegram bots may upload documents up to 50 MB via sendDocument.
// https://core.telegram.org/bots/api#senddocument
const TELEGRAM_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Extract the first RFC 4122 v4-shaped UUID found in `text`.
 *
 * @param {string|null|undefined} text
 * @returns {string|null}
 */
export function extractSessionIdFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(UUID_RE);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Decide where the log for a session should be delivered.
 *
 * Inputs:
 * - `statusResult`: parsed result of `$ --status <uuid>` (see
 *   `parseSessionStatusOutput` in `isolation-runner.lib.mjs`).
 * - `sessionInfo`: in-memory record from the Telegram session monitor, or null.
 * - `repoVisibility`: result of `detectRepositoryVisibility(owner, repo)`, or
 *   null when the repo could not be identified.
 * - `chatType`: Telegram chat type where `/log` was invoked
 *   (`'private'` | `'group'` | `'supergroup'` | `'channel'`).
 *
 * Output: `{ destination, reason, isolationBackend }` where `destination` is
 * one of `'chat'` (deliver in the same chat), `'dm'` (deliver in DM),
 * `'reject'` (don't deliver). `reason` is a short, user-facing string.
 *
 * @returns {{destination: 'chat'|'dm'|'reject', reason: string, isolationBackend: string|null}}
 */
export function decideLogDestination({ statusResult, sessionInfo, repoVisibility, chatType }) {
  if (!statusResult || !statusResult.exists) {
    return { destination: 'reject', reason: 'Unknown session id (start-command does not know about it).', isolationBackend: null };
  }

  // Determine isolation backend. Prefer the in-memory record (which knows what
  // we asked `$` to use), fall back to whatever `$ --status` reports.
  const isolationBackend = (sessionInfo?.isolationBackend || statusResult.isolation || '').toLowerCase() || null;
  if (!isolationBackend || !ISOLATION_BACKENDS.has(isolationBackend)) {
    return {
      destination: 'reject',
      reason: 'This command currently supports only sessions launched with `$` isolation (screen / tmux / docker).',
      isolationBackend: isolationBackend || null,
    };
  }

  // Privacy decision — fail closed when in doubt.
  const isPublic = repoVisibility?.isPublic === true;
  const visibilityKnown = !!repoVisibility && repoVisibility.visibility !== null;

  if (isPublic && visibilityKnown) {
    if (chatType === 'private') {
      // /log was invoked in DM. Deliver in DM regardless of repo visibility.
      return { destination: 'dm', reason: 'Public repository, delivering in DM (command was sent in a private chat).', isolationBackend };
    }
    return { destination: 'chat', reason: 'Public repository, delivering in chat.', isolationBackend };
  }

  // Private OR unknown visibility — never leak in a public chat.
  return {
    destination: 'dm',
    reason: visibilityKnown ? 'Private repository — delivering via direct message.' : 'Repository visibility could not be determined — delivering via direct message (fail-closed).',
    isolationBackend,
  };
}

/**
 * Resolve the on-disk log path for a session.
 *
 * Prefers the `logPath` field reported by `$ --status` (always correct when
 * supported). Falls back to start-command's documented layout if the field is
 * missing.
 *
 * @returns {string|null}
 */
export function resolveLogPath({ statusResult, isolationBackend }) {
  if (statusResult?.logPath) return statusResult.logPath;
  const uuid = statusResult?.uuid;
  if (!uuid) return null;
  const logBackend = statusResult?.isolation || isolationBackend;
  if (logBackend && ISOLATION_BACKENDS.has(logBackend)) {
    return path.join('/tmp/start-command/logs/isolation', logBackend, `${uuid}.log`);
  }
  return path.join('/tmp/start-command/logs/direct', `${uuid}.log`);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return null;
  }
}

/**
 * Registers the /log command handler with the bot.
 *
 * Dependencies (`querySessionStatus`, `getTrackedSessionInfo`,
 * `detectRepositoryVisibility`, `parseGitHubUrl`) are lazy-loaded from the
 * existing libraries by default; tests pass mocked versions through `options`.
 *
 * @param {Object} bot - Telegraf bot instance
 * @param {Object} options
 * @param {boolean} [options.VERBOSE]
 * @param {Function} options.isOldMessage
 * @param {Function} options.isChatAuthorized
 * @param {Function} [options.isTopicAuthorized]
 * @param {Function} [options.buildAuthErrorMessage]
 * @param {Function} [options.querySessionStatus] - Override for tests
 * @param {Function} [options.getTrackedSessionInfo] - Override for tests
 * @param {Function} [options.detectRepositoryVisibility] - Override for tests
 * @param {Function} [options.parseGitHubUrl] - Override for tests
 */
export async function registerLogCommand(bot, options) {
  const { VERBOSE = false, isOldMessage, isChatAuthorized, isTopicAuthorized, buildAuthErrorMessage } = options;
  const querySessionStatus = options.querySessionStatus || (await import('./isolation-runner.lib.mjs')).querySessionStatus;
  const getTrackedSessionInfo = options.getTrackedSessionInfo || (await import('./session-monitor.lib.mjs')).getTrackedSessionInfo;
  const detectRepositoryVisibility = options.detectRepositoryVisibility || (await import('./github.lib.mjs')).detectRepositoryVisibility;
  const parseGitHubUrl = options.parseGitHubUrl || (await import('./github.lib.mjs')).parseGitHubUrl;

  bot.command('log', async ctx => {
    VERBOSE && console.log('[VERBOSE] /log command received');

    if (isOldMessage && isOldMessage(ctx)) {
      VERBOSE && console.log('[VERBOSE] /log ignored: old message');
      return;
    }

    const chat = ctx.chat;
    const message = ctx.message;
    if (!chat || !message) return;

    const chatType = chat.type;
    const chatId = chat.id;

    // Extract the session id. Priority: explicit argument, then reply text.
    const directSessionId = extractSessionIdFromText(message.text || '');
    const repliedTo = message.reply_to_message;
    const replySessionId = repliedTo ? extractSessionIdFromText(repliedTo.text || repliedTo.caption || '') : null;
    const sessionId = directSessionId || replySessionId;

    if (!sessionId) {
      await ctx.reply('❌ /log requires a session id.\n\nUsage:\n• `/log <UUID>` — fetch a specific session log\n• Reply to a session message with `/log` — fetch the session referenced in that message', {
        parse_mode: 'Markdown',
        reply_to_message_id: message.message_id,
      });
      return;
    }

    // Authorization. /log is only available to chat owners. In private chats
    // there is no "creator" status — the user is implicitly the owner of their
    // own DM, so we allow it. We still apply the optional allowlist used by
    // other commands so a private bot deployment can lock /log to known users.
    if (chatType === 'private') {
      // No further auth required beyond the optional whitelist applied below.
    } else {
      try {
        const member = await ctx.telegram.getChatMember(chatId, ctx.from.id);
        if (!member || member.status !== 'creator') {
          VERBOSE && console.log('[VERBOSE] /log rejected: not chat owner');
          await ctx.reply('❌ /log is only available to the chat owner.', { reply_to_message_id: message.message_id });
          return;
        }
      } catch (error) {
        console.error('[ERROR] /log: getChatMember failed:', error);
        await ctx.reply('❌ Failed to verify permissions for /log.', { reply_to_message_id: message.message_id });
        return;
      }
    }

    if (isChatAuthorized && !isChatAuthorized(chatId)) {
      // Topic-aware fallback (used elsewhere in this repo for forum topics).
      if (!isTopicAuthorized || !isTopicAuthorized(ctx)) {
        VERBOSE && console.log('[VERBOSE] /log rejected: chat not authorized');
        const errMsg = buildAuthErrorMessage ? buildAuthErrorMessage(ctx) : `❌ This chat (ID: ${chatId}) is not authorized.`;
        await ctx.reply(errMsg, { reply_to_message_id: message.message_id });
        return;
      }
    }

    // 1. Validate the session id with $ --status.
    let statusResult;
    try {
      statusResult = await querySessionStatus(sessionId, VERBOSE);
    } catch (error) {
      console.error('[ERROR] /log: querySessionStatus failed:', error);
      await ctx.reply(`❌ Failed to query session status: ${error.message || String(error)}`, { reply_to_message_id: message.message_id });
      return;
    }

    if (!statusResult || !statusResult.exists) {
      await ctx.reply(`❌ Session \`${sessionId}\` is not known to start-command.\n\nUse the session id from a \`📊 Session: <uuid>\` line in one of the bot's status messages.`, {
        parse_mode: 'Markdown',
        reply_to_message_id: message.message_id,
      });
      return;
    }

    // 2. Look up tracked metadata (for repo URL and original chat).
    const sessionInfo = getTrackedSessionInfo ? getTrackedSessionInfo(sessionId) : null;

    // 3. Decide repo visibility — prefer the URL we tracked at launch time.
    let repoVisibility = null;
    let repoUrlDescription = null;
    const trackedUrl = sessionInfo?.url || null;
    if (trackedUrl) {
      const parsed = parseGitHubUrl ? parseGitHubUrl(trackedUrl) : null;
      if (parsed && parsed.valid && parsed.owner && parsed.repo) {
        repoUrlDescription = `${parsed.owner}/${parsed.repo}`;
        try {
          repoVisibility = await detectRepositoryVisibility(parsed.owner, parsed.repo);
        } catch (error) {
          console.error('[ERROR] /log: detectRepositoryVisibility failed:', error);
          repoVisibility = null;
        }
      }
    }

    // 4. Decide the destination.
    const decision = decideLogDestination({ statusResult, sessionInfo, repoVisibility, chatType });
    if (decision.destination === 'reject') {
      // Surface enough state to diagnose false-rejections like issue #1700,
      // where the parser missed the isolation field name reported by the host.
      VERBOSE && console.log(`[VERBOSE] /log rejected session ${sessionId}: reason="${decision.reason}" parsedIsolation=${JSON.stringify(statusResult?.isolation)} sessionInfoBackend=${JSON.stringify(sessionInfo?.isolationBackend)} rawHead=${JSON.stringify((statusResult?.raw || '').slice(0, 240))}`);
      await ctx.reply(`❌ ${decision.reason}`, { reply_to_message_id: message.message_id });
      return;
    }

    // 5. Resolve and validate the on-disk log file.
    const logPath = resolveLogPath({ statusResult, isolationBackend: decision.isolationBackend });
    if (!logPath) {
      await ctx.reply('❌ Could not determine the log file path for this session.', { reply_to_message_id: message.message_id });
      return;
    }
    if (!(await fileExists(logPath))) {
      await ctx.reply(`❌ Log file does not exist on disk:\n\`${logPath}\`\n\nThe session may have been cleaned up by the host or the isolation backend.`, {
        parse_mode: 'Markdown',
        reply_to_message_id: message.message_id,
      });
      return;
    }
    const size = await fileSize(logPath);
    if (size !== null && size > TELEGRAM_DOCUMENT_MAX_BYTES) {
      await ctx.reply(`❌ Log file is ${(size / (1024 * 1024)).toFixed(1)} MB which exceeds Telegram's 50 MB document upload limit.\n\nFile path on host: \`${logPath}\``, {
        parse_mode: 'Markdown',
        reply_to_message_id: message.message_id,
      });
      return;
    }

    const filename = path.basename(logPath);
    const captionLines = [`📁 Log for session \`${sessionId}\``];
    if (decision.isolationBackend) captionLines.push(`🔒 Isolation: \`${decision.isolationBackend}\``);
    if (statusResult.status) captionLines.push(`Status: \`${statusResult.status}\``);
    if (repoUrlDescription) captionLines.push(`Repo: \`${repoUrlDescription}\``);
    captionLines.push(`Privacy: ${decision.reason}`);
    const caption = captionLines.join('\n');

    if (decision.destination === 'chat') {
      // Public repository → reply with the document directly in the chat.
      try {
        await ctx.replyWithDocument({ source: logPath, filename }, { reply_to_message_id: message.message_id, caption, parse_mode: 'Markdown' });
      } catch (error) {
        console.error('[ERROR] /log: replyWithDocument failed:', error);
        await ctx.reply(`❌ Failed to upload log: ${error.message || String(error)}`, { reply_to_message_id: message.message_id });
      }
      return;
    }

    // DM flow: forward the originating message into DM (so the audit chain
    // is preserved), then reply to that forwarded message with the log file.
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply('❌ Cannot deliver the log via DM: missing user id.', { reply_to_message_id: message.message_id });
      return;
    }

    let forwardedMessageId = null;
    try {
      // Forward the message that contains the session id (the reply target if
      // any, otherwise the /log message itself).
      const forwardSource = repliedTo || message;
      const forwardedFromChatId = forwardSource === repliedTo ? chatId : chatId;
      const forwardedSourceMessageId = forwardSource.message_id;
      try {
        const forwarded = await ctx.telegram.forwardMessage(userId, forwardedFromChatId, forwardedSourceMessageId);
        forwardedMessageId = forwarded?.message_id || null;
      } catch (forwardError) {
        // forwardMessage can fail if the user has not opened a DM with the bot
        // yet, or the source chat blocks forwards. Fall back to copyMessage,
        // which works without a forward header.
        try {
          const copied = await ctx.telegram.copyMessage(userId, forwardedFromChatId, forwardedSourceMessageId);
          forwardedMessageId = copied?.message_id || null;
        } catch (copyError) {
          console.error('[ERROR] /log: forward/copyMessage to DM failed:', forwardError, copyError);
          // Fall through — we can still try sendDocument without a reply ref.
        }
      }
    } catch (error) {
      console.error('[ERROR] /log: DM forwarding step failed:', error);
    }

    try {
      const replyOpts = forwardedMessageId ? { reply_to_message_id: forwardedMessageId, caption, parse_mode: 'Markdown' } : { caption, parse_mode: 'Markdown' };
      await ctx.telegram.sendDocument(userId, { source: logPath, filename }, replyOpts);
    } catch (error) {
      console.error('[ERROR] /log: sendDocument to DM failed:', error);
      // Tell the user, in their original chat, that DM delivery failed
      // (commonly because they have not started a chat with the bot).
      const friendly = error?.code === 403 || /chat not found|bot can't initiate conversation/i.test(error?.message || '') ? 'I could not send you a DM. Please open a private chat with me and send /start, then try again.' : `Failed to send the log via DM: ${error.message || String(error)}`;
      await ctx.reply(`❌ ${friendly}`, { reply_to_message_id: message.message_id });
      return;
    }

    // Acknowledge in the original chat (only if it wasn't already a DM).
    if (chatType !== 'private') {
      try {
        await ctx.reply(`📬 Sent the log for \`${sessionId}\` to your direct messages (private repository).`, {
          parse_mode: 'Markdown',
          reply_to_message_id: message.message_id,
        });
      } catch (error) {
        console.error('[ERROR] /log: failed to acknowledge in chat:', error);
      }
    }
  });
}

export const __INTERNAL_FOR_TESTS__ = {
  UUID_RE,
  TELEGRAM_DOCUMENT_MAX_BYTES,
  ISOLATION_BACKENDS,
};
