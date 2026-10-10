/**
 * Unload the Formal AI image after hours of disuse (issue #2305).
 *
 * The on-demand lifecycle (issue #2146) already stops the sidecar container as
 * soon as no Formal AI task needs it, but a stopped sidecar still leaves a
 * ~24 GB image — and before issue #2305 every superseded release as well — on
 * the host for good. This module removes them once Formal AI has not been used
 * for `HIVE_MIND_FORMAL_AI_UNLOAD_AFTER` (default 5h).
 *
 * Invariants:
 *
 *   1. **Only under the sidecar lock, only with no leases.** An acquire that
 *      races the unload waits on the same lock and then pulls the image back;
 *      it can never boot a half-removed image.
 *   2. **The persisted memory volume is never removed.** Only containers
 *      (with their anonymous volumes), the sidecar network and images go.
 *   3. **The accepted build is remembered.** `lastUpdate` stays in the record,
 *      so the next Formal AI task pulls exactly the build that was verified
 *      against the memory file, not whatever `:latest` has become.
 *   4. **Opt-outs win.** `HIVE_MIND_FORMAL_AI_PREFETCH=true` keeps the image,
 *      `HIVE_MIND_FORMAL_AI_UNLOAD_AFTER=0` disables unloading, and a disabled
 *      sidecar lifecycle (`HIVE_MIND_FORMAL_AI_SIDECAR=0`) is left alone.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2305
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

import { dockerOk, dockerText } from './docker-sidecar.lib.mjs';
import { formatDockerSize, removeFormalAiImages } from './formal-ai-image-store.lib.mjs';
import { FORMAL_AI_MEMORY_VOLUME_NAME, FORMAL_AI_SIDECAR_LABEL, FORMAL_AI_SIDECAR_NETWORK_NAME, isFormalAiSidecarEnabled, readFormalAiSidecarState, reconcileFormalAiSidecar, withFormalAiSidecarLock, writeFormalAiSidecarState } from './formal-ai-sidecar.lib.mjs';
import { describeFormalAiUsage, formatFormalAiDuration, isFormalAiPrefetchEnabled, resolveFormalAiUnloadAfterMs } from './formal-ai-usage.lib.mjs';

const execFileAsync = promisify(execFile);

/**
 * Why unloading is switched off for this deployment, or null when it is on.
 */
export const resolveFormalAiUnloadDisabledReason = (env = process.env) => {
  if (!isFormalAiSidecarEnabled(env)) return 'HIVE_MIND_FORMAL_AI_SIDECAR is off';
  if (isFormalAiPrefetchEnabled(env)) return 'HIVE_MIND_FORMAL_AI_PREFETCH keeps the image on this host';
  if (resolveFormalAiUnloadAfterMs(env) === 0) return 'HIVE_MIND_FORMAL_AI_UNLOAD_AFTER is 0';
  return null;
};

/** Every container the sidecar lifecycle ever created, running or not. */
const listFormalAiSidecarContainers = async ({ run, timeoutMs }) => {
  try {
    const raw = await dockerText(run, ['ps', '--all', '--quiet', '--no-trunc', '--filter', `label=${FORMAL_AI_SIDECAR_LABEL}=sidecar`], { timeoutMs });
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

/**
 * Remove the Formal AI image(s) if Formal AI has been idle past the unload window.
 *
 * @returns {Promise<{status: 'disabled'|'busy'|'recently-used'|'nothing-to-unload'|'unloaded', ...}>}
 */
export const unloadIdleFormalAiSidecar = async ({ env = process.env, fsImpl = fs, run = execFileAsync, timeoutMs, log = null, verbose = false, now = () => new Date(), sleepImpl, lockOptions = {} } = {}) => {
  const disabledReason = resolveFormalAiUnloadDisabledReason(env);
  if (disabledReason) {
    if (verbose && log) await log(`[VERBOSE] formal-ai-unload: disabled (${disabledReason})`);
    return { status: 'disabled', reason: disabledReason };
  }

  return withFormalAiSidecarLock(
    async () => {
      const { leaseCount } = await reconcileFormalAiSidecar({ env, fsImpl, run, timeoutMs, log, verbose, now });
      if (leaseCount > 0) return { status: 'busy', leaseCount };

      const state = readFormalAiSidecarState({ env, fsImpl });
      const usage = describeFormalAiUsage({ state, env, now });
      if (usage.recent) {
        if (verbose && log) await log(`[VERBOSE] formal-ai-unload: Formal AI used ${formatFormalAiDuration(usage.idleMs)} ago; unloading after ${formatFormalAiDuration(usage.unloadAfterMs)} idle`);
        return { status: 'recently-used', idleMs: usage.idleMs, unloadAfterMs: usage.unloadAfterMs };
      }

      // Containers first: an image a container still references cannot be
      // removed. `--volumes` takes the container's anonymous volumes with it;
      // named volumes — the memory volume above all — are never touched.
      const containers = await listFormalAiSidecarContainers({ run, timeoutMs });
      for (const container of containers) await dockerOk(run, ['rm', '--force', '--volumes', container], { timeoutMs });
      if (containers.length > 0) await dockerOk(run, ['network', 'rm', FORMAL_AI_SIDECAR_NETWORK_NAME], { timeoutMs });

      const images = await removeFormalAiImages({ env, run, timeoutMs, log, verbose });
      if (containers.length === 0 && images.removed.length === 0 && images.failed.length === 0) {
        if (verbose && log) await log('[VERBOSE] formal-ai-unload: no Formal AI image on this host');
        return { status: 'nothing-to-unload', kept: images.kept.map(image => image.id) };
      }

      const at = now().toISOString();
      const lastUnload = { at, idleMs: usage.idleMs, images: images.removed.map(image => image.id), failed: images.failed.map(image => image.id), containers: containers.length, bytesFreed: images.bytesFreed };
      writeFormalAiSidecarState({ ...readFormalAiSidecarState({ env, fsImpl }), image: null, imageReference: null, imageDigest: null, startedAt: null, leases: [], lastUnload }, { env, fsImpl });

      if (log) {
        const why = usage.used ? `unused for ${formatFormalAiDuration(usage.idleMs)}` : 'never used on this host';
        await log(`🧹 Formal AI unloaded (${why}): removed ${images.removed.length} image(s) and ${containers.length} container(s), freeing ${formatDockerSize(images.bytesFreed)}; memory volume '${FORMAL_AI_MEMORY_VOLUME_NAME}' preserved`);
        if (images.failed.length > 0) await log(`⚠️ Could not remove Formal AI image(s): ${images.failed.map(image => `${image.repoTags[0] ?? image.id}: ${image.error}`).join('; ')}`);
      }
      return { status: 'unloaded', ...lastUnload };
    },
    { env, fsImpl, sleepImpl, log, ...lockOptions }
  );
};

export default { resolveFormalAiUnloadDisabledReason, unloadIdleFormalAiSidecar };
