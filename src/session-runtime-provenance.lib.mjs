#!/usr/bin/env node

/**
 * State, in the session comment, which code is about to run.
 *
 * Issue #2247 (H1). On 2026-09-13 three tasks started 111 minutes after
 * v2.28.1 was published and all three ran v2.22.0 (line 6 of every log:
 * `🚀 solve v2.22.0`). The drift itself is fixed where it is caused - the task
 * image is refreshed before the container is created
 * (`task-image-refresh.lib.mjs`) - but it stayed invisible for a second reason:
 * nothing published which `solve`, which image, or which Formal AI release the
 * session used. A reader of those three pull requests could not have told.
 *
 * The *AI Work Session Started* comment is where a reader looks first, so that
 * is where the provenance goes. Everything here is best-effort and never
 * throws: a session must not fail because it could not name its own version.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2247
 */

import { describeTaskImage, readTaskImageProvenance } from './task-image-refresh.lib.mjs';
import { getVersion } from './version.lib.mjs';

/** The backend probe is a health check on a local sidecar, not a model call. */
export const RUNTIME_PROBE_TIMEOUT_MS = 5000;

/**
 * Render the provenance as one italic line for a GitHub comment.
 *
 * @param {Object} runtime - from {@link resolveSessionRuntime}
 * @returns {string} the line, or '' when nothing is known
 */
export const formatSessionRuntimeLine = ({ solveVersion = null, tool = null, model = null, taskImage = null, formalAiVersion = null } = {}) => {
  const parts = [];
  if (solveVersion) parts.push(`solve \`v${String(solveVersion).replace(/^v/, '')}\``);
  if (tool) parts.push(`tool \`${tool}\``);
  if (model) parts.push(`model \`${model}\``);
  if (taskImage?.image || taskImage?.digest) parts.push(`task image \`${describeTaskImage(taskImage)}\``);
  if (formalAiVersion) parts.push(`Formal AI \`${formalAiVersion}\``);
  return parts.length ? `_Runtime: ${parts.join(' · ')}_` : '';
};

/**
 * Ask the endpoint that will serve this task which release it is.
 *
 * Only for `--model formal-ai`, and only when an endpoint is configured: the
 * per-task sidecar is reachable over the internal network, so this is a local
 * HTTP request with its own deadline.
 *
 * @returns {Promise<string|null>}
 */
const probeFormalAiVersion = async ({ env, timeoutMs }) => {
  const baseUrl = String(env?.HIVE_MIND_FORMAL_AI_BASE_URL || '').trim();
  if (!baseUrl) return null;
  try {
    const { probeFormalAiBackend, resolveFormalAiApiKey } = await import('./formal-ai-runtime.lib.mjs');
    const probe = await probeFormalAiBackend({ baseUrl, apiKey: resolveFormalAiApiKey(env), env, timeoutMs });
    return probe?.version || null;
  } catch {
    // The session comment is not the place to fail over a version probe; the
    // runtime's own fail-closed check still runs before any model request.
    return null;
  }
};

/**
 * Collect everything the session comment should state about this run.
 *
 * @param {Object} [params]
 * @param {Object} [params.env]
 * @param {string|null} [params.model]
 * @param {string|null} [params.tool]
 * @param {Function} [params.versionImpl] - test seam for `getVersion`
 * @param {Function} [params.probeImpl] - test seam for the Formal AI probe
 * @param {number} [params.timeoutMs]
 * @returns {Promise<{solveVersion: string|null, tool: string|null, model: string|null, taskImage: Object|null, formalAiVersion: string|null, line: string}>}
 */
export const resolveSessionRuntime = async ({ env = process.env, model = null, tool = null, versionImpl = getVersion, probeImpl = probeFormalAiVersion, timeoutMs = RUNTIME_PROBE_TIMEOUT_MS } = {}) => {
  let solveVersion;
  try {
    solveVersion = await versionImpl();
  } catch {
    // A version that cannot be read is reported as unknown, not as a failure.
    solveVersion = null;
  }

  let formalAiVersion = null;
  if (model) {
    try {
      const { isFormalAiModel } = await import('./formal-ai-model.lib.mjs');
      if (isFormalAiModel(model)) formalAiVersion = await probeImpl({ env, timeoutMs });
    } catch {
      formalAiVersion = null;
    }
  }

  const runtime = { solveVersion: solveVersion && solveVersion !== 'unknown' ? solveVersion : null, tool: tool || null, model: model || null, taskImage: readTaskImageProvenance(env), formalAiVersion };
  return { ...runtime, line: formatSessionRuntimeLine(runtime) };
};

export default { formatSessionRuntimeLine, resolveSessionRuntime, RUNTIME_PROBE_TIMEOUT_MS };
