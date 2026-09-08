/**
 * "How much space COULD be free" for the disk gate (issue #2187, item E).
 *
 * `disk-guard.lib.mjs` answers "how much is free" and, when that is not enough,
 * stops the run with:
 *
 *     🛑 Stopping: no in-flight work can release disk space.
 *     Free space on this host (or enable --auto-cleanup) and rerun.
 *
 * On the reported host that advice was actionable in four different places at
 * once — 24 GB of reclaimable docker data, orphaned agent snapshot stores
 * (#2186), idle solver workspaces, and toolchain versions superseded by newer
 * ones — and the operator was told about none of them.
 *
 * This module collects those sources into one summary the gate can print before
 * it defers work, splitting what the guard reclaims by itself (`automatic`)
 * from what needs a human or another command (`manual`). Sources that overlap
 * are reported but counted once: the superseded-image plan is a subset of
 * docker's own reclaimable figure, so only the figure is summed.
 *
 * Everything that touches the outside world is injectable, so the summary can
 * be tested against a fixture host.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2187
 */

import fsPromises from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { DEFAULT_AGENT_SNAPSHOT_MIN_IDLE_MS, classifyAgentSnapshotStores, getAgentDataHome } from './agent-snapshot-store.lib.mjs';
import { DEFAULT_MIN_IDLE_MS, DEFAULT_TMP_ROOT, findBusySolverWorkspaces, listSolverWorkspaces } from './disk-guard.lib.mjs';
import { collectDockerImageReclaimPlan, measureDockerReclaimableBytes } from './docker-image-reclaim.lib.mjs';
import { collectToolchainInventory } from './toolchain-inventory.lib.mjs';
import { measureDiskUsageBytes } from './disk-usage.lib.mjs';
import { formatBytes } from './cleanup.lib.mjs';

const execFileAsync = promisify(execFile);

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** Idle `/tmp/gh-issue-solver-*` workspaces: what the guard removes by itself. */
const collectIdleWorkspaces = async ({ tmpRoot, protectedPaths, minIdleMs, now, fileSystem, procRoot, exec }) => {
  const workspaces = await listSolverWorkspaces({ tmpRoot, fileSystem });
  if (workspaces.length === 0) return null;
  const busy = await findBusySolverWorkspaces({ workspaces, procRoot, fileSystem });
  const currentTime = now();
  const items = [];
  let bytes = 0;
  let truncated = false;
  for (const workspace of workspaces) {
    // Exactly the rules reclaimSolverWorkspaces() applies, so the figure is what
    // the guard would actually release — not an optimistic total.
    if (protectedPaths.has(workspace.path)) continue;
    if (busy.has(workspace.path)) continue;
    if (currentTime - workspace.mtimeMs < minIdleMs) continue;
    const measured = await measureDiskUsageBytes(workspace.path, { exec, fileSystem });
    truncated = truncated || measured.truncated;
    bytes += measured.bytes;
    items.push({ label: workspace.path, bytes: measured.bytes, command: null });
  }
  if (items.length === 0) return null;
  return { id: 'idle_workspaces', label: plural(items.length, 'idle solver workspace'), count: items.length, bytes, counted: true, automatic: true, command: null, note: 'reclaimed automatically before work is deferred', items, truncated };
};

/** Orphaned agent snapshot stores (#2186): also reclaimed by the guard itself. */
const collectOrphanedAgentSnapshots = async ({ agentDataHome, agentSnapshotMinIdleMs, now, fileSystem, exec }) => {
  if (!agentDataHome) return null;
  const { orphaned } = await classifyAgentSnapshotStores({ dataHome: agentDataHome, minIdleMs: agentSnapshotMinIdleMs, now, fileSystem });
  if (orphaned.length === 0) return null;
  const items = [];
  let bytes = 0;
  let truncated = false;
  for (const store of orphaned) {
    const measured = await measureDiskUsageBytes(store.path, { exec, fileSystem });
    truncated = truncated || measured.truncated;
    bytes += measured.bytes;
    items.push({ label: store.path, bytes: measured.bytes, command: null });
  }
  return { id: 'orphaned_agent_snapshots', label: plural(items.length, 'orphaned agent snapshot store'), count: items.length, bytes, counted: true, automatic: true, command: null, note: 'reclaimed automatically before work is deferred', items, truncated };
};

/** Toolchain versions superseded by a newer one (item A): never automatic. */
const collectSupersededToolchains = async ({ homeDir, fileSystem, exec }) => {
  const inventory = await collectToolchainInventory({ homeDir, fileSystem, exec });
  const superseded = inventory.entries.filter(entry => entry.status === 'superseded');
  if (superseded.length === 0) return null;
  return {
    id: 'superseded_toolchains',
    label: plural(superseded.length, 'superseded toolchain'),
    count: superseded.length,
    bytes: inventory.supersededBytes,
    counted: true,
    // A toolchain is shared with everything else on the host: removing one is an
    // operator decision, never something a disk gate does behind their back.
    automatic: false,
    command: superseded[0].command,
    note: null,
    items: superseded.map(entry => ({ label: `${entry.kind} ${entry.name}`, bytes: entry.bytes, command: entry.command })),
    truncated: inventory.truncated,
  };
};

/** Superseded images and docker's own reclaimable figure (item D). */
const collectDockerSources = async ({ exec, env, dockerImageReclaimMode }) => {
  const sources = [];
  const daemonBytes = await measureDockerReclaimableBytes({ exec });
  const plan = await collectDockerImageReclaimPlan({ exec, env, mode: dockerImageReclaimMode });
  if (plan && plan.remove.length > 0) {
    sources.push({
      id: 'docker_images',
      label: plural(plan.remove.length, 'superseded docker image'),
      count: plan.remove.length,
      bytes: plan.reclaimableBytes,
      // A subset of what `docker system df` reports, so it is only summed when
      // that figure is unavailable.
      counted: daemonBytes === null,
      automatic: false,
      command: 'solve --docker-image-reclaim=superseded (runs automatically with --auto-cleanup)',
      note: daemonBytes === null ? null : "included in docker's figure below",
      items: plan.remove.map(image => ({ label: image.reference, bytes: image.sizeBytes, command: image.command })),
      truncated: false,
    });
  }
  if (daemonBytes) {
    sources.push({ id: 'docker_daemon', label: 'docker reports reclaimable', count: 1, bytes: daemonBytes, counted: true, automatic: false, command: 'hive-cleanup --docker', note: 'images, containers and build cache (volumes are counted too, and never pruned automatically)', items: [], truncated: false });
  }
  return sources;
};

/**
 * Everything this host could release, measured rather than estimated.
 *
 * @returns {Promise<{totalBytes: number, automaticBytes: number, manualBytes: number, sources: Array<object>, truncated: boolean, errors: Array<{id: string, message: string}>}>}
 */
export const collectReclaimableSpace = async ({ tmpRoot = DEFAULT_TMP_ROOT, protectedPaths = new Set(), minIdleMs = DEFAULT_MIN_IDLE_MS, agentDataHome = getAgentDataHome(), agentSnapshotMinIdleMs = DEFAULT_AGENT_SNAPSHOT_MIN_IDLE_MS, homeDir = null, dockerImageReclaimMode = 'superseded', now = Date.now, fileSystem = fsPromises, procRoot = '/proc', exec = execFileAsync, env = process.env, includeDocker = true, includeToolchains = true } = {}) => {
  const sources = [];
  const errors = [];

  // One broken source must not cost the operator the other three.
  const gather = async (id, collect) => {
    try {
      const result = await collect();
      for (const source of Array.isArray(result) ? result : [result]) {
        if (source && (source.bytes > 0 || source.count > 0)) sources.push(source);
      }
    } catch (error) {
      errors.push({ id, message: error?.message || String(error) });
    }
  };

  await gather('idle_workspaces', () => collectIdleWorkspaces({ tmpRoot, protectedPaths, minIdleMs, now, fileSystem, procRoot, exec }));
  await gather('orphaned_agent_snapshots', () => collectOrphanedAgentSnapshots({ agentDataHome, agentSnapshotMinIdleMs, now, fileSystem, exec }));
  if (includeDocker) await gather('docker', () => collectDockerSources({ exec, env, dockerImageReclaimMode }));
  if (includeToolchains) await gather('superseded_toolchains', () => collectSupersededToolchains({ homeDir, fileSystem, exec }));

  const counted = sources.filter(source => source.counted);
  const totalBytes = counted.reduce((sum, source) => sum + source.bytes, 0);
  const automaticBytes = counted.filter(source => source.automatic).reduce((sum, source) => sum + source.bytes, 0);
  return { totalBytes, automaticBytes, manualBytes: totalBytes - automaticBytes, sources, truncated: sources.some(source => source.truncated), errors };
};

/** The summary as log lines. Empty when there is nothing to say. */
export const formatReclaimableSpaceLines = summary => {
  if (!summary || !summary.sources || summary.sources.length === 0) return [];
  const headline = summary.automaticBytes > 0 ? `   ♻️  Reclaimable space: ${formatBytes(summary.totalBytes)}${summary.truncated ? '+' : ''} (${formatBytes(summary.automaticBytes)} of it automatically)` : `   ♻️  Reclaimable space: ${formatBytes(summary.totalBytes)}${summary.truncated ? '+' : ''}`;
  const lines = [headline];
  for (const source of summary.sources) {
    const suffix = [source.note, source.command].filter(Boolean).join('; ');
    lines.push(`      • ${source.label}: ${formatBytes(source.bytes)}${suffix ? ` — ${suffix}` : ''}`);
  }
  return lines;
};

/**
 * Print the summary, collecting it first when the caller does not already have
 * one (the solver-reported deferral path in hive has no guard result to reuse).
 * Never throws: this runs while a run is already giving up.
 */
export const logReclaimableSpace = async ({ summary = null, log, level = undefined, collect = collectReclaimableSpace, options = {} } = {}) => {
  let resolved = summary;
  if (!resolved) {
    try {
      resolved = await collect(options);
    } catch {
      return null;
    }
  }
  for (const line of formatReclaimableSpaceLines(resolved)) await log(line, level ? { level } : undefined);
  return resolved;
};

export default {
  collectReclaimableSpace,
  formatReclaimableSpaceLines,
  logReclaimableSpace,
};
