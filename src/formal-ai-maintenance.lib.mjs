/**
 * Background maintenance for the Formal AI sidecar and the agentic CLIs
 * (issue #2146, PR #2147 review).
 *
 * One periodic tick performs the three idle-only duties the review asked for,
 * in the only order that is safe:
 *
 *   1. **Reconcile and stop.** Drop leases whose task container is gone and, if
 *      nothing is left, stop the sidecar. Must run first — the update and the
 *      CLI refresh both require an idle host, and a crashed task would
 *      otherwise keep the sidecar alive forever.
 *   2. **Update the Formal AI image**, including the non-destructive memory
 *      migration, while the sidecar is stopped.
 *   3. **Refresh the agentic CLIs**, which is throttled independently because
 *      it queries the npm registry.
 *
 * Every step is best-effort: maintenance must never take the bot down, and a
 * failure is reported and retried on the next tick rather than thrown.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2146
 */

import { updateAgenticClisWhenIdle } from './agentic-cli-updater.lib.mjs';
import { startSidecarMaintenance } from './docker-sidecar.lib.mjs';
import { reconcileFormalAiSidecar, stopFormalAiSidecar, withFormalAiSidecarLock } from './formal-ai-sidecar.lib.mjs';
import { updateFormalAiSidecarWhenIdle } from './formal-ai-updater.lib.mjs';

/** Default gap between maintenance ticks. */
export const DEFAULT_FORMAL_AI_MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Stop the sidecar when no Formal AI task holds a lease any more.
 *
 * This is what turns "the task finished" into "the container is gone" without
 * having to hook every completion path: a lease is only live while its task
 * container is, so a finished, killed or crashed task all converge here.
 *
 * @returns {Promise<{leaseCount: number, stopped: boolean}>}
 */
export const stopIdleFormalAiSidecar = async ({ env = process.env, run, log = null, verbose = false, lockOptions = {} } = {}) =>
  withFormalAiSidecarLock(
    async () => {
      const { leaseCount, container } = await reconcileFormalAiSidecar({ env, run, log, verbose });
      if (leaseCount > 0 || !container.exists) return { leaseCount, stopped: false };
      const { stopped } = await stopFormalAiSidecar({ env, run, log, verbose, reason: 'no Formal AI tasks running' });
      return { leaseCount: 0, stopped };
    },
    { env, log, ...lockOptions }
  );

/**
 * Run one maintenance tick.
 *
 * @returns {Promise<{idle: object, formalAi: object|null, agenticClis: object|null, errors: object[]}>}
 */
export const runFormalAiMaintenanceTick = async ({ env = process.env, run, log = null, verbose = false, updateFormalAi = updateFormalAiSidecarWhenIdle, updateClis = updateAgenticClisWhenIdle, stopIdle = stopIdleFormalAiSidecar } = {}) => {
  const errors = [];

  let idle = { leaseCount: null, stopped: false };
  try {
    idle = await stopIdle({ env, run, log, verbose });
  } catch (error) {
    errors.push({ stage: 'stop-idle', error: error?.message || String(error) });
  }

  let formalAi = null;
  try {
    formalAi = await updateFormalAi({ env, run, log, verbose });
  } catch (error) {
    errors.push({ stage: 'formal-ai-update', error: error?.message || String(error) });
  }

  let agenticClis = null;
  try {
    agenticClis = await updateClis({ env, run, log, verbose });
  } catch (error) {
    errors.push({ stage: 'agentic-cli-update', error: error?.message || String(error) });
  }

  if (log && errors.length > 0) await log(`⚠️ Formal AI maintenance tick had ${errors.length} problem(s): ${errors.map(entry => `${entry.stage}: ${entry.error}`).join('; ')}`);
  if (verbose && log) await log(`[VERBOSE] formal-ai-maintenance: leases=${idle.leaseCount ?? 'unknown'} stopped=${idle.stopped} update=${formalAi?.status ?? 'skipped'} clis=${agenticClis?.status ?? 'skipped'}`);
  return { idle, formalAi, agenticClis, errors };
};

/**
 * Start the periodic maintenance timer.
 *
 * The timer is unref'd so it never keeps the process alive on shutdown.
 *
 * @returns {{stop: () => void}}
 */
export const startFormalAiMaintenance = ({ env = process.env, log = null, verbose = false, intervalMs = DEFAULT_FORMAL_AI_MAINTENANCE_INTERVAL_MS, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval, runTick = runFormalAiMaintenanceTick } = {}) => startSidecarMaintenance({ runTick, logPrefix: 'formal-ai-maintenance', env, log, verbose, intervalMs, setIntervalImpl, clearIntervalImpl });

export default { DEFAULT_FORMAL_AI_MAINTENANCE_INTERVAL_MS, runFormalAiMaintenanceTick, startFormalAiMaintenance, stopIdleFormalAiSidecar };
