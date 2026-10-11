/**
 * Last-resort recovery of the solve queue from bot logs.
 *
 * When every links store is gone, the queue can still be rebuilt from what the
 * bot wrote to its log:
 *
 * - `EVENT queue_item_<event> {record}` lines carry the full persisted record
 *   of an item (command, args, requester, chat and message ids, tool, status,
 *   timestamps), written on every queue change.
 * - Older versions only wrote `/queue: Enqueued:` / `Starting:` / `Finished:`
 *   lines and the `/<command> raw text:` line of the command (console output,
 *   e.g. `docker logs hive-mind`). These give the id, tool and URL, and the
 *   original command text when it is still in the same log.
 *
 * Lines are folded in order, by item id: an item that was finished, cancelled
 * or rejected later in the log is not restored.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2890
 */

import fs from 'node:fs';
import path from 'node:path';
import { canonicalizeGitHubUrl } from './github-url-parser.lib.mjs';
import { applySolveToolAlias, getSolveToolAliasFromText, parseCommandArgs } from './telegram-solve-command.lib.mjs';
import { extractIsolationFromArgs } from './telegram-isolation.lib.mjs';

export const DEFAULT_LOG_RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_LOG_RECOVERY_MAX_FILES = 50;

const DONE_EVENTS = new Set(['finished', 'cancelled', 'rejected']);
const ISO_PREFIX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s/;
const EVENT_LINE = /\bEVENT queue_item_([a-z_]+) (\{.*\})\s*$/;
const QUEUE_LINE = /\/queue: (Enqueued|Restored|Starting|Finished|Cancelled queued item|Rejected queued item): \[([^\]]+)\] (\S+) \(([a-z]+)\)(?: (?:to|from) ([\w.-]+) queue)?/;
const RAW_TEXT_LINE = /\[VERBOSE\] (\/[\w@]+) raw text: (.*)$/;

/** `solve-<ms>-<random>` ids carry their creation time. */
export function timeFromItemId(id) {
  const match = /^solve-(\d{12,14})-/.exec(String(id || ''));
  if (!match) return null;
  const date = new Date(Number(match[1]));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const canonical = url => canonicalizeGitHubUrl(String(url || '')) || String(url || '');

/**
 * Rebuild the solve arguments from the command text the user sent, the way
 * the /solve handler does before applying the bot's locked overrides.
 */
export function argsFromCommandText(text, url, tool) {
  let args = applySolveToolAlias(parseCommandArgs(text), getSolveToolAliasFromText(text));
  const { backend, filteredArgs } = extractIsolationFromArgs(args);
  args = filteredArgs;
  const index = args.findIndex(arg => canonical(arg) === canonical(url));
  if (index > 0) args = [args[index], ...args.slice(0, index), ...args.slice(index + 1)];
  if (index >= 0) args[0] = url;
  else args = [url, ...args];
  if (tool && tool !== 'claude' && !args.some((arg, i) => arg === `--tool=${tool}` || (arg === '--tool' && args[i + 1] === tool))) args.push('--tool', tool);
  return { args, perCommandIsolation: backend || null };
}

/**
 * Fold log text into queue records.
 * @param {string|string[]} input - log text (or several, oldest first)
 * @returns {{records: Map<string, object>, done: Set<string>, starts: object}}
 */
export function foldQueueLog(input, state = { records: new Map(), done: new Set(), starts: {}, rawTexts: [] }) {
  const texts = Array.isArray(input) ? input : [input];
  for (const text of texts) {
    for (const line of String(text || '').split('\n')) {
      const at = ISO_PREFIX.exec(line)?.[1] || null;
      const event = EVENT_LINE.exec(line);
      if (event) {
        let record;
        try {
          record = JSON.parse(event[2]);
        } catch {
          continue; // a line cut off by the kill
        }
        if (!record?.id) continue;
        if (DONE_EVENTS.has(event[1])) {
          state.records.delete(record.id);
          state.done.add(record.id);
          continue;
        }
        if (state.done.has(record.id)) continue;
        state.records.set(record.id, { ...state.records.get(record.id), ...record, source: 'event' });
        if (event[1] === 'starting' && record.tool) state.starts[record.tool] = record.startedAt || at;
        continue;
      }
      const raw = RAW_TEXT_LINE.exec(line);
      if (raw) {
        state.rawTexts.push({ command: raw[1], text: raw[2], at });
        if (state.rawTexts.length > 200) state.rawTexts.shift();
        continue;
      }
      const queueLine = QUEUE_LINE.exec(line);
      if (!queueLine) continue;
      const [, kind, id, url, status, tool] = queueLine;
      if (kind === 'Finished' || kind.startsWith('Cancelled') || kind.startsWith('Rejected')) {
        state.records.delete(id);
        state.done.add(id);
        continue;
      }
      if (state.done.has(id)) continue;
      const known = state.records.get(id);
      if (kind === 'Starting') {
        if (known) known.status = 'starting';
        if (known && !known.startedAt) known.startedAt = at || null;
        if (tool) state.starts[tool] = at || timeFromItemId(id);
        if (known || !tool) continue;
      }
      if (known?.source === 'event') continue;
      const record = known || { id, url, tool: tool || 'claude', status: kind === 'Starting' ? 'starting' : status === 'waiting' ? 'waiting' : 'queued', createdAt: timeFromItemId(id) || at, source: 'legacy' };
      if (!record.args) {
        const target = canonical(url);
        const rawIndex = state.rawTexts.findLastIndex(entry => entry.text.split(/\s+/).some(word => canonical(word) === target));
        if (rawIndex >= 0) {
          const [entry] = state.rawTexts.splice(rawIndex, 1);
          Object.assign(record, argsFromCommandText(entry.text, url, record.tool), { commandText: entry.text });
        }
      }
      state.records.set(id, record);
    }
  }
  return state;
}

/**
 * Turn folded log state into what `restoreSolveQueue` expects.
 * @param {object} state - result of foldQueueLog
 */
export function queueFromLogState(state, { now = new Date(), maxAgeMs = DEFAULT_LOG_RECOVERY_MAX_AGE_MS } = {}) {
  const cutoff = now.getTime() - maxAgeMs;
  const items = [];
  for (const record of state.records.values()) {
    const created = Date.parse(record.createdAt || '') || 0;
    if (!record.url || (maxAgeMs && created && created < cutoff)) continue;
    const { source, commandText, ...rest } = record;
    if (!rest.args) Object.assign(rest, argsFromCommandText('', rest.url, rest.tool));
    if (source === 'legacy' && !rest.infoBlock) rest.infoBlock = commandText ? `${rest.url}\n${commandText}` : rest.url;
    items.push(rest);
  }
  items.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  const header = Object.keys(state.starts).length ? { lastStartTimeByTool: { ...state.starts }, lastStartTime: Object.values(state.starts).sort().at(-1) || null, stats: {} } : null;
  return { doc: null, source: 'log', revision: null, header, items };
}

/**
 * Bot log files to read, oldest first: the rotated `telegram-bot-*.log`
 * backups, the active log, then any extra files (e.g. a saved `docker logs`).
 */
export function listRecoveryLogFiles({ logDir, baseName = 'telegram-bot', extraFiles = [], maxFiles = DEFAULT_LOG_RECOVERY_MAX_FILES, fsImpl = fs } = {}) {
  const files = [];
  if (logDir) {
    try {
      const backups = fsImpl
        .readdirSync(logDir)
        .filter(name => name.startsWith(`${baseName}-`) && name.endsWith('.log'))
        .sort()
        .slice(-maxFiles);
      files.push(...backups.map(name => path.join(logDir, name)));
      if (fsImpl.existsSync(path.join(logDir, `${baseName}.log`))) files.push(path.join(logDir, `${baseName}.log`));
    } catch {
      /* no log directory */
    }
  }
  return [...extraFiles.filter(Boolean), ...files];
}

/**
 * Read the queue back from log files.
 * @returns {Promise<{doc: null, source: 'log', revision: null, header: object|null, items: object[], files: string[]}>}
 */
export async function loadQueueFromLogs({ logDir, extraFiles = [], now = new Date(), maxAgeMs = DEFAULT_LOG_RECOVERY_MAX_AGE_MS, verbose = false, log = console.log, fsImpl = fs } = {}) {
  const files = listRecoveryLogFiles({ logDir, extraFiles, fsImpl });
  const state = { records: new Map(), done: new Set(), starts: {}, rawTexts: [] };
  const read = [];
  for (const file of files) {
    try {
      foldQueueLog(fsImpl.readFileSync(file, 'utf8'), state);
      read.push(file);
    } catch (error) {
      if (verbose) log(`[VERBOSE] /queue-restore: could not read ${file}: ${error.message}`);
    }
  }
  const result = { ...queueFromLogState(state, { now, maxAgeMs }), files: read };
  if (verbose) log(`[VERBOSE] /queue-restore: ${result.items.length} pending item(s) found in ${read.length} log file(s)`);
  return result;
}

export default {
  timeFromItemId,
  argsFromCommandText,
  foldQueueLog,
  queueFromLogState,
  listRecoveryLogFiles,
  loadQueueFromLogs,
};
