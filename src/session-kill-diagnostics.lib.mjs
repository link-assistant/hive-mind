/**
 * Kill-cause diagnostics for work sessions (issue #2134).
 *
 * "Work session killed — out of memory **or** forced kill (SIGKILL)" was as much
 * as Hive Mind could say, because nothing ever looked at the machine state — even
 * though every ingredient was already being collected and thrown away:
 *
 *   - `src/solve.resource-diagnostics.lib.mjs` writes `📈 [RESOURCES]` markers
 *     (memory available/total, disk used percent) into every session log;
 *   - the bot records the same snapshot every heartbeat;
 *   - on Linux the kernel exposes the ground truth in
 *     `/sys/fs/cgroup/memory.events` (`oom`, `oom_kill`), `/proc/meminfo`,
 *     `/proc/pressure/memory` and the OOM killer's `dmesg` lines, which name the
 *     exact victim process.
 *
 * This module turns those into ONE explicit verdict — out of memory / disk full /
 * forced kill — with the evidence that produced it, so both the Telegram message
 * and the pull-request notice can say what actually happened. Every probe is
 * injectable and never throws: a diagnosis is a best-effort enrichment, never a
 * reason to fail a completion notification.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2134
 */

import fsPromises from 'fs/promises';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { t } from './i18n.lib.mjs';
import { formatBytes, formatHeapUsage, parseResourceMarkers } from './solve.resource-diagnostics.lib.mjs';
import { findFatalMemoryMarker } from './child-exit.lib.mjs';
import { readLogTextBounded } from './log-bounded-read.lib.mjs';

const exec = promisify(execCallback);

export const KILL_CAUSE_OUT_OF_MEMORY = 'out-of-memory';
export const KILL_CAUSE_DISK_FULL = 'disk-full';
export const KILL_CAUSE_FORCED_KILL = 'forced-kill';
export const KILL_CAUSE_UNKNOWN = 'unknown';

/** Memory is considered exhausted below this share of total RAM still available. */
export const MEMORY_EXHAUSTED_AVAILABLE_RATIO = 0.1;
/**
 * How much of a session log the kill diagnosis is allowed to read (issue #2189).
 * Split head/tail by {@link readLogTextBounded}: 512 KiB of the beginning and
 * 512 KiB of the end, which covers both the resource markers and the fatal exit.
 */
export const KILL_DIAGNOSTICS_LOG_BYTES = 1024 * 1024;
/**
 * A V8 heap this far into its own limit counts as memory exhaustion on its own
 * (issue #2189). The runtime aborts with "Reached heap limit" while the machine
 * still reports gigabytes free, so the host-memory ratio above never fires; the
 * heap markers are the only in-band signal, and the last one written before the
 * abort is typically already deep in the red.
 */
export const HEAP_EXHAUSTED_PERCENT = 90;

/**
 * Prefix start-command 0.33.0 puts on every `exitReason` that reports memory
 * exhaustion, whatever the mechanism — `memory-exhaustion (v8-heap-limit)`,
 * `memory-exhaustion (kernel-oom-killer)`, `memory-exhaustion (go-runtime)`,
 * `memory-exhaustion (allocation-failure)`. Matching the prefix rather than the
 * exact strings means a new upstream mechanism is classified correctly without
 * a Hive Mind release. See link-foundation/start#164 and #165.
 */
export const UPSTREAM_MEMORY_EXHAUSTION_PREFIX = 'memory-exhaustion';

/** Disk is considered full at or above this used percentage… */
export const DISK_FULL_USED_PERCENT = 95;
/** …or below this much free space, whichever triggers first. */
export const DISK_FULL_AVAILABLE_BYTES = 512 * 1024 * 1024;

function text(locale, key, fallback, params = {}) {
  if (!locale) return fallback;
  return t(key, params, { locale });
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

/**
 * The most recent `📈 [RESOURCES]` marker that carries usable memory data —
 * i.e. the closest reading to the moment the session died.
 *
 * @param {{markers: Array}|null} parsed - Output of parseResourceMarkers()
 * @returns {Object|null}
 */
export function selectLastMemoryResourceMarker(parsed) {
  const markers = Array.isArray(parsed?.markers) ? parsed.markers : [];
  for (let i = markers.length - 1; i >= 0; i--) {
    if (finite(markers[i]?.memory?.availableBytes) !== null) return markers[i];
  }
  return null;
}

/**
 * The most recent marker that carries a V8 heap reading (issue #2189). Older
 * logs have none — the heap fields were added with this fix — so every caller
 * must tolerate `null`.
 *
 * @param {{markers: Array}|null} parsed
 * @returns {Object|null}
 */
export function selectLastHeapResourceMarker(parsed) {
  const markers = Array.isArray(parsed?.markers) ? parsed.markers : [];
  for (let i = markers.length - 1; i >= 0; i--) {
    if (finite(markers[i]?.memory?.processHeapUsedBytes) !== null) return markers[i];
  }
  return null;
}

/**
 * The most recent marker that carries usable disk data.
 *
 * @param {{markers: Array}|null} parsed
 * @returns {Object|null}
 */
export function selectLastDiskResourceMarker(parsed) {
  const markers = Array.isArray(parsed?.markers) ? parsed.markers : [];
  for (let i = markers.length - 1; i >= 0; i--) {
    if (finite(markers[i]?.disk?.usedPercent) !== null || finite(markers[i]?.disk?.availableBytes) !== null) return markers[i];
  }
  return null;
}

function parseCgroupKeyedFile(content) {
  const out = {};
  for (const line of String(content || '').split(/\r?\n/)) {
    const match = /^(\S+)\s+(\d+)$/.exec(line.trim());
    if (match) out[match[1]] = Number(match[2]);
  }
  return out;
}

function parseMeminfo(content) {
  const fields = {};
  for (const line of String(content || '').split(/\r?\n/)) {
    const match = /^(\w+):\s+(\d+)\s*kB$/.exec(line.trim());
    if (match) fields[match[1]] = Number(match[2]) * 1024;
  }
  return {
    totalBytes: finite(fields.MemTotal),
    availableBytes: finite(fields.MemAvailable),
    swapTotalBytes: finite(fields.SwapTotal),
    swapFreeBytes: finite(fields.SwapFree),
  };
}

/**
 * Parse the kernel OOM killer's own report out of `dmesg` output. Both the
 * modern `oom-kill:...,task=<comm>,pid=<pid>` summary and the classic
 * `Killed process <pid> (<comm>)` line are recognised, because which one appears
 * depends on the kernel version.
 *
 * @param {string} dmesgText
 * @returns {Array<{pid: number|null, comm: string|null, line: string}>}
 */
export function parseOomVictims(dmesgText) {
  const victims = [];
  for (const line of String(dmesgText || '').split(/\r?\n/)) {
    const killed = /Killed process (\d+)\s+\(([^)]+)\)/.exec(line);
    if (killed) {
      victims.push({ pid: Number(killed[1]), comm: killed[2], line: line.trim() });
      continue;
    }
    const oomKill = /oom-kill:.*?task=([^,\s]+).*?pid=(\d+)/.exec(line);
    if (oomKill) {
      victims.push({ pid: Number(oomKill[2]), comm: oomKill[1], line: line.trim() });
    }
  }
  return victims;
}

/**
 * Read every kernel-side kill signal this machine exposes. Linux-only in
 * practice; on other platforms (or in a sandbox where the files are not
 * readable) the corresponding fields stay null and the reason is recorded in
 * `errors` so a `--verbose` run can show why a diagnosis was thin (R8/#2134).
 *
 * @param {Object} [options]
 * @param {Function} [options.readFile] - Injectable fs.promises.readFile
 * @param {Function} [options.execImpl] - Injectable promisified exec (for dmesg)
 * @param {boolean} [options.verbose]
 * @param {boolean} [options.includeDmesg=true]
 * @returns {Promise<Object>} System diagnostics (never throws)
 */
export async function collectSystemKillDiagnostics({ readFile = fsPromises.readFile, execImpl = exec, verbose = false, includeDmesg = true, cgroupPath = '/sys/fs/cgroup' } = {}) {
  const result = { cgroup: { oom: null, oomKill: null, maxBytes: null, currentBytes: null }, memory: { totalBytes: null, availableBytes: null, swapTotalBytes: null, swapFreeBytes: null }, pressure: null, victims: [], errors: [] };

  const readOptional = async (file, label) => {
    try {
      return await readFile(file, 'utf8');
    } catch (error) {
      result.errors.push(`${label}: ${error?.message || error}`);
      if (verbose) console.log(`[VERBOSE] kill-diagnostics: could not read ${file}: ${error?.message || error}`);
      return null;
    }
  };

  const events = await readOptional(`${cgroupPath}/memory.events`, 'cgroup memory.events');
  if (events) {
    const parsed = parseCgroupKeyedFile(events);
    result.cgroup.oom = finite(parsed.oom);
    result.cgroup.oomKill = finite(parsed.oom_kill);
  }
  const max = await readOptional(`${cgroupPath}/memory.max`, 'cgroup memory.max');
  if (max) {
    const trimmed = max.trim();
    result.cgroup.maxBytes = trimmed === 'max' ? null : finite(Number(trimmed));
  }
  const current = await readOptional(`${cgroupPath}/memory.current`, 'cgroup memory.current');
  if (current) result.cgroup.currentBytes = finite(Number(current.trim()));

  const meminfo = await readOptional('/proc/meminfo', '/proc/meminfo');
  if (meminfo) result.memory = parseMeminfo(meminfo);

  const pressure = await readOptional('/proc/pressure/memory', '/proc/pressure/memory');
  if (pressure) result.pressure = pressure.trim().split(/\r?\n/)[0] || null;

  if (includeDmesg) {
    try {
      const { stdout } = await execImpl('dmesg -T 2>/dev/null | grep -iE "out of memory|oom-kill|killed process" | tail -20', { timeout: 10000, maxBuffer: 1024 * 1024 });
      result.victims = parseOomVictims(stdout);
    } catch (error) {
      // A non-root container usually cannot read the kernel ring buffer, and
      // grep exits 1 when nothing matched. Both are normal, not failures.
      result.errors.push(`dmesg: ${error?.message || error}`);
      if (verbose) console.log(`[VERBOSE] kill-diagnostics: dmesg probe unavailable: ${error?.message || error}`);
    }
  }

  if (verbose) {
    console.log(`[VERBOSE] kill-diagnostics: cgroup oom=${result.cgroup.oom} oom_kill=${result.cgroup.oomKill}, mem available=${formatBytes(result.memory.availableBytes)}/${formatBytes(result.memory.totalBytes)}, victims=${result.victims.length}`);
  }
  return result;
}

function memoryRatio(memory) {
  const available = finite(memory?.availableBytes);
  const total = finite(memory?.totalBytes);
  if (available === null || total === null || total <= 0) return null;
  return available / total;
}

function describeMemory(memory, timestamp) {
  const available = finite(memory?.availableBytes);
  const total = finite(memory?.totalBytes);
  if (available === null || total === null) return null;
  const usedPercent = total > 0 ? (100 * (total - available)) / total : null;
  const at = timestamp ? ` at ${timestamp}` : '';
  return `${formatBytes(available)} of ${formatBytes(total)} RAM available${usedPercent === null ? '' : ` (${usedPercent.toFixed(1)}% used)`}${at}`;
}

function describeDisk(disk, timestamp) {
  const usedPercent = finite(disk?.usedPercent);
  const available = finite(disk?.availableBytes);
  if (usedPercent === null && available === null) return null;
  const at = timestamp ? ` at ${timestamp}` : '';
  const parts = [];
  if (available !== null) parts.push(`${formatBytes(available)} free`);
  if (finite(disk?.totalBytes) !== null) parts.push(`of ${formatBytes(disk.totalBytes)}`);
  if (usedPercent !== null) parts.push(`(${usedPercent.toFixed(1)}% used)`);
  return `disk ${disk?.path || '/'}: ${parts.join(' ')}${at}`;
}

/**
 * Decide WHY a session was killed, from the evidence available.
 *
 * The order encodes confidence: a kernel OOM report or a container OOM flag is
 * proof; a resource marker showing exhausted memory/disk is strong
 * circumstantial evidence; a signal exit with healthy resources is a forced
 * kill (an operator, a supervisor, or `docker stop`).
 *
 * @param {Object} [params]
 * @param {string} [params.logText] - Session log text (parsed for markers)
 * @param {Object} [params.resourceMarkers] - Pre-parsed parseResourceMarkers() output
 * @param {boolean} [params.oomKilled] - Docker `State.OOMKilled`
 * @param {number|null} [params.exitCode]
 * @param {Object|null} [params.system] - collectSystemKillDiagnostics() result
 * @param {boolean} [params.stopRequestedByUser] - The operator asked for the stop
 * @param {boolean|null} [params.reportedMemoryExhausted] - `$ --status` `memoryExhausted` (start-command >= 0.33.0)
 * @param {string|null} [params.reportedMemoryExhaustedReason] - `$ --status` `memoryExhaustedReason` (the evidence line)
 * @param {string|null} [params.reportedExitReason] - `$ --status` `exitReason` hint, e.g. `memory-exhaustion (v8-heap-limit)`
 * @returns {{cause: string, summary: string, evidence: string[], memory: Object|null, disk: Object|null, victims: Array}}
 */
export function describeKillCause({ logText = null, resourceMarkers = null, oomKilled = false, exitCode = null, system = null, stopRequestedByUser = false, reportedMemoryExhausted = null, reportedMemoryExhaustedReason = null, reportedExitReason = null } = {}) {
  const parsed = resourceMarkers || (logText ? parseResourceMarkers(logText) : { markers: [], byPhase: {} });
  const memoryMarker = selectLastMemoryResourceMarker(parsed);
  const heapMarker = selectLastHeapResourceMarker(parsed);
  const diskMarker = selectLastDiskResourceMarker(parsed);
  const memory = memoryMarker?.memory || null;
  const disk = diskMarker?.disk || null;
  const victims = Array.isArray(system?.victims) ? system.victims : [];
  const cgroupOomKills = finite(system?.cgroup?.oomKill);

  const evidence = [];
  const memoryLine = describeMemory(memory, memoryMarker?.timestamp || null);
  if (memoryLine) evidence.push(`last session memory reading — ${memoryLine} (phase \`${memoryMarker.phase}\`)`);
  // Issue #2189: report the heap against its own limit, which is the number that
  // decides a "JavaScript heap out of memory" abort — host RAM does not.
  const heapMemory = heapMarker?.memory || null;
  const heapUsedPercent = finite(heapMemory?.processHeapUsedPercent);
  const heapLine = heapMemory ? `${formatHeapUsage(heapMemory)}${heapMarker?.timestamp ? ` at ${heapMarker.timestamp}` : ''}` : null;
  if (heapLine) evidence.push(`last session V8 heap reading — ${heapLine} (phase \`${heapMarker.phase}\`)`);
  const diskLine = describeDisk(disk, diskMarker?.timestamp || null);
  if (diskLine) evidence.push(`last session ${diskLine} (phase \`${diskMarker.phase}\`)`);
  if (oomKilled) evidence.push('container reports `State.OOMKilled = true` (an OOM event hit the container cgroup)');
  if (cgroupOomKills !== null && cgroupOomKills > 0) evidence.push(`cgroup \`memory.events\` reports ${cgroupOomKills} OOM kill(s)`);
  const systemMemoryLine = describeMemory(system?.memory, null);
  if (systemMemoryLine) evidence.push(`host memory now — ${systemMemoryLine}`);
  if (system?.pressure) evidence.push(`\`/proc/pressure/memory\`: ${system.pressure}`);
  for (const victim of victims.slice(-3)) {
    evidence.push(`kernel OOM killer terminated \`${victim.comm || 'unknown'}\` (pid ${victim.pid ?? '?'})`);
  }

  // Issue #2189: the ground truth for a runtime that exhausted its OWN heap is
  // the fatal line it printed, not the cgroup counters — those legitimately read
  // zero for a V8 self-abort. Only an abnormal ending is allowed to be upgraded,
  // so a log that merely mentions the phrase cannot manufacture a diagnosis.
  const abnormalExit = exitCode === null || exitCode !== 0;
  const fatalMemoryMarker = abnormalExit ? findFatalMemoryMarker(logText) : null;
  if (fatalMemoryMarker) {
    evidence.push(`the ${fatalMemoryMarker.runtime} runtime aborted on its own heap limit: \`${fatalMemoryMarker.line}\` (a self-abort is invisible to \`docker inspect\` and to cgroup OOM counters)`);
  }

  // Issue #2189 also went upstream: start-command 0.33.0 (link-foundation/start
  // #164, #165) performs the same tail scan inside `$` and reports it as
  // `memoryExhausted` / `memoryExhaustedReason` / `exitReason`. Consuming it
  // catches the case our own scan cannot: the fatal line scrolled out of the
  // bounded window we read, but `$` saw it when the command exited. The local
  // scan stays as defense in depth — these fields are absent on an older `$`.
  const reportedExitReasonText = typeof reportedExitReason === 'string' && reportedExitReason.trim() ? reportedExitReason.trim() : null;
  const reportedMemoryExhaustion = abnormalExit && (reportedMemoryExhausted === true || (reportedExitReasonText !== null && reportedExitReasonText.startsWith(UPSTREAM_MEMORY_EXHAUSTION_PREFIX)));
  // `memory-exhaustion (v8-heap-limit)` → `v8-heap-limit`: the prefix is already
  // said in words by the surrounding sentence, so only the mechanism is new.
  const reportedMechanism =
    reportedMemoryExhaustion && reportedExitReasonText
      ? reportedExitReasonText
          .slice(UPSTREAM_MEMORY_EXHAUSTION_PREFIX.length)
          .trim()
          .replace(/^\((.*)\)$/, '$1') || null
      : null;
  if (reportedMemoryExhaustion) {
    const detail = reportedMemoryExhaustedReason ? `: \`${reportedMemoryExhaustedReason}\`` : '';
    evidence.push(`\`$ --status\` reports memory exhaustion${reportedMechanism ? ` (\`${reportedMechanism}\`)` : ''}${detail}`);
  } else if (reportedExitReasonText && abnormalExit) {
    evidence.push(`\`$ --status\` reports \`exitReason = ${reportedExitReasonText}\``);
  }

  const ratio = memoryRatio(memory);
  const memoryExhausted = ratio !== null && ratio <= MEMORY_EXHAUSTED_AVAILABLE_RATIO;
  // A heap already at the limit is only evidence of a kill when the session
  // actually ended abnormally — a healthy run may legitimately end near its cap.
  const heapExhausted = abnormalExit && heapUsedPercent !== null && heapUsedPercent >= HEAP_EXHAUSTED_PERCENT;
  const diskUsedPercent = finite(disk?.usedPercent);
  const diskAvailable = finite(disk?.availableBytes);
  const diskFull = (diskUsedPercent !== null && diskUsedPercent >= DISK_FULL_USED_PERCENT) || (diskAvailable !== null && diskAvailable <= DISK_FULL_AVAILABLE_BYTES);

  let cause = KILL_CAUSE_UNKNOWN;
  if (stopRequestedByUser) {
    cause = KILL_CAUSE_FORCED_KILL;
  } else if (victims.length > 0 || (cgroupOomKills !== null && cgroupOomKills > 0) || oomKilled || memoryExhausted || fatalMemoryMarker || heapExhausted || reportedMemoryExhaustion) {
    cause = KILL_CAUSE_OUT_OF_MEMORY;
  } else if (diskFull) {
    cause = KILL_CAUSE_DISK_FULL;
  } else if (exitCode !== null && exitCode > 128) {
    cause = KILL_CAUSE_FORCED_KILL;
  }

  let summary;
  if (cause === KILL_CAUSE_OUT_OF_MEMORY && fatalMemoryMarker && victims.length === 0 && !oomKilled && !(cgroupOomKills > 0)) {
    // Issue #2189: appending "10.3 GB of 11.7 GB RAM available" to "out of
    // memory" reads as a contradiction. For a runtime self-abort the host being
    // healthy is the whole point, so say which limit was actually hit.
    summary = `out of memory — the ${fatalMemoryMarker.runtime} runtime hit its own heap limit, not the machine's: \`${fatalMemoryMarker.line}\`${memoryLine ? ` (host memory was fine: ${memoryLine})` : ''}`;
  } else if (cause === KILL_CAUSE_OUT_OF_MEMORY && heapExhausted && victims.length === 0 && !oomKilled && !(cgroupOomKills > 0) && !memoryExhausted) {
    // Same shape as the fatal-marker case, but reconstructed from telemetry when
    // the fatal line itself was lost (truncated tail, killed before flushing).
    summary = `out of memory — the runtime's own heap was exhausted: ${heapLine}${memoryLine ? ` (host memory was fine: ${memoryLine})` : ''}`;
  } else if (cause === KILL_CAUSE_OUT_OF_MEMORY && reportedMemoryExhaustion && victims.length === 0 && !oomKilled && !(cgroupOomKills > 0) && !memoryExhausted) {
    // Only `$` saw the evidence (our bounded window missed the fatal line).
    // Quote what it saw rather than falling back to the host-memory phrasing,
    // which would again read as a contradiction on a healthy machine.
    summary = `out of memory — start-command reported memory exhaustion${reportedMechanism ? ` (${reportedMechanism})` : ''}${reportedMemoryExhaustedReason ? `: \`${reportedMemoryExhaustedReason}\`` : ''}${memoryLine ? ` (host memory was fine: ${memoryLine})` : ''}`;
  } else if (cause === KILL_CAUSE_OUT_OF_MEMORY) {
    const victim = victims.length > 0 ? `, kernel OOM killer terminated \`${victims[victims.length - 1].comm || 'unknown'}\` (pid ${victims[victims.length - 1].pid ?? '?'})` : '';
    summary = `out of memory${memoryLine ? ` — ${memoryLine}` : ''}${victim}`;
  } else if (cause === KILL_CAUSE_DISK_FULL) {
    summary = `disk full${diskLine ? ` — ${diskLine}` : ''}`;
  } else if (cause === KILL_CAUSE_FORCED_KILL) {
    const healthy = [memoryLine ? `memory (${memoryLine})` : null, diskLine ? diskLine : null].filter(Boolean).join(', ');
    summary = stopRequestedByUser ? 'forced kill — an operator requested the stop' : `forced kill${healthy ? ` — ${healthy} were within normal limits` : ' — no resource exhaustion was observed'}`;
  } else {
    summary = 'unknown — no resource marker, cgroup counter or kernel OOM report was available';
  }

  return { cause, summary, evidence, memory, heap: heapMemory, heapUsedPercent, disk, victims, fatalMemoryMarker, reportedMemoryExhaustion, reportedExitReason: reportedExitReasonText };
}

/**
 * Telegram/PR section describing why the session was killed.
 *
 * @param {Object} diagnosis - describeKillCause() result
 * @param {Object} [options]
 * @param {string|null} [options.locale]
 * @returns {string} Markdown block, or '' when there is nothing to report
 */
export function formatKillDiagnosticsSection(diagnosis, { locale = null } = {}) {
  if (!diagnosis || diagnosis.cause === KILL_CAUSE_UNKNOWN) {
    if (!diagnosis?.evidence?.length) return '';
  }
  const title = text(locale, 'telegram.session_kill_diagnostics', 'Kill diagnostics');
  const causeLabel = text(locale, 'telegram.session_kill_cause', 'Cause');
  const lines = [`🔎 *${title}*`, `${causeLabel}: ${diagnosis.summary}`];
  for (const item of diagnosis.evidence) lines.push(`• ${item}`);
  return lines.join('\n');
}

/**
 * The warning the issue asks for: a session that hit an out-of-memory event (or
 * any other kill) and nevertheless completed must say so, instead of reading as
 * an ordinary success.
 *
 * @param {Object} [options]
 * @param {string} [options.cause] - Kill cause constant
 * @param {string|null} [options.observedAt] - When the event was observed
 * @param {string|null} [options.locale]
 * @param {boolean} [options.resumed] - A new working session was started
 * @returns {string} Markdown block, or '' when nothing was recovered from
 */
export function formatKillRecoverySection({ cause = KILL_CAUSE_OUT_OF_MEMORY, observedAt = null, locale = null, resumed = false } = {}) {
  const key = cause === KILL_CAUSE_OUT_OF_MEMORY ? 'telegram.session_recovered_oom' : 'telegram.session_recovered_kill';
  const fallback = cause === KILL_CAUSE_OUT_OF_MEMORY ? 'recovered from out of memory' : 'recovered from forced kill';
  const lines = [`⚠️ *${text(locale, key, fallback)}*`];
  if (observedAt) {
    lines.push(text(locale, 'telegram.session_recovered_at', `The event was observed at ${observedAt}; the work session kept running and completed.`, { observedAt }));
  }
  if (resumed) {
    lines.push(text(locale, 'telegram.session_recovered_resumed', 'A new working session was started to recover from the kill.'));
  }
  return lines.join('\n');
}

/**
 * The counterpart for a session that did NOT survive: `--on-session-kill=resume`
 * started a fresh working session, and the Telegram report must say so with the
 * same words the pull-request notice uses — that is the "consistent in ALL
 * places" requirement of issue #2134.
 *
 * @param {Object} [options]
 * @param {string|null} [options.sessionId] - Id of the recovery working session
 * @param {number|null} [options.attempt]
 * @param {number|null} [options.maxAttempts]
 * @param {string|null} [options.locale]
 * @returns {string} Markdown block, or '' when no recovery session was started
 */
export function formatKillResumeSection({ sessionId = null, attempt = null, maxAttempts = null, locale = null } = {}) {
  if (!sessionId) return '';
  const withAttempt = Number.isFinite(attempt) && Number.isFinite(maxAttempts);
  const attemptText = withAttempt ? `${attempt}/${maxAttempts}` : '';
  const key = withAttempt ? 'telegram.session_kill_resumed_attempt' : 'telegram.session_kill_resumed';
  const fallback = withAttempt ? `🔄 A new working session was started to recover from this kill (attempt ${attemptText}): ${sessionId}` : `🔄 A new working session was started to recover from this kill: ${sessionId}`;
  return text(locale, key, fallback, { attempt: attemptText, sessionId });
}

/**
 * Read a session log, diagnose the kill and render the Telegram section in one
 * call. Never throws — returns '' when nothing can be said.
 *
 * @param {string|null} logPath
 * @param {Object} [options]
 * @returns {Promise<{section: string, diagnosis: Object|null}>}
 */
export async function buildKillDiagnosticsSection(logPath, { verbose = false, readFile = fsPromises.readFile, maxLogBytes = KILL_DIAGNOSTICS_LOG_BYTES, oomKilled = false, exitCode = null, stopRequestedByUser = false, locale = null, collectSystem = collectSystemKillDiagnostics, reportedMemoryExhausted = null, reportedMemoryExhaustedReason = null, reportedExitReason = null } = {}) {
  try {
    let logText = '';
    if (logPath) {
      // Issue #2189: this used to be `readFile(logPath, 'utf8')`. The bot ran it
      // once per monitor tick for a session it never marked handled, so a 134 MB
      // transcript was pulled into the bot's own heap over and over. Everything
      // this function needs — the `📈 [RESOURCES]` markers and the runtime's
      // dying `FATAL ERROR` line — lives at the two ends of the transcript.
      logText = await readLogTextBounded(logPath, { readFile, maxBytes: maxLogBytes, verbose });
    }
    const system = await collectSystem({ verbose });
    const diagnosis = describeKillCause({ logText, oomKilled, exitCode, system, stopRequestedByUser, reportedMemoryExhausted, reportedMemoryExhaustedReason, reportedExitReason });
    if (verbose) console.log(`[VERBOSE] kill-diagnostics: cause=${diagnosis.cause} — ${diagnosis.summary}`);
    return { section: formatKillDiagnosticsSection(diagnosis, { locale }), diagnosis };
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] kill-diagnostics: diagnosis failed: ${error?.message || error}`);
    return { section: '', diagnosis: null };
  }
}
