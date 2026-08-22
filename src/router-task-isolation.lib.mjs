/**
 * Launch-time policy for router isolation (issue #2164, EXPERIMENTAL).
 *
 * The lifecycle lives in `./router-sidecar.lib.mjs` and the mount/endpoint
 * policy in `./router-isolation.lib.mjs`; this module decides *when* they apply
 * to a launch, and is kept separate so the runner stays readable and the policy
 * is testable without Docker.
 *
 * The governing rule is that router isolation **fails closed**. `--use-router`
 * is a request to withhold the operator's subscription from the task; if the
 * router cannot be reached, launching anyway would either hand the credentials
 * over after all — exactly what was asked against — or start an agent with no
 * model at all. Neither is a useful outcome, so the launch is refused with the
 * reason on the record.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2164
 */

import { describeRouterCoverageGaps, isRouterEnabled, resolveRouterGhHost } from './router-isolation.lib.mjs';
import { acquireRouterSidecar, attachTaskToRouterNetwork, releaseRouterSidecar } from './router-sidecar.lib.mjs';

const logToConsole = message => console.log(message);

/**
 * Mint this task's token and make sure the router is up.
 *
 * @returns {Promise<{router: object|null, error: string|null}>} `router` is null
 *   with `error` null when routing was not requested; a non-null `error` means
 *   the caller must abort the launch.
 */
export const acquireRouterForTask = async ({ backend, useRouter = false, model = null, sessionId, env = process.env, verbose = false, log = logToConsole, acquire = acquireRouterSidecar } = {}) => {
  if (backend !== 'docker' || !isRouterEnabled({ useRouter, env })) return { router: null, error: null };

  let acquired;
  try {
    acquired = await acquire({ sessionId, env, verbose, log });
  } catch (error) {
    acquired = { error: error?.message || String(error) };
  }
  if (acquired?.error || !acquired?.token) {
    const message = `Router isolation was requested but the router is unavailable, so the task was not launched rather than being given direct access to the subscription (issue #2164): ${acquired?.error || 'no token was issued'}`;
    console.error(`[router-isolation] Session ${sessionId}: ${message}`);
    return { router: null, error: message };
  }

  if (log) {
    await log(`🔀 [EXPERIMENTAL] Task '${sessionId}' routed through the router; vendor credentials stay in the sidecar (issue #2164)`);
    for (const gap of describeRouterCoverageGaps({ model, ghRouted: Boolean(resolveRouterGhHost({ env })) })) {
      await log(`⚠️ ${gap}`);
    }
  }
  return { router: acquired, error: null };
};

/**
 * Put the freshly-created task container on the router's internal network.
 *
 * An external router is reached over the default bridge and has no network of
 * ours to join, so there is nothing to attach.
 *
 * @returns {Promise<string|null>} An error message, or null when there is
 *   nothing to do or the attach succeeded.
 */
export const attachRouterTaskContainer = async ({ router, sessionId, verbose = false, log = logToConsole, attach = attachTaskToRouterNetwork } = {}) => {
  if (!router || router.external) return null;
  const result = await attach({ sessionId, verbose, log });
  return result?.attached ? null : result?.error || 'unknown error';
};

/** Revoke the task's token and release its lease. Never throws: a failed release must not mask a launch error. */
export const releaseRouterForTask = async ({ router, sessionId, env = process.env, verbose = false, log = logToConsole, release = releaseRouterSidecar } = {}) => {
  if (!router || router.external) return null;
  try {
    return await release({ sessionId, env, verbose, log });
  } catch (error) {
    console.error(`[router-isolation] Could not release the router lease for '${sessionId}': ${error?.message || error}`);
    return null;
  }
};

export default { acquireRouterForTask, attachRouterTaskContainer, releaseRouterForTask };
