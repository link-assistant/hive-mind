/**
 * Docker daemon restart detection (issue #2892).
 *
 * On 2026-10-09 the kernel OOM-killed the host `dockerd`. systemd restarted it,
 * and while it restored its containers it force-killed every one that was still
 * running (exit 137). Several task containers had survived earlier OOM kills of
 * a child process (`rustc`, `clippy-driver`), and Docker's `State.OOMKilled`
 * flag stays `true` for the rest of a container's life (moby#43564). The bot
 * read `OOMKilled=true` + exit 137 as "the task ran out of memory" and said so
 * in Telegram and on the pull request.
 *
 * This module answers one question for a container that exited 137: was it
 * killed because the Docker daemon restarted? The evidence, strongest first:
 *
 *   1. start-command's attributed `exitReason` (`killed (docker daemon restart)`,
 *      link-foundation/start#194 / #196);
 *   2. start-command's `Exit evidence: docker-daemon-restart` line in the log;
 *   3. the Docker service journal: a daemon exit/start line and the
 *      "failed to exit within …s of signal 15 - using the force" line for this
 *      exact container id (a `docker stop` writes the force line too, so the
 *      daemon line is required);
 *   4. the running dockerd started after this container did, within
 *      {@link DAEMON_RESTART_WINDOW_MS} of the container's `FinishedAt`;
 *   5. the bot's OWN container (`$HOSTNAME`) also finished within
 *      {@link BOT_CONTAINER_RESTART_WINDOW_MS} of the task and was started
 *      again afterwards. This is the fallback for an older `$`, a DinD root
 *      container or a remote daemon: none of them can read the host journal or
 *      the host dockerd start time. Simultaneous task finish times alone are
 *      not enough (start#194), but the bot container is not part of any task's
 *      cgroup, so it dying in the same seconds points at the daemon.
 *
 * Fresh main-process OOM evidence (`Exit evidence: main-oom …`) is never
 * overruled by the start-time rule. Every probe is injectable and the whole
 * detection never throws: it only enriches a report.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2892
 * @see https://github.com/link-foundation/start/issues/194
 * @see https://github.com/moby/moby/issues/43564
 */

import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';

/** start-command's `exitReason` for a container the restarting daemon killed. */
export const DAEMON_RESTART_EXIT_REASON = 'killed (docker daemon restart)';
/** start-command's exit evidence line for the same verdict. */
export const DAEMON_RESTART_LOG_EVIDENCE = 'Exit evidence: docker-daemon-restart';
/** start-command's exit evidence line for an OOM kill of the main process. */
export const MAIN_OOM_LOG_EVIDENCE = 'Exit evidence: main-oom';
/** How far the daemon start may be from the container's `FinishedAt`. */
export const DAEMON_RESTART_WINDOW_MS = 60_000;
/** How far the bot container's `FinishedAt` may be from a task's `FinishedAt`. */
export const BOT_CONTAINER_RESTART_WINDOW_MS = 15_000;
const PROBE_TIMEOUT_MS = 10_000;
const MEMORY_EXHAUSTION_PREFIX = 'memory-exhaustion';
// The daemon went down or came up (systemd and dockerd's own lines).
const DAEMON_LIFECYCLE_PATTERN = /Main process exited|Scheduled restart job|Stopping (?:docker\.service|Docker)|Starting (?:docker\.service|Docker)|Started (?:docker\.service|Docker)|Daemon shutdown complete|Processing signal 'terminated'|Loading containers: start/i;
const FORCE_KILL_PATTERN = /failed to exit within|using the force|force.?kill/i;

function parseMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function toIso(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function runCapture(command, args) {
  return new Promise(resolve => {
    execFile(command, args, { timeout: PROBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || '') });
    });
  });
}

async function runSafe(run, command, args) {
  try {
    const result = await run(command, args);
    return { code: result?.code ?? 1, stdout: String(result?.stdout ?? '') };
  } catch {
    return { code: 1, stdout: '' };
  }
}

/**
 * Whether start-command attributed the exit to a Docker daemon restart.
 *
 * @param {string|null} reason - `$ --status` `exitReason`
 * @returns {boolean}
 */
export function isDaemonRestartExitReason(reason) {
  return typeof reason === 'string' && reason.trim().toLowerCase() === DAEMON_RESTART_EXIT_REASON;
}

/**
 * Whether start-command attributed the exit to something other than memory
 * exhaustion, e.g. `signal (SIGKILL; cause unknown)` (start-command >= 0.37).
 * Such a reason means the sticky container flag did not explain the exit.
 *
 * @param {string|null} reason - `$ --status` `exitReason`
 * @returns {boolean}
 */
export function isAttributedNonMemoryExitReason(reason) {
  if (typeof reason !== 'string') return false;
  const text = reason.trim();
  return text !== '' && !text.toLowerCase().startsWith(MEMORY_EXHAUSTION_PREFIX);
}

/**
 * The last `Exit evidence:` line start-command wrote into the log.
 *
 * @param {string|null} logText
 * @returns {{daemonRestart: boolean, mainOom: boolean, line: string|null}}
 */
export function readExitEvidenceFromLog(logText) {
  const lines = String(logText || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('Exit evidence:'));
  const line = lines.at(-1) || null;
  return { daemonRestart: Boolean(line?.startsWith(DAEMON_RESTART_LOG_EVIDENCE)), mainOom: Boolean(line?.startsWith(MAIN_OOM_LOG_EVIDENCE)), line };
}

/**
 * Find the daemon restart in a Docker service journal excerpt.
 *
 * @param {string} journalText - `journalctl -u docker.service` output
 * @param {string} containerId - Full container id
 * @returns {{daemonLine: string, forceLine: string}|null}
 */
export function findDaemonRestartInJournal(journalText, containerId) {
  if (!containerId) return null;
  const lines = String(journalText || '').split('\n');
  const daemonLine = lines.find(line => DAEMON_LIFECYCLE_PATTERN.test(line));
  const forceLine = lines.find(line => line.includes(containerId) && FORCE_KILL_PATTERN.test(line));
  return daemonLine && forceLine ? { daemonLine: daemonLine.trim(), forceLine: forceLine.trim() } : null;
}

/**
 * When the running Docker daemon started. Never throws.
 *
 * systemd's `ActiveEnterTimestamp` first (host install), then the oldest
 * `dockerd` process's elapsed time (`ps -o etimes=`).
 *
 * @param {Object} [options]
 * @param {Function} [options.run] - (command, args) => Promise<{code, stdout}>
 * @param {Function} [options.now] - () => epoch ms
 * @returns {Promise<{startedAt: string, source: string}|null>}
 */
export async function readDockerDaemonStartedAt({ run = runCapture, now = Date.now } = {}) {
  const systemd = await runSafe(run, 'systemctl', ['show', 'docker.service', '--property=ActiveEnterTimestamp', '--value', '--timestamp=unix']);
  const value = systemd.code === 0 ? systemd.stdout.trim() : '';
  const unix = /^@(\d+(?:\.\d+)?)$/.exec(value);
  if (unix) {
    const ms = Number.parseFloat(unix[1]) * 1000;
    if (ms > 0) return { startedAt: toIso(ms), source: 'systemd ActiveEnterTimestamp' };
  }
  const pid = await runSafe(run, 'pgrep', ['-o', '-x', 'dockerd']);
  const dockerdPid = pid.code === 0 ? pid.stdout.trim().split(/\s+/)[0] : '';
  if (!/^\d+$/.test(dockerdPid)) return null;
  const elapsed = await runSafe(run, 'ps', ['-o', 'etimes=', '-p', dockerdPid]);
  const seconds = elapsed.code === 0 ? Number.parseInt(elapsed.stdout.trim(), 10) : NaN;
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return { startedAt: toIso(now() - seconds * 1000), source: `dockerd process ${dockerdPid} start time` };
}

/**
 * The container's id and lifetime from `docker inspect`. Never throws.
 *
 * @param {string} containerName
 * @param {Object} [options]
 * @param {Function} [options.run]
 * @returns {Promise<{id: string, startedAt: string|null, finishedAt: string|null}|null>}
 */
export async function inspectContainerLifetime(containerName, { run = runCapture } = {}) {
  if (!containerName) return null;
  const result = await runSafe(run, 'docker', ['inspect', '--type', 'container', '--format', '{{.Id}}|{{.State.StartedAt}}|{{.State.FinishedAt}}', String(containerName)]);
  if (result.code !== 0) return null;
  const [id, startedAt, finishedAt] = result.stdout.trim().split('|');
  if (!/^[a-f0-9]{64}$/.test(id || '')) return null;
  return { id, startedAt: parseMs(startedAt) ? startedAt : null, finishedAt: parseMs(finishedAt) ? finishedAt : null };
}

/**
 * The Docker service journal around the container's exit. Never throws.
 *
 * @param {string} finishedAt
 * @param {Object} [options]
 * @param {Function} [options.run]
 * @returns {Promise<string|null>}
 */
export async function readDockerServiceJournal(finishedAt, { run = runCapture } = {}) {
  const end = parseMs(finishedAt);
  if (end === null) return null;
  // A local journal says nothing about a remote daemon.
  const dockerHost = process.env.DOCKER_HOST;
  if (dockerHost && !dockerHost.startsWith('unix://')) return null;
  const result = await runSafe(run, 'journalctl', ['-u', 'docker.service', '--since', toIso(end - DAEMON_RESTART_WINDOW_MS), '--until', toIso(end + 5_000), '--no-pager', '--quiet', '--output=short-iso']);
  return result.code === 0 && result.stdout.trim() ? result.stdout : null;
}

/**
 * The bot's own container lifetime: when it last finished and when it was
 * started again. Docker keeps the previous `FinishedAt` after a restart, so a
 * running container whose `StartedAt` is later than its `FinishedAt` died at
 * `FinishedAt`. Never throws; null outside a container or when unknown.
 *
 * @param {Object} [options]
 * @param {string} [options.hostname] - Container id prefix (Docker sets `$HOSTNAME` to it)
 * @param {Function} [options.run]
 * @param {Function} [options.inContainer] - () => boolean
 * @returns {Promise<{name: string, startedAt: string, finishedAt: string}|null>}
 */
export async function readBotContainerLifetime({
  hostname = process.env.HOSTNAME,
  run = runCapture,
  inContainer = () =>
    access('/.dockerenv').then(
      () => true,
      () => false
    ),
} = {}) {
  try {
    if (!hostname || !(await inContainer())) return null;
    const result = await runSafe(run, 'docker', ['inspect', '--type', 'container', '--format', '{{.State.StartedAt}}|{{.State.FinishedAt}}', String(hostname)]);
    if (result.code !== 0) return null;
    const [startedAt, finishedAt] = result.stdout.trim().split('|');
    const startMs = parseMs(startedAt);
    const finishMs = parseMs(finishedAt);
    if (startMs === null || finishMs === null || startMs <= finishMs) return null;
    return { name: String(hostname), startedAt, finishedAt };
  } catch {
    return null;
  }
}

/**
 * Which sessions ended together with the bot's own container (issue #2892).
 *
 * @param {Object} options
 * @param {{finishedAt: string, startedAt?: string}|null} options.anchor - readBotContainerLifetime() result
 * @param {Array<{sessionName: string, finishedAt: string|null, startedAt?: string|null, exitCode?: number|null}>} options.sessions
 * @param {number} [options.windowMs]
 * @returns {string[]} Names of the sessions killed with the bot container
 */
export function correlateWithBotContainerRestart({ anchor = null, sessions = [], windowMs = BOT_CONTAINER_RESTART_WINDOW_MS } = {}) {
  const anchorMs = parseMs(anchor?.finishedAt);
  if (anchorMs === null) return [];
  return sessions
    .filter(session => {
      const code = session?.exitCode === null || session?.exitCode === undefined ? null : Number(session.exitCode);
      if (code !== null && code !== 137) return false;
      const finishMs = parseMs(session?.finishedAt);
      if (finishMs === null || Math.abs(finishMs - anchorMs) > windowMs) return false;
      const startMs = parseMs(session?.startedAt);
      return startMs === null || startMs < anchorMs;
    })
    .map(session => session.sessionName);
}

/**
 * Was this container killed because the Docker daemon restarted?
 *
 * @param {Object} options
 * @param {number|null} [options.exitCode] - Only 137 (SIGKILL) or an unknown exit qualifies
 * @param {string|null} [options.exitReason] - `$ --status` `exitReason`
 * @param {string|null} [options.logText] - Session log text (for start-command's exit evidence)
 * @param {string|null} [options.containerName] - Docker container to inspect
 * @param {string|null} [options.startedAt] - Fallback container start time
 * @param {string|null} [options.finishedAt] - Fallback container finish time
 * @param {Object} [options.probes] - { run, now, inspect, readJournal, readDaemonStartedAt, readBotContainer }
 * @param {boolean} [options.verbose]
 * @returns {Promise<Object|null>} The event, or null
 */
export async function detectDockerDaemonRestart({ exitCode = null, exitReason = null, logText = null, containerName = null, startedAt = null, finishedAt = null, probes = {}, verbose = false } = {}) {
  try {
    const code = exitCode === null || exitCode === undefined ? null : Number(exitCode);
    if (code !== null && code !== 137 && code >= 0) return null;
    const detectedAt = toIso((probes.now || Date.now)());
    if (isDaemonRestartExitReason(exitReason)) {
      return { detectedBy: 'exit-reason', exitReason: DAEMON_RESTART_EXIT_REASON, containerName, finishedAt: finishedAt || null, detectedAt };
    }
    const logEvidence = readExitEvidenceFromLog(logText);
    if (logEvidence.daemonRestart) return { detectedBy: 'log-evidence', evidenceLine: logEvidence.line, containerName, finishedAt: finishedAt || null, detectedAt };
    if (logEvidence.mainOom) return null;
    if (!containerName) return null;

    const run = probes.run || runCapture;
    const readBotContainer = probes.readBotContainer || (() => readBotContainerLifetime({ run }));
    const fromBotContainer = async (base, start, finish) => {
      const anchor = await readBotContainer();
      const [name] = correlateWithBotContainerRestart({ anchor, sessions: [{ sessionName: containerName, exitCode: code, startedAt: start, finishedAt: finish }] });
      if (verbose) console.log(`[VERBOSE] docker-daemon-restart: ${containerName} finished=${finish || '?'}; bot container ${anchor ? `${anchor.name} finished=${anchor.finishedAt} restarted=${anchor.startedAt}` : 'unavailable'}`);
      return name ? { ...base, detectedBy: 'bot-container-restart', botContainer: anchor.name, botContainerFinishedAt: anchor.finishedAt, botContainerStartedAt: anchor.startedAt } : null;
    };
    const inspect = probes.inspect || (name => inspectContainerLifetime(name, { run }));
    const container = await inspect(containerName);
    // A removed container cannot be inspected; the bot container may still tell.
    if (!container?.id) return await fromBotContainer({ containerName, startedAt: startedAt || null, finishedAt: finishedAt || null, detectedAt }, startedAt, finishedAt);
    const containerStartedAt = container.startedAt || startedAt;
    const containerFinishedAt = container.finishedAt || finishedAt;
    const base = { containerName, containerId: container.id, startedAt: containerStartedAt || null, finishedAt: containerFinishedAt || null, detectedAt };

    const readJournal = probes.readJournal || (at => readDockerServiceJournal(at, { run }));
    const journal = containerFinishedAt ? await readJournal(containerFinishedAt) : null;
    const journalHit = journal ? findDaemonRestartInJournal(journal, container.id) : null;
    if (journalHit) return { ...base, detectedBy: 'journal', ...journalHit };

    const readDaemonStartedAt = probes.readDaemonStartedAt || (() => readDockerDaemonStartedAt({ run, now: probes.now }));
    const daemon = await readDaemonStartedAt();
    const daemonMs = parseMs(daemon?.startedAt);
    const startMs = parseMs(containerStartedAt);
    const finishMs = parseMs(containerFinishedAt);
    if (verbose) console.log(`[VERBOSE] docker-daemon-restart: ${containerName} started=${containerStartedAt || '?'} finished=${containerFinishedAt || '?'} dockerd started=${daemon?.startedAt || '?'} (${daemon?.source || 'unavailable'}) journal=${journal ? 'read, no restart for this container' : 'unavailable'}`);
    if (daemonMs !== null && startMs !== null && finishMs !== null && startMs < daemonMs && Math.abs(daemonMs - finishMs) <= DAEMON_RESTART_WINDOW_MS) {
      return { ...base, detectedBy: 'daemon-start-time', daemonStartedAt: daemon.startedAt, daemonStartSource: daemon.source };
    }
    return await fromBotContainer(base, containerStartedAt, containerFinishedAt);
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] docker-daemon-restart: detection failed: ${error?.message || error}`);
    return null;
  }
}

/**
 * Evidence lines for the kill diagnostics.
 *
 * @param {Object} event - detectDockerDaemonRestart() result
 * @returns {string[]}
 */
export function describeDaemonRestartEvidence(event) {
  if (!event) return [];
  if (event.detectedBy === 'exit-reason') return [`\`$ --status\` reports \`exitReason = ${DAEMON_RESTART_EXIT_REASON}\` (start-command found the daemon restart in the Docker service journal)`];
  if (event.detectedBy === 'log-evidence') return [`start-command recorded \`${event.evidenceLine || DAEMON_RESTART_LOG_EVIDENCE}\` in the session log`];
  if (event.detectedBy === 'journal') return [`Docker service journal: \`${event.daemonLine}\``, `Docker service journal: \`${event.forceLine}\``];
  if (event.detectedBy === 'bot-container-restart') return [`the bot's own container \`${event.botContainer}\` was killed at ${event.botContainerFinishedAt}, within ${BOT_CONTAINER_RESTART_WINDOW_MS / 1000} s of this container's exit at ${event.finishedAt}, and restarted at ${event.botContainerStartedAt}; two unrelated containers dying together points at the Docker daemon`];
  if (event.detectedBy === 'daemon-start-time') {
    const gapSeconds = Math.round(Math.abs(Date.parse(event.daemonStartedAt) - Date.parse(event.finishedAt)) / 1000);
    return [`dockerd started at ${event.daemonStartedAt} (${event.daemonStartSource}), ${gapSeconds} s from the container's exit at ${event.finishedAt}; the container had started before it, at ${event.startedAt}`];
  }
  return [];
}

/**
 * One-line cause for the notice and the Telegram message.
 *
 * @param {Object} event
 * @returns {string}
 */
export function describeDaemonRestartCause(event) {
  const at = event?.finishedAt ? ` at ${event.finishedAt}` : '';
  return `killed by Docker daemon restart — dockerd restarted and force-killed the running container${at}; with \`"live-restore": true\` in \`/etc/docker/daemon.json\` containers keep running while the daemon restarts`;
}

/**
 * Issue #2892: consume start-command's attribution and the daemon-restart
 * detection before a sticky `State.OOMKilled` is turned into `oom-killed`.
 * Called by `resolveOomKilledState` once the footer, liveness and ordinary
 * exit checks found nothing. Never throws.
 *
 * - A daemon restart (attributed, or detected by the probes) is remembered on
 *   `sessionInfo.dockerDaemonRestart`, so the kill report and the completion
 *   message survive a bot restart and name the real cause.
 * - Any other non-memory attribution (`signal (SIGKILL; cause unknown)`) only
 *   says the flag did not explain the exit: the verdict is a plain kill and the
 *   kill diagnostics decide the cause from all the evidence.
 *
 * @param {string} sessionName
 * @param {Object} sessionInfo - Mutable persisted session info
 * @param {Object} statusResult - Parsed `$ --status` payload
 * @param {Object} options
 * @param {number|null} options.exitCode
 * @param {string|null} options.endTime
 * @param {string|null} options.containerName
 * @param {Function|null} [options.detect] - detectDockerDaemonRestart-compatible probe
 * @param {Function} [options.persistSnapshot]
 * @param {boolean} [options.verbose]
 * @returns {Promise<{verdict: 'daemon-restart'|'non-memory', event?: Object, exitReason?: string}|null>}
 */
export async function resolveDaemonRestartKill(sessionName, sessionInfo, statusResult, { exitCode = null, endTime = null, containerName = null, detect = null, persistSnapshot, verbose = false } = {}) {
  const exitReason = typeof statusResult?.exitReason === 'string' ? statusResult.exitReason : null;
  const docker = sessionInfo?.isolationBackend === 'docker' || statusResult?.isolation === 'docker';
  let event = sessionInfo?.dockerDaemonRestart || null;
  if (!event && docker && typeof detect === 'function') {
    try {
      event = await detect({ exitCode, exitReason, containerName, startedAt: statusResult?.startTime || null, finishedAt: endTime, verbose });
    } catch (error) {
      if (verbose) console.log(`[VERBOSE] Session ${sessionName} docker daemon restart detection failed: ${error?.message || error}`);
      event = null;
    }
  }
  if (!event && isDaemonRestartExitReason(exitReason)) {
    event = { detectedBy: 'exit-reason', exitReason: DAEMON_RESTART_EXIT_REASON, containerName, finishedAt: endTime, detectedAt: new Date().toISOString() };
  }
  if (event) {
    if (sessionInfo && !sessionInfo.dockerDaemonRestart) {
      sessionInfo.dockerDaemonRestart = event;
      if (typeof persistSnapshot === 'function') persistSnapshot();
    }
    if (verbose) console.log(`[VERBOSE] Session ${sessionName} was killed by a Docker daemon restart (${event.detectedBy})${statusResult?.oomKilled === true ? '; the sticky State.OOMKilled flag (moby#43564) is not what ended it' : ''} — reporting a kill, not oom-killed (issue #2892)`);
    return { verdict: 'daemon-restart', event };
  }
  if (isAttributedNonMemoryExitReason(exitReason)) {
    if (verbose) console.log(`[VERBOSE] Session ${sessionName} status includes oomKilled=true, but start-command attributes the exit to "${exitReason}", not memory exhaustion; reporting a kill, not oom-killed (issue #2892)`);
    return { verdict: 'non-memory', exitReason };
  }
  return null;
}
