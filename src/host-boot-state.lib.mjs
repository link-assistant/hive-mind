/**
 * Host reboot detection (issue #3533).
 *
 * When the host goes down without a shutdown (hypervisor reset, power, kernel
 * hang), dockerd marks every task container exit 255 after the next boot. The
 * bot then reported each task as a separate "forced kill — memory … within
 * normal limits", quoting readings from hours earlier and the time of an
 * unrelated, survived child OOM as "Detected at". Nothing said the host went
 * down, or that every task died at the same moment.
 *
 * The bot records the host's `boot_id` with every heartbeat. On the next start,
 * a different `boot_id` (or an uptime shorter than the time since the last
 * heartbeat) means the host restarted while the bot was down. Every session
 * that was still running is then reported as ONE event: "host rebooted" or
 * "host hard reset (no shutdown recorded)".
 *
 * `/proc/sys/kernel/random/boot_id` and `/proc/uptime` are not namespaced, so
 * the bot container sees the host's values. Whether the host shut down cleanly
 * is read from the host journal when there is one; inside a container (no host
 * journal) the bot's own stop record answers it: an orderly host shutdown
 * stops the bot container with SIGTERM first, which records `stoppedAt`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3533
 * @see https://github.com/link-assistant/hive-mind/issues/2892 (dockerd restart)
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveBotStateDir } from './session-store.lib.mjs';

export const HOST_BOOT_STATE_FILE = 'host-boot-state.json';
export const HOST_BOOT_ID_PATH = '/proc/sys/kernel/random/boot_id';
export const HOST_UPTIME_PATH = '/proc/uptime';
// The uptime fallback (no boot_id) allows for clock jitter and a slow heartbeat.
const UPTIME_SLACK_MS = 2 * 60 * 1000;
// A session whose log was last written this long before the bot's last
// heartbeat had ended on its own before the host went down.
export const HOST_REBOOT_SESSION_SLACK_MS = 10 * 60 * 1000;
// Lines the previous boot's journal ends with after an orderly shutdown.
const SHUTDOWN_JOURNAL_PATTERN = /Journal stopped|systemd-shutdown|Reached target .*(?:Power-Off|Reboot|Shutdown|Halt)|System is (?:rebooting|powering down|halting)/i;

function toIso(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function parseMs(value) {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Read the host's boot identity. Never throws: a missing file reads as null.
 *
 * @param {Object} [options]
 * @param {Function} [options.readFile] - (path, encoding) => Promise<string>
 * @param {Function} [options.now] - () => epoch ms
 * @returns {Promise<{bootId: string|null, uptimeSeconds: number|null, bootedAt: string|null}>}
 */
export async function readHostBootIdentity({ readFile = fs.readFile, now = Date.now } = {}) {
  const read = async file => {
    try {
      return String(await readFile(file, 'utf8')).trim();
    } catch {
      return null;
    }
  };
  const [bootId, uptimeText] = await Promise.all([read(HOST_BOOT_ID_PATH), read(HOST_UPTIME_PATH)]);
  const uptimeSeconds = uptimeText ? Number.parseFloat(uptimeText.split(/\s+/)[0]) : NaN;
  const uptime = Number.isFinite(uptimeSeconds) && uptimeSeconds >= 0 ? uptimeSeconds : null;
  return { bootId: bootId || null, uptimeSeconds: uptime, bootedAt: uptime === null ? null : toIso(now() - uptime * 1000) };
}

/**
 * Whether the previous boot's journal ends with an orderly shutdown.
 *
 * @param {Object} [options]
 * @param {Function} [options.run] - (command, args) => Promise<{code, stdout}>
 * @returns {Promise<boolean|null>} null when there is no readable host journal
 */
export async function readPreviousBootShutdownRecord({ run = runCapture } = {}) {
  try {
    const result = await run('journalctl', ['--boot=-1', '--lines=200', '--output=cat', '--no-pager', '--quiet']);
    if (result?.code !== 0 || !String(result.stdout?.toString() || '').trim()) return null;
    return SHUTDOWN_JOURNAL_PATTERN.test(result.stdout);
  } catch {
    return null;
  }
}

function runCapture(command, args) {
  return new Promise(resolve => {
    execFile(command, args, { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || '') });
    });
  });
}

/**
 * Pure decision: did the host restart since the state was last recorded?
 *
 * @param {Object} options
 * @param {Object|null} options.previous - Persisted state from the last run
 * @param {Object} options.current - readHostBootIdentity() result
 * @param {boolean|null} [options.journalShutdownRecorded] - readPreviousBootShutdownRecord() result
 * @returns {Object|null} The reboot event, or null
 */
export function detectHostReboot({ previous = null, current = {}, journalShutdownRecorded = null } = {}) {
  if (!previous) return null;
  const lastHeartbeatMs = parseMs(previous.lastHeartbeatAt);
  const bootedAtMs = parseMs(current.bootedAt);
  let detectedBy = null;
  if (previous.bootId && current.bootId) {
    if (previous.bootId !== current.bootId) detectedBy = 'boot-id';
  } else if (lastHeartbeatMs !== null && bootedAtMs !== null && bootedAtMs > lastHeartbeatMs + UPTIME_SLACK_MS) {
    // No boot_id: the host came up after the bot's last heartbeat.
    detectedBy = 'uptime';
  }
  if (!detectedBy) return null;
  const stoppedMs = parseMs(previous.stoppedAt);
  const botStoppedCleanly = stoppedMs !== null && (lastHeartbeatMs === null || stoppedMs >= lastHeartbeatMs);
  const shutdownRecorded = journalShutdownRecorded ?? botStoppedCleanly;
  return {
    detectedBy,
    previousBootId: previous.bootId || null,
    currentBootId: current.bootId || null,
    bootedAt: current.bootedAt || null,
    lastHeartbeatAt: previous.lastHeartbeatAt || null,
    botStoppedAt: botStoppedCleanly ? previous.stoppedAt : null,
    shutdownRecorded,
    shutdownSource: journalShutdownRecorded === null ? 'bot-stop-record' : 'host-journal',
  };
}

/**
 * Persisted per-host state: `{ bootId, bootedAt, lastHeartbeatAt, stoppedAt }`.
 *
 * @param {Object} [options]
 * @param {string} [options.stateDir]
 * @param {Object} [options.fsImpl] - fs/promises-compatible
 * @param {Function} [options.now]
 * @param {Function} [options.readIdentity]
 * @param {Function} [options.readShutdownRecord]
 * @param {boolean} [options.verbose]
 */
export function createHostBootTracker({ stateDir = resolveBotStateDir(), fsImpl = fs, now = Date.now, readIdentity = () => readHostBootIdentity({ now }), readShutdownRecord = () => readPreviousBootShutdownRecord(), verbose = false } = {}) {
  const file = path.join(stateDir, HOST_BOOT_STATE_FILE);
  let identity = null;

  const load = async () => {
    try {
      return JSON.parse(await fsImpl.readFile(file, 'utf8'));
    } catch {
      return null;
    }
  };
  const save = async state => {
    try {
      await fsImpl.mkdir(stateDir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fsImpl.writeFile(tmp, JSON.stringify(state));
      await fsImpl.rename(tmp, file);
      return true;
    } catch (error) {
      if (verbose) console.log(`[VERBOSE] host-boot-state: could not write ${file}: ${error?.message || error}`);
      return false;
    }
  };
  const ensureIdentity = async () => (identity ||= await readIdentity());

  return {
    file,
    /**
     * Compare the last run's state with this boot, then record this boot so a
     * second bot restart in the same boot does not report the reboot again.
     * Never throws.
     *
     * @returns {Promise<Object|null>} The reboot event, or null
     */
    async detect() {
      try {
        const previous = await load();
        const current = await ensureIdentity();
        let event = detectHostReboot({ previous, current });
        if (event) event = detectHostReboot({ previous, current, journalShutdownRecorded: await readShutdownRecord() });
        if (verbose) console.log(`[VERBOSE] host-boot-state: previous=${JSON.stringify(previous)} current=${JSON.stringify(current)} reboot=${event ? JSON.stringify(event) : 'none'}`);
        await save({ bootId: current.bootId, bootedAt: current.bootedAt, lastHeartbeatAt: toIso(now()), stoppedAt: null });
        return event;
      } catch (error) {
        if (verbose) console.log(`[VERBOSE] host-boot-state: detection failed: ${error?.message || error}`);
        return null;
      }
    },
    /** Called with every bot heartbeat. */
    async recordHeartbeat() {
      const current = await ensureIdentity();
      return save({ bootId: current.bootId, bootedAt: current.bootedAt, lastHeartbeatAt: toIso(now()), stoppedAt: null });
    },
    /** Called when the bot stops on a signal (an orderly host shutdown sends SIGTERM). */
    async recordStop() {
      const current = await ensureIdentity();
      const at = toIso(now());
      return save({ bootId: current.bootId, bootedAt: current.bootedAt, lastHeartbeatAt: at, stoppedAt: at });
    },
  };
}

/**
 * Whether this session was still running when the host went down: it started
 * before the new boot and its log was written up to the last heartbeat.
 *
 * @param {Object} sessionInfo
 * @param {Object} event - detectHostReboot() result
 * @param {number|null} [logMtimeMs]
 * @returns {boolean}
 */
export function sessionRanIntoHostReboot(sessionInfo, event, logMtimeMs = null) {
  if (!event) return false;
  const startMs = parseMs(sessionInfo?.startTime);
  const bootedAtMs = parseMs(event.bootedAt);
  if (startMs !== null && bootedAtMs !== null && startMs >= bootedAtMs) return false;
  const lastHeartbeatMs = parseMs(event.lastHeartbeatAt);
  if (Number.isFinite(logMtimeMs) && lastHeartbeatMs !== null && logMtimeMs < lastHeartbeatMs - HOST_REBOOT_SESSION_SLACK_MS) return false;
  return true;
}

/**
 * Mark every session that was running when the host went down, so its kill
 * report names the reboot. All of them share one event and know how many tasks
 * it took down.
 *
 * @param {Object} options
 * @param {Array<{sessionName: string, sessionInfo: Object}>} options.sessions
 * @param {Object|null} options.event
 * @param {Function} [options.isHandled] - (sessionInfo) => boolean
 * @param {Function} [options.persist] - (sessionName, sessionInfo) => void
 * @param {Function} [options.statLog] - (logPath) => Promise<{mtimeMs}>
 * @param {boolean} [options.verbose]
 * @returns {Promise<string[]>} Names of the marked sessions
 */
export async function markSessionsEndedByHostReboot({ sessions = [], event = null, isHandled = () => false, persist = () => {}, statLog = file => fs.stat(file), verbose = false } = {}) {
  if (!event) return [];
  const affected = [];
  for (const entry of sessions) {
    const { sessionInfo } = entry;
    if (!sessionInfo || isHandled(sessionInfo) || sessionInfo.hostReboot) continue;
    let logMtimeMs = null;
    if (sessionInfo.logPath) {
      try {
        logMtimeMs = (await statLog(sessionInfo.logPath))?.mtimeMs ?? null;
      } catch {
        logMtimeMs = null;
      }
    }
    if (!sessionRanIntoHostReboot(sessionInfo, event, logMtimeMs)) {
      if (verbose) console.log(`[VERBOSE] host-reboot: ${entry.sessionName} was not running when the host went down (log last written ${toIso(logMtimeMs) || 'unknown'})`);
      continue;
    }
    affected.push({ ...entry, logMtimeMs });
  }
  const names = affected.map(entry => entry.sessionName);
  for (const { sessionName, sessionInfo, logMtimeMs } of affected) {
    const endedAtMs = Number.isFinite(logMtimeMs) && logMtimeMs <= (parseMs(event.bootedAt) ?? Infinity) ? logMtimeMs : parseMs(event.lastHeartbeatAt);
    sessionInfo.hostReboot = { ...event, sessionEndedAt: toIso(endedAtMs), affectedSessions: names.length, affectedSessionNames: names };
    persist(sessionName, sessionInfo);
    if (verbose) console.log(`[VERBOSE] host-reboot: ${sessionName} ended with the host at ${sessionInfo.hostReboot.sessionEndedAt || 'unknown'} (${names.length} task(s) affected)`);
  }
  return names;
}

/**
 * One-line cause for the notice and the Telegram message.
 *
 * @param {Object} hostReboot
 * @returns {string}
 */
export function describeHostRebootCause(hostReboot) {
  if (!hostReboot) return '';
  const kind = hostReboot.shutdownRecorded === false ? 'host hard reset (no shutdown recorded)' : 'host rebooted';
  const heartbeat = hostReboot.lastHeartbeatAt ? ` — last bot heartbeat before the outage at ${hostReboot.lastHeartbeatAt}` : '';
  const booted = hostReboot.bootedAt ? `${heartbeat ? ';' : ' —'} the host came back up at ${hostReboot.bootedAt}` : '';
  return `${kind}${heartbeat}${booted}`;
}

/**
 * "The host restarted; all N running tasks …" — the reboot is one event.
 *
 * @param {Object} hostReboot
 * @returns {string}
 */
export function describeHostRebootScope(hostReboot) {
  const count = Number(hostReboot?.affectedSessions) || 0;
  if (count <= 1) return 'The host restarted while this task was running; it was the only running task.';
  return `The host restarted; all ${count} running tasks ended at the same moment. This is one host event, not ${count} separate failures.`;
}
