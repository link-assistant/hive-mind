/**
 * `--respect-blockers` for `/solve`, `/claude`, `/codex` and the other solve
 * commands, and blocker-aware ordering of a multi-link batch (issue #4069).
 *
 * The relations are the ones `/hive` respects (#2615): GitHub issue
 * dependencies ("blocked by"), open sub-issues (a parent waits for its
 * children) and the blockers of its ancestors.
 *
 * - When every open blocker is already queued or running, the task waits for
 *   them as `/after` does: it starts only when all of them succeed.
 * - When a blocker is neither queued nor running, the task is not started: it
 *   could only start before the work it depends on.
 * - When the relations cannot be read, or the link is not an issue (a pull
 *   request has no blockers), the task starts as before: missing information
 *   never blocks work, as in `/hive`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4069
 * @see https://github.com/link-assistant/hive-mind/issues/2615
 */

import { describeWaitReasons, formatIssueRef, getWaitReasons, parseIssueRef, planIssueQueue } from './hive.issue-relations.lib.mjs';
import { resolveDependencyTarget } from './telegram-solve-dependencies.lib.mjs';

export const RESPECT_BLOCKERS_FLAG = 'respect-blockers';

/**
 * Take `--respect-blockers` (also `--no-respect-blockers` and `=true|false`) out
 * of the command arguments. It is a bot option and never reaches solve.
 * @param {string[]} args
 * @returns {{args: string[], respectBlockers: boolean|null}} `null` when the command does not say
 */
export function extractRespectBlockersFlag(args = []) {
  let respectBlockers = null;
  const rest = [];
  for (const arg of args) {
    const match = /^--(no-)?respect-blockers(?:=(.*))?$/i.exec(String(arg));
    if (!match) {
      rest.push(arg);
      continue;
    }
    const value = match[2] === undefined ? true : !/^(false|0|no|off)$/i.test(match[2]);
    respectBlockers = match[1] ? !value : value;
  }
  return { args: rest, respectBlockers };
}

/** Open issues an issue waits for, from its wait reasons, without repeats. */
export function collectBlockerUrls(reasons = []) {
  const seen = new Set();
  const urls = [];
  for (const reason of reasons) {
    for (const ref of reason.refs || []) {
      const parsed = parseIssueRef(ref.url);
      if (!parsed || seen.has(parsed.key)) continue;
      seen.add(parsed.key);
      urls.push(parsed.url);
    }
  }
  return urls;
}

/**
 * Decide whether a solve task may start now, must wait for queued blockers, or
 * may not start at all.
 *
 * @param {object} params
 * @param {string} params.url - Canonical issue or pull request URL of the task
 * @param {Map<string, object>} [params.relations] - Relations already read (a batch reads them once)
 * @param {(urls: string[]) => Promise<Map<string, object>>} [params.fetchRelations]
 * @param {object} params.solveQueue
 * @param {Function} [params.findSessionById]
 * @param {Function} [params.findSessionByUrl]
 * @param {Function} [params.log]
 * @returns {Promise<{action: 'start', note?: string}
 *   | {action: 'wait', targets: object[], description: string, blockers: string[]}
 *   | {action: 'reject', description: string, missing: Array<{url: string, detail: string}>}>}
 */
export async function planBlockerWait({ url, relations = null, fetchRelations = null, solveQueue, findSessionById, findSessionByUrl, log = () => {} }) {
  const ref = parseIssueRef(url);
  if (!ref) return { action: 'start', note: 'not an issue link: no blockers to respect' };
  let known = relations;
  if (!known?.has?.(ref.key)) {
    if (!fetchRelations) return { action: 'start', note: 'issue relations unavailable' };
    try {
      known = await fetchRelations([ref.url]);
    } catch (error) {
      log(`Could not read the issue relations of ${url}; starting without them: ${error?.message || error}`);
      return { action: 'start', note: 'issue relations could not be read' };
    }
  }
  const relation = known?.get?.(ref.key);
  if (!relation) return { action: 'start', note: 'issue relations unavailable' };
  const reasons = getWaitReasons(relation, known);
  if (reasons.length === 0) return { action: 'start' };
  const description = describeWaitReasons(ref.url, reasons);
  const blockers = collectBlockerUrls(reasons);
  const targets = [];
  const missing = [];
  for (const blockerUrl of blockers) {
    const resolved = resolveDependencyTarget({ kind: 'url', value: blockerUrl }, { solveQueue, findSessionById, findSessionByUrl });
    if (resolved.status === 'active') targets.push({ ...resolved.target, label: formatIssueRef(blockerUrl, ref.url) });
    else missing.push({ url: blockerUrl, detail: resolved.status === 'finished' ? `its task ${resolved.detail}, but the issue is still open` : 'not queued or running' });
  }
  if (missing.length > 0) return { action: 'reject', description, missing };
  return { action: 'wait', targets, description, blockers };
}

/**
 * Order the links of a batch so that work starts in dependency order: issues
 * with no open blockers first (the ones that unblock the most first, as in
 * `/hive`), then the blocked ones, each after the batch links it waits for.
 * Links the relations do not know (pull requests, unreadable issues) keep
 * their place among the ready ones; links in a dependency cycle go last.
 *
 * @param {string[]} urls
 * @param {Map<string, object>} relations
 * @returns {{urls: string[], ready: number, waiting: number, cycles: string[][]}}
 */
export function orderBatchByBlockers(urls, relations) {
  if (!relations || relations.size === 0 || urls.length < 2) return { urls: [...urls], ready: urls.length, waiting: 0, cycles: [] };
  const plan = planIssueQueue(urls, relations);
  const ordered = plan.ready.map(entry => entry.url);
  const keyOf = url => parseIssueRef(url)?.key || null;
  const waiting = plan.waiting.map(entry => ({ url: entry.url, key: keyOf(entry.url), waitsFor: new Set(collectBlockerUrls(entry.reasons).map(keyOf)) }));
  const placed = new Set(ordered.map(keyOf).filter(Boolean));
  const batchKeys = new Set(urls.map(keyOf).filter(Boolean));
  // Kahn's algorithm over the waits-for edges inside the batch; ties keep the plan's order.
  let progress = true;
  while (progress) {
    progress = false;
    for (const entry of waiting) {
      if (placed.has(entry.key)) continue;
      if ([...entry.waitsFor].every(key => !batchKeys.has(key) || placed.has(key))) {
        ordered.push(entry.url);
        placed.add(entry.key);
        progress = true;
      }
    }
  }
  for (const entry of waiting) if (!placed.has(entry.key)) ordered.push(entry.url);
  return { urls: ordered, ready: plan.ready.length, waiting: plan.waiting.length, cycles: plan.cycles };
}
