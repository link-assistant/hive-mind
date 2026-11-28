/* eslint-disable no-await-in-loop -- reads retry one after another with a pause while the stores disagree */
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

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { LINO_STATE_ROOT, formatVerifiedLinoTree, normalizeStringTree, parseLinoTree, stringTreesEqual } from './bot-state-lino.lib.mjs';
import { createLinksStore } from './bot-state-links.lib.mjs';
import { BOT_STATE_VERSION, getBotStateVersion, migrateBotState, parseBotStateVersion } from './bot-state-migrations.lib.mjs';
import { resolveBotStateDir } from './session-store.lib.mjs';
import { withStateLock } from './state-lock.lib.mjs';

export { BOT_STATE_VERSION };
export const BOT_STATE_BASENAME = 'hive-mind-state';
export const BOT_STATE_LOCK_NAME = 'hive-mind-state';
export const INTAKE_STATES = Object.freeze(['accepting', 'draining']);

// Fields decoded back to numbers or booleans; everything else stays a string.
const NUMBER_FIELDS = new Set(['version', 'pid', 'number', 'launching', 'chatId', 'messageId', 'messageThreadId', 'replyToMessageId', 'requesterUserId', 'sourceChatId', 'userId', 'position', 'percentage', 'httpStatus', 'missingSince']);
const BOOLEAN_FIELDS = new Set(['showLimits', 'success', 'succeeded']);

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Convert a JSON-like state into a string tree. */
export function stateToStringTree(value) {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(item => stateToStringTree(item)).filter(item => item !== undefined);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, child]) => [key, stateToStringTree(child)])
        .filter(([, child]) => child !== undefined)
    );
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
    instance: isPlainObject(state.instance) ? state.instance : {},
    intake: { ...intake, state: INTAKE_STATES.includes(intake.state) ? intake.state : 'accepting' },
    tasks: isPlainObject(state.tasks) ? state.tasks : {},
    subscribers: isPlainObject(state.subscribers) ? state.subscribers : {},
  };
}

/** State trees are JSON-like (strings, numbers, booleans, arrays, objects). */
export const cloneState = value => JSON.parse(JSON.stringify(value));

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
export function createBotStateStore({ env = process.env, dir = resolveBotStateDir(env), fsImpl = fs, linksStore, readRetries = 3, retryDelayMs = 150, lockOptions = {}, verbose = false, log = message => console.log(`[bot-state] ${message}`), parser } = {}) {
  const fsp = fsImpl.promises;
  const linoPath = path.join(dir, `${BOT_STATE_BASENAME}.lino`);
  const trace = message => verbose && log(message);
  const links = linksStore ?? createLinksStore({ env, fsImpl, dbPath: path.join(dir, `${BOT_STATE_BASENAME}.links`), log: trace });
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
    if (!isPlainObject(tree)) throw new Error(`${linoPath} state root must be an object`);
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
    const agree = linksResult.available ? !linoError && !linksResult.error && stringTreesEqual(expected ?? null, actual ?? null) : null;
    return { linoTree, linoError, linksTree: linksResult.tree, linksAvailable: linksResult.available, linksError: linksResult.error, agree };
  }

  function toResult(snapshot, attempts) {
    const { linoTree, linksTree, linksAvailable, agree } = snapshot;
    const tree = agree && linksTree ? linksTree : (linoTree ?? linksTree);
    const source = agree && linksTree ? 'links' : linoTree ? 'lino' : linksTree ? 'links' : 'empty';
    const state = tree ? stringTreeToState(tree) : {};
    return {
      state: normalizeBotState(state),
      schemaVersion: tree ? getBotStateVersion(state) : null,
      source,
      consistent: agree,
      binaryStore: linksAvailable ? 'available' : 'unavailable',
      attempts,
      exists: Boolean(linoTree || linksTree),
      errors: [snapshot.linoError, snapshot.linksError].filter(Boolean).map(error => error.stderr || error.message),
    };
  }

  /** Read without the lock, retrying while the stores differ, then under the lock. */
  async function read({ lock = true, retries = readRetries } = {}) {
    let snapshot;
    let attempts = 0;
    for (; attempts <= retries; attempts++) {
      snapshot = await readOnce();
      if (snapshot.agree !== false) return toResult(snapshot, attempts + 1);
      trace(`Stores disagree on attempt ${attempts + 1}; retrying`);
      if (attempts < retries) await sleep(retryDelayMs);
    }
    if (lock) {
      snapshot = await withStateLock(BOT_STATE_LOCK_NAME, readOnce, { env, fsImpl, lockPath, log, trace, ...lockOptions });
      attempts++;
    }
    if (snapshot.agree === false) log(`⚠️ ${linoPath} and ${links.dbPath} differ; using the readable copy when available`);
    return toResult(snapshot, attempts);
  }

  async function writeUnlocked(state, { repairBinary }) {
    const normalized = normalizeBotState(state);
    const tree = stateToStringTree(normalized);
    const text = await formatVerifiedLinoTree(tree, { parser });
    await fsp.mkdir(dir, { recursive: true });
    const temporary = `${linoPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fsp.writeFile(temporary, text, { mode: 0o600 });
      await fsp.rename(temporary, linoPath);
    } finally {
      await fsp.rm(temporary, { force: true }).catch(() => {});
    }
    trace(`Wrote ${linoPath} (${text.length} bytes)`);
    let binary = false;
    try {
      binary = await links.write(tree, { repair: repairBinary });
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
     * Cheap lock-free look at the `.lino` copy only (no link-cli process), used
     * by the publisher to notice operator requests such as a drain between
     * heartbeats. `null` when there is no state or it cannot be parsed.
     */
    async peek() {
      const tree = await readLino().catch(error => {
        trace(`.lino peek failed: ${error.message}`);
        return null;
      });
      return tree ? normalizeBotState(stringTreeToState(tree)) : null;
    },
    /**
     * Read-modify-write under the lock. `mutate(state)` returns the new state
     * (or mutates in place and returns undefined). Returning `false` skips the
     * write when nothing changed, unless the stores disagreed.
     */
    async update(mutate, { targetVersion } = {}) {
      const target = targetVersion === undefined ? undefined : parseBotStateVersion(targetVersion);
      return withStateLock(
        BOT_STATE_LOCK_NAME,
        async () => {
          const snapshot = await readOnce();
          const current = toResult(snapshot, 1);
          if (!current.exists && current.errors.length) throw new Error(`No readable bot state copy: ${current.errors.join('; ')}`);
          const version = target ?? current.schemaVersion ?? BOT_STATE_VERSION;
          const changingVersion = current.exists && current.schemaVersion !== version;
          const draft = migrateBotState(cloneState(current.state), version);
          const result = await mutate(draft, current);
          if (result === false && !changingVersion && current.consistent !== false) return { ...current, written: false };
          const next = result && result !== true ? result : draft;
          if (getBotStateVersion(next) !== version) throw new Error('Change the bot state schema using a migration');
          const { state, binary } = await writeUnlocked(next, { repairBinary: Boolean(snapshot.linksError) });
          return { ...current, state, schemaVersion: version, written: true, binaryWritten: binary };
        },
        { env, fsImpl, lockPath, log, trace, ...lockOptions }
      );
    },
  };
}

export default { BOT_STATE_BASENAME, BOT_STATE_LOCK_NAME, BOT_STATE_VERSION, INTAKE_STATES, cloneState, createBotStateStore, normalizeBotState, stateToStringTree, stringTreeToState };
