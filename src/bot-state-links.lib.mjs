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
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
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
    if (Array.isArray(item)) return link({ text: ARR, depth: 0 }, list(item.map(value)));
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
    const visited = new Set();
    while (ref !== END) {
      if (visited.has(ref)) throw new Error('Cyclic list');
      visited.add(ref);
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
      if (kind === ARR) return list(body).map(value);
      if (kind === OBJ) {
        return Object.fromEntries(
          list(body).map(entry => {
            if (isPoint(entry)) {
              const name = leaf(entry);
              return [name, name];
            }
            const [key, child] = get(entry);
            return [leaf(key), value(child)];
          })
        );
      }
      throw new Error(`Unknown container ${kind}`);
    } finally {
      seen.delete(ref);
    }
  };
  const tree = value(root[1]);
  if (!isPlainObject(tree)) throw new Error('The binary state root must be an object');
  return tree;
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

export function createLinksStore({ dbPath, env = process.env, command = resolveClinkCommand(env), retention = env.HIVE_MIND_STATE_LINKS_RETENTION || 'sized:64', logMaxBytes = Number(env.HIVE_MIND_STATE_LINKS_LOG_MAX_BYTES) || DEFAULT_LINKS_LOG_MAX_BYTES, timeoutMs = Number(env.HIVE_MIND_STATE_LINKS_TIMEOUT_MS) || 30000, indexedLookups = !/^(off|false|0|no)$/i.test(env.HIVE_MIND_STATE_LINKS_INDEXED_LOOKUPS?.trim() || ''), rootKey = LINO_STATE_ROOT, fsImpl = fs, run = runFile, log = () => {} } = {}) {
  const fsp = fsImpl.promises;
  let availability = command ? null : false;
  let version = [];
  const tmpPath = suffix => `${dbPath}.${randomUUID()}.${suffix}.lino`;
  const atLeast = (minor, patch = 0) => version[0] > 3 || (version[0] === 3 && (version[1] > minor || (version[1] === minor && version[2] >= patch)));
  const transactionArgs = ['--transactions', ...(retention ? ['--retention', retention] : [])];
  // Every leaf of the state is a named link, and link-cli resolves names by
  // scanning the whole names store unless `--indexed-lookups` (link-cli 1.0.9+)
  // is given: without it 2400 names take ~28 s to import and again to export
  // (link-cli#110 added the flag as an opt-in decorator).
  const lookupArgs = indexedLookups ? ['--indexed-lookups'] : [];
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
      const result = await run(command, ['--version'], { timeoutMs });
      version =
        String(result?.stdout ?? '')
          .match(/\b(\d+)\.(\d+)\.(\d+)\b/)
          ?.slice(1)
          .map(Number) ?? [];
      availability = true;
    } catch (error) {
      availability = false;
      log(`link-cli (${command}) is not available: ${error.code || error.message}`);
    }
    return availability;
  }

  async function exportText({ live = false, replayJournal = false } = {}) {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hive-mind-links-'));
    try {
      const out = path.join(tempDir, 'export.lino');
      const db = live ? dbPath : path.join(tempDir, path.basename(dbPath));
      if (!live) {
        // Link CLI 3.3.3 saves even when exporting. Give it a private copy so
        // status readers can run concurrently and against a read-only mount.
        const [data, names] = dataFiles();
        await fsp.copyFile(data, db, fs.constants.COPYFILE_FICLONE);
        await fsp.copyFile(names, path.join(tempDir, path.basename(names)), fs.constants.COPYFILE_FICLONE).catch(ignoreMissing);
      }
      await clink(['--db', db, '--out', out, ...lookupArgs, ...(replayJournal ? transactionArgs : [])], '--out');
      return await fsp.readFile(out, 'utf8');
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function importTree(tree, { db = dbPath, args = transactionArgs } = {}) {
    const input = tmpPath('in');
    try {
      await fsp.writeFile(input, encodeDoublets(tree, rootKey), { mode: 0o600 });
      await clink(['--db', db, '--in', input, ...lookupArgs, ...args], '--in', db);
    } finally {
      await fsp.rm(input, { force: true }).catch(() => {});
    }
  }

  const base = dbPath.replace(/\.links$/, '');
  const journal = `${base}.transitions.log`;
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
   * Build compactions and repairs away from the live mirror. Link-cli 3.3.1+
   * batches the import in one transaction (link-cli#199). Older binaries
   * import without transactions here to avoid one disk commit per link.
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
      await importTree(tree, { db: freshData[0], args: atLeast(3, 1) ? transactionArgs : [] });
      // The data, names and journal are a set. The bot state lock serializes
      // replacement against bot writes. A reader verifies the snapshot against
      // .lino, which also repairs the binary set if replacement is interrupted.
      for (const file of [journal, ...logFiles()]) await fsp.rm(file, { force: true });
      // Names first: `read()` treats a missing data file as "no state yet".
      const targets = dataFiles();
      for (const index of [1, 0]) await fsp.rename(freshData[index], targets[index]).catch(ignoreMissing);
      await fsp.rename(`${freshBase}.transitions.log`, journal).catch(ignoreMissing);
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
    /** Read the tree. A writer can open the journal to replay unapplied commits. */
    async read({ replayJournal = false } = {}) {
      if (!(await available())) return null;
      try {
        await fsp.access(dbPath);
      } catch {
        return null;
      }
      const journalExists =
        replayJournal &&
        atLeast(2) &&
        (await fsp.access(journal).then(
          () => true,
          () => false
        ));
      return decodeDoublets(await exportText({ live: journalExists, replayJournal: journalExists }), rootKey);
    },
    /** Write the tree and rebuild the store when garbage outgrows it. */
    async write(tree, { repair = false } = {}) {
      if (!(await available())) return false;
      await fsp.mkdir(path.dirname(dbPath), { recursive: true });
      const exists = await fsp.access(dbPath).then(
        () => true,
        () => false
      );
      if (repair || (!exists && !atLeast(3, 1))) {
        await replaceWithFresh(tree);
        return true;
      }
      if (!atLeast(2)) await rotateLogIfLarge();
      await importTree(tree);
      if (!exists) return true;
      const total = parseDoubletsExport(await exportText({ live: true })).size;
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
