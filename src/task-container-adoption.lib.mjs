/**
 * Adopt running task containers the bot is not tracking (issue #2917).
 *
 * A task keeps running when the bot restarts with an empty or stale
 * `sessions.json`, when an operator resumes it with `$ --resume`, or when a
 * failed recovery already reported it as finished. Such a container is counted
 * in `/limits` (see task-container-inventory.lib.mjs), and this pass also puts
 * it back into the session registry with the tool, URL and ids from its labels,
 * so the monitor follows it to the end and `sessions.json` lists it again.
 *
 * An adopted session has no chat to report to; the monitor logs its completion
 * instead of sending a message.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2917
 */

import { getTaskContainerSnapshot, invalidateTaskContainerSnapshot } from './task-container-inventory.lib.mjs';
import { hasExplicitBotInstanceId, resolveBotInstanceId } from './task-container-labels.lib.mjs';

/**
 * The bot tracks a queue launch only after `$` returns, so a just-started
 * container is briefly untracked. Adopting it in that window would race the
 * real tracking record.
 */
export const ADOPTION_GRACE_MS = 2 * 60 * 1000;
export const ADOPTION_INTERVAL_MS = 60 * 1000;

/**
 * The tracking record for one untracked container.
 * @param {Object} container - From attributeTaskContainers().
 * @param {Object} options
 * @param {string} options.instanceId
 * @param {number} options.now
 * @returns {{sessionName: string, sessionInfo: Object}}
 */
export function buildAdoptedSessionInfo(container, { instanceId, now }) {
  const sessionName = container.scSession || container.session || container.name;
  const startTime = new Date(Number.isFinite(container.createdAtMs) ? container.createdAtMs : now);
  return {
    sessionName,
    sessionInfo: {
      chatId: null,
      messageId: null,
      messageThreadId: null,
      startTime,
      launchedAt: startTime.toISOString(),
      url: container.url || null,
      command: container.command || 'solve',
      isolationBackend: 'docker',
      sessionId: sessionName,
      containerName: container.name,
      executionUuid: container.executionUuid || container.scUuid || null,
      rootSessionName: container.scRootSession || null,
      tool: container.tool || 'claude',
      adopted: true,
      adoptedAt: new Date(now).toISOString(),
      adoptedFrom: container.source || null,
      instanceId: container.instance || instanceId || null,
    },
  };
}

/**
 * Which untracked containers to adopt now.
 * @param {Object} options
 * @param {Array<Object>} options.containers - Attributed containers.
 * @param {number} options.now
 * @param {number} [options.graceMs]
 * @param {string} [options.instanceId]
 * @param {boolean} [options.ownInstanceOnly] - Skip containers labelled by another named bot instance.
 * @param {Set<string>} [options.adoptedBefore] - Containers adopted earlier in this process; one that was reported finished while still running is not adopted twice.
 * @returns {{adopt: Array<{sessionName: string, sessionInfo: Object}>, skipped: Array<{name: string, reason: string}>}}
 */
export function planContainerAdoptions({ containers = [], now = Date.now(), graceMs = ADOPTION_GRACE_MS, instanceId = null, ownInstanceOnly = false, adoptedBefore = new Set() } = {}) {
  const adopt = [];
  const skipped = [];
  for (const container of containers) {
    if (container.tracked) continue;
    if (adoptedBefore.has(container.name)) {
      skipped.push({ name: container.name, reason: 'adopted-before' });
      continue;
    }
    if (ownInstanceOnly && container.instance && instanceId && container.instance !== instanceId) {
      skipped.push({ name: container.name, reason: 'other-instance' });
      continue;
    }
    const age = Number.isFinite(container.createdAtMs) ? now - container.createdAtMs : null;
    if (age === null || age < graceMs) {
      skipped.push({ name: container.name, reason: 'launch-grace' });
      continue;
    }
    adopt.push(buildAdoptedSessionInfo(container, { instanceId, now }));
  }
  return { adopt, skipped };
}

/**
 * One adoption pass. Never throws.
 * @param {Object} options
 * @param {Function} options.trackSession - `(sessionName, sessionInfo) => void`.
 * @param {Function} [options.getSnapshot] - Defaults to a fresh container snapshot.
 * @param {Function} [options.now]
 * @param {number} [options.graceMs]
 * @param {Object} [options.env]
 * @param {Set<string>} [options.adoptedBefore]
 * @param {{event?: Function}} [options.logger]
 * @param {boolean} [options.verbose]
 * @returns {Promise<{adopted: string[], skipped: Array<Object>}>}
 */
export async function adoptUntrackedTaskContainers({ trackSession, getSnapshot = verbose => getTaskContainerSnapshot(verbose, { fresh: true }), now = Date.now, graceMs = ADOPTION_GRACE_MS, env = process.env, adoptedBefore = new Set(), logger = null, verbose = false } = {}) {
  const adopted = [];
  try {
    const snapshot = await getSnapshot(verbose);
    if (!snapshot || typeof trackSession !== 'function') return { adopted, skipped: [] };
    const instanceId = resolveBotInstanceId(env);
    const plan = planContainerAdoptions({ containers: snapshot.containers || [], now: now(), graceMs, instanceId, ownInstanceOnly: hasExplicitBotInstanceId(env), adoptedBefore });
    for (const { sessionName, sessionInfo } of plan.adopt) {
      trackSession(sessionName, sessionInfo);
      adoptedBefore.add(sessionInfo.containerName);
      adopted.push(sessionName);
      logger?.event?.('task_container_adopted', { sessionName, containerName: sessionInfo.containerName, tool: sessionInfo.tool, url: sessionInfo.url, executionUuid: sessionInfo.executionUuid, source: sessionInfo.adoptedFrom });
      if (verbose) console.log(`[VERBOSE] Adopted untracked ${sessionInfo.tool} task container ${sessionInfo.containerName} as session ${sessionName} (issue #2917)`);
    }
    if (adopted.length > 0) invalidateTaskContainerSnapshot();
    return { adopted, skipped: plan.skipped };
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] Task container adoption failed: ${error?.message || error}`);
    return { adopted, skipped: [] };
  }
}

/**
 * Run {@link adoptUntrackedTaskContainers} now and then every `intervalMs`.
 * @param {Object} options - As for adoptUntrackedTaskContainers, plus `intervalMs`.
 * @returns {{stop: Function, runOnce: Function}}
 */
export function startTaskContainerAdoption({ intervalMs = ADOPTION_INTERVAL_MS, setIntervalFn = setInterval, clearIntervalFn = clearInterval, ...options } = {}) {
  const adoptedBefore = options.adoptedBefore || new Set();
  let running = null;
  const runOnce = () => {
    if (!running) {
      running = adoptUntrackedTaskContainers({ ...options, adoptedBefore }).finally(() => {
        running = null;
      });
    }
    return running;
  };
  runOnce();
  const timer = setIntervalFn(runOnce, intervalMs);
  timer?.unref?.();
  return { stop: () => clearIntervalFn(timer), runOnce };
}
