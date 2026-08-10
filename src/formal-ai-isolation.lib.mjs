/**
 * Glue between the Docker isolation runner and the on-demand Formal AI sidecar
 * (issue #2146, PR #2147 review).
 *
 * The lifecycle itself lives in `./formal-ai-sidecar.lib.mjs`; this module is
 * the launch-time policy, kept separate so the runner stays readable and so the
 * policy can be tested without launching a container:
 *
 *   - a Formal AI task takes a lease *before* the container is created, because
 *     the endpoint has to be in the task's environment;
 *   - the container is attached to the internal network while the start gate
 *     still holds the task command back;
 *   - anything that goes wrong fails the launch closed, because issue #2146
 *     forbids a Formal AI task from silently continuing on another model.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2146
 */

import { acquireFormalAiSidecar, attachTaskToFormalAiNetwork, isFormalAiSidecarEnabled, isFormalAiTask, releaseFormalAiSidecar } from './formal-ai-sidecar.lib.mjs';

const logToConsole = message => console.log(message);

/**
 * Take a sidecar lease when this task will be driven by Formal AI.
 *
 * @returns {Promise<{sidecar: object|null, error: string|null}>} `sidecar` is
 *   null when Formal AI is not involved (with `error` null) or when the sidecar
 *   refused to start (with `error` set — the caller must abort the launch).
 */
export const acquireFormalAiSidecarForTask = async ({ backend, args = [], model = null, tool = null, sessionId, env = process.env, verbose = false, log = logToConsole, acquire = acquireFormalAiSidecar } = {}) => {
  if (backend !== 'docker' || !isFormalAiTask({ args, model }) || !isFormalAiSidecarEnabled(env)) return { sidecar: null, error: null };
  try {
    return { sidecar: await acquire({ sessionId, tool, model, env, verbose, log }), error: null };
  } catch (error) {
    return { sidecar: null, error: `Formal AI sidecar could not be started, so the task was not launched (issue #2146): ${error?.message || error}` };
  }
};

/**
 * Add the internal Formal AI network to the freshly-created task container.
 *
 * @returns {Promise<string|null>} An error message when the task cannot reach
 *   Formal AI, or null when there is nothing to do or the attach succeeded.
 */
export const attachFormalAiTaskContainer = async ({ sidecar, sessionId, verbose = false, log = logToConsole, attach = attachTaskToFormalAiNetwork } = {}) => {
  if (!sidecar) return null;
  const result = await attach({ sessionId, verbose, log });
  return result?.attached ? null : result?.error || 'unknown error';
};

/** Give the lease back; never throws, because a failed release must not mask the launch error. */
export const releaseFormalAiSidecarForTask = async ({ sidecar, sessionId, env = process.env, verbose = false, log = logToConsole, release = releaseFormalAiSidecar } = {}) => {
  if (!sidecar) return null;
  try {
    return await release({ sessionId, env, verbose, log });
  } catch (error) {
    console.error(`[formal-ai-isolation] Could not release the Formal AI lease for '${sessionId}': ${error?.message || error}`);
    return null;
  }
};

export default { acquireFormalAiSidecarForTask, attachFormalAiTaskContainer, releaseFormalAiSidecarForTask };
