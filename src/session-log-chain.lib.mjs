/**
 * The whole log of a task that was recovered after a kill (issue #3530).
 *
 * An in-place resume (`$ --resume`) keeps the execution and appends to its log,
 * but a fresh recovery launch is a new execution with a new log file. start-command
 * 0.37.8 has no aliases that would tie the two together, and a launch that reuses
 * an existing `--session-id` truncates the earlier log (see the case study), so
 * hive-mind keeps the chain itself.
 *
 * The chain is rebuilt from `sessions-events.jsonl`, the session store's
 * append-only audit log: every tracked session (and every recovery of it) is
 * written there with its `rootSessionName`, `killRecoveryOfSession`,
 * `executionUuid` and `previousExecutionUuids`. Any id of the chain finds all of
 * it, so `/log` on the one id Telegram shows returns every attempt's log, oldest
 * first, in one file.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3530
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { once } from 'node:events';
import { resolveBotStateDir } from './session-store.lib.mjs';

export const SESSION_EVENTS_FILE = 'sessions-events.jsonl';

const unique = values => [...new Set(values.filter(value => typeof value === 'string' && value))];

/**
 * Every id a persisted session answers to.
 * @param {string} sessionName
 * @param {Object} sessionInfo
 * @returns {string[]}
 */
export function sessionRecordIds(sessionName, sessionInfo = {}) {
  const info = sessionInfo || {};
  return unique([sessionName, info.sessionId, info.executionUuid, info.rootSessionName, info.killRecoveryOfSession, info.killRecoverySessionId, info.containerName, info.rootContainerName, ...(Array.isArray(info.previousExecutionUuids) ? info.previousExecutionUuids : []), ...(Array.isArray(info.containerNameHistory) ? info.containerNameHistory : [])]);
}

/**
 * The executions of one session record, oldest first.
 * @param {Object} sessionInfo
 * @returns {string[]}
 */
export function sessionRecordExecutions(sessionInfo = {}) {
  const info = sessionInfo || {};
  return unique([...(Array.isArray(info.previousExecutionUuids) ? info.previousExecutionUuids : []), info.executionUuid]);
}

/**
 * Group session records (in the order they were written) into recovery chains.
 *
 * @param {Array<{sessionName: string, sessionInfo: Object}>} records
 * @returns {{lookup: (id: string) => ({ids: string[], executions: string[], latest: string, url: string|null, logPaths: Object<string, string>}|null)}}
 */
export function buildSessionLogChains(records = []) {
  const parent = new Map();
  const find = id => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    for (let node = id; node !== root;) {
      const next = parent.get(node);
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const add = id => {
    if (!parent.has(id)) parent.set(id, id);
  };
  const compact = [];
  for (const { sessionName, sessionInfo } of records) {
    const ids = sessionRecordIds(sessionName, sessionInfo);
    if (ids.length === 0) continue;
    ids.forEach(add);
    for (const id of ids.slice(1)) {
      const a = find(ids[0]);
      const b = find(id);
      if (a !== b) parent.set(b, a);
    }
    compact.push({ sessionName, ids, executions: sessionRecordExecutions(sessionInfo), url: sessionInfo?.url || null, executionUuid: sessionInfo?.executionUuid || null, logPath: sessionInfo?.logPath || null });
  }
  return {
    lookup(id) {
      if (!id || !parent.has(id)) return null;
      const root = find(id);
      const members = compact.filter(record => find(record.ids[0]) === root);
      if (members.length === 0) return null;
      const latest = members.at(-1);
      return {
        ids: unique(members.flatMap(record => record.ids)),
        executions: unique(members.flatMap(record => record.executions)),
        latest: latest.sessionName,
        url: [...members].reverse().find(record => record.url)?.url || null,
        // The log each execution was recorded with, for executions `$ --status` no longer knows.
        logPaths: Object.fromEntries(members.filter(record => record.executionUuid && record.logPath).map(record => [record.executionUuid, record.logPath])),
      };
    },
  };
}

/**
 * Read the recovery chain an id belongs to from the session store's audit log.
 *
 * @param {string} id - Any session name, execution UUID or container name of the chain
 * @param {Object} [options]
 * @param {string} [options.eventsPath] - Defaults to the bot state dir's `sessions-events.jsonl`
 * @param {Array<{sessionName: string, sessionInfo: Object}>} [options.liveRecords] - Tracked sessions not yet on disk
 * @param {Object} [options.fsImpl]
 * @param {boolean} [options.verbose]
 * @returns {Promise<{ids: string[], executions: string[], latest: string, url: string|null, logPaths: Object<string, string>}|null>}
 */
export async function readSessionLogChain(id, { eventsPath = path.join(resolveBotStateDir(), SESSION_EVENTS_FILE), liveRecords = [], fsImpl = fs, verbose = false } = {}) {
  if (!id) return null;
  const records = [];
  let stream = null;
  try {
    stream = fsImpl.createReadStream(eventsPath, { encoding: 'utf8' });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.includes('"track"')) continue;
      try {
        const event = JSON.parse(line);
        if (event?.type === 'track' && event.sessionName) records.push({ sessionName: event.sessionName, sessionInfo: event.sessionInfo || {} });
      } catch {
        // A torn last line (crash mid-append) is skipped.
      }
    }
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] session-log-chain: could not read ${eventsPath}: ${error?.message || error}`);
  } finally {
    stream?.destroy();
  }
  const chain = buildSessionLogChains([...records, ...liveRecords]).lookup(id);
  if (verbose) console.log(`[VERBOSE] session-log-chain: ${id} → ${chain ? `${chain.executions.length} execution(s) [${chain.executions.join(', ')}], latest session ${chain.latest}` : 'no recorded chain'} (${records.length} track events read)`);
  return chain;
}

/**
 * Write the logs of every attempt, oldest first, into one file. Each part starts
 * with a header naming the attempt and its execution; a log that is gone is named
 * as missing instead of silently skipped.
 *
 * @param {Object} options
 * @param {Array<{uuid: string, logPath: string|null}>} options.parts
 * @param {string} options.destPath
 * @param {Object} [options.fsImpl]
 * @returns {Promise<{path: string, bytes: number, included: string[], missing: string[]}>}
 */
export async function writeCombinedSessionLog({ parts = [], destPath, fsImpl = fs }) {
  const out = fsImpl.createWriteStream(destPath, { mode: 0o600 });
  let writeError = null;
  out.on('error', error => {
    writeError = error;
  });
  const included = [];
  const missing = [];
  const write = async chunk => {
    if (!out.write(chunk)) await once(out, 'drain');
  };
  try {
    for (const [index, part] of parts.entries()) {
      const header = `${index > 0 ? '\n' : ''}===== hive-mind: attempt ${index + 1}/${parts.length}, execution ${part.uuid}${part.logPath ? ` (${part.logPath})` : ''} =====\n`;
      await write(header);
      if (!part.logPath) {
        missing.push(part.uuid);
        await write('(no log file is known for this execution)\n');
        continue;
      }
      const input = fsImpl.createReadStream(part.logPath);
      try {
        for await (const chunk of input) await write(chunk);
        included.push(part.uuid);
      } catch (error) {
        missing.push(part.uuid);
        await write(`(log could not be read: ${error?.code || error?.message || error})\n`);
      } finally {
        input.destroy();
      }
    }
  } finally {
    out.end();
    if (!out.closed) await once(out, 'close');
  }
  if (writeError) throw writeError;
  const bytes = (await fsImpl.promises.stat(destPath)).size;
  return { path: destPath, bytes, included, missing };
}
