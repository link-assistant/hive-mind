#!/usr/bin/env node

/**
 * Regression: the V8 heap must be observable while the process is still alive.
 *
 * Incident (issue #2189): the run that died with
 *
 *   FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
 *
 * left exactly three `📈 [RESOURCES]` markers in 429,803 log lines —
 * `solve_start` (RSS 109 MB), `after_clone` (RSS 90 MB) and `after_agent`
 * (RSS 373 MB at 13:57:07Z). The fatal error came ten minutes later, at
 * 14:07:47Z, during `--attach-logs`. The phase that actually died was
 * untelemetered, and the markers that did exist reported RSS against *total
 * RAM* — a comparison that can never explain a V8 self-abort, because the
 * machine still had 10.3 GB of 11.7 GB free. The diagnosis came out as
 * "forced kill", and the post-mortem had nothing better to work with.
 *
 * Two gaps are closed here, both required by the issue's follow-up comment
 * ("If there is not enough data to find actual root cause, add debug output and
 * verbose mode"):
 *
 *   1. Every snapshot carries the used heap AND `heap_size_limit`, so the one
 *      ratio that decides an abort is in the log, with a warning once the heap
 *      is close enough to its limit to be the next failure.
 *   2. `attachLogToGitHub` brackets itself with `log_upload_start` /
 *      `log_upload_end` samples on every exit path, so the ten-minute blind
 *      spot cannot recur.
 *
 * And the payoff: `describeKillCause` can now reconstruct "out of memory" from
 * the telemetry alone, for the case where the fatal line itself was lost.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';
import { HEAP_PRESSURE_WARN_PERCENT, RESOURCE_PHASE_LOG_UPLOAD_END, RESOURCE_PHASE_LOG_UPLOAD_START, buildResourceMarker, captureResourceSnapshot, formatHeapUsage, formatResourceSnapshotForLog, isHeapUnderPressure, parseResourceMarkers, summarizeResourceSnapshot } from '../src/solve.resource-diagnostics.lib.mjs';
import { HEAP_EXHAUSTED_PERCENT, KILL_CAUSE_FORCED_KILL, KILL_CAUSE_OUT_OF_MEMORY, describeKillCause, selectLastHeapResourceMarker } from '../src/session-kill-diagnostics.lib.mjs';
import { attachLogToGitHub } from '../src/github.lib.mjs';
import { createHeartbeat } from '../src/bot-lifecycle.lib.mjs';

const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-2189-heap-'));
const tmp = name => path.join(workDir, name);

// The incident's own numbers: node's default old-space cap on that box, and the
// host that was reported as healthy while the runtime was dying.
const HEAP_LIMIT = 2197815296; // ~2.05 GiB, what v8.getHeapStatistics() returns for a default node 20
const HOST_TOTAL = 12541493248; // 11.7 GB
const HOST_AVAILABLE = 11059591086; // 10.3 GB

console.log('================================================================================');
console.log('Regression: V8 heap telemetry and log-upload phase sampling (#2189)');
console.log('================================================================================\n');

// ---------------------------------------------------------------------------
// 1. Every snapshot carries used heap and the heap limit
// ---------------------------------------------------------------------------
console.log('1. captureResourceSnapshot reports the heap against its own limit\n');

const stubbedSnapshot = captureResourceSnapshot({
  phase: RESOURCE_PHASE_LOG_UPLOAD_START,
  processImpl: { ...process, memoryUsage: () => ({ rss: 1_900_000_000, heapUsed: 2_020_000_000, heapTotal: 2_090_000_000, external: 12_000_000 }) },
  v8Impl: { getHeapStatistics: () => ({ heap_size_limit: HEAP_LIMIT }) },
});
assert(stubbedSnapshot.memory.processHeapUsedBytes === 2_020_000_000, 'the used heap is captured');
assert(stubbedSnapshot.memory.processHeapLimitBytes === HEAP_LIMIT, 'the heap limit is captured — the number that decides the abort');
assert(stubbedSnapshot.memory.processHeapTotalBytes === 2_090_000_000, 'the allocated heap is captured');
assert(stubbedSnapshot.memory.processExternalBytes === 12_000_000, 'external (off-heap buffer) memory is captured');
assert(Math.abs(stubbedSnapshot.memory.processHeapUsedPercent - 91.9) < 0.2, `the used share of the heap limit is derived (${stubbedSnapshot.memory.processHeapUsedPercent})`);

// A runtime without heap statistics must degrade to nulls, not throw: the
// telemetry is diagnostic and may never take a run down itself.
const noV8 = captureResourceSnapshot({
  phase: 'snapshot',
  v8Impl: {
    getHeapStatistics: () => {
      throw new Error('unavailable');
    },
  },
});
assert(noV8.memory.processHeapLimitBytes === null, 'a runtime with no heap statistics reports a null limit');
assert(noV8.memory.processHeapUsedPercent === null, 'no limit means no percentage rather than a bogus one');
assert(formatHeapUsage(noV8.memory).startsWith(`${Math.round(noV8.memory.processHeapUsedBytes / 1024 / 1024)} MB used`), 'the used heap is still reported without a limit');

// The real runtime must produce real numbers — this is what ships in the logs.
const liveSnapshot = captureResourceSnapshot({ phase: 'snapshot' });
assert(Number.isFinite(liveSnapshot.memory.processHeapLimitBytes) && liveSnapshot.memory.processHeapLimitBytes > 0, `the live heap limit is a real number (${liveSnapshot.memory.processHeapLimitBytes})`);
assert(Number.isFinite(liveSnapshot.memory.processHeapUsedPercent), 'the live heap percentage is a real number');

// ---------------------------------------------------------------------------
// 2. The marker round-trips the heap fields
// ---------------------------------------------------------------------------
console.log('\n2. Marker round trip\n');

const marker = buildResourceMarker(stubbedSnapshot);
assert(marker.includes(`processHeapUsedBytes=${2_020_000_000}`), 'the marker carries the used heap');
assert(marker.includes(`processHeapLimitBytes=${HEAP_LIMIT}`), 'the marker carries the heap limit');
assert(marker.includes('heap='), 'the marker carries a human-readable heap summary next to mem= and disk=');

const roundTripped = parseResourceMarkers(`some log line\n${marker}\ntrailing line\n`);
const parsedMemory = roundTripped.byPhase[RESOURCE_PHASE_LOG_UPLOAD_START].memory;
assert(parsedMemory.processHeapUsedBytes === 2_020_000_000, 'the parser recovers the used heap');
assert(parsedMemory.processHeapLimitBytes === HEAP_LIMIT, 'the parser recovers the heap limit');
assert(Math.abs(parsedMemory.processHeapUsedPercent - 91.9) < 0.2, 'the parser recovers the used share');

// Markers written before this fix have no heap fields at all; they must parse
// to nulls rather than break the diagnosis of an old log.
const legacy = parseResourceMarkers('📈 [RESOURCES] phase=after_agent ts=2026-09-02T13%3A57%3A07.000Z processRssBytes=391118848 memTotalBytes=12541493248');
assert(legacy.byPhase.after_agent.memory.processRssBytes === 391118848, 'a pre-fix marker still parses');
assert(legacy.byPhase.after_agent.memory.processHeapUsedBytes === null, 'a pre-fix marker reports a null heap rather than failing');
assert(selectLastHeapResourceMarker(legacy) === null, 'there is no heap marker to select in a pre-fix log');

const summarized = summarizeResourceSnapshot(stubbedSnapshot);
assert(summarized.memory.processHeapLimitBytes === HEAP_LIMIT, 'the compact heartbeat summary carries the heap limit too');

// ---------------------------------------------------------------------------
// 3. Heap pressure is called out while the process can still print it
// ---------------------------------------------------------------------------
console.log('\n3. Heap pressure warning\n');

assert(HEAP_PRESSURE_WARN_PERCENT === 85, 'the warning threshold is documented as 85%');
assert(isHeapUnderPressure({ processHeapUsedPercent: 91.9 }), 'a heap at 91.9% of its limit is under pressure');
assert(!isHeapUnderPressure({ processHeapUsedPercent: 40 }), 'a heap at 40% is not');
assert(!isHeapUnderPressure({}), 'an unknown heap is never reported as pressure');

const pressureText = formatResourceSnapshotForLog(stubbedSnapshot);
assert(pressureText.includes('V8 heap: 1.9 GB used of 2.0 GB limit (91.9%)'), `the human line states used-of-limit: ${JSON.stringify(pressureText.split('\n')[3])}`);
assert(pressureText.includes('JavaScript heap out of memory'), 'the warning names the abort that is about to happen');

const calmSnapshot = captureResourceSnapshot({
  phase: 'snapshot',
  processImpl: { ...process, memoryUsage: () => ({ rss: 200_000_000, heapUsed: 100_000_000, heapTotal: 120_000_000, external: 1_000_000 }) },
  v8Impl: { getHeapStatistics: () => ({ heap_size_limit: HEAP_LIMIT }) },
});
assert(!formatResourceSnapshotForLog(calmSnapshot).includes('⚠️'), 'a healthy heap prints no warning');

// ---------------------------------------------------------------------------
// 4. The kill diagnosis can reconstruct the OOM from telemetry alone
// ---------------------------------------------------------------------------
console.log('\n4. Kill classification from heap markers\n');

const healthySystem = { cgroup: { oom: 0, oomKill: 0 }, memory: { totalBytes: HOST_TOTAL, availableBytes: HOST_AVAILABLE }, victims: [], pressure: null };
const heapMarkerLine = buildResourceMarker({
  phase: RESOURCE_PHASE_LOG_UPLOAD_START,
  timestamp: '2026-09-02T14:02:00.000Z',
  cpu: {},
  memory: { totalBytes: HOST_TOTAL, availableBytes: HOST_AVAILABLE, usedBytes: HOST_TOTAL - HOST_AVAILABLE, processRssBytes: 2_100_000_000, processHeapUsedBytes: 2_060_000_000, processHeapLimitBytes: HEAP_LIMIT, processHeapUsedPercent: 93.7 },
  disk: { path: '/', totalBytes: 206900281344, availableBytes: 133189214208, usedBytes: 73694289920, usedPercent: 35.6 },
});

// This is the incident with its fatal line lost — killed before the tail was
// flushed. Only the telemetry survives, and it is enough.
const fromTelemetry = describeKillCause({ logText: `${heapMarkerLine}\n`, oomKilled: false, exitCode: 139, system: healthySystem });
assert(fromTelemetry.cause === KILL_CAUSE_OUT_OF_MEMORY, `a heap at 93.7% of its limit plus a signal exit is an OOM, not a forced kill (got ${fromTelemetry.cause})`);
assert(fromTelemetry.summary.includes("runtime's own heap was exhausted"), `the summary says which limit was hit: ${fromTelemetry.summary}`);
assert(fromTelemetry.summary.includes('host memory was fine'), 'the summary explains why the host looked healthy instead of contradicting itself');
assert(
  fromTelemetry.evidence.some(line => line.includes('V8 heap reading')),
  `the heap reading is listed as evidence: ${JSON.stringify(fromTelemetry.evidence)}`
);
assert(Math.abs(fromTelemetry.heapUsedPercent - 93.7) < 0.2, 'the diagnosis exposes the heap share it classified on');

// The same telemetry on a clean exit is not a kill at all.
const cleanExit = describeKillCause({ logText: `${heapMarkerLine}\n`, oomKilled: false, exitCode: 0, system: healthySystem });
assert(cleanExit.cause !== KILL_CAUSE_OUT_OF_MEMORY, `a session that exited 0 near its heap limit is not an OOM (got ${cleanExit.cause})`);

// A comfortable heap leaves the forced-kill verdict untouched.
const comfortable = buildResourceMarker({
  phase: 'after_agent',
  timestamp: '2026-09-02T13:57:07.000Z',
  cpu: {},
  memory: { totalBytes: HOST_TOTAL, availableBytes: HOST_AVAILABLE, usedBytes: HOST_TOTAL - HOST_AVAILABLE, processRssBytes: 391118848, processHeapUsedBytes: 120_000_000, processHeapLimitBytes: HEAP_LIMIT, processHeapUsedPercent: 5.5 },
  disk: { path: '/', totalBytes: 206900281344, availableBytes: 133189214208, usedBytes: 73694289920, usedPercent: 35.6 },
});
const stillForced = describeKillCause({ logText: `${comfortable}\n`, oomKilled: false, exitCode: 137, system: healthySystem });
assert(stillForced.cause === KILL_CAUSE_FORCED_KILL, `a small heap plus a signal exit is still a forced kill (got ${stillForced.cause})`);
assert(HEAP_EXHAUSTED_PERCENT === 90, 'the classification threshold is documented as 90%');

// ---------------------------------------------------------------------------
// 5. attachLogToGitHub brackets itself with samples on every exit path
// ---------------------------------------------------------------------------
console.log('\n5. Log-upload phase sampling\n');

const smallLog = tmp('small.log');
await fs.writeFile(smallLog, 'a short transcript with nothing secret in it\n'.repeat(20), 'utf8');

const phases = [];
const messages = [];
const failingAttach = await attachLogToGitHub({
  logFile: smallLog,
  targetType: 'pr',
  targetNumber: 42,
  owner: 'link-assistant',
  repo: 'hive-mind',
  // Never reaches the network: every gh call answers "failed" locally.
  $: (...args) => (Array.isArray(args[0]?.raw) ? Promise.resolve({ code: 1, stdout: '', stderr: 'stubbed, no network in tests' }) : (...inner) => (Array.isArray(inner[0]?.raw) ? Promise.resolve({ code: 1, stdout: '', stderr: 'stubbed, no network in tests' }) : undefined)),
  log: async message => messages.push(String(message)),
  recordResources: async ({ phase, label }) => {
    phases.push({ phase, label });
    return null;
  },
});
assert(failingAttach === false, 'the stubbed gh failure is reported as a failed attach');
assert(phases.length === 2, `the upload is bracketed by exactly two samples (got ${JSON.stringify(phases)})`);
assert(phases[0].phase === RESOURCE_PHASE_LOG_UPLOAD_START, 'the first sample is taken before any of the log is read');
assert(phases[0].label.includes('log upload start') && /\d+KB|\d+MB/.test(phases[0].label), `the entry sample is labelled with the log size: ${phases[0].label}`);
assert(phases[1].phase === RESOURCE_PHASE_LOG_UPLOAD_END, 'the closing sample runs even though the attach failed');

// An empty log short-circuits before any work — and therefore before any phase.
const emptyLog = tmp('empty.log');
await fs.writeFile(emptyLog, '', 'utf8');
const emptyPhases = [];
const emptyResult = await attachLogToGitHub({
  logFile: emptyLog,
  targetType: 'pr',
  targetNumber: 42,
  owner: 'link-assistant',
  repo: 'hive-mind',
  $: () => async () => ({ code: 0, stdout: '', stderr: '' }),
  log: async () => {},
  recordResources: async ({ phase }) => {
    emptyPhases.push(phase);
    return null;
  },
});
assert(emptyResult === false, 'an empty log is not attached');
assert(emptyPhases.length === 0, `no upload happened, so no upload phase is sampled (got ${JSON.stringify(emptyPhases)})`);

// Telemetry may never change the outcome of an upload.
const throwingPhases = [];
const survivedTelemetryFailure = await attachLogToGitHub({
  logFile: smallLog,
  targetType: 'pr',
  targetNumber: 42,
  owner: 'link-assistant',
  repo: 'hive-mind',
  $: () => async () => ({ code: 1, stdout: '', stderr: 'stubbed' }),
  log: async () => {},
  recordResources: async ({ phase }) => {
    throwingPhases.push(phase);
    throw new Error('telemetry exploded');
  },
});
assert(throwingPhases.includes(RESOURCE_PHASE_LOG_UPLOAD_END), 'the closing sample is still attempted when the opening one threw');
assert(survivedTelemetryFailure === false, 'a telemetry failure does not turn into a crash — the upload result stands');

// ---------------------------------------------------------------------------
// 6. The bot warns about its own heap before it dies of it
// ---------------------------------------------------------------------------
console.log('\n6. Bot heartbeat heap pressure\n');

const beats = [];
const warnings = [];
const heartbeatLogger = { heartbeat: data => beats.push(data), warn: (message, meta) => warnings.push({ message, meta }), event() {}, error() {}, debug() {}, info() {} };
const noopTimers = { setInterval: () => ({ unref: () => {} }), clearInterval: () => {} };
const pressuredHeartbeat = createHeartbeat({
  logger: heartbeatLogger,
  getActiveSessionCount: () => 1,
  processImpl: { uptime: () => 660 }, // the incident bot: up 11 minutes, one dead session
  setIntervalImpl: noopTimers.setInterval,
  clearIntervalImpl: noopTimers.clearInterval,
  // 1.84 GB of a 2.05 GB cap — the exact reading from the issue's follow-up.
  captureResources: () => ({ phase: 'bot_heartbeat', timestamp: '2026-09-03T06:00:00.000Z', cpu: {}, memory: { totalBytes: HOST_TOTAL, availableBytes: HOST_AVAILABLE, usedBytes: HOST_TOTAL - HOST_AVAILABLE, processRssBytes: 1_975_684_301, processHeapUsedBytes: 1_975_684_301, processHeapLimitBytes: HEAP_LIMIT, processHeapUsedPercent: 89.9 }, disk: { path: '/', totalBytes: 100, availableBytes: 75, usedBytes: 25, usedPercent: 25, error: null } }),
});
pressuredHeartbeat.beat();
assert(beats.length === 1 && beats[0].resources.memory.processHeapLimitBytes === HEAP_LIMIT, 'the heartbeat records the bot heap against its limit');
assert(warnings.length === 1, `a bot heap at 89.9% of its cap raises exactly one warning per beat (got ${warnings.length})`);
assert(warnings[0].message.includes('1.8 GB used of 2.0 GB limit'), `the warning quotes the reading: ${warnings[0].message}`);

const calmBeats = [];
const calmWarnings = [];
createHeartbeat({
  logger: { heartbeat: data => calmBeats.push(data), warn: message => calmWarnings.push(message), event() {}, error() {}, debug() {}, info() {} },
  getActiveSessionCount: () => 0,
  processImpl: { uptime: () => 10 },
  setIntervalImpl: noopTimers.setInterval,
  clearIntervalImpl: noopTimers.clearInterval,
  captureResources: () => ({ phase: 'bot_heartbeat', timestamp: '2026-09-03T06:00:00.000Z', cpu: {}, memory: { processHeapUsedBytes: 100_000_000, processHeapLimitBytes: HEAP_LIMIT, processHeapUsedPercent: 4.6 }, disk: { path: '/' } }),
}).beat();
assert(calmBeats.length === 1 && calmWarnings.length === 0, 'a healthy bot heap beats without a warning');

await fs.rm(workDir, { recursive: true, force: true });

printSummary('Issue #2189 — V8 heap telemetry');
process.exit(getFailCount() > 0 ? 1 : 0);
