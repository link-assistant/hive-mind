/** Runtime enforcement and reporting for Docker task disk limits (issue #449). */
import { detectContainerDiskLimitBreach } from './container-resource-limits.lib.mjs';
import { getDockerTaskContainerName } from './docker-resume-handoff.lib.mjs';

function formatResourceLimitBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatContainerResourceLimitExceededSection(sessionInfo) {
  const breach = sessionInfo?.containerResourceLimitExceeded;
  if (breach?.resource !== 'disk') return '';
  const action = breach.stopped === false ? 'The task container could not be stopped when the limit was detected.' : breach.stopped === true ? 'The task container was stopped.' : 'A container stop was requested.';
  return [`🛑 *Container resource limit exceeded*`, `Writable layer: ${formatResourceLimitBytes(breach.observedBytes)} used; limit ${formatResourceLimitBytes(breach.limitBytes)}.`, action].join('\n');
}

export async function enforceContainerDiskLimitForSession(sessionName, sessionInfo, containerBytes, { verbose = false, killContainer = null, persistSnapshot = () => {} } = {}) {
  // Issue #2408: a session resumed from a snapshot keeps what its earlier
  // containers wrote in image layers; that usage still counts toward the limit.
  const inheritedBytes = Number.isFinite(sessionInfo?.containerFilesystemInheritedBytes) ? sessionInfo.containerFilesystemInheritedBytes : 0;
  const observedBytes = Number.isFinite(containerBytes) ? containerBytes + inheritedBytes : containerBytes;
  if (verbose && inheritedBytes > 0 && Number.isFinite(containerBytes)) {
    console.log(`[VERBOSE] Session ${sessionName} disk usage: ${formatResourceLimitBytes(containerBytes)} in this container + ${formatResourceLimitBytes(inheritedBytes)} carried from earlier containers`);
  }
  const breach = detectContainerDiskLimitBreach({ limitBytes: sessionInfo?.containerResourceLimits?.diskBytes, observedBytes });
  if (!breach) return null;
  sessionInfo.containerResourceLimitExceeded = { ...breach, observedAt: new Date().toISOString() };
  persistSnapshot();
  const stop =
    killContainer ||
    (async (containerName, killVerbose) => {
      const { killDockerContainer } = await import('./docker-container-control.lib.mjs');
      return killDockerContainer(containerName, killVerbose);
    });
  let result;
  try {
    result = await stop(getDockerTaskContainerName(sessionInfo, sessionName), verbose);
  } catch (error) {
    result = { success: false, error: error?.message || String(error) };
  }
  const enforcement = { ...breach, observedAt: sessionInfo.containerResourceLimitExceeded.observedAt, stopped: Boolean(result?.success), error: result?.error || null };
  sessionInfo.containerResourceLimitExceeded = enforcement;
  persistSnapshot();
  const message = `Session ${sessionName} exceeded its Docker writable-layer limit (${formatResourceLimitBytes(observedBytes)} > ${formatResourceLimitBytes(breach.limitBytes)})`;
  if (result?.success) console.warn(`[session-monitor] ${message}; container stopped`);
  else console.error(`[session-monitor] ${message}; docker kill failed: ${result?.error || 'unknown error'}`);
  return enforcement;
}
