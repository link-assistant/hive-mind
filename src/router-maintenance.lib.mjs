/**
 * Background maintenance for the router sidecar (issue #2164, R5).
 *
 * The issue's requirement is that the `hive-mind-router` container "only runs
 * while at least one task uses it". `releaseRouterSidecar()` covers the orderly
 * case — a task that finishes hands its lease back and stops the container when
 * it was the last one — but nothing orderly happens when a task is killed, when
 * the host reboots mid-run, or when the release path itself fails. This tick is
 * the backstop for all three: leases are reconciled against Docker, which is the
 * only source of truth about whether a task is still alive, and a sidecar with
 * no live lease is stopped.
 *
 * Stopping never touches the data volume. The request logs are the reason the
 * feature exists (R8), so they outlive every container that produced them.
 *
 * Everything here is best-effort: maintenance must never take the Telegram bot
 * down, so a failure is reported and retried on the next tick rather than thrown.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2164
 */

import { startSidecarMaintenance } from './docker-sidecar.lib.mjs';
import { isRouterSidecarEnabled, reconcileRouterSidecar, stopRouterSidecar, withRouterSidecarLock } from './router-sidecar.lib.mjs';

/** Default gap between maintenance ticks. */
export const DEFAULT_ROUTER_MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Stop the router sidecar once no routed task holds a lease any more.
 *
 * Runs under the sidecar lock so it cannot race a task that is in the middle of
 * acquiring one: without the lock, a tick could observe zero leases in the
 * instant between "container started" and "lease written" and tear the sidecar
 * down under a task that is about to use it.
 *
 * @returns {Promise<{leaseCount: number|null, stopped: boolean, skipped?: string}>}
 */
export const stopIdleRouterSidecar = async ({ env = process.env, run, log = null, verbose = false, lockOptions = {} } = {}) => {
  if (!isRouterSidecarEnabled(env)) return { leaseCount: null, stopped: false, skipped: 'sidecar management disabled' };
  return withRouterSidecarLock(
    async () => {
      const reconciled = await reconcileRouterSidecar({ env, run, log, verbose });
      if (reconciled.leaseCount > 0) return { leaseCount: reconciled.leaseCount, stopped: false };
      if (!reconciled.container.exists) return { leaseCount: 0, stopped: false };
      const outcome = await stopRouterSidecar({ env, run, log, verbose, reason: 'no routed tasks running' });
      return { leaseCount: 0, stopped: outcome.stopped };
    },
    { env, log, ...lockOptions }
  );
};

/**
 * Run one maintenance tick.
 *
 * @returns {Promise<{idle: object, errors: object[]}>}
 */
export const runRouterMaintenanceTick = async ({ env = process.env, run, log = null, verbose = false, stopIdle = stopIdleRouterSidecar } = {}) => {
  const errors = [];
  let idle = { leaseCount: null, stopped: false };
  try {
    idle = await stopIdle({ env, run, log, verbose });
  } catch (error) {
    errors.push({ stage: 'stop-idle', error: error?.message || String(error) });
    if (log) await log(`⚠️ Router maintenance could not reconcile the sidecar: ${errors[0].error}`);
  }
  if (verbose && log) await log(`[VERBOSE] router-maintenance: leases=${idle.leaseCount ?? 'unknown'} stopped=${idle.stopped}${idle.skipped ? ` skipped=${idle.skipped}` : ''}`);
  return { idle, errors };
};

/**
 * Start the periodic maintenance timer.
 *
 * @returns {{stop: () => void}}
 */
export const startRouterMaintenance = ({ env = process.env, log = null, verbose = false, intervalMs = DEFAULT_ROUTER_MAINTENANCE_INTERVAL_MS, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval, runTick = runRouterMaintenanceTick } = {}) => startSidecarMaintenance({ runTick, logPrefix: 'router-maintenance', env, log, verbose, intervalMs, setIntervalImpl, clearIntervalImpl });

export default { DEFAULT_ROUTER_MAINTENANCE_INTERVAL_MS, runRouterMaintenanceTick, startRouterMaintenance, stopIdleRouterSidecar };
