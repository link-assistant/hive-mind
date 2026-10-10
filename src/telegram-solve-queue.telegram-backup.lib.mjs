/**
 * Off-host copy of the solve queue in Telegram.
 *
 * The Bot API cannot read chat history, so the bot cannot rebuild its queue
 * from the messages it sent. Instead, when `HIVE_MIND_QUEUE_BACKUP_CHAT_ID`
 * is set, the bot keeps the `.lino` projection of the queue as a pinned
 * document in that chat (a private channel or group where the bot can pin).
 * Each new copy replaces the previous one. On startup, if both links stores
 * on the host volume are gone, the pinned document is read back with
 * `getChat` → `pinned_message.document` → `getFileLink`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2890
 */

import { documentRevision, documentToLino, linoToDocument } from './solve-queue-store.lib.mjs';

export const QUEUE_BACKUP_FILE_NAME = 'solve-queue.lino';
export const DEFAULT_QUEUE_BACKUP_INTERVAL_MS = 60 * 1000;

/**
 * @param {object} options
 * @param {object} options.telegram - Telegraf `bot.telegram`
 * @param {string|number} options.chatId - backup chat
 * @param {number} [options.minIntervalMs] - at most one upload per interval
 * @param {Function} [options.fetchImpl] - fetch used to download the pinned file
 */
export function createTelegramQueueBackup(options = {}) {
  const { telegram, chatId, minIntervalMs = DEFAULT_QUEUE_BACKUP_INTERVAL_MS, fetchImpl = globalThis.fetch, verbose = false, log = console.log, setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now() } = options;
  const trace = message => {
    if (verbose) log(`[VERBOSE] /queue-backup: ${message}`);
  };
  let pendingDoc = null;
  let timer = null;
  let lastUploadAt = 0;
  let lastMessageId = null;
  let chain = Promise.resolve();

  async function upload(doc) {
    const text = await documentToLino(doc);
    const revision = documentRevision(doc);
    const sent = await telegram.sendDocument(chatId, { source: Buffer.from(text, 'utf8'), filename: QUEUE_BACKUP_FILE_NAME }, { caption: `solve-queue revision ${revision ?? '?'}`, disable_notification: true });
    await telegram.pinChatMessage(chatId, sent.message_id, { disable_notification: true });
    // Deleting the previous copy also unpins it, so the pinned message is always the newest.
    if (lastMessageId && lastMessageId !== sent.message_id) await telegram.deleteMessage(chatId, lastMessageId).catch(() => {});
    lastMessageId = sent.message_id;
    lastUploadAt = now();
    trace(`revision ${revision} pinned as message ${sent.message_id} in ${chatId}`);
  }

  function run() {
    timer = null;
    const doc = pendingDoc;
    pendingDoc = null;
    if (!doc) return chain;
    chain = chain.then(() => upload(doc)).catch(error => log(`⚠️ /queue-backup: could not save the queue to Telegram chat ${chatId}: ${error.message}`));
    return chain;
  }

  /** Remember the newest document; upload it at most once per interval. */
  function save(doc) {
    pendingDoc = doc;
    if (timer) return;
    const wait = Math.max(0, lastUploadAt + minIntervalMs - now());
    timer = setTimer(run, wait);
    timer?.unref?.();
  }

  async function flush() {
    if (timer) {
      clearTimer(timer);
      run();
    }
    await chain;
  }

  /** Read the pinned copy back. */
  async function load() {
    const empty = { doc: null, source: 'telegram', revision: null };
    try {
      const chat = await telegram.getChat(chatId);
      const pinned = chat?.pinned_message;
      const document = pinned?.document;
      if (!document || document.file_name !== QUEUE_BACKUP_FILE_NAME) {
        trace(`no pinned ${QUEUE_BACKUP_FILE_NAME} in ${chatId}`);
        return empty;
      }
      const link = await telegram.getFileLink(document.file_id);
      const response = await fetchImpl(String(link));
      if (!response.ok) throw new Error(`download failed with HTTP ${response.status}`);
      const doc = await linoToDocument(await response.text());
      lastMessageId = pinned.message_id;
      trace(`loaded revision ${documentRevision(doc)} from pinned message ${pinned.message_id}`);
      return { doc, source: 'telegram', revision: documentRevision(doc) };
    } catch (error) {
      log(`⚠️ /queue-backup: could not read the queue from Telegram chat ${chatId}: ${error.message}`);
      return empty;
    }
  }

  return { save, flush, load };
}

export default { createTelegramQueueBackup, QUEUE_BACKUP_FILE_NAME };
