/**
 * Scoped disk-space-saviour integration. Docker operations are disabled until
 * its DinD liveness/size probes are reliable (disk-space-saviour#14).
 * Never grant container/image removal consent or scan installed agent CLIs.
 */
import path from 'node:path';

const loadDss = () => import('disk-space-saviour');
const CACHE_RULES = ['npm-cache', 'bun-cache', 'pnpm-store', 'pip-cache', 'uv-cache', 'cargo-registry'];
const RUST_RULES = ['cargo-superseded', 'cargo-superseded-leaf'];
export const DEFAULT_RECLAIM_INTERVAL_MS = 30 * 60 * 1000;

function enabled(env) {
  return (env.HIVE_MIND_AUTO_RECLAIM ?? 'safe') === 'safe';
}

function optionsFor({ env, workspace, protectedPaths = new Set() }) {
  return {
    docker: false,
    host: true,
    tier: 'safe',
    // Native cache commands can require a project manifest or affect paths
    // outside the scanned filesystem/exclusions. Remove selected paths only.
    noNative: true,
    olderThan: env.HIVE_MIND_RECLAIM_STALE_AGE || '1h',
    scanners: workspace ? ['projects'] : ['global'],
    roots: workspace ? [path.resolve(workspace)] : null,
    only: workspace ? RUST_RULES : CACHE_RULES,
    exclude: [...protectedPaths],
    removeStoppedContainers: false,
    removeContainers: [],
    removeImages: [],
    includeVolumes: false,
    allowDirtyRepos: false,
    allowDirtyContainers: [],
  };
}

function scanSummary(report) {
  return {
    totals: report.totals,
    errors: report.errors,
    items: report.items.map(({ rule, paths, bytes, tier, blockers }) => ({ rule, paths, bytes, tier, blockers })),
  };
}

/**
 * Reclaim on the filesystem whose disk gate failed. DSS rechecks liveness and
 * tracking before deletion and stops at the free-space goal, at the safe tier.
 * The caller must remeasure free space: overlay lower-layer bytes cannot be
 * reclaimed by deleting paths in a container. Failures fall back to the gate.
 */
export async function reclaimDiskSpace({ requiredMB, diskPath = '/tmp', workspace = null, protectedPaths, env = process.env, log = async () => {}, load = loadDss } = {}) {
  if (!enabled(env)) return null;
  let pendingLogs = Promise.resolve();
  try {
    const dss = await load();
    const options = optionsFor({ env, workspace, protectedPaths });
    const report = await dss.scan(options);
    await log(`💾 [DSS_SCAN] ${JSON.stringify(scanSummary(report))}`);
    const onEntry = entry => {
      pendingLogs = pendingLogs.then(() => log(`💾 [DSS_RECLAIM] ${JSON.stringify(entry)}`));
    };
    const audit = workspace ? await dss.clean(report, { ...options, onEntry }) : await dss.emergency({ ...options, report, path: diskPath, free: requiredMB * 1024 * 1024, onEntry });
    await pendingLogs;
    await log(`💾 DSS reclaimed ${audit.freedBytes} bytes; audit: ${audit.file ?? 'unavailable'}`);
    return audit;
  } catch (error) {
    await pendingLogs;
    await log(`⚠️ Disk reclaim unavailable: ${error.message}`, { level: 'warning' });
    return null;
  }
}

/** A disk probe and reclaim hook shared by solve's pre-flight check. */
export async function probeDiskSpaceWithReclaim({ requiredMB, diskPath, getFreeMB, reclaim = reclaimDiskSpace, log }) {
  let availableMB = await getFreeMB();
  if (Number.isFinite(availableMB) && availableMB < requiredMB) {
    await reclaim({ requiredMB, diskPath, log });
    availableMB = await getFreeMB();
  }
  return availableMB;
}

/**
 * Prune only superseded Rust artifacts in this task's workspace. Passes never
 * overlap. Stopping drains an in-flight pass before workspace cleanup or exit.
 * A final pass after the tool exits can reclaim artifacts blocked by its build.
 */
export function startWorkspaceReclaim({ workspace, log, env = process.env, intervalMs = DEFAULT_RECLAIM_INTERVAL_MS, reclaim = reclaimDiskSpace, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!enabled(env) || !workspace) return async () => {};
  let stopped = false;
  let pending = Promise.resolve();
  let timer;
  const pass = () =>
    Promise.resolve()
      .then(() => reclaim({ workspace, env, log }))
      .catch(error => log?.(`⚠️ Workspace reclaim failed: ${error.message}`, { level: 'warning' }));
  const schedule = () => {
    timer = setTimer(() => {
      pending = pass();
      pending.then(() => {
        if (!stopped) schedule();
      });
    }, intervalMs);
    timer.unref?.();
  };
  schedule();
  return async ({ final = false } = {}) => {
    if (stopped) return pending;
    stopped = true;
    clearTimer(timer);
    if (final) pending = pending.then(pass);
    await pending;
  };
}
