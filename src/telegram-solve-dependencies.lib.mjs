/**
 * Tasks that start only after other tasks have finished (issue #4069).
 *
 * `/after <task> <link>` and `/enqueue <task> <link>` add one solve task that
 * waits for another task (a running session or a queued item). `/solve
 * --respect-blockers` and the multi-link batch use the same mechanism to wait
 * for the GitHub blockers of an issue that are already queued or running.
 *
 * A waiting task is a solve queue item kept out of the tool queues: an item at
 * the head of a tool queue would hold back every item behind it, while a
 * waiting task may wait for hours. When every task it waits for has finished,
 * the item is handed to the tool queue and starts like any other queued
 * `/solve` (same limits, same order). It fails without starting when a task
 * it waits for fails and the mode is `success`.
 *
 * Modes:
 * - `success` (`/after`, blockers): start only when every awaited task
 *   succeeded. A failed, killed, stopped or cancelled task fails this one too,
 *   so a hand-built chain stops at the first failure.
 * - `finish` (`/enqueue`): start when every awaited task finished, whatever
 *   the outcome.
 *
 * A solve that finished without changes (exit code 2, #3211) did not fail
 * (#3215), so it counts as a success here too.
 *
 * Everything that reads the session registry is injected, which keeps this
 * module testable without a bot.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4069
 */

import { classifySessionOutcome } from './work-session-formatting.lib.mjs';

export const DEPENDENCY_MODE = Object.freeze({ SUCCESS: 'success', FINISH: 'finish' });

/** Telegram command -> dependency mode. */
export const DEPENDENCY_COMMAND_MODES = Object.freeze({ after: DEPENDENCY_MODE.SUCCESS, enqueue: DEPENDENCY_MODE.FINISH });

/** A target that is neither active nor finished for this long is treated as finished with an unknown result. */
export const DEPENDENCY_MISSING_GRACE_MS = 2 * 60 * 1000;

/** How often waiting tasks recheck their targets without an event. */
export const DEPENDENCY_RECONCILE_INTERVAL_MS = 30 * 1000;

const ACTIVE_ITEM_STATUSES = new Set(['queued', 'waiting', 'starting']);

/**
 * How a finished session ended, in dependency terms.
 * @param {{exitCode?: number|null, status?: string|null, command?: string|null}} event
 * @returns {{succeeded: boolean, detail: string}}
 */
export function classifyDependencyOutcome({ exitCode = null, status = null, command = 'solve' } = {}) {
  const outcome = classifySessionOutcome({ exitCode, status, command });
  if (outcome.killed) return { succeeded: false, detail: status ? `killed (${status})` : `killed (exit code ${exitCode})` };
  if (outcome.failed && !outcome.noChanges) return { succeeded: false, detail: status && status !== 'executed' ? `failed (${status}${Number.isInteger(exitCode) ? `, exit code ${exitCode}` : ''})` : `failed (exit code ${exitCode})` };
  return { succeeded: true, detail: outcome.noChanges ? 'finished without changes' : 'finished successfully' };
}

/**
 * Build a target that waits for a queue item (queued, waiting, starting,
 * started, or itself waiting for other tasks).
 * @param {object} item - SolveQueueItem
 * @param {string} [label]
 */
export function createItemTarget(item, label = item?.url) {
  return { type: 'item', item, url: item?.url || null, label: label || item?.url || item?.id, names: new Set(), outcome: null, missingSince: null };
}

/**
 * Build a target that waits for a running session that is not a queue item
 * (a task that started at once, or one the queue history has forgotten).
 * @param {object} params
 * @param {string[]} params.names - session name, session id, execution UUID, root session name
 * @param {string|null} [params.url]
 * @param {string} [params.label]
 */
export function createSessionTarget({ names, url = null, label = null }) {
  const set = new Set((names || []).filter(Boolean).map(String));
  return { type: 'session', item: null, url, label: label || url || [...set][0] || 'session', names: set, outcome: null, missingSince: null };
}

/**
 * Track queue items that wait for other tasks.
 *
 * @param {object} deps
 * @param {(names: Set<string>) => boolean} deps.isSessionActive - whether a tracked session matches any of the names
 * @param {(entry: object) => (void|Promise<void>)} deps.onRelease - every awaited task finished as required; queue the item
 * @param {(entry: object, reason: string) => (void|Promise<void>)} deps.onFail - an awaited task failed; fail the item
 * @param {Function} [deps.log]
 * @param {() => number} [deps.now]
 * @param {number} [deps.missingGraceMs]
 */
export class SolveDependencyTracker {
  constructor({ isSessionActive = () => false, onRelease = () => {}, onFail = () => {}, log = () => {}, now = () => Date.now(), missingGraceMs = DEPENDENCY_MISSING_GRACE_MS } = {}) {
    this.isSessionActive = isSessionActive;
    this.onRelease = onRelease;
    this.onFail = onFail;
    this.log = log;
    this.now = now;
    this.missingGraceMs = missingGraceMs;
    /** @type {Array<{item: object, mode: string, targets: object[], createdAt: number}>} */
    this.entries = [];
    this.timer = null;
  }

  /**
   * Add an item that waits for `targets`.
   * @returns {object} The entry
   */
  add(item, { targets, mode = DEPENDENCY_MODE.SUCCESS }) {
    if (!Array.isArray(targets) || targets.length === 0) throw new Error('A waiting task needs at least one task to wait for');
    if (!Object.values(DEPENDENCY_MODE).includes(mode)) throw new Error(`Unknown dependency mode: ${mode}`);
    const entry = { item, mode, targets, createdAt: this.now() };
    this.entries.push(entry);
    this.log(`Waiting: ${item.url} (${item.id}) starts after ${targets.map(target => target.label).join(', ')} ${mode === DEPENDENCY_MODE.SUCCESS ? 'succeed' : 'finish'}`);
    return entry;
  }

  /** Number of waiting items. */
  get size() {
    return this.entries.length;
  }

  /** Waiting items, oldest first. */
  list() {
    return this.entries.map(entry => entry.item);
  }

  /** The entry of a waiting item. */
  getEntry(itemOrId) {
    const id = typeof itemOrId === 'string' ? itemOrId : itemOrId?.id;
    return this.entries.find(entry => entry.item.id === id) || null;
  }

  /** The waiting item for a URL, compared with `canonicalize`. */
  findByUrl(url, canonicalize = value => value) {
    const key = canonicalize(url);
    return this.entries.find(entry => canonicalize(entry.item.url) === key)?.item || null;
  }

  /** Remove a waiting item without starting it (`/stop`). The caller marks it cancelled. */
  remove(id) {
    const index = this.entries.findIndex(entry => entry.item.id === id);
    if (index === -1) return null;
    return this.entries.splice(index, 1)[0];
  }

  /**
   * A tracked session ended. Records the outcome on session targets whose
   * names match; queue item targets read the outcome the queue recorded on
   * the item (`sessionOutcome`). A completion continued by a kill-recovery
   * session (`supersededBy`) is not the end of the task.
   */
  handleSessionCompletion(event = {}) {
    if (event.supersededBy) return;
    const eventNames = [event.sessionName, event.rootSessionName, event.killRecoveryOfSession].filter(Boolean).map(String);
    if (eventNames.length === 0) return;
    for (const entry of this.entries) {
      for (const target of entry.targets) {
        if (target.outcome) continue;
        const names = this.targetNames(target);
        if (eventNames.some(name => names.has(name))) {
          target.outcome = classifyDependencyOutcome(event);
          this.log(`Awaited task ${target.label} ${target.outcome.detail} (session ${event.sessionName})`);
        }
      }
    }
  }

  /** Names a target's session may be completed under. */
  targetNames(target) {
    const names = new Set(target.names);
    if (target.item?.sessionName && target.item.sessionName !== 'unknown') names.add(String(target.item.sessionName));
    return names;
  }

  /**
   * The state of one awaited task.
   * @returns {{state: 'active'} | {state: 'finished', succeeded: boolean, detail: string} | {state: 'missing'}}
   */
  getTargetState(target) {
    if (target.outcome) return { state: 'finished', ...target.outcome };
    const item = target.item;
    if (item) {
      if (ACTIVE_ITEM_STATUSES.has(item.status) || this.getEntry(item)) return { state: 'active' };
      if (item.status === 'failed') return { state: 'finished', succeeded: false, detail: `failed to start${item.error ? `: ${String(item.error).split('\n')[0]}` : ''}` };
      if (item.status === 'cancelled') return { state: 'finished', succeeded: false, detail: 'cancelled' };
      if (item.sessionOutcome) {
        const failed = item.sessionOutcome.failed || item.sessionOutcome.killed;
        return { state: 'finished', succeeded: !failed, detail: failed ? classifyDependencyOutcome({ exitCode: item.sessionOutcome.exitCode, status: item.sessionOutcome.status }).detail : item.sessionOutcome.noChanges ? 'finished without changes' : 'finished successfully' };
      }
    }
    const names = this.targetNames(target);
    if (names.size > 0 && this.isSessionActive(names)) return { state: 'active' };
    // A queue item between "starting" and its tracked session, or a session the
    // monitor has not reported yet: give it a grace period before calling it lost.
    return { state: 'missing' };
  }

  /**
   * Recheck every waiting item; release or fail the ones whose awaited tasks
   * are done. Repeats until nothing changes, so a chain fails (or moves) in one
   * call.
   * @returns {Promise<{released: object[], failed: object[]}>}
   */
  async reconcile() {
    const released = [];
    const failed = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of [...this.entries]) {
        const decision = this.decide(entry);
        if (decision.action === 'wait') continue;
        this.remove(entry.item.id);
        changed = true;
        if (decision.action === 'release') {
          released.push(entry.item);
          this.log(`Released: ${entry.item.url} (${entry.item.id}) — ${decision.summary}`);
          // eslint-disable-next-line no-await-in-loop -- in order: a released task may unblock the next one
          await this.onRelease(entry, decision.summary);
        } else {
          failed.push(entry.item);
          this.log(`Not started: ${entry.item.url} (${entry.item.id}) — ${decision.reason}`);
          // eslint-disable-next-line no-await-in-loop -- in order: a failed task may fail the next one
          await this.onFail(entry, decision.reason);
        }
      }
    }
    return { released, failed };
  }

  /** What to do with one waiting item now. */
  decide(entry) {
    const states = entry.targets.map(target => {
      let state = this.getTargetState(target);
      if (state.state === 'missing') {
        if (target.missingSince === null) target.missingSince = this.now();
        if (this.now() - target.missingSince >= this.missingGraceMs) {
          state = { state: 'finished', succeeded: false, detail: 'ended without a known result' };
          target.outcome = { succeeded: false, detail: state.detail };
        }
      } else target.missingSince = null;
      return { target, state };
    });
    // A target may require success on its own (a GitHub blocker of an `/enqueue` task).
    const failure = states.find(({ target, state }) => (target.mode || entry.mode) === DEPENDENCY_MODE.SUCCESS && state.state === 'finished' && !state.succeeded);
    if (failure) return { action: 'fail', reason: `${failure.target.label} ${failure.state.detail}` };
    if (states.every(({ state }) => state.state === 'finished')) {
      return { action: 'release', summary: states.map(({ target, state }) => `${target.label} ${state.detail}`).join('; ') };
    }
    return { action: 'wait' };
  }

  /** Start the periodic recheck (unref'd, so it never keeps the process alive). */
  start(intervalMs = DEPENDENCY_RECONCILE_INTERVAL_MS) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.entries.length === 0) return;
      this.reconcile().catch(error => console.error(`[solve_queue] Dependency recheck failed: ${error?.message || error}`));
    }, intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/**
 * Find what a dependency reference points to: a queue item (pending, waiting
 * for other tasks, in flight, or in the recent history) or a tracked session.
 *
 * @param {{kind: 'uuid'|'url', value: string}} ref
 * @param {object} deps
 * @param {object} deps.solveQueue - SolveQueue (findByUrl, findItemBySession, findRecentByUrl)
 * @param {(id: string) => ({sessionName: string, sessionInfo: object}|null)} deps.findSessionById
 * @param {(url: string) => ({sessionName: string, sessionInfo: object}|null)} deps.findSessionByUrl
 * @returns {{status: 'active', target: object} | {status: 'finished', succeeded: boolean, detail: string, url: string|null} | {status: 'unknown'}}
 */
export function resolveDependencyTarget(ref, { solveQueue, findSessionById = () => null, findSessionByUrl = () => null }) {
  if (!ref?.value) return { status: 'unknown' };
  const tracker = solveQueue.dependencies;
  const sessionNamesOf = (sessionName, info) => [sessionName, info?.sessionId, info?.executionUuid, info?.rootSessionName, info?.killRecoveryOfSession];
  if (ref.kind === 'uuid') {
    const item = solveQueue.findItemBySession?.(ref.value) || null;
    const session = findSessionById(ref.value);
    if (session) return { status: 'active', target: item && !item.sessionOutcome ? createItemTarget(item, session.sessionInfo?.url || item.url) : createSessionTarget({ names: [...sessionNamesOf(session.sessionName, session.sessionInfo), ref.value], url: session.sessionInfo?.url || null, label: session.sessionInfo?.url || ref.value }) };
    if (item) {
      const state = tracker.getTargetState(createItemTarget(item));
      if (state.state === 'active') return { status: 'active', target: createItemTarget(item) };
      if (state.state === 'finished') return { status: 'finished', succeeded: state.succeeded, detail: state.detail, url: item.url };
    }
    return { status: 'unknown' };
  }
  const item = solveQueue.findByUrl(ref.value);
  if (item) return { status: 'active', target: createItemTarget(item) };
  const session = findSessionByUrl(ref.value);
  if (session) {
    const started = solveQueue.findItemBySession?.(session.sessionName) || null;
    return { status: 'active', target: started && !started.sessionOutcome ? createItemTarget(started) : createSessionTarget({ names: sessionNamesOf(session.sessionName, session.sessionInfo), url: session.sessionInfo?.url || ref.value, label: ref.value }) };
  }
  const recent = solveQueue.findRecentByUrl?.(ref.value) || null;
  if (recent) {
    const state = tracker.getTargetState(createItemTarget(recent));
    if (state.state === 'finished') return { status: 'finished', succeeded: state.succeeded, detail: state.detail, url: recent.url };
  }
  return { status: 'unknown' };
}
