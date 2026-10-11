/**
 * Combine the queue's external-processing sources into one snapshot.
 *
 * Issue #2917: the snapshot used to be `max(pgrep, tracked sessions)`. Neither
 * source sees a docker-isolated task the bot is not tracking in memory — the AI
 * CLI runs in a sibling container's PID namespace, and a task resumed outside
 * the bot is in no registry — so four running `/codex` tasks counted as zero for
 * both `/limits` and dispatch throttling. The running task containers are now a
 * third source, reconciled with the tracked sessions:
 *
 *   docker[tool]   = max(tracked docker sessions, running task containers)
 *   isolated[tool] = tracked non-docker sessions + docker[tool]
 *   byTool[tool]   = max(pgrep, isolated[tool])
 *
 * `max` (not a sum) is kept wherever two sources can see the same task: pgrep
 * sees screen/tmux sessions and, when the bot runs on the host, container
 * processes too; a tracked docker session and its container are one task. A
 * tracked session whose `$ --status` is stale (`executed 137` while the
 * container is up) is still counted, because its container is.
 *
 * Containers no tracked session accounts for are reported as `untracked`, so
 * `/limits` can say so instead of hiding them.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2917
 */

import { countTaskContainersByTool, partitionTaskContainers } from './docker-task-containers.lib.mjs';

function sumValues(map) {
  return Object.values(map || {}).reduce((sum, count) => sum + (count || 0), 0);
}

/**
 * @param {object} sources
 * @param {string[]} sources.tools - Tool queues to report
 * @param {Object<string, number>} sources.processByTool - pgrep counts
 * @param {{count?: number, byTool?: Object, dockerByTool?: Object, identities?: string[]}} sources.isolated - tracked sessions
 * @param {{available?: boolean, containers?: Array}|null} [sources.containerResult] - running task containers
 * @returns {{byTool: Object, processByTool: Object, isolatedByTool: Object, containerByTool: Object, untrackedByTool: Object, untrackedContainers: Array, containersAvailable: boolean, total: number, isolatedTotal: number, processTotal: number, containerTotal: number, untrackedTotal: number}}
 */
export function mergeExternalProcessingSnapshot({ tools = [], processByTool = {}, isolated = {}, containerResult = null } = {}) {
  const isolatedByTool = isolated?.byTool || {};
  const trackedDockerByTool = isolated?.dockerByTool || {};
  const containersAvailable = Boolean(containerResult?.available);
  const containers = containersAvailable ? containerResult.containers || [] : [];
  const containerByTool = countTaskContainersByTool(containers);
  const { untracked } = partitionTaskContainers(containers, isolated?.identities || []);
  const untrackedByTool = countTaskContainersByTool(untracked);

  const combinedByTool = {};
  for (const tool of new Set([...tools, ...Object.keys(isolatedByTool), ...Object.keys(containerByTool)])) {
    const trackedDocker = trackedDockerByTool[tool] || 0;
    const trackedOther = Math.max(0, (isolatedByTool[tool] || 0) - trackedDocker);
    combinedByTool[tool] = trackedOther + Math.max(trackedDocker, containerByTool[tool] || 0);
  }
  const byTool = {};
  for (const tool of tools) {
    byTool[tool] = Math.max(processByTool[tool] || 0, combinedByTool[tool] || 0);
  }

  const processTotal = sumValues(processByTool);
  const trackedTotal = isolated?.count || sumValues(isolatedByTool);
  const trackedDockerTotal = sumValues(trackedDockerByTool);
  const containerTotal = containers.length;
  const isolatedTotal = Math.max(0, trackedTotal - trackedDockerTotal) + Math.max(trackedDockerTotal, containerTotal);
  return {
    byTool,
    processByTool,
    isolatedByTool,
    containerByTool,
    untrackedByTool,
    untrackedContainers: untracked,
    containersAvailable,
    total: Math.max(processTotal, isolatedTotal),
    isolatedTotal,
    processTotal,
    containerTotal,
    untrackedTotal: untracked.length,
  };
}
