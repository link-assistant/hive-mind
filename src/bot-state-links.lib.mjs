/* eslint-disable no-await-in-loop -- link-cli files are stat-ed, renamed and removed one at a time under the state lock */
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
 * link-cli 3.2+ keeps transactions in an append-only journal,
 * `<db>.transitions.log`, which `--retention` compacts on disk, so writes stay
 * constant-time (link-cli#195, fixed in 3.2.0). link-cli 3.1.x instead kept one
 * commit marker per transaction in `<db>.transitions*.links` for ever and
 * replayed it on open; for such a `clink` the legacy log is rotated to
 * `<db>.transitions*.prev.links` once it passes `logMaxBytes`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4143
 * @see https://github.com/link-foundation/link-cli
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
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

/**
 * link-cli parses `--in` with the links-notation default nesting limit of 64,
 * and a list cell nests one level per item, so a state with dozens of tasks
 * failed to import. A link deeper than `MAX_LINE_DEPTH` is moved to its own
 * line under a content-addressed name (`~c<hash>`) and referenced by that name;
 * the stored doublets, and so the decoder, stay the same.
 */
export const MAX_LINE_DEPTH = 32;

function createEncoder(rootKey) {
  const lines = [];
  const named = new Set();
  const leaf = value => ({ text: toLinkName(value, rootKey), depth: 0 });
  const link = (source, target) => {
    const text = `(${source.text} ${target.text})`;
    const depth = 1 + Math.max(source.depth, target.depth);
    if (depth < MAX_LINE_DEPTH) return { text, depth };
    const name = `~c${createHash('sha256').update(text).digest('base64url').slice(0, 22)}`;
    if (!named.has(name)) {
      named.add(name);
      lines.push(`(${name}: ${source.text} ${target.text})`);
    }
    return { text: name, depth: 0 };
  };
  const list = refs => refs.reduceRight((rest, ref) => link(ref, rest), { text: END, depth: 0 });
  const value = item => {
    if (Array.isArray(item)) return link({ text: ARR, depth: 0 }, list(item.map(leaf)));
    if (isPlainObject(item)) return link({ text: OBJ, depth: 0 }, list(Object.entries(item).map(([key, child]) => link(leaf(key), value(child)))));
    return leaf(item);
  };
  return { lines, value };
}

/** LiNo import document for a state tree: deep links first, the root last. */
export function encodeDoublets(tree, rootKey = LINO_STATE_ROOT) {
  const encoder = createEncoder(rootKey);
  const root = encoder.value(normalizeStringTree(tree) ?? {});
  return [...encoder.lines, `(${rootKey}: ${rootKey} ${root.text})`, ''].join('\n');
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
 * state lock. link-cli 3.2+ also locks each store itself (`--lock flock` by
 * default, link-cli#194), but a state write spans the `.lino` file and several
 * `clink` calls, and link-cli 3.1.x has no lock and loses concurrent updates
 * (see docs/case-studies/issue-4143).
 */
export const DEFAULT_LINKS_LOG_MAX_BYTES = 64 * 1024;

export function createLinksStore({ dbPath, command = resolveClinkCommand(), retention = process.env.HIVE_MIND_STATE_LINKS_RETENTION || 'sized:64', logMaxBytes = Number(process.env.HIVE_MIND_STATE_LINKS_LOG_MAX_BYTES) || DEFAULT_LINKS_LOG_MAX_BYTES, timeoutMs = Number(process.env.HIVE_MIND_STATE_LINKS_TIMEOUT_MS) || 30000, rootKey = LINO_STATE_ROOT, fsImpl = fs, run = runFile, log = () => {} } = {}) {
  const fsp = fsImpl.promises;
  let availability = command ? null : false;
  const tmpPath = suffix => `${dbPath}.${process.pid}.${suffix}.lino`;
  const transactionArgs = ['--transactions', ...(retention ? ['--retention', retention] : [])];
  // Issue #4143: time every clink call (verbose trace in the bot state store); link-cli#195 slowed 3.1.x writes down.
  const clink = async (args, label, target = dbPath) => {
    const started = Date.now();
    try {
      return await run(command, args, { timeoutMs });
    } finally {
      log(`clink ${label} ${target}: ${Date.now() - started}ms`);
    }
  };

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
      await clink(['--db', dbPath, '--out', out], '--out');
      return await fsp.readFile(out, 'utf8');
    } finally {
      await fsp.rm(out, { force: true }).catch(() => {});
    }
  }

  async function importTree(tree, { db = dbPath, args = transactionArgs } = {}) {
    const input = tmpPath('in');
    await fsp.writeFile(input, encodeDoublets(tree, rootKey));
    try {
      await clink(['--db', db, '--in', input, ...args], '--in', db);
    } finally {
      await fsp.rm(input, { force: true }).catch(() => {});
    }
  }

  const base = dbPath.replace(/\.links$/, '');
  const dataFiles = () => [dbPath, `${base}.names.links`];
  // Legacy link-cli 3.1.x marker log; 3.2+ migrates it to a self-compacting `.transitions.log`.
  const logFiles = () => [`${base}.transitions.links`, `${base}.transitions.names.links`];

  const ignoreMissing = error => (error.code === 'ENOENT' ? null : Promise.reject(error));

  async function rotateLogIfLarge() {
    let size = 0;
    for (const file of logFiles())
      size += await fsp.stat(file).then(
        stats => stats.size,
        () => 0
      );
    if (size <= logMaxBytes) return false;
    log(`Rotating the link-cli transitions log of ${dbPath} (${size} bytes)`);
    for (const file of logFiles()) await fsp.rename(file, file.replace(/\.links$/, '.prev.links')).catch(ignoreMissing);
    return true;
  }

  /**
   * Issue #4143: link-cli 3.2.1 commits one transaction per created link with
   * `--transactions` (link-cli#199), about 1 s per task on disk, so a full
   * import can outlast the timeout and a crash leaves it half applied. A first
   * write and a rebuild therefore import into a fresh store without
   * `--transactions` and rename it over the old one: the old store stays
   * readable until the new one is complete.
   */
  async function replaceWithFresh(tree) {
    const freshBase = `${base}.${process.pid}.fresh`;
    const freshData = [`${freshBase}.links`, `${freshBase}.names.links`];
    const cleanup = async () => {
      const prefix = `${path.basename(freshBase)}.`;
      const names = await fsp.readdir(path.dirname(dbPath)).catch(() => []);
      for (const name of names) if (name.startsWith(prefix)) await fsp.rm(path.join(path.dirname(dbPath), name), { recursive: true, force: true });
    };
    await cleanup();
    try {
      await importTree(tree, { db: freshData[0], args: [] });
      // The journal describes the store being replaced.
      for (const file of [`${base}.transitions.log`, ...logFiles()]) await fsp.rm(file, { force: true });
      // Names first: `read()` treats a missing data file as "no state yet".
      const targets = dataFiles();
      for (const index of [1, 0]) await fsp.rename(freshData[index], targets[index]).catch(ignoreMissing);
    } finally {
      await cleanup();
    }
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
      const exists = await fsp.access(dbPath).then(
        () => true,
        () => false
      );
      if (!exists) {
        await replaceWithFresh(tree);
        return true;
      }
      await rotateLogIfLarge();
      await importTree(tree);
      const total = parseDoubletsExport(await exportText()).size;
      const live = countLiveLinks(tree) + 8;
      if (total > Math.max(256, live * 4)) {
        log(`Rebuilding ${dbPath}: ${total} links, ${live} live`);
        await replaceWithFresh(tree);
      }
      return true;
    },
  };
}

export default { DEFAULT_LINKS_LOG_MAX_BYTES, countLiveLinks, createLinksStore, decodeDoublets, encodeDoublets, parseDoubletsExport, resolveClinkCommand, toLinkName };
