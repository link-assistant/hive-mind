/**
 * Triple storage for durable bot state on the associative stack.
 *
 * Issue #2890: the solve queue lived only in memory, so an OOM kill of the
 * root container lost every queued command. A state document is kept in three
 * stores, and each one can rebuild the other two:
 *
 *   1. `<base>.links-archive` — the whole doublets store, names included, as a
 *      link-cli store archive (binary links notation, §10 of the spec). It is
 *      byte-compatible with `clink --import-binary` / `--export-binary`.
 *   2. `<base>.lino` — the human-readable, diffable Links Notation projection.
 *   3. `<base>-db/<base>.links` — a link-cli database (doublets store with
 *      names and an fsynced transitions log) for querying with `clink`. It is
 *      maintained through the `clink` CLI when it is installed.
 *
 * The first two are written synchronously and atomically (temp file, fsync,
 * rename, directory fsync), so a SIGKILL at any point leaves either the old
 * or the new version on disk. The link-cli database is rebuilt asynchronously
 * in a temporary directory that then replaces the live one.
 *
 * Every store carries the document's `revision`. Loading reads all of them,
 * keeps the newest valid document and repairs the stores that are missing,
 * stale or corrupt.
 *
 * The shared middle form is a string tree: a leaf is a string and a link is
 * `{ id: string|null, values: Tree[] }` with at least one value. A document is
 * an array of links.
 *
 * Doublets mapping (deterministic, content-addressed):
 *   - points 1..4 are reserved, unnamed `(n: n n)` links: 1 = nil (end of a
 *     list), 2 = identified-link marker, 3 = document marker, 4 = empty string;
 *   - a non-empty leaf string `s` is the named point `(s: s s)`;
 *   - a link's values form a cons chain `(v1 (v2 (… (vn 1))))`;
 *   - an identified link `(id: …)` is `(2 (id chain))`;
 *   - the document is `(3 chain)`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2890
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const NIL = 1;
export const IDENTIFIED = 2;
export const DOCUMENT = 3;
export const EMPTY_STRING = 4;
const FIRST_FREE_ADDRESS = 5;
// link-cli stores are 32-bit (§10: an address that does not fit is rejected).
const MAX_ADDRESS = 0xffffffff;

let linksNotationPromise = null;

/**
 * Load links-notation once. It is resolved through use-m like the rest of the
 * runtime dependencies (see src/lino.lib.mjs).
 */
export async function loadLinksNotation() {
  if (!linksNotationPromise) {
    linksNotationPromise = (async () => {
      const { ensureUseM } = await import('./use-m-bootstrap.lib.mjs');
      if (typeof globalThis.use === 'undefined') await ensureUseM();
      const { useWithRetry } = await import('./use-with-retry.lib.mjs');
      const m = await useWithRetry(globalThis.use, 'links-notation');
      const pick = name => m[name] || m.default?.[name];
      const api = { Parser: pick('Parser'), Link: pick('Link'), formatLinks: pick('formatLinks'), LinksPacket: pick('LinksPacket'), PacketReader: pick('PacketReader'), External: pick('External'), DecodeLimits: pick('DecodeLimits') };
      for (const [name, value] of Object.entries(api)) {
        if (!value) throw new Error(`links-notation does not export ${name}`);
      }
      return api;
    })().catch(error => {
      linksNotationPromise = null;
      throw error;
    });
  }
  return linksNotationPromise;
}

// ---------------------------------------------------------------------------
// String tree validation
// ---------------------------------------------------------------------------

function assertTree(node, where = 'node') {
  if (typeof node === 'string') return;
  if (!node || typeof node !== 'object' || !Array.isArray(node.values)) {
    throw new TypeError(`${where}: expected a string or { id, values }`);
  }
  if (node.values.length === 0) {
    // `()` has no Links Notation spelling that survives a round trip.
    throw new TypeError(`${where}: a link needs at least one value`);
  }
  if (node.id !== null && node.id !== undefined && typeof node.id !== 'string') {
    throw new TypeError(`${where}: link id must be a string`);
  }
  node.values.forEach((value, index) => assertTree(value, `${where}.values[${index}]`));
}

export function assertDocument(doc) {
  if (!Array.isArray(doc)) throw new TypeError('document must be an array of links');
  doc.forEach((node, index) => {
    if (typeof node === 'string') throw new TypeError(`document[${index}]: top-level entries must be links`);
    assertTree(node, `document[${index}]`);
  });
}

// ---------------------------------------------------------------------------
// Tree <-> Links Notation
// ---------------------------------------------------------------------------

export async function documentToLino(doc) {
  assertDocument(doc);
  const { Link, formatLinks } = await loadLinksNotation();
  const toLink = node => (typeof node === 'string' ? new Link(node, []) : new Link(node.id ?? null, node.values.map(toLink)));
  const text = formatLinks(doc.map(toLink));
  return text.endsWith('\n') ? text : `${text}\n`;
}

export async function linoToDocument(text) {
  const { Parser } = await loadLinksNotation();
  const parsed = new Parser().parse(String(text));
  const fromLink = (link, where) => {
    const values = Array.isArray(link?.values) ? link.values : [];
    if (values.length > 0) return { id: link.id ?? null, values: values.map((value, index) => fromLink(value, `${where}.${index}`)) };
    if (link?.id === null || link?.id === undefined) throw new SyntaxError(`${where}: empty link`);
    return String(link.id);
  };
  const doc = parsed.map((link, index) => fromLink(link, `line ${index + 1}`));
  assertDocument(doc);
  return doc;
}

// ---------------------------------------------------------------------------
// Tree <-> doublets store ({ links: [[address, source, target]], names: [[address, name]] })
// ---------------------------------------------------------------------------

export function documentToStore(doc) {
  assertDocument(doc);
  const links = [];
  const names = [];
  const leafAddresses = new Map();
  const pairAddresses = new Map();
  let next = FIRST_FREE_ADDRESS;
  for (const reserved of [NIL, IDENTIFIED, DOCUMENT, EMPTY_STRING]) links.push([reserved, reserved, reserved]);
  const allocate = () => {
    if (next > MAX_ADDRESS) throw new RangeError('document does not fit a 32-bit links store');
    return next++;
  };
  const leaf = value => {
    if (value === '') return EMPTY_STRING;
    let address = leafAddresses.get(value);
    if (address === undefined) {
      address = allocate();
      leafAddresses.set(value, address);
      links.push([address, address, address]);
      names.push([address, value]);
    }
    return address;
  };
  const pair = (source, target) => {
    const key = `${source} ${target}`;
    let address = pairAddresses.get(key);
    if (address === undefined) {
      address = allocate();
      pairAddresses.set(key, address);
      links.push([address, source, target]);
    }
    return address;
  };
  const chain = values => {
    // Children are encoded first, left to right, so addresses are post-order.
    const encoded = values.map(encode);
    let tail = NIL;
    for (let index = encoded.length - 1; index >= 0; index--) tail = pair(encoded[index], tail);
    return tail;
  };
  function encode(node) {
    if (typeof node === 'string') return leaf(node);
    if (node.id !== null && node.id !== undefined) {
      const id = leaf(node.id);
      return pair(IDENTIFIED, pair(id, chain(node.values)));
    }
    return chain(node.values);
  }
  const root = pair(DOCUMENT, doc.length ? chain(doc) : NIL);
  return { links, names, root };
}

export function storeToDocument(store) {
  const byAddress = new Map();
  for (const [address, source, target] of store.links) byAddress.set(Number(address), [Number(source), Number(target)]);
  const names = new Map(store.names.map(([address, name]) => [Number(address), String(name)]));
  for (const reserved of [NIL, IDENTIFIED, DOCUMENT, EMPTY_STRING]) {
    const link = byAddress.get(reserved);
    if (!link || link[0] !== reserved || link[1] !== reserved) throw new Error(`reserved point ${reserved} is missing`);
  }
  const roots = [...byAddress].filter(([address, [source]]) => source === DOCUMENT && address !== DOCUMENT);
  if (roots.length !== 1) throw new Error(`expected one document link, found ${roots.length}`);
  const get = address => {
    const link = byAddress.get(address);
    if (!link) throw new Error(`dangling reference to ${address}`);
    return link;
  };
  const isPoint = address => {
    const [source, target] = get(address);
    return source === address && target === address;
  };
  const leafOf = address => {
    if (address === EMPTY_STRING) return '';
    if (!isPoint(address) || address < FIRST_FREE_ADDRESS) throw new Error(`link ${address} is not a leaf`);
    if (!names.has(address)) throw new Error(`leaf ${address} has no name`);
    return names.get(address);
  };
  let budget = byAddress.size * 4 + 16;
  const chainOf = address => {
    const values = [];
    while (address !== NIL) {
      if (--budget < 0) throw new Error('cyclic links structure');
      if (isPoint(address)) throw new Error(`link ${address} is not a list`);
      const [head, tail] = get(address);
      values.push(decode(head));
      address = tail;
    }
    return values;
  };
  function decode(address) {
    if (--budget < 0) throw new Error('cyclic links structure');
    if (isPoint(address)) return leafOf(address);
    const [source, target] = get(address);
    if (source === IDENTIFIED) {
      const [id, values] = get(target);
      const node = { id: leafOf(id), values: chainOf(values) };
      if (!node.values.length) throw new Error(`identified link ${address} has no values`);
      return node;
    }
    const values = chainOf(address);
    return { id: null, values };
  }
  const doc = chainOf(roots[0][1][1]);
  assertDocument(doc);
  return doc;
}

// ---------------------------------------------------------------------------
// Doublets store <-> link-cli store archive (two binary links notation packets)
// ---------------------------------------------------------------------------

export async function encodeStoreArchive(store) {
  const { LinksPacket, External, DecodeLimits } = await loadLinksNotation();
  const links = [...store.links].sort((a, b) => a[0] - b[0]).map(([address, source, target]) => [address, [source, target]]);
  const names = [...store.names].sort((a, b) => a[0] - b[0]).map(([address, name], index) => [index + 1, [new External(address), ...Array.from(String(name), char => new External(char.codePointAt(0)))]]);
  const limits = DecodeLimits.unlimited();
  const first = LinksPacket.pack(false, links, true).toBytes(limits);
  const second = LinksPacket.pack(true, names, true).toBytes(limits);
  const bytes = new Uint8Array(first.length + second.length);
  bytes.set(first, 0);
  bytes.set(second, first.length);
  return bytes;
}

export async function decodeStoreArchive(bytes) {
  const { PacketReader, External, DecodeLimits } = await loadLinksNotation();
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const reader = new PacketReader(data);
  const limits = DecodeLimits.unlimited();
  const linksPacket = reader.read(limits);
  if (!linksPacket) throw new Error('store archive is empty');
  const namesPacket = reader.read(limits);
  if (!namesPacket) throw new Error('store archive is cut short: names packet is missing');
  if (reader.offset !== data.length) throw new Error('store archive has trailing bytes');
  if (linksPacket.externalReferences || !namesPacket.externalReferences) throw new Error('store archive packets are in the wrong order');
  const links = linksPacket.links().map(([address, refs]) => {
    if (refs.length !== 2 || refs.some(ref => ref instanceof External)) throw new Error(`link ${address} is not a doublet of internal references`);
    if (address > BigInt(MAX_ADDRESS)) throw new Error(`address ${address} does not fit a 32-bit store`);
    return [Number(address), Number(refs[0]), Number(refs[1])];
  });
  const names = namesPacket.links().map(([, refs]) => {
    if (refs.some(ref => !(ref instanceof External))) throw new Error('name holds an internal reference');
    const [address, ...codePoints] = refs.map(ref => ref.value);
    return [Number(address), String.fromCodePoint(...codePoints.map(Number))];
  });
  return { links, names };
}

export async function documentToArchive(doc) {
  return encodeStoreArchive(documentToStore(doc));
}

export async function archiveToDocument(bytes) {
  return storeToDocument(await decodeStoreArchive(bytes));
}

// ---------------------------------------------------------------------------
// Document header helpers: the first link is `(<kind> (revision N) …)`.
// ---------------------------------------------------------------------------

export function documentRevision(doc) {
  const header = Array.isArray(doc) ? doc[0] : null;
  if (!header || typeof header === 'string') return null;
  for (const value of header.values) {
    if (typeof value !== 'string' && value.values[0] === 'revision') {
      const revision = Number(value.values[1]);
      return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/**
 * Write a file so that a crash leaves either the old or the new content.
 */
export function writeFileAtomicSync(filePath, data, fsImpl = fs) {
  const dir = path.dirname(filePath);
  fsImpl.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  const fd = fsImpl.openSync(tmpPath, 'w', 0o600);
  try {
    fsImpl.writeSync(fd, typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data));
    fsImpl.fsyncSync(fd);
  } finally {
    fsImpl.closeSync(fd);
  }
  try {
    fsImpl.renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      fsImpl.unlinkSync(tmpPath);
    } catch {
      // The temp file is already gone.
    }
    throw error;
  }
  fsyncDirectory(dir, fsImpl);
}

function fsyncDirectory(dir, fsImpl = fs) {
  let fd = null;
  try {
    fd = fsImpl.openSync(dir, 'r');
    fsImpl.fsyncSync(fd);
  } catch {
    // Some filesystems cannot fsync a directory; the rename is still atomic.
  } finally {
    if (fd !== null) {
      try {
        fsImpl.closeSync(fd);
      } catch {
        // Nothing to release.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// link-cli
// ---------------------------------------------------------------------------

/**
 * Find the `clink` executable: HIVE_MIND_CLINK_PATH, then PATH, then the
 * default `dotnet tool install --global clink` location.
 *
 * @returns {string|null}
 */
export function findClink(env = process.env, fsImpl = fs) {
  const explicit = String(env.HIVE_MIND_CLINK_PATH || '').trim();
  if (explicit) return ['0', 'false', 'off', 'none'].includes(explicit.toLowerCase()) ? null : explicit;
  const candidates = String(env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .map(dir => path.join(dir, 'clink'));
  try {
    candidates.push(path.join(os.homedir(), '.dotnet', 'tools', 'clink'));
  } catch {
    // No home directory.
  }
  for (const candidate of candidates) {
    try {
      fsImpl.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try the next location.
    }
  }
  return null;
}

function runClink(clinkPath, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(clinkPath, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${error.message}${stderr ? `\n${String(stderr).trim()}` : ''}`;
        reject(error);
      } else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

// ---------------------------------------------------------------------------
// The triple store
// ---------------------------------------------------------------------------

/**
 * @param {object} options
 * @param {string} options.dir - directory holding the three stores
 * @param {string} [options.baseName='solve-queue']
 * @param {string|null|false} [options.clinkPath] - `clink` executable; `false` disables it, `undefined` autodetects
 * @param {number} [options.clinkDebounceMs=1000]
 * @param {number} [options.clinkTimeoutMs=60000]
 * @param {boolean} [options.verbose=false]
 * @param {Function} [options.log=console.log]
 * @param {object} [options.fsImpl=fs]
 */
export function createLinksTripleStore(options = {}) {
  const { dir, baseName = 'solve-queue', clinkDebounceMs = 1000, clinkTimeoutMs = 60000, verbose = false, log = console.log, fsImpl = fs } = options;
  if (!dir) throw new Error('createLinksTripleStore: dir is required');
  const clinkPath = options.clinkPath === false ? null : options.clinkPath === undefined ? findClink(process.env, fsImpl) : options.clinkPath;
  const paths = {
    archive: path.join(dir, `${baseName}.links-archive`),
    lino: path.join(dir, `${baseName}.lino`),
    clinkDir: path.join(dir, `${baseName}-db`),
    clinkDb: path.join(dir, `${baseName}-db`, `${baseName}.links`),
  };
  const trace = message => {
    if (verbose) log(`[VERBOSE] /queue-store: ${message}`);
  };
  const warn = message => log(`⚠️ /queue-store: ${message}`);

  let clinkTimer = null;
  let clinkRunning = null;
  let clinkPending = false;
  let clinkRevision = null;
  let lastSaved = null;
  let closed = false;

  async function writeSync(doc, { skip = [] } = {}) {
    const archive = await documentToArchive(doc);
    const lino = await documentToLino(doc);
    if (!skip.includes('archive')) writeFileAtomicSync(paths.archive, archive, fsImpl);
    if (!skip.includes('lino')) writeFileAtomicSync(paths.lino, lino, fsImpl);
    return { archive, lino };
  }

  /**
   * Persist a document to the archive and the `.lino` projection, then
   * schedule a link-cli database rebuild.
   */
  async function save(doc) {
    const revision = documentRevision(doc);
    await writeSync(doc);
    lastSaved = { revision };
    trace(`saved revision ${revision} to ${paths.archive} and ${paths.lino}`);
    scheduleClinkSync();
    return { revision };
  }

  function scheduleClinkSync() {
    if (!clinkPath || closed) return;
    clinkPending = true;
    if (clinkTimer) return;
    clinkTimer = setTimeout(() => {
      clinkTimer = null;
      void syncClink();
    }, clinkDebounceMs);
    clinkTimer.unref?.();
  }

  /**
   * Rebuild the link-cli database from the archive in a temporary directory,
   * then swap it in. A crash mid-rebuild leaves the previous database intact.
   */
  async function syncClink() {
    if (!clinkPath) return false;
    if (clinkRunning) {
      clinkPending = true;
      await clinkRunning;
      return syncClink();
    }
    clinkPending = false;
    clinkRunning = (async () => {
      const stamp = `${process.pid}-${Date.now()}`;
      const tmpDir = `${paths.clinkDir}.tmp-${stamp}`;
      const oldDir = `${paths.clinkDir}.old-${stamp}`;
      try {
        const archiveBytes = fsImpl.readFileSync(paths.archive);
        const revision = documentRevision(await archiveToDocument(archiveBytes));
        fsImpl.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
        const tmpArchive = path.join(tmpDir, `${baseName}.import.links-archive`);
        fsImpl.writeFileSync(tmpArchive, archiveBytes);
        await runClink(clinkPath, ['--db', path.join(tmpDir, `${baseName}.links`), '--transactions', '--import-binary', tmpArchive], clinkTimeoutMs);
        fsImpl.unlinkSync(tmpArchive);
        fsyncDirectory(tmpDir, fsImpl);
        const hadLive = fsImpl.existsSync(paths.clinkDir);
        if (hadLive) fsImpl.renameSync(paths.clinkDir, oldDir);
        fsImpl.renameSync(tmpDir, paths.clinkDir);
        fsyncDirectory(dir, fsImpl);
        if (hadLive) fsImpl.rmSync(oldDir, { recursive: true, force: true });
        clinkRevision = revision;
        trace(`link-cli database ${paths.clinkDb} rebuilt at revision ${revision}`);
        return true;
      } catch (error) {
        warn(`link-cli database rebuild failed: ${error.message}`);
        try {
          fsImpl.rmSync(tmpDir, { recursive: true, force: true });
          if (!fsImpl.existsSync(paths.clinkDir) && fsImpl.existsSync(oldDir)) fsImpl.renameSync(oldDir, paths.clinkDir);
        } catch {
          // Best effort cleanup.
        }
        return false;
      }
    })();
    try {
      return await clinkRunning;
    } finally {
      clinkRunning = null;
    }
  }

  async function readArchive() {
    return archiveToDocument(fsImpl.readFileSync(paths.archive));
  }

  async function readLino() {
    return linoToDocument(fsImpl.readFileSync(paths.lino, 'utf8'));
  }

  async function readClink() {
    if (!clinkPath) throw Object.assign(new Error('clink is not installed'), { code: 'ENOCLINK' });
    if (!fsImpl.existsSync(paths.clinkDb)) throw Object.assign(new Error(`${paths.clinkDb} does not exist`), { code: 'ENOENT' });
    const tmpArchive = path.join(dir, `.${baseName}.export-${process.pid}-${Date.now()}.links-archive`);
    try {
      await runClink(clinkPath, ['--db', paths.clinkDb, '--export-binary', tmpArchive], clinkTimeoutMs);
      return await archiveToDocument(fsImpl.readFileSync(tmpArchive));
    } finally {
      try {
        fsImpl.unlinkSync(tmpArchive);
      } catch {
        // Export failed before writing.
      }
    }
  }

  /**
   * Read every store, keep the newest valid document and repair the others.
   *
   * @returns {Promise<{doc: Array|null, source: string|null, revision: number|null, sources: Array<{source: string, ok: boolean, revision?: number|null, error?: string}>}>}
   */
  async function load({ repair = true } = {}) {
    const readers = [
      ['archive', readArchive],
      ['lino', readLino],
      ['clink', readClink],
    ];
    const sources = [];
    let best = null;
    for (const [source, read] of readers) {
      try {
        const doc = await read();
        const revision = documentRevision(doc);
        sources.push({ source, ok: true, revision });
        trace(`${source}: valid, revision ${revision}`);
        if (!best || (revision ?? -1) > (best.revision ?? -1)) best = { doc, source, revision };
      } catch (error) {
        const missing = error.code === 'ENOENT' || error.code === 'ENOCLINK';
        sources.push({ source, ok: false, missing, error: error.message });
        if (missing) trace(`${source}: ${error.message}`);
        else warn(`${source} store is unreadable: ${error.message}`);
      }
    }
    if (!best) return { doc: null, source: null, revision: null, sources };
    if (repair) {
      const stale = sources.filter(entry => entry.source !== best.source && (!entry.ok || entry.revision !== best.revision) && !(entry.source === 'clink' && !clinkPath));
      const fileStale = stale.filter(entry => entry.source !== 'clink').map(entry => entry.source);
      if (fileStale.length) {
        const skip = ['archive', 'lino'].filter(name => !fileStale.includes(name));
        await writeSync(best.doc, { skip });
        trace(`repaired ${fileStale.join(', ')} from ${best.source} (revision ${best.revision})`);
      }
      if (stale.some(entry => entry.source === 'clink')) {
        if (best.source === 'clink' && fileStale.length === 0) {
          // Nothing to do: clink was the newest and the files match it.
        } else {
          await syncClink();
        }
      }
    }
    lastSaved = { revision: best.revision };
    return { ...best, sources };
  }

  /** Wait for a pending link-cli rebuild. */
  async function flush() {
    if (clinkTimer) {
      clearTimeout(clinkTimer);
      clinkTimer = null;
      clinkPending = true;
    }
    if (clinkRunning) await clinkRunning;
    if (clinkPending) await syncClink();
  }

  async function close() {
    await flush();
    closed = true;
  }

  return {
    paths,
    clinkPath,
    save,
    load,
    flush,
    close,
    syncClink,
    readArchive,
    readLino,
    readClink,
    get lastSavedRevision() {
      return lastSaved?.revision ?? null;
    },
    get clinkRevision() {
      return clinkRevision;
    },
  };
}
