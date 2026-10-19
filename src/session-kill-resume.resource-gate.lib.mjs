/**
 * Resource gate for automatic kill recovery (issue #3530).
 *
 * One out-of-memory event usually kills several sessions at once. If they are
 * all recovered as soon as their random delay expires, the host has not freed
 * its memory yet, the recoveries run it out of memory again, and the cycle
 * repeats. In #3530 that loop ran for hours.
 *
 * A recovery therefore passes the same gate a queued task passes, the solve
 * queue's `canStartCommand()` (RAM, CPU, disk and API limits, plus the minimum
 * interval between starts). It must also see the host stay healthy for several
 * checks in a row before it launches. The start slot is then reserved through
 * the queue, so a queued task and a recovery cannot both take the same headroom.
 *
 * Every state change is reported through `notify` as a `waiting-resources`
 * lifecycle event, which goes to Telegram only. GitHub gets no intermediate
 * statuses (issue #3530, R4).
 *
 * Configuration, all optional:
 *   - `HIVE_MIND_RECOVERY_RESOURCE_POLL_SECONDS` (default 60): seconds between checks;
 *   - `HIVE_MIND_RECOVERY_RESOURCE_STABLE_CHECKS` (default 3): consecutive
 *     passing checks needed before a launch;
 *   - `HIVE_MIND_RECOVERY_RESOURCE_MAX_WAIT_MINUTES` (default 360): how long a
 *     recovery waits before it gives up and reports why.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3530
 */

import { canonicalizeGitHubUrl } from './github-url-parser.lib.mjs';

export const RECOVERY_RESOURCE_DEFAULTS = Object.freeze({ pollSeconds: 60, stableChecks: 3, maxWaitMinutes: 360 });

function positiveNumber(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * @param {Object} [env]
 * @returns {{pollMs: number, stableChecks: number, maxWaitMs: number}}
 */
export function resolveRecoveryResourceGateConfig(env = process.env) {
  return {
    pollMs: positiveNumber(env?.HIVE_MIND_RECOVERY_RESOURCE_POLL_SECONDS, RECOVERY_RESOURCE_DEFAULTS.pollSeconds) * 1000,
    stableChecks: Math.max(1, Math.round(positiveNumber(env?.HIVE_MIND_RECOVERY_RESOURCE_STABLE_CHECKS, RECOVERY_RESOURCE_DEFAULTS.stableChecks))),
    maxWaitMs: positiveNumber(env?.HIVE_MIND_RECOVERY_RESOURCE_MAX_WAIT_MINUTES, RECOVERY_RESOURCE_DEFAULTS.maxWaitMinutes) * 60 * 1000,
  };
}

/**
 * Adapt the solve queue to the gate interface.
 *
 * @param {Function} getQueue - Returns a SolveQueue (lazily, so tests and the
 *   bot can share one instance)
 * @returns {{check: Function, reserve: Function}}
 */
export function createQueueRecoveryResourceGate(getQueue) {
  return {
    check: async options => {
      const queue = getQueue();
      const result = await queue.canStartCommand(options);
      // The queue's `one_at_a_time` strategy: under that pressure nothing starts
      // while a task of the same tool is being processed (findStartableItems()).
      const processing = result?.canStart && result.oneAtATime ? queue.getProcessingCountByTool?.(options?.tool || 'claude') || 0 : 0;
      return processing > 0 ? { ...result, canStart: false, reasons: [`one-at-a-time: ${processing} ${options?.tool || 'claude'} task(s) already processing`] } : result;
    },
    reserve: options => getQueue().reserveStartSlot(options),
  };
}

/**
 * Issue #3532: a queue item, or a direct /solve, for the same URL that is being
 * launched right now is not tracked yet, so the recovery's sibling check would miss it.
 *
 * @param {Object|null} queue - SolveQueue
 * @param {string} url
 * @param {{has: Function}|null} [launchingClaims] - The bot's direct-start URL claims
 * @returns {string|null} A name for the launching item, or null
 */
export function findLaunchingQueueItem(queue, url, launchingClaims = null) {
  try {
    if (launchingClaims?.has?.(url) || launchingClaims?.has?.(canonicalizeGitHubUrl(url))) return 'a /solve being launched';
    const item = queue?.findByUrl?.(url);
    return item && queue.processing?.has?.(item.id) ? `queue item ${item.id}` : null;
  } catch {
    return null;
  }
}

function describeGateResult(result) {
  if (!result) return 'the resource check returned no result';
  if (result.rejected) return result.rejectReason || 'the queue rejects new work right now';
  const reasons = Array.isArray(result.reasons) ? result.reasons.filter(Boolean) : [];
  return reasons.length ? reasons.join('; ') : result.reason || 'resources are not available yet';
}

/**
 * Wait until the host can take the recovery, then reserve its start slot.
 *
 * Without a gate (unit tests, or a monitor started without a queue) it returns
 * at once with `ready: true`, as before #3530.
 *
 * @param {Object} options
 * @param {string} options.sessionName
 * @param {Object} options.sessionInfo - Mutable tracked info (`/stop` is honoured)
 * @param {number|null} [options.attempt]
 * @param {number|null} [options.maxAttempts]
 * @param {{check: Function, reserve?: Function}|null} [options.gate]
 * @param {Function} [options.notify] - Lifecycle sink (Telegram)
 * @param {Function} [options.sleep]
 * @param {Object} [options.env]
 * @param {Function} [options.now]
 * @param {boolean} [options.verbose]
 * @returns {Promise<{ready: boolean, reason: string|null, waitedMs: number, checks: number}>}
 */
export async function waitForRecoveryResources({ sessionName, sessionInfo = {}, attempt = null, maxAttempts = null, gate = null, notify = async () => {}, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), env = process.env, now = Date.now, verbose = false } = {}) {
  if (!gate || typeof gate.check !== 'function') return { ready: true, reason: null, waitedMs: 0, checks: 0 };
  const { pollMs, stableChecks, maxWaitMs } = resolveRecoveryResourceGateConfig(env);
  const options = { tool: sessionInfo?.tool || 'claude', locale: sessionInfo?.locale || null };
  const startedMs = now();
  let checks = 0;
  let passes = 0;
  let lastReported = null;
  const report = async (state, reason) => {
    const key = `${state}:${reason || ''}`;
    if (key === lastReported) return;
    lastReported = key;
    await notify({ phase: 'waiting-resources', attempt, maxAttempts, reason, resourceState: state, stablePasses: passes, stableChecks, waitedMs: now() - startedMs });
  };

  for (;;) {
    if (sessionInfo?.stopRequestedByUser === true) return { ready: false, reason: 'stopped-by-user', waitedMs: now() - startedMs, checks };
    checks++;
    let result;
    try {
      result = await gate.check(options);
    } catch (error) {
      result = { canStart: false, reason: `the resource check failed: ${error?.message || error}` };
    }
    if (result?.canStart && !result.rejected) {
      passes++;
      if (verbose) console.log(`[VERBOSE] Recovery of ${sessionName}: resources available (${passes}/${stableChecks} consecutive checks, issue #3530)`);
      if (passes >= stableChecks) {
        const reserved = typeof gate.reserve === 'function' ? await Promise.resolve(gate.reserve(options)).catch(error => ({ canStart: false, startReserved: false, reason: `the start slot could not be reserved: ${error?.message || error}` })) : { startReserved: true };
        if (reserved?.startReserved !== false) {
          const waitedMs = now() - startedMs;
          if (verbose || checks > stableChecks) console.log(`[session-kill-resume] ${sessionName}: resources stable for ${passes} checks after ${Math.round(waitedMs / 1000)}s; launching the recovery (issue #3530)`);
          return { ready: true, reason: null, waitedMs, checks };
        }
        // Someone else took the slot between our check and the reservation.
        passes = 0;
        await report('blocked', describeGateResult(reserved));
      } else {
        await report('stabilizing', `Resources are available; waiting until they stay stable (${passes}/${stableChecks} checks).`);
      }
    } else {
      passes = 0;
      const reason = describeGateResult(result);
      if (verbose) console.log(`[VERBOSE] Recovery of ${sessionName} is waiting for resources: ${reason} (issue #3530)`);
      await report('blocked', reason);
    }
    const waitedMs = now() - startedMs;
    if (waitedMs >= maxWaitMs) {
      const reason = `resources did not become stable within ${Math.round(maxWaitMs / 60000)} minutes (last state: ${lastReported || 'unknown'})`;
      console.warn(`[session-kill-resume] ${sessionName}: ${reason}; not launching the recovery (issue #3530)`);
      return { ready: false, reason: 'resource-wait-timeout', detail: reason, waitedMs, checks };
    }
    await sleep(pollMs);
  }
}
