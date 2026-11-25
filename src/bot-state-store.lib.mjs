/**
 * Durable bot instance state kept in two stores that must agree (issue #4143):
 *
 * - `<stateDir>/hive-mind-state.lino`: indented Links Notation, written
 *   atomically (temporary file + rename). Mount the state directory on the
 *   host to read it without entering the container.
 * - `<stateDir>/hive-mind-state.links`: a link-cli (`clink`) doublets store
 *   with the transactions log enabled.
 *
 * Writes go to `.lino` first, then to link-cli, under a PID-owned state lock.
 * Reads take link-cli and compare it with `.lino`; when they differ (a writer
 * is between the two steps, or crashed there) the read is retried, then
 * repeated under the lock, and finally falls back to `.lino`, the store that
 * is written first, reporting `consistent: false`. The next write repairs the
 * link-cli copy.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4143
 */

import fs from 'node:fs';
import path from 'node:path';

import { LINO_STATE_ROOT, formatVerifiedLinoTree, normalizeStringTree, parseLinoTree, stringTreesEqual } from './bot-state-lino.lib.mjs';
import { createLinksStore } from './bot-state-links.lib.mjs';
import { resolveBotStateDir } from './session-store.lib.mjs';
import { withStateLock } from './state-lock.lib.mjs';

export const BOT_STATE_VERSION = 1;
export const BOT_STATE_BASENAME = 'hive-mind-state';
export const BOT_STATE_LOCK_NAME = 'hive-mind-state';
export const INTAKE_STATES = Object.freeze(['accepting', 'draining']);

// Fields decoded back to numbers or booleans; everything else stays a string.
const NUMBER_FIELDS = new Set(['version', 'pid', 'chatId', 'messageId', 'messageThreadId', 'replyToMessageId', 'requesterUserId', 'sourceChatId', 'userId', 'position']);
const BOOLEAN_FIELDS = new Set(['showLimits']);

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Convert a JSON-like state into a string tree. */
export function stateToStringTree(value) {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(item => stateToStringTree(item)).filter(item => item !== undefined);
  if (isPlainObject(value)) {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      const converted = stateToStringTree(child);
      if (converted !== undefined) result[key] = converted;
    }
    return result;
  }
  return String(value);
}

/** Convert a string tree back using the field schema above. */
export function stringTreeToState(tree, key = null) {
  if (Array.isArray(tree)) return tree.map(item => stringTreeToState(item, key));
  if (isPlainObject(tree)) return Object.fromEntries(Object.entries(tree).map(([childKey, child]) => [childKey, stringTreeToState(child, childKey)]));
  if (typeof tree !== 'string') return tree;
  if (NUMBER_FIELDS.has(key) && /^-?\d+(\.\d+)?$/.test(tree)) return Number(tree);
  if (BOOLEAN_FIELDS.has(key) && (tree === 'true' || tree === 'false')) return tree === 'true';
  return tree;
}

/** Fill defaults so readers never deal with missing sections. */
export function normalizeBotState(state = {}) {
  const intake = isPlainObject(state.intake) ? state.intake : {};
  return {
    ...state,
    version: BOT_STATE_VERSION,
    instance: isPlainObject(state.instance) ? state.instance : {},
    intake: { ...intake, state: INTAKE_STATES.includes(intake.state) ? intake.state : 'accepting' },
    tasks: isPlainObject(state.tasks) ? state.tasks : {},
    subscribers: isPlainObject(state.subscribers) ? state.subscribers : {},
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Create the dual store.
 *
 * @param {object} [options]
 * @param {string} [options.dir] - State directory (default: `resolveBotStateDir()`).
 * @param {object} [options.linksStore] - link-cli client (default: `createLinksStore`).
 * @param {number} [options.readRetries=3] - Extra lock-free reads when the stores differ.
 * @param {object} [options.lockOptions] - Passed to `withStateLock` (`mode`, `timeoutMs`, ...).
 * @param {boolean} [options.verbose=false] - Trace reads, writes and mismatches.
 */
export function createBotStateStore({ dir = resolveBotStateDir(), env = process.env, fsImpl = fs, linksStore, readRetries = 3, retryDelayMs = 150, lockOptions = {}, verbose = false, log = message => console.log(`[bot-state] ${message}`), parser } = {}) {
  const fsp = fsImpl.promises;
  const linoPath = path.join(dir, `${BOT_STATE_BASENAME}.lino`);
  const trace = message => verbose && log(message);
  const links = linksStore ?? createLinksStore({ dbPath: path.join(dir, `${BOT_STATE_BASENAME}.links`), log: trace });
  const lockPath = path.join(dir, `${BOT_STATE_LOCK_NAME}.lock`);

  async function readLino() {
    let text;
    try {
      text = await fsp.readFile(linoPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    const { rootKey, tree } = await parseLinoTree(text, { parser });
    if (rootKey !== LINO_STATE_ROOT) throw new Error(`${linoPath} has root "${rootKey}", expected "${LINO_STATE_ROOT}"`);
    return tree;
  }

  async function readLinks() {
    try {
      return { tree: await links.read(), available: await links.available() };
    } catch (error) {
      trace(`link-cli read failed: ${error.stderr || error.message}`);
      return { tree: null, available: await links.available(), error };
    }
  }

  async function readOnce() {
    const linksResult = await readLinks();
    let linoTree = null;
    let linoError = null;
    try {
      linoTree = await readLino();
    } catch (error) {
      linoError = error;
      trace(`.lino read failed: ${error.message}`);
    }
    const expected = linoTree && (normalizeStringTree(linoTree) ?? {});
    const actual = linksResult.tree && (normalizeStringTree(linksResult.tree) ?? {});
    const agree = linksResult.available ? stringTreesEqual(expected ?? null, actual ?? null) : null;
    return { linoTree, linoError, linksTree: linksResult.tree, linksAvailable: linksResult.available, linksError: linksResult.error, agree };
  }

  function toResult(snapshot, attempts) {
    const { linoTree, linksTree, linksAvailable, agree } = snapshot;
    const tree = agree && linksTree ? linksTree : (linoTree ?? linksTree);
    const source = agree && linksTree ? 'links' : linoTree ? 'lino' : linksTree ? 'links' : 'empty';
    return {
      state: normalizeBotState(tree ? stringTreeToState(tree) : {}),
      source,
      consistent: agree,
      binaryStore: linksAvailable ? 'available' : 'unavailable',
      attempts,
      exists: Boolean(linoTree || linksTree),
      errors: [snapshot.linoError, snapshot.linksError].filter(Boolean).map(error => error.stderr || error.message),
    };
  }

  /** Read without the lock, retrying while the stores differ, then under the lock. */
  async function read({ lock = true } = {}) {
    let snapshot;
    let attempts = 0;
    for (; attempts <= readRetries; attempts++) {
      snapshot = await readOnce();
      if (snapshot.agree !== false) return toResult(snapshot, attempts + 1);
      trace(`Stores disagree on attempt ${attempts + 1}; retrying`);
      if (attempts < readRetries) await sleep(retryDelayMs);
    }
    if (lock) {
      snapshot = await withStateLock(BOT_STATE_LOCK_NAME, readOnce, { env, fsImpl, lockPath, ...lockOptions });
      attempts++;
    }
    if (snapshot.agree === false) log(`⚠️ ${linoPath} and ${links.dbPath} differ; using the .lino copy, the next write repairs link-cli`);
    return toResult(snapshot, attempts);
  }

  async function writeUnlocked(state) {
    const normalized = normalizeBotState(state);
    const tree = stateToStringTree(normalized);
    const text = await formatVerifiedLinoTree(tree, { parser });
    await fsp.mkdir(dir, { recursive: true });
    const temporary = `${linoPath}.${process.pid}.tmp`;
    await fsp.writeFile(temporary, text);
    await fsp.rename(temporary, linoPath);
    trace(`Wrote ${linoPath} (${text.length} bytes)`);
    let binary = false;
    try {
      binary = await links.write(tree);
      if (binary) trace(`Wrote ${links.dbPath}`);
    } catch (error) {
      log(`⚠️ Could not write ${links.dbPath}: ${error.stderr || error.message}`);
    }
    return { state: normalized, binary };
  }

  return {
    get paths() {
      return { dir, lino: linoPath, links: links.dbPath, lock: lockPath };
    },
    get linksStore() {
      return links;
    },
    read,
    /**
     * Read-modify-write under the lock. `mutate(state)` returns the new state
     * (or mutates in place and returns undefined). Returning `false` skips the
     * write when nothing changed, unless the stores disagreed.
     */
    async update(mutate) {
      return withStateLock(
        BOT_STATE_LOCK_NAME,
        async () => {
          const current = toResult(await readOnce(), 1);
          const draft = structuredClone(current.state);
          const result = await mutate(draft, current);
          if (result === false && current.consistent !== false) return { ...current, written: false };
          const { state, binary } = await writeUnlocked(result && result !== true ? result : draft);
          return { ...current, state, written: true, binaryWritten: binary };
        },
        { env, fsImpl, lockPath, ...lockOptions }
      );
    },
  };
}

export default { BOT_STATE_BASENAME, BOT_STATE_LOCK_NAME, BOT_STATE_VERSION, INTAKE_STATES, createBotStateStore, normalizeBotState, stateToStringTree, stringTreeToState };
