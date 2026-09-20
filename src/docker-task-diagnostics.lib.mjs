/**
 * Host-side snapshot of a Docker-isolated task container (issue #2244).
 *
 * The incident that produced this module left a 37-line session log for a task
 * that lived six seconds:
 *
 *   [dind-entrypoint] Starting dockerd (storage-driver=fuse-overlayfs, ...)
 *   Container kept for investigation: 6eeae339-...
 *   Reason: exitCode=137 oomKilled=false
 *
 * Everything that could have explained the SIGKILL — the container's own state
 * (`StartedAt`/`FinishedAt`/`Error`/`OOMKilled`), whatever it managed to print,
 * and the nested daemon's log inside `/var/log/dockerd.log` — existed only
 * INSIDE the container, and the monitor's retention policy removes that
 * container as soon as the completion notification is out. Nothing was ever
 * copied to the host, so by the time a human read the notification the evidence
 * was gone.
 *
 * This module copies those artifacts next to the session log start-command
 * already preserves, before the container is reaped. Every probe is injectable,
 * bounded by a timeout and non-fatal: diagnostics must never delay or fail a
 * completion notification — the original bug was an unbounded `docker inspect`
 * holding a launch open, and repeating that here would be inexcusable.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2244
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Upper bound for every docker call made here. Generous enough for `docker cp`
 * on a busy daemon, short enough that a wedged daemon cannot stall the monitor
 * loop for more than the sum of a handful of probes.
 */
export const DOCKER_DIAGNOSTICS_TIMEOUT_MS = 15_000;
/** Cap on the captured container output; the session log has the full stream. */
export const DOCKER_DIAGNOSTICS_LOG_TAIL_LINES = 5000;
const DOCKER_DIAGNOSTICS_MAX_BUFFER = 16 * 1024 * 1024;
const DEFAULT_DIND_DAEMON_LOG = '/var/log/dockerd.log';

/**
 * What an exit code above 128 says about the signal that ended the container.
 *
 * Docker reports `137` and start-command copies it verbatim into the session
 * log. `137 = 128 + 9` is SIGKILL, which is the single most important fact about
 * issue #2244's run and was never once spelled out for the reader.
 */
const SIGNAL_NAMES = new Map([
  [2, 'SIGINT'],
  [6, 'SIGABRT'],
  [9, 'SIGKILL'],
  [11, 'SIGSEGV'],
  [15, 'SIGTERM'],
]);
const SIGNAL_DESCRIPTIONS = new Map([
  ['SIGKILL', 'the container was killed outright (kernel OOM killer, a container memory limit, or an explicit `docker kill`/`rm -f`); nothing it could print survives this'],
  ['SIGTERM', 'the container was asked to stop — usually a timeout, `docker stop`, or a supervisor shutting it down'],
  ['SIGABRT', 'a process inside aborted — for Node.js this is usually a fatal V8 error such as a heap limit'],
  ['SIGSEGV', 'a process inside crashed with a segmentation fault'],
  ['SIGINT', 'the container was interrupted (Ctrl+C)'],
]);

/**
 * Decode a container exit code into the signal that produced it, if any.
 *
 * @param {number|null} exitCode
 * @returns {{exitCode: number|null, signal: string|null, description: string}}
 */
export function describeDockerExitCode(exitCode) {
  const code = Number(exitCode);
  if (!Number.isFinite(code)) return { exitCode: null, signal: null, description: 'no exit code was reported' };
  if (code === 0) return { exitCode: 0, signal: null, description: 'the container exited normally' };
  if (code > 128 && code < 192) {
    const signal = SIGNAL_NAMES.get(code - 128) || `signal ${code - 128}`;
    return { exitCode: code, signal, description: SIGNAL_DESCRIPTIONS.get(signal) || `the container was terminated by ${signal}` };
  }
  return { exitCode: code, signal: null, description: `the container exited with status ${code}` };
}

/**
 * When may a container be snapshotted? `on-failure` (the default) keeps the
 * successful path free of extra docker calls; `always` is for reproducing a
 * flaky startup; `off` restores the pre-#2244 behavior.
 */
export function resolveDockerDiagnosticsPolicy({ env = process.env } = {}) {
  const raw = String(env?.HIVE_MIND_DOCKER_DIAGNOSTICS ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'always' || raw === 'all') return 'always';
  if (raw === 'off' || raw === '0' || raw === 'false' || raw === 'no' || raw === 'never') return 'off';
  return 'on-failure';
}

/** True when this terminal session should have its container snapshotted. */
export function shouldCaptureDockerDiagnostics({ isolationBackend = null, exitCode = null, status = null, env = process.env } = {}) {
  if (isolationBackend !== 'docker') return false;
  const policy = resolveDockerDiagnosticsPolicy({ env });
  if (policy === 'off') return false;
  if (policy === 'always') return true;
  const normalizedStatus = String(status || '')
    .trim()
    .toLowerCase();
  if (['killed', 'terminated', 'failed', 'error', 'oom', 'out-of-memory'].includes(normalizedStatus)) return true;
  if (exitCode === null || exitCode === undefined) return false;
  return Number(exitCode) !== 0;
}

/**
 * Where the snapshot goes: beside the session log, named after it, so the two
 * halves of the evidence are found together. Without a log path (the status
 * record was garbage-collected) fall back to a stable temp location.
 */
export function resolveDockerDiagnosticsDirectory({ logPath = null, containerName = 'container', tmpDir = os.tmpdir() } = {}) {
  if (logPath) {
    const dir = path.dirname(logPath);
    const base = path.basename(logPath).replace(/\.log$/i, '');
    return path.join(dir, `${base}.diagnostics`);
  }
  return path.join(tmpDir, 'hive-mind', 'docker-diagnostics', String(containerName || 'container'));
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function extractFacts(inspectJson, exitCode) {
  const record = Array.isArray(inspectJson) ? inspectJson[0] : inspectJson;
  const state = record?.State || {};
  const startedAt = state.StartedAt && !state.StartedAt.startsWith('0001-01-01') ? state.StartedAt : null;
  const finishedAt = state.FinishedAt && !state.FinishedAt.startsWith('0001-01-01') ? state.FinishedAt : null;
  const started = startedAt ? Date.parse(startedAt) : NaN;
  const finished = finishedAt ? Date.parse(finishedAt) : NaN;
  const resolvedExit = Number.isFinite(Number(state.ExitCode)) ? Number(state.ExitCode) : Number.isFinite(Number(exitCode)) ? Number(exitCode) : null;
  return {
    exitCode: resolvedExit,
    signal: describeDockerExitCode(resolvedExit).signal,
    oomKilled: state.OOMKilled ?? null,
    error: state.Error || null,
    status: state.Status || null,
    startedAt,
    finishedAt,
    lifetimeMs: Number.isFinite(started) && Number.isFinite(finished) ? finished - started : null,
    image: record?.Config?.Image || null,
    privileged: record?.HostConfig?.Privileged ?? null,
    restartCount: record?.RestartCount ?? null,
  };
}

function buildSummaryText({ containerName, facts, exitCode, status, errors }) {
  const decoded = describeDockerExitCode(facts.exitCode ?? exitCode);
  const lines = [`# Docker task container diagnostics (issue #2244)`, `capturedAt=${new Date().toISOString()}`, `container=${containerName}`, `sessionStatus=${status ?? 'unknown'}`, `exitCode=${facts.exitCode ?? exitCode ?? 'unknown'}`, `signal=${decoded.signal ?? 'none'}`, `meaning=${decoded.description}`, `oomKilled=${facts.oomKilled ?? 'unknown'}`, `dockerState=${facts.status ?? 'unknown'}`, `dockerError=${facts.error || 'none'}`, `startedAt=${facts.startedAt ?? 'unknown'}`, `finishedAt=${facts.finishedAt ?? 'unknown'}`, `lifetime=${formatDuration(facts.lifetimeMs) ?? 'unknown'}`, `image=${facts.image ?? 'unknown'}`, `privileged=${facts.privileged ?? 'unknown'}`, `restartCount=${facts.restartCount ?? 'unknown'}`];
  if (errors.length > 0) lines.push(`captureErrors=${errors.join(' | ')}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Snapshot a finished task container to the host.
 *
 * Never throws. Returns `{captured, directory, files, facts, errors}`; a caller
 * treats `captured === false` as "no extra evidence this time" and carries on.
 */
export async function captureDockerTaskContainerDiagnostics({ containerName, logPath = null, exitCode = null, status = null, daemonLogPath = DEFAULT_DIND_DAEMON_LOG, timeoutMs = DOCKER_DIAGNOSTICS_TIMEOUT_MS, tmpDir = os.tmpdir(), verbose = false, execFileImpl = execFileAsync, fsImpl = fs } = {}) {
  const errors = [];
  const files = [];
  let facts = {};
  if (!containerName) return { captured: false, directory: null, files, facts, errors: ['no container name'] };
  const directory = resolveDockerDiagnosticsDirectory({ logPath, containerName, tmpDir });
  try {
    fsImpl.mkdirSync(directory, { recursive: true });
  } catch (error) {
    return { captured: false, directory, files, facts, errors: [`could not create ${directory}: ${error?.message || error}`] };
  }
  const run = async args => execFileImpl('docker', args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: DOCKER_DIAGNOSTICS_MAX_BUFFER });
  const write = (name, content) => {
    try {
      fsImpl.writeFileSync(path.join(directory, name), content);
      files.push(name);
      return true;
    } catch (error) {
      errors.push(`could not write ${name}: ${error?.message || error}`);
      return false;
    }
  };
  // 1. The container's own state — the only place that distinguishes an OOM kill
  //    from an external `docker rm -f`, and the only source of real timestamps
  //    (start-command recomputes `endTime` at observation time, so its record
  //    drifted almost four days past the real finish in the incident).
  try {
    const { stdout } = await run(['inspect', containerName]);
    write('container-inspect.json', stdout);
    facts = extractFacts(JSON.parse(stdout), exitCode);
  } catch (error) {
    errors.push(`docker inspect failed: ${error?.message || error}`);
  }
  // 2. Whatever the container printed, including the start-gate markers and the
  //    dind entrypoint. Redundant with the session log in the happy case, but the
  //    session log is the artifact that was empty in the incident.
  try {
    const { stdout, stderr } = await run(['logs', '--timestamps', '--tail', String(DOCKER_DIAGNOSTICS_LOG_TAIL_LINES), containerName]);
    write('container-logs.txt', `${stdout || ''}${stderr || ''}`);
  } catch (error) {
    errors.push(`docker logs failed: ${error?.message || error}`);
  }
  // 3. The nested daemon's log. box keeps it inside the container at
  //    /var/log/dockerd.log and only surfaces a tail of it when the readiness
  //    wait fails, so a container killed earlier takes it to the grave.
  if (daemonLogPath) {
    try {
      await run(['cp', `${containerName}:${daemonLogPath}`, path.join(directory, 'dockerd.log')]);
      files.push('dockerd.log');
    } catch (error) {
      errors.push(`docker cp ${daemonLogPath} failed: ${error?.message || error}`);
    }
  }
  write('summary.txt', buildSummaryText({ containerName, facts, exitCode, status, errors }));
  const captured = files.length > 0;
  if (verbose) {
    console.log(`[VERBOSE] Docker diagnostics for '${containerName}': ${captured ? `saved ${files.join(', ')} to ${directory}` : 'nothing could be captured'}${errors.length > 0 ? ` (${errors.join('; ')})` : ''}`);
  }
  return { captured, directory, files, facts, errors };
}

/**
 * The completion-message block that tells a human the evidence exists and where.
 * An empty string when there is nothing to point at, so callers can spread it.
 */
export function formatDockerDiagnosticsSection(capture) {
  if (!capture?.captured || !capture.directory) return '';
  const facts = capture.facts || {};
  const decoded = describeDockerExitCode(facts.exitCode);
  const lines = ['*🧾 Container diagnostics saved*'];
  if (facts.exitCode !== null && facts.exitCode !== undefined) {
    lines.push(`Exit: \`${facts.exitCode}\`${decoded.signal ? ` (${decoded.signal} — ${decoded.description})` : ''}`);
  }
  const stateBits = [];
  if (facts.status) stateBits.push(`state \`${facts.status}\``);
  if (facts.oomKilled !== null && facts.oomKilled !== undefined) stateBits.push(`OOMKilled \`${facts.oomKilled}\``);
  const lifetime = formatDuration(facts.lifetimeMs);
  if (lifetime) stateBits.push(`lifetime \`${lifetime}\``);
  if (stateBits.length > 0) lines.push(`Container: ${stateBits.join(', ')}`);
  if (facts.error) lines.push(`Docker error: \`${facts.error}\``);
  lines.push(`Saved to: \`${capture.directory}\``);
  lines.push(`Files: ${capture.files.map(file => `\`${file}\``).join(', ')}`);
  return lines.join('\n');
}
