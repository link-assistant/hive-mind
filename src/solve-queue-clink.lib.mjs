/**
 * Issue #2890: the link-cli (`clink`) copy of the solve queue.
 *
 * The snapshot is projected onto doublets, one named link per field:
 *
 *   (pending_0.url: pending_0 'https://github.com/owner/repo/issues/1')
 *   (pending_0.tool: pending_0 'codex')
 *   (pending_0.record: pending_0 'b64:...')   -- the whole item, lossless
 *   (snapshot.meta: snapshot 'b64:...')        -- start times and stats
 *
 * so `clink --db queue.links` can query the queue, and the `.record` links
 * restore it when `queue.json` and `queue.lino` are both gone.
 *
 * clink 4.x reads a backslash inside a quoted name as an escape and drops it,
 * and an import that fails part-way keeps the links it already made. A value
 * with a backslash, a newline or both quote kinds is therefore stored as
 * base64 (`b64:` prefix), and every rebuild imports into a fresh database that
 * replaces the old one only after the import succeeded.
 *
 * Optional: without the binary (`clink` on PATH, `~/.dotnet/tools/clink` or
 * `HIVE_MIND_CLINK_PATH`) the json and lino copies carry the queue alone.
 * `HIVE_MIND_QUEUE_CLINK=0` turns the mirror off.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const SECTIONS = ['pending', 'processing', 'completed', 'failed'];
const QUERY_FIELDS = ['id', 'url', 'tool', 'status', 'requester', 'chatId', 'createdAt', 'sessionName'];
const CLINK_TIMEOUT_MS = 30000;

/**
 * Locate the clink binary. Startup and tests only.
 * @param {object} [env=process.env]
 * @returns {string|null}
 */
export function findClinkBinary(env = process.env) {
  if (String(env.HIVE_MIND_QUEUE_CLINK || '').trim() === '0') return null;
  const explicit = String(env.HIVE_MIND_CLINK_PATH || '').trim();
  const home = (() => {
    try {
      return os.homedir();
    } catch {
      return '/tmp';
    }
  })();
  const candidates = [
    explicit,
    ...String(env.PATH || '')
      .split(path.delimiter)
      .filter(Boolean)
      .map(dir => path.join(dir, 'clink')),
    path.join(home, '.dotnet', 'tools', 'clink'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK); // hive-sync-ok: one-time lookup while the store is created at startup
      return candidate;
    } catch {
      /* not here */
    }
  }
  return null;
}

/**
 * Quote a value as a clink name.
 * @param {*} value
 * @returns {string}
 */
export function encodeClinkValue(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  const unsafe = text === '' || text.startsWith('b64:') || /[\\\r\n]/.test(text);
  if (!unsafe && !text.includes("'")) return `'${text}'`;
  if (!unsafe && !text.includes('"')) return `"${text}"`;
  return `'b64:${Buffer.from(text, 'utf8').toString('base64')}'`;
}

/**
 * Read a quoted or bare clink name back.
 * @param {string} token
 * @returns {string}
 */
export function decodeClinkValue(token) {
  let text = String(token || '');
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) text = text.slice(1, -1);
  return text.startsWith('b64:') ? Buffer.from(text.slice(4), 'base64').toString('utf8') : text;
}

/**
 * Project a queue snapshot onto doublet links (LiNo text for `clink --import`).
 * @param {object} snapshot
 * @returns {string}
 */
export function encodeClinkProjection(snapshot) {
  const lines = [];
  const items = { pending: [], processing: snapshot.processing || [], completed: snapshot.completed || [], failed: snapshot.failed || [] };
  for (const [tool, records] of Object.entries(snapshot.queues || {})) {
    lines.push(`(queues.${tool}: queues ${encodeClinkValue(tool)})`);
    for (const record of records) items.pending.push(record);
  }
  for (const section of SECTIONS) {
    items[section].forEach((record, index) => {
      const name = `${section}_${index}`;
      for (const field of QUERY_FIELDS) {
        if (record[field] !== undefined && record[field] !== null) lines.push(`(${name}.${field}: ${name} ${encodeClinkValue(record[field])})`);
      }
      lines.push(`(${name}.record: ${name} ${encodeClinkValue(JSON.stringify(record))})`);
    });
  }
  const { queues: _queues, processing: _processing, completed: _completed, failed: _failed, ...meta } = snapshot;
  lines.push(`(snapshot.meta: snapshot ${encodeClinkValue(JSON.stringify(meta))})`);
  return `${lines.join('\n')}\n`;
}

const TOKEN = String.raw`('[^']*'|"[^"]*"|[^\s()'"]+)`;
const LINK_LINE = new RegExp(String.raw`^\(\s*${TOKEN}:\s*${TOKEN}\s+${TOKEN}\s*\)$`);

/**
 * Rebuild a snapshot from `clink --export` output (point links are ignored).
 * @param {string} text
 * @returns {object|null}
 */
export function decodeClinkProjection(text) {
  const fields = new Map();
  for (const raw of String(text || '').split('\n')) {
    const match = LINK_LINE.exec(raw.trim());
    if (!match) continue;
    const [, name, source, target] = match;
    if (name === source && source === target) continue;
    fields.set(decodeClinkValue(name), decodeClinkValue(target));
  }
  if (!fields.has('snapshot.meta')) return null;
  const snapshot = { ...JSON.parse(fields.get('snapshot.meta')), queues: {}, processing: [], completed: [], failed: [] };
  const ordered = [...fields.keys()].filter(key => key.startsWith('queues.'));
  const tools = ordered.map(key => key.slice('queues.'.length));
  for (const tool of tools) snapshot.queues[tool] = [];
  for (const section of SECTIONS) {
    for (let index = 0; fields.has(`${section}_${index}.record`); index++) {
      const record = JSON.parse(fields.get(`${section}_${index}.record`));
      if (section === 'pending') (snapshot.queues[record.tool || 'claude'] ||= []).push(record);
      else snapshot[section].push(record);
    }
  }
  // The same key order as the snapshot that was written.
  const { version, updatedAt, queues, processing, completed, failed, ...rest } = snapshot;
  return { version, updatedAt, queues, processing, completed, failed, ...rest };
}

function run(bin, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${path.basename(bin)} ${args[0]} ${args[1]}: ${String(stderr || error.message).trim()}`));
      else resolve(String(stdout || ''));
    });
  });
}

/**
 * The link-cli database of the queue in `dir`.
 * @param {object} options
 * @param {string} options.dir
 * @param {string|null} [options.bin] - clink path (default: findClinkBinary()).
 * @param {boolean} [options.required=false] - Report a missing binary.
 * @param {Function} [options.exec] - Injectable runner `(bin, args) => Promise<string>`.
 */
export function createClinkMirror({ dir, bin, required = false, exec = null, fsImpl = fs, logger = null, timeout = CLINK_TIMEOUT_MS } = {}) {
  const fsp = fsImpl.promises || fs.promises;
  const clink = bin === undefined ? findClinkBinary() : bin;
  const runner = exec || ((file, args) => run(file, args, timeout));
  const dbPath = path.join(dir, 'queue.links');
  const namesPath = path.join(dir, 'queue.names.links');
  if (!clink && required) logger?.warn?.('link-cli (clink) is not installed: the solve queue is kept in queue.json and queue.lino only');

  return {
    available: Boolean(clink),
    dbPath,
    async write(snapshot) {
      if (!clink) return false;
      const nextDb = path.join(dir, 'queue.next.links');
      const nextNames = path.join(dir, 'queue.next.names.links');
      const input = path.join(dir, 'queue.clink.tmp.lino');
      await fsp.mkdir(dir, { recursive: true });
      await Promise.all([nextDb, nextNames].map(file => fsp.rm(file, { force: true })));
      await fsp.writeFile(input, encodeClinkProjection(snapshot));
      try {
        await runner(clink, ['--db', nextDb, '--import', input, '--auto-create-missing-references']);
        await fsp.rename(nextNames, namesPath);
        await fsp.rename(nextDb, dbPath);
      } finally {
        await fsp.rm(input, { force: true });
      }
      return true;
    },
    async read() {
      if (!clink) return null;
      try {
        await fsp.access(dbPath);
      } catch {
        return null; // `clink --export` would create an empty database
      }
      const output = path.join(dir, 'queue.clink.export.tmp.lino');
      try {
        await runner(clink, ['--db', dbPath, '--export', output]);
        return decodeClinkProjection(await fsp.readFile(output, 'utf8'));
      } finally {
        await fsp.rm(output, { force: true });
      }
    },
  };
}
