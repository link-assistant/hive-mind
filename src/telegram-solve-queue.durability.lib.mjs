/**
 * Durable solve queue for the Telegram bot: load the stored queue on launch,
 * put it back (reconciling interrupted starts with running sessions), keep
 * saving every change, and tell the chats what was restored.
 *
 * Sources, in order: the links triple store on the state volume (archive,
 * `.lino`, link-cli database), the pinned Telegram backup (opt-in), and the
 * bot logs.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2890
 */

import path from 'node:path';
import { t } from './i18n.lib.mjs';
import { resolveBotStateDir } from './session-store.lib.mjs';
import { createSolveQueuePersistence, parseSolveQueueDocument, restoreSolveQueue, DEFAULT_MAX_RESTORES } from './telegram-solve-queue.persistence.lib.mjs';
import { loadQueueFromLogs } from './telegram-solve-queue.log-recovery.lib.mjs';
import { createTelegramQueueBackup } from './telegram-solve-queue.telegram-backup.lib.mjs';

const MAX_LISTED_ITEMS = 15;

/** Session info for the session monitor, as `createIsolationAwareQueueCallback` tracks it. */
export function sessionInfoFromRecord(record, status = null) {
  return {
    chatId: record.chatId ?? record.messageInfo?.chatId ?? null,
    messageId: record.messageInfo?.messageId ?? null,
    messageThreadId: record.messageInfo?.messageThreadId ?? record.messageThreadId ?? null,
    startTime: record.startedAt ? new Date(record.startedAt) : status?.startTime ? new Date(status.startTime) : new Date(),
    url: record.url,
    command: record.command || 'solve',
    commandAlias: record.commandAlias || null,
    isolationBackend: record.isolationBackend || status?.isolation || null,
    sessionId: record.sessionId,
    tool: record.tool || 'claude',
    infoBlock: record.infoBlock,
    args: Array.isArray(record.args) ? [...record.args] : undefined,
    urlContext: record.urlContext || null,
    requesterUserId: record.requesterUserId ?? null,
  };
}

/**
 * Decide whether an item that was starting when the bot died reached a
 * session. Sessions already resumed from `sessions.json` stay with the
 * monitor; sessions `$` knows about but the bot does not are handed to it.
 */
export function createSessionReconciler({ getTrackedSessionInfo = () => null, querySessionStatus = null, hasActiveSessionForUrlAsync = null, trackSession = null, verbose = false } = {}) {
  const found = new Map();
  return {
    async isSessionRunning(record) {
      if (getTrackedSessionInfo(record.sessionId)) return true;
      if (typeof querySessionStatus !== 'function') return false;
      const status = await querySessionStatus(record.sessionId, verbose);
      if (!status?.exists) return false;
      found.set(record.id, status);
      return true;
    },
    async isUrlRunning(record) {
      if (typeof hasActiveSessionForUrlAsync !== 'function') return false;
      return (await hasActiveSessionForUrlAsync(record.url, verbose))?.isActive === true;
    },
    async onRunning(record) {
      const status = found.get(record.id);
      if (!status || !record.sessionId || getTrackedSessionInfo(record.sessionId) || typeof trackSession !== 'function') return;
      trackSession(record.sessionId, sessionInfoFromRecord(record, status), verbose);
    },
  };
}

const listLine = record => `• ${record.tool || 'claude'} ${record.url}`;

/** One plain-text message per chat (and topic) that had restored items. */
export function buildRestoreNotices(summary, { source } = {}) {
  const groups = new Map();
  const add = (kind, record) => {
    const chatId = record.chatId ?? record.messageInfo?.chatId;
    if (chatId === null || chatId === undefined) return;
    const threadId = record.messageInfo?.messageThreadId ?? record.messageThreadId ?? null;
    const key = `${chatId}:${threadId ?? ''}`;
    if (!groups.has(key)) groups.set(key, { chatId, threadId, locale: record.locale || null, requeued: [], running: [], dropped: [] });
    groups.get(key)[kind].push(record);
  };
  for (const kind of ['requeued', 'running', 'dropped']) for (const entry of summary[kind] || []) add(kind, entry.record);
  const notices = [];
  for (const group of groups.values()) {
    const opts = { locale: group.locale || undefined };
    const lines = [t('telegram.solve_restored_title', { source: source || summary.source || '?' }, opts)];
    for (const kind of ['requeued', 'running', 'dropped']) {
      const records = group[kind];
      if (!records.length) continue;
      lines.push('', t(`telegram.solve_restored_${kind}`, { count: records.length, max: DEFAULT_MAX_RESTORES }, opts));
      lines.push(...records.slice(0, MAX_LISTED_ITEMS).map(listLine));
      if (records.length > MAX_LISTED_ITEMS) lines.push(`… +${records.length - MAX_LISTED_ITEMS}`);
      if (kind === 'dropped') lines.push(t('telegram.solve_restored_resend', {}, opts));
    }
    notices.push({ chatId: group.chatId, threadId: group.threadId, text: lines.join('\n') });
  }
  return notices;
}

/**
 * @param {object} options
 * @param {object} options.queue - the SolveQueue
 * @param {object} options.telegram - Telegraf `bot.telegram`
 * @param {string} [options.stateDir] - host volume for the queue store (default: HIVE_MIND_STATE_DIR or ~/.hive-mind/state)
 * @param {string} [options.logDir] - bot log directory, the last-resort source (default: the logger's directory)
 * @param {string[]} [options.recoveryLogFiles] - extra logs, e.g. a saved `docker logs` (default: HIVE_MIND_QUEUE_RECOVERY_LOG, path-delimiter separated)
 * @param {string|number} [options.backupChatId] - chat for the pinned Telegram copy (default: HIVE_MIND_QUEUE_BACKUP_CHAT_ID)
 * @param {object} [options.reconciler] - see createSessionReconciler
 * @param {Function} [options.ensureExecuteCallback] - set the queue's executor before items are restored
 */
export function createSolveQueueDurability(options = {}) {
  const env = options.env || process.env;
  const {
    queue,
    telegram = null,
    logger = null,
    stateDir = resolveBotStateDir(env),
    logDir = logger?.dir || null,
    recoveryLogFiles = String(env.HIVE_MIND_QUEUE_RECOVERY_LOG || '')
      .split(path.delimiter)
      .filter(Boolean),
    backupChatId = String(env.HIVE_MIND_QUEUE_BACKUP_CHAT_ID || '').trim() || null,
    verbose = false,
    log = console.log,
    reconciler = {},
    ensureExecuteCallback = null,
    notify = true,
    maxRestores = DEFAULT_MAX_RESTORES,
    clinkPath,
    now = () => new Date(),
  } = options;
  const backup = options.backup !== undefined ? options.backup : backupChatId && telegram ? createTelegramQueueBackup({ telegram, chatId: backupChatId, verbose, log }) : null;
  const persistence = options.persistence || createSolveQueuePersistence({ dir: stateDir, logger, backup, verbose, log, clinkPath });
  let started = null;

  async function loadNewest() {
    const stored = await persistence.load();
    if (stored.doc) return stored;
    if (stored.sources?.some(entry => !entry.ok && !entry.missing)) log(`⚠️ /queue-restore: the queue store in ${stateDir} is unreadable, trying the fallbacks`);
    if (backup?.load) {
      const pinned = await backup.load();
      if (pinned.doc) return { ...pinned, ...parseSolveQueueDocument(pinned.doc) };
    }
    if (logDir || recoveryLogFiles.length) {
      const fromLogs = await loadQueueFromLogs({ logDir, extraFiles: recoveryLogFiles, now: now(), verbose, log });
      if (fromLogs.items.length) return fromLogs;
    }
    return stored;
  }

  async function restore() {
    if (typeof ensureExecuteCallback === 'function') ensureExecuteCallback();
    let loaded;
    try {
      loaded = await loadNewest();
    } catch (error) {
      log(`⚠️ /queue-restore: could not load the stored queue: ${error.message}`);
      loaded = { items: [], source: null };
    }
    const summary = await restoreSolveQueue(queue, loaded, { telegram, ...reconciler, maxRestores, verbose, log });
    // Attach only now, so the first save holds the restored items instead of an empty queue.
    persistence.attach(queue);
    await persistence.persist('startup');
    const counts = { requeued: summary.requeued.length, running: summary.running.length, dropped: summary.dropped.length, skipped: summary.skipped.length };
    logger?.event?.('queue_restored', { source: summary.source, revision: summary.revision, ...counts, files: loaded.files });
    if (counts.requeued || counts.running || counts.dropped) log(`♻️ /queue-restore: restored the solve queue from ${summary.source}: ${counts.requeued} queued again, ${counts.running} still running, ${counts.dropped} dropped`);
    else if (verbose) log(`[VERBOSE] /queue-restore: nothing to restore (${summary.source || 'no stored queue'})`);
    if (notify && telegram?.sendMessage) {
      for (const notice of buildRestoreNotices(summary)) {
        try {
          await telegram.sendMessage(notice.chatId, notice.text, { ...(notice.threadId ? { message_thread_id: notice.threadId } : {}), disable_web_page_preview: true });
        } catch (error) {
          log(`⚠️ /queue-restore: could not tell chat ${notice.chatId} about the restored queue: ${error.message}`);
        }
      }
    }
    return summary;
  }

  return {
    persistence,
    backup,
    /** Restore once; later calls return the same result. */
    start() {
      if (!started) started = restore();
      return started;
    },
    flush: () => persistence.flush(),
    close: () => persistence.close(),
  };
}

export default { createSolveQueueDurability, createSessionReconciler, buildRestoreNotices, sessionInfoFromRecord };
