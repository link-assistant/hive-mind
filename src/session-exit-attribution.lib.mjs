/**
 * Who ended a docker work session with SIGKILL (exit 137)? Issue #2892.
 *
 * Docker's `State.OOMKilled` and the cgroup `oom_kill` counter are container-wide
 * and sticky (moby/moby#43564): one OOM-killed `rustc` child hours earlier leaves
 * them set for the rest of the container's life. In the #2892 incident the host
 * dockerd was itself OOM-killed, systemd restarted it, and the restarting daemon
 * force-killed every container ("Container failed to exit within 10s of signal 15 -
 * using the force") — exit 137 next to a stale `OOMKilled=true`. Hive Mind read
 * that pair as an OOM kill and said "out of memory" in Telegram and on the PR.
 *
 * `OOMKilled && 137` therefore proves nothing on its own. This module combines the
 * evidence that can attribute the exit:
 *
 *   - start-command >= 0.36.0 (link-foundation/start#194, PR #196) attributes the
 *     exit itself: `exitReason` `killed (docker daemon restart)` or
 *     `signal (SIGKILL; cause unknown)`, `options.exitEvidence` `{daemonRestart,
 *     mainOom}`, and an `Exit evidence: …` line in the session log.
 *   - Our own probe, `detectDockerDaemonRestart()`, for when `$` could not read the
 *     host journal (it runs inside the DinD root container) or predates 0.36.0:
 *     other containers that finished in the same second — at least one of them with
 *     no OOM at all — or a dockerd (re)start right around `FinishedAt`.
 *
 * Precedence follows upstream: daemon restart > exit-time OOM of the main process >
 * "not the main process" > unknown (null, the legacy behaviour).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2892
 * @see https://github.com/link-foundation/start/issues/194
 */

import { execFile } from 'child_process';

export const UPSTREAM_DAEMON_RESTART_EXIT_REASON = 'killed (docker daemon restart)';
export const UPSTREAM_SIGKILL_UNKNOWN_EXIT_REASON = 'signal (SIGKILL; cause unknown)';

export const EXIT_EVIDENCE_LINE_PREFIX = 'Exit evidence:';
export const EXIT_EVIDENCE_MAIN_OOM = 'Exit evidence: main-oom (recent cgroup oom_kill delta)';
export const EXIT_EVIDENCE_DAEMON_RESTART = 'Exit evidence: docker-daemon-restart (Docker service journal)';
export const EXIT_EVIDENCE_UNAVAILABLE_PREFIX = 'Exit evidence: unavailable';

/** The Docker daemon restarted (or stopped) and force-killed the container. */
export const EXIT_ATTRIBUTION_DAEMON_RESTART = 'docker-daemon-restart';
/** The OOM killer hit the main process at exit time (fresh `oom_kill` delta). */
export const EXIT_ATTRIBUTION_MAIN_OOM = 'main-oom';
/** Attribution ran and found no exit-time OOM: any OOM flag is historical. */
export const EXIT_ATTRIBUTION_NOT_MAIN_OOM = 'not-main-oom';

/** Containers whose `FinishedAt` is this close count as killed "in the same second". */
export const DAEMON_RESTART_SIBLING_WINDOW_MS = 2000;
/** How many such other containers it takes before a mass kill is assumed. */
export const DAEMON_RESTART_MIN_SIBLINGS = 2;
/** A dockerd (re)start this close to `FinishedAt` explains the kill. */
export const DAEMON_RESTART_START_WINDOW_MS = 120_000;
/** Bound on the containers inspected for siblings, newest first. */
export const DAEMON_RESTART_MAX_CONTAINERS = 200;

const INSPECT_FORMAT = '{{.Id}}|{{.Name}}|{{.State.FinishedAt}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.State.Running}}';

/**
 * The last `Exit evidence:` line start-command's watcher appended to the log.
 *
 * @param {string|null} logText
 * @returns {{mainOom: boolean, daemonRestart: boolean, unavailable: boolean, line: string}|null} Null when the log has none
 */
export function parseExitEvidenceFromLog(logText) {
  if (!logText) return null;
  const line = String(logText)
    .split('\n')
    .map(entry => entry.trim())
    .filter(entry => entry.startsWith(EXIT_EVIDENCE_LINE_PREFIX))
    .at(-1);
  if (!line) return null;
  return { mainOom: line === EXIT_EVIDENCE_MAIN_OOM, daemonRestart: line === EXIT_EVIDENCE_DAEMON_RESTART, unavailable: line.startsWith(EXIT_EVIDENCE_UNAVAILABLE_PREFIX), line };
}

/**
 * Combine every attribution source into one verdict.
 *
 * @param {Object} [sources]
 * @param {string|null} [sources.exitReason] - `$ --status` `exitReason`
 * @param {{daemonRestart?: boolean, mainOom?: boolean}|null} [sources.exitEvidence] - `$ --status` `options.exitEvidence` (start-command >= 0.36.0)
 * @param {string|null} [sources.logText] - Session log text (for the `Exit evidence:` line)
 * @param {{detected?: boolean}|null} [sources.dockerDaemonRestart] - detectDockerDaemonRestart() result
 * @returns {{kind: string|null, source: string|null}} `kind` is one of the EXIT_ATTRIBUTION_* constants, or null when nothing attributes the exit
 */
export function resolveExitAttribution({ exitReason = null, exitEvidence = null, logText = null, dockerDaemonRestart = null } = {}) {
  const reason = typeof exitReason === 'string' ? exitReason.trim() : '';
  const logged = parseExitEvidenceFromLog(logText);
  if (reason === UPSTREAM_DAEMON_RESTART_EXIT_REASON) return { kind: EXIT_ATTRIBUTION_DAEMON_RESTART, source: `\`$ --status\` exitReason \`${reason}\`` };
  if (exitEvidence?.daemonRestart === true) return { kind: EXIT_ATTRIBUTION_DAEMON_RESTART, source: '`$ --status` exitEvidence.daemonRestart' };
  if (logged?.daemonRestart) return { kind: EXIT_ATTRIBUTION_DAEMON_RESTART, source: `log line \`${logged.line}\`` };
  if (dockerDaemonRestart?.detected === true) return { kind: EXIT_ATTRIBUTION_DAEMON_RESTART, source: 'Hive Mind docker probe' };
  if (exitEvidence?.mainOom === true) return { kind: EXIT_ATTRIBUTION_MAIN_OOM, source: '`$ --status` exitEvidence.mainOom' };
  if (logged?.mainOom) return { kind: EXIT_ATTRIBUTION_MAIN_OOM, source: `log line \`${logged.line}\`` };
  if (reason === UPSTREAM_SIGKILL_UNKNOWN_EXIT_REASON) return { kind: EXIT_ATTRIBUTION_NOT_MAIN_OOM, source: `\`$ --status\` exitReason \`${reason}\`` };
  if (exitEvidence && exitEvidence.mainOom === false) return { kind: EXIT_ATTRIBUTION_NOT_MAIN_OOM, source: '`$ --status` exitEvidence.mainOom = false' };
  if (logged?.unavailable) return { kind: EXIT_ATTRIBUTION_NOT_MAIN_OOM, source: `log line \`${logged.line}\`` };
  return { kind: null, source: null };
}

function defaultRun(cmd, args) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: 15_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      resolve({ ok: !error, stdout: stdout || '' });
    });
  });
}

function parseInspectRows(stdout) {
  const rows = [];
  for (const line of String(stdout || '').split('\n')) {
    const [id, name, finishedAt, exitCode, oomKilled, running] = line.trim().split('|');
    if (!id || !finishedAt) continue;
    const finishedMs = Date.parse(finishedAt);
    // Docker reports `0001-01-01T00:00:00Z` for a container that never stopped.
    if (!Number.isFinite(finishedMs) || finishedMs <= 0) continue;
    rows.push({ id, name: String(name || '').replace(/^\//, ''), finishedAt, finishedMs, exitCode: Number(exitCode), oomKilled: oomKilled === 'true', running: running === 'true' });
  }
  return rows;
}

function parseDaemonStart(stdout) {
  const value = String(stdout || '').trim();
  if (!value) return null;
  const unix = value.match(/^@(\d+)/);
  const ms = unix ? Number(unix[1]) * 1000 : Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function describeSibling(sibling) {
  const state = sibling.running ? 'running again' : `exit ${sibling.exitCode}`;
  return `\`${sibling.name}\` (${state}, OOMKilled=${sibling.oomKilled})`;
}

/**
 * Was this container killed by a Docker daemon restart (or stop)?
 *
 * Two independent signals, either of which is enough:
 *   1. At least DAEMON_RESTART_MIN_SIBLINGS other containers finished within
 *      DAEMON_RESTART_SIBLING_WINDOW_MS, and at least one of them never had an OOM
 *      event. A host-wide OOM storm can kill several containers at once, but it sets
 *      `OOMKilled` on each of them; a container without it was stopped by something
 *      else. (Running containers count too: `FinishedAt` survives a restart, which is
 *      how the DinD root container restarted by hand still shows the 12:11:55 kill.)
 *   2. `docker.service` (re)started within DAEMON_RESTART_START_WINDOW_MS of
 *      `FinishedAt` (only checked against a local daemon — systemd cannot see a
 *      remote one, and inside a container `systemctl` simply fails).
 *
 * Both are temporal hints, not proof; the result is reported as "likely" and is
 * only consulted when start-command could not attribute the exit itself.
 *
 * @param {string} containerName - Container name or id (the session id for `$ --isolated docker`)
 * @param {Object} [options]
 * @param {boolean} [options.verbose]
 * @param {Function} [options.run] - `(cmd, args) => Promise<{ok, stdout}>`, injectable for tests
 * @param {Object} [options.env]
 * @returns {Promise<{detected: boolean, finishedAt: string, siblings: Array, daemonStartedAt: string|null, evidence: string[]}|null>} Null when the container cannot be inspected
 */
export async function detectDockerDaemonRestart(containerName, { verbose = false, run = defaultRun, env = process.env } = {}) {
  if (!containerName) return null;
  try {
    const own = parseInspectRows((await run('docker', ['inspect', '--format', INSPECT_FORMAT, containerName])).stdout)[0];
    if (!own) {
      if (verbose) console.log(`[VERBOSE] daemon-restart probe: cannot inspect container '${containerName}'`);
      return null;
    }

    const listed = await run('docker', ['ps', '-a', '-q', '--no-trunc', '--last', String(DAEMON_RESTART_MAX_CONTAINERS)]);
    const ids = (listed.stdout?.toString() ?? '')
      .split('\n')
      .map(id => id.trim())
      .filter(id => id && id !== own.id);
    // A container removed between `ps` and `inspect` makes `inspect` exit non-zero
    // but it still prints every other container, so the output is used either way.
    const others = ids.length > 0 ? parseInspectRows((await run('docker', ['inspect', '--format', INSPECT_FORMAT, ...ids])).stdout) : [];
    const siblings = others.filter(other => other.id !== own.id && Math.abs(other.finishedMs - own.finishedMs) <= DAEMON_RESTART_SIBLING_WINDOW_MS);
    const massKill = siblings.length >= DAEMON_RESTART_MIN_SIBLINGS && siblings.some(sibling => !sibling.oomKilled);

    let daemonStartMs = null;
    const dockerHost = env?.DOCKER_HOST || '';
    if (!dockerHost || dockerHost.startsWith('unix://')) {
      const shown = await run('systemctl', ['show', 'docker.service', '--property=ActiveEnterTimestamp', '--value', '--timestamp=unix']);
      daemonStartMs = shown.ok ? parseDaemonStart(shown.stdout) : null;
    }
    const daemonNear = daemonStartMs !== null && Math.abs(daemonStartMs - own.finishedMs) <= DAEMON_RESTART_START_WINDOW_MS;

    const evidence = [];
    if (siblings.length > 0) {
      evidence.push(`${siblings.length} other container${siblings.length === 1 ? '' : 's'} finished within ${DAEMON_RESTART_SIBLING_WINDOW_MS / 1000}s of this one (${own.finishedAt}): ${siblings.slice(0, 6).map(describeSibling).join(', ')}${siblings.length > 6 ? ', …' : ''}`);
    }
    if (daemonStartMs !== null) {
      const delta = Math.round((daemonStartMs - own.finishedMs) / 1000);
      evidence.push(`dockerd (\`docker.service\`) (re)started at ${new Date(daemonStartMs).toISOString()}, ${Math.abs(delta)}s ${delta < 0 ? 'before' : 'after'} this container finished`);
    }
    const detected = massKill || daemonNear;
    if (verbose) {
      console.log(`[VERBOSE] daemon-restart probe: ${containerName} finished ${own.finishedAt} exit=${own.exitCode} OOMKilled=${own.oomKilled}; siblings=${siblings.length} (without OOM: ${siblings.filter(s => !s.oomKilled).length}) daemonStart=${daemonStartMs === null ? 'unknown' : new Date(daemonStartMs).toISOString()} → detected=${detected}`);
    }
    return { detected, finishedAt: own.finishedAt, siblings: siblings.map(({ finishedMs: _finishedMs, ...sibling }) => sibling), daemonStartedAt: daemonStartMs === null ? null : new Date(daemonStartMs).toISOString(), evidence };
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] daemon-restart probe failed for '${containerName}': ${error?.message || error}`);
    return null;
  }
}
