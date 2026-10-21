/**
 * Issue #2890: rebuild the solve queue from the bot log.
 *
 * The last-resort fallback when `queue.json`, `queue.lino` and the link-cli
 * database are all gone. The bot log (`~/.hive-mind/logs/telegram-bot*.log`)
 * keeps two kinds of records:
 *
 * - `EVENT queue_item_*` lines written by attachQueuePersistence() (full item
 *   records: chat, message, requester, args, tool, ...);
 * - the older `[VERBOSE] /queue: Enqueued:` / `Starting:` / `Finished:` lines
 *   and the `[VERBOSE] /<command> raw text:` line, which carry only the id,
 *   URL, tool and the typed text. Items rebuilt from them have no chat, so the
 *   restore cannot tell anyone about them, but they still run again.
 *
 * Telegram itself cannot be the fallback: the Bot API has no way to read chat
 * history or fetch an old message by id, so the log is the only durable copy.
 */

import fs from 'node:fs';
import path from 'node:path';

const LOG_BASE_NAME = 'telegram-bot';
// Rotated logs are capped at 10 MiB and up to 100 are kept; reading all of them
// at startup would stall the launch, so only the newest files up to this budget are read.
export const LOG_RECOVERY_MAX_BYTES = 64 * 1024 * 1024;

const EVENT_RE = /\bEVENT (queue_item_[a-z_]+)(?: (\{.*\}))?\s*$/;
const RAW_TEXT_RE = /\[VERBOSE\] \/([a-z0-9_-]+) raw text: \/([a-z0-9_]+)(?:@\S+)?\s+(.*)$/i;
const ITEM_LINE_RE = /\/queue: (Enqueued|Starting|Finished|Cancelled queued item|Rejected queued item): \[(solve-[^\]\s]+)\] (\S+) \(([a-z]+)\)(?: (?:to|from) ([a-z0-9_-]+) queue)?/i;
const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s/;
// The command aliases that pick a tool (`/codex <url>` == `/solve <url> --tool codex`).
const ALIAS_TOOLS = new Set(['agent', 'codex', 'qwen', 'gemini', 'opencode', 'claude']);

function createdAtFromId(id) {
  const match = String(id || '').match(/^solve-(\d{10,})-/);
  return match ? new Date(Number(match[1])).toISOString() : null;
}

function withToolArg(args, tool) {
  if (!tool || tool === 'claude' || args.includes('--tool')) return args;
  return [...args, '--tool', tool];
}

/**
 * Rebuild a queue snapshot from bot log text.
 *
 * @param {string} text - One or more bot log files, oldest first.
 * @returns {object|null} A snapshot like buildQueueSnapshot(), or null when the log has no queue records.
 */
export function parseQueueLogText(text) {
  const entries = new Map(); // id -> { record, state }
  const rawByUrl = new Map(); // url -> { alias, args }
  const entryFor = id => {
    if (!entries.has(id)) entries.set(id, { record: { id }, state: 'queued' });
    return entries.get(id);
  };
  let lastTimestamp = null;
  for (const line of String(text || '').split('\n')) {
    if (!line) continue;
    const stamp = line.match(TIMESTAMP_RE);
    if (stamp) lastTimestamp = stamp[1];
    const event = line.match(EVENT_RE);
    if (event) {
      let data;
      try {
        data = event[2] ? JSON.parse(event[2]) : {};
      } catch {
        continue;
      }
      if (!data?.id) continue;
      const entry = entryFor(data.id);
      const type = event[1];
      if (type === 'queue_item_enqueued') {
        entry.record = { ...entry.record, ...data };
        entry.state = 'queued';
      } else if (type === 'queue_item_message') {
        if (data.messageInfo) entry.record.messageInfo = data.messageInfo;
        if (data.chatId !== undefined && data.chatId !== null) entry.record.chatId = data.chatId;
      } else if (type === 'queue_item_cancelled') {
        entry.state = 'cancelled';
      } else if (type === 'queue_item_starting') {
        entry.record = { ...entry.record, ...data };
        entry.state = 'starting';
      } else if (type === 'queue_item_finished') {
        entry.record = { ...entry.record, ...data };
        entry.state = data.status === 'started' ? 'started' : 'failed';
      }
      continue;
    }
    const raw = line.match(RAW_TEXT_RE);
    if (raw) {
      const tokens = raw[3].trim().split(/\s+/).filter(Boolean);
      if (tokens.length > 0 && /^https?:\/\//.test(tokens[0])) rawByUrl.set(tokens[0], { alias: raw[2].toLowerCase(), args: tokens });
      continue;
    }
    const itemLine = line.match(ITEM_LINE_RE);
    if (!itemLine) continue;
    const [, kind, id, url, status, tool] = itemLine;
    const known = entries.has(id);
    const entry = entryFor(id);
    if (!known || !entry.record.url) {
      const rawText = rawByUrl.get(url);
      const itemTool = (tool || (rawText && ALIAS_TOOLS.has(rawText.alias) ? rawText.alias : null) || 'claude').toLowerCase();
      entry.record = { id, url, tool: itemTool, args: withToolArg(rawText ? rawText.args : [url], itemTool), createdAt: createdAtFromId(id) || lastTimestamp, status, ...entry.record };
    }
    if (kind === 'Enqueued') {
      if (!known) entry.state = 'queued';
    } else if (kind === 'Starting') {
      entry.state = 'starting';
      entry.record.status = 'starting';
    } else if (kind === 'Finished') {
      entry.state = status === 'started' ? 'started' : status === 'failed' ? 'failed' : entry.state;
      entry.record.status = status;
    } else if (kind === 'Cancelled queued item') {
      entry.state = 'cancelled';
    } else {
      entry.state = 'failed';
      entry.record.status = 'failed';
    }
  }
  if (entries.size === 0) return null;
  const snapshot = { version: 1, updatedAt: lastTimestamp, queues: {}, processing: [], completed: [], failed: [], lastStartTime: null, lastStartTimeByTool: {}, stats: {}, recoveredFrom: 'log' };
  for (const { record, state } of entries.values()) {
    if (!record.url) continue;
    const tool = record.tool || 'claude';
    if (state === 'queued') (snapshot.queues[tool] ||= []).push({ ...record, tool, status: record.status === 'waiting' ? 'waiting' : 'queued' });
    else if (state === 'starting') snapshot.processing.push({ ...record, tool, status: 'starting' });
    else if (state === 'started') snapshot.completed.push({ ...record, tool });
    else if (state === 'failed') snapshot.failed.push({ ...record, tool });
  }
  return snapshot;
}

/**
 * Read the bot logs (rotated backups oldest first, then the active file) and
 * rebuild the queue from them.
 *
 * @param {object} options
 * @param {string} options.logDir - The bot log directory (`botLogger.dir`).
 * @param {object} [options.fsImpl=fs]
 * @param {number} [options.maxBytes=LOG_RECOVERY_MAX_BYTES]
 * @returns {Promise<object|null>}
 */
export async function readQueueFromBotLogs({ logDir, fsImpl = fs, maxBytes = LOG_RECOVERY_MAX_BYTES } = {}) {
  if (!logDir) return null;
  const fsp = fsImpl.promises || fs.promises;
  let names;
  try {
    names = await fsp.readdir(logDir);
  } catch {
    return null;
  }
  const backups = names.filter(name => name.startsWith(`${LOG_BASE_NAME}-`) && name.endsWith('.log')).sort();
  const files = [...backups, ...(names.includes(`${LOG_BASE_NAME}.log`) ? [`${LOG_BASE_NAME}.log`] : [])];
  // Newest first until the budget is spent, then parse oldest first.
  const texts = [];
  let budget = maxBytes;
  for (let index = files.length - 1; index >= 0 && budget > 0; index--) {
    try {
      const text = await fsp.readFile(path.join(logDir, files[index]), 'utf8');
      texts.unshift(text);
      budget -= text.length;
    } catch {
      // A backup pruned while we read it is not an error.
    }
  }
  return texts.length > 0 ? parseQueueLogText(texts.join('\n')) : null;
}
