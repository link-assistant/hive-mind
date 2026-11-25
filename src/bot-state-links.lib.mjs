/**
 * Binary mirror of the bot instance state in a link-cli (`clink`) doublets
 * store (issue #4143).
 *
 * The state string tree is stored as doublets so link-cli can keep it in its
 * binary store with the transactions log enabled:
 *
 *   (hive_mind_state: hive_mind_state <value>)  root, re-pointed on each write
 *   (~obj <list>)   object; list cells are (entry rest) ending in ~end,
 *                   each entry is (keyLeaf valueRef)
 *   (~arr <list>)   array of leaves
 *   leaf            a named point; names outside the safe charset, names
 *                   starting with `~`, numeric names and the root name are
 *                   stored as `~b64_<base64url>`
 *
 * link-cli deduplicates links by content, so an entry `(x x)` is the point `x`
 * itself; decoding is therefore driven by position (entry, list, value).
 * Old links stay in the store after the root is re-pointed, so the store is
 * rebuilt when garbage outgrows the live tree.
 *
 * link-cli 3.1.2 keeps one commit marker per transaction in the transitions
 * log for ever (retention only drops payloads) and replays the log on open, so
 * every import gets slower: about 0.1 s more per 10 writes. The log is rotated
 * to `<db>.transitions*.prev.links` once it passes `logMaxBytes`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4143
 * @see https://github.com/link-foundation/link-cli
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { B64_PREFIX, LINO_STATE_ROOT, decodeB64, encodeB64, normalizeStringTree } from './bot-state-lino.lib.mjs';

const SAFE_NAME = /^[A-Za-z_-][A-Za-z0-9_.-]*$/;
const OBJ = '~obj';
const ARR = '~arr';
const END = '~end';

/** Map a string to a link-cli name that survives import and export. */
export function toLinkName(value, rootKey = LINO_STATE_ROOT) {
  const text = String(value);
  if (text !== rootKey && SAFE_NAME.test(text) && !text.startsWith('~')) return text;
  return encodeB64(text);
}

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function encodeList(refs) {
  let list = END;
  for (let index = refs.length - 1; index >= 0; index--) list = `(${refs[index]} ${list})`;
  return list;
}

function encodeValue(value, rootKey) {
  if (Array.isArray(value)) return `(${ARR} ${encodeList(value.map(item => toLinkName(item, rootKey)))})`;
  if (isPlainObject(value)) return `(${OBJ} ${encodeList(Object.entries(value).map(([key, child]) => `(${toLinkName(key, rootKey)} ${encodeValue(child, rootKey)})`))})`;
  return toLinkName(value, rootKey);
}

/** One-line LiNo import document for a state tree. */
export function encodeDoublets(tree, rootKey = LINO_STATE_ROOT) {
  const normalized = normalizeStringTree(tree) ?? {};
  return `(${rootKey}: ${rootKey} ${encodeValue(normalized, rootKey)})\n`;
}

/** Parse `clink --out` lines `(id: source target)` into a map. */
export function parseDoubletsExport(text) {
  const links = new Map();
  for (const line of String(text).split('\n')) {
    const match = /^\((\S+): (\S+) (\S+)\)$/.exec(line.trim());
    if (match) links.set(match[1], [match[2], match[3]]);
  }
  return links;
}

/** Decode the state tree under `rootKey` from a doublets export. */
export function decodeDoublets(text, rootKey = LINO_STATE_ROOT) {
  const links = parseDoubletsExport(text);
  const root = links.get(rootKey);
  if (!root) return null;
  const seen = new Set();
  const get = ref => {
    const link = links.get(ref);
    if (!link) throw new Error(`Missing link ${ref}`);
    return link;
  };
  const isPoint = ref => {
    const link = links.get(ref);
    return link && link[0] === ref && link[1] === ref;
  };
  const leaf = ref => {
    if (!isPoint(ref)) throw new Error(`Expected a named point, found ${ref}`);
    return ref.startsWith(B64_PREFIX) ? decodeB64(ref) : ref;
  };
  const list = ref => {
    const items = [];
    while (ref !== END) {
      if (items.length > 1000000) throw new Error('Cyclic list');
      const [head, rest] = get(ref);
      items.push(head);
      ref = rest;
    }
    return items;
  };
  const value = ref => {
    if (isPoint(ref)) return leaf(ref);
    const [kind, body] = get(ref);
    if (seen.has(ref)) throw new Error(`Cycle at ${ref}`);
    seen.add(ref);
    try {
      if (kind === ARR) return list(body).map(leaf);
      if (kind === OBJ) {
        const result = {};
        for (const entry of list(body)) {
          if (isPoint(entry)) {
            const name = leaf(entry);
            result[name] = name;
          } else {
            const [key, child] = get(entry);
            result[leaf(key)] = value(child);
          }
        }
        return result;
      }
      throw new Error(`Unknown container ${kind}`);
    } finally {
      seen.delete(ref);
    }
  };
  const tree = value(root[1]);
  return isPlainObject(tree) ? tree : {};
}

/** Live link count of the tree, used to decide when to rebuild the store. */
export const countLiveLinks = tree => (encodeDoublets(tree).match(/\(/g) || []).length;

const runFile = (command, args, { timeoutMs }) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = String(stderr || '').trim();
        reject(error);
      } else resolve({ stdout, stderr });
    });
  });

/**
 * Resolve the clink executable. `HIVE_MIND_CLINK=off` disables the binary
 * store; any other value is the command to run.
 */
export function resolveClinkCommand(env = process.env) {
  const configured = env.HIVE_MIND_CLINK?.trim();
  if (configured && /^(off|false|0|none|disabled)$/i.test(configured)) return null;
  return configured || 'clink';
}

/**
 * Create a client for the doublets store. Callers serialize access with the
 * state lock: link-cli 3.1.2 has no lock of its own and loses concurrent
 * updates (see docs/case-studies/issue-4143).
 */
export const DEFAULT_LINKS_LOG_MAX_BYTES = 64 * 1024;

export function createLinksStore({ dbPath, command = resolveClinkCommand(), retention = process.env.HIVE_MIND_STATE_LINKS_RETENTION || 'sized:64', logMaxBytes = Number(process.env.HIVE_MIND_STATE_LINKS_LOG_MAX_BYTES) || DEFAULT_LINKS_LOG_MAX_BYTES, timeoutMs = 30000, rootKey = LINO_STATE_ROOT, fsImpl = fs, run = runFile, log = () => {} } = {}) {
  const fsp = fsImpl.promises;
  let availability = command ? null : false;
  const tmpPath = suffix => `${dbPath}.${process.pid}.${suffix}.lino`;
  const transactionArgs = ['--transactions', ...(retention ? ['--retention', retention] : [])];

  async function available() {
    if (availability !== null) return availability;
    try {
      await run(command, ['--version'], { timeoutMs });
      availability = true;
    } catch (error) {
      availability = false;
      log(`link-cli (${command}) is not available: ${error.code || error.message}`);
    }
    return availability;
  }

  async function exportText() {
    const out = tmpPath('out');
    try {
      await run(command, ['--db', dbPath, '--out', out], { timeoutMs });
      return await fsp.readFile(out, 'utf8');
    } finally {
      await fsp.rm(out, { force: true }).catch(() => {});
    }
  }

  async function importTree(tree) {
    const input = tmpPath('in');
    await fsp.writeFile(input, encodeDoublets(tree, rootKey));
    try {
      await run(command, ['--db', dbPath, '--in', input, ...transactionArgs], { timeoutMs });
    } finally {
      await fsp.rm(input, { force: true }).catch(() => {});
    }
  }

  const base = dbPath.replace(/\.links$/, '');
  const dataFiles = () => [dbPath, `${base}.names.links`];
  const logFiles = () => [`${base}.transitions.links`, `${base}.transitions.names.links`];

  async function rotateLogIfLarge() {
    let size = 0;
    for (const file of logFiles()) size += await fsp.stat(file).then(stats => stats.size, () => 0);
    if (size <= logMaxBytes) return false;
    log(`Rotating the link-cli transitions log of ${dbPath} (${size} bytes)`);
    for (const file of logFiles()) await fsp.rename(file, file.replace(/\.links$/, '.prev.links')).catch(error => (error.code === 'ENOENT' ? null : Promise.reject(error)));
    return true;
  }

  return {
    get dbPath() {
      return dbPath;
    },
    get command() {
      return command;
    },
    get files() {
      return { data: dataFiles(), log: logFiles() };
    },
    available,
    /** Read the tree; `null` when the store holds no state yet. */
    async read() {
      if (!(await available())) return null;
      try {
        await fsp.access(dbPath);
      } catch {
        return null;
      }
      return decodeDoublets(await exportText(), rootKey);
    },
    /** Write the tree and rebuild the store when garbage outgrows it. */
    async write(tree) {
      if (!(await available())) return false;
      await fsp.mkdir(path.dirname(dbPath), { recursive: true });
      await rotateLogIfLarge();
      await importTree(tree);
      const total = parseDoubletsExport(await exportText()).size;
      const live = countLiveLinks(tree) + 8;
      if (total > Math.max(256, live * 4)) {
        log(`Rebuilding ${dbPath}: ${total} links, ${live} live`);
        for (const file of dataFiles()) await fsp.rm(file, { force: true });
        await importTree(tree);
      }
      return true;
    },
  };
}

export default { DEFAULT_LINKS_LOG_MAX_BYTES, countLiveLinks, createLinksStore, decodeDoublets, encodeDoublets, parseDoubletsExport, resolveClinkCommand, toLinkName };
