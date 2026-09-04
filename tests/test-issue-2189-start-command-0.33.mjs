#!/usr/bin/env node

/**
 * Issue #2189, upstream half: consume what `start-command@0.33.0` delivered.
 *
 * The incident in #2189 produced three upstream issues against
 * link-foundation/start; all three are closed as completed and released in
 * `start-command@0.33.0`, which the Hive Mind images now pin:
 *
 *   - start#162 — `--attach` / `--resume <uuid>` / `--resume-all` re-enter an
 *     existing execution instead of forcing a fresh isolated run.
 *   - start#164 — `--status`/`--list` expose an additive `exitReason` hint.
 *   - start#165 — `--status`/`--list` expose `memoryExhausted` /
 *     `memoryExhaustedReason`, so a V8 heap self-abort is distinguishable from a
 *     forced kill without reading the log twice.
 *
 * This file locks in the downstream consumption:
 *   1. The `$ --status` / `$ --list` parsers read the three new fields from
 *      JSON, links notation and text output — and yield `null` (never `false`,
 *      never a throw) for an older `$` that does not emit them.
 *   2. `describeKillCause` upgrades a kill to `out-of-memory` on the upstream
 *      hint alone, so a fatal line that scrolled out of our bounded window is
 *      still classified correctly — while a clean exit (code 0) is never
 *      upgraded.
 *   3. The local log-marker classification still stands on its own, so the
 *      verdict does not regress on an older `$` binary.
 *   4. Both images pin `start-command@0.33.0`.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 * @see https://github.com/link-foundation/start/issues/162
 * @see https://github.com/link-foundation/start/issues/164
 * @see https://github.com/link-foundation/start/issues/165
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';
import { parseSessionListOutput, parseSessionStatusOutput } from '../src/isolation-runner.parsers.lib.mjs';
import { KILL_CAUSE_FORCED_KILL, KILL_CAUSE_OUT_OF_MEMORY, UPSTREAM_MEMORY_EXHAUSTION_PREFIX, describeKillCause } from '../src/session-kill-diagnostics.lib.mjs';
import { buildKillCompletionSections } from '../src/session-monitor.kill-sections.lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const FATAL_V8_LINE = 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory';
const V8_REASON = `${UPSTREAM_MEMORY_EXHAUSTION_PREFIX} (v8-heap-limit)`;

console.log('================================================================================');
console.log('Issue #2189 — consuming start-command 0.33.0 (start#162, #164, #165)');
console.log('================================================================================\n');

// ---------------------------------------------------------------------------
// 1. `$ --status` parsing of the additive 0.33.0 fields
// ---------------------------------------------------------------------------
console.log('1. `$ --status` exposes exitReason / memoryExhausted\n');

const jsonStatus = parseSessionStatusOutput(
  JSON.stringify({
    uuid: 'edc7b051-e12f-4f7b-b677-c885f3208407',
    status: 'executed',
    exitCode: 139,
    oomKilled: false,
    exitReason: V8_REASON,
    memoryExhausted: true,
    memoryExhaustedReason: FATAL_V8_LINE,
    options: { isolated: 'docker' },
  })
);
assert(jsonStatus.exitReason === V8_REASON, `JSON status carries exitReason (${jsonStatus.exitReason})`);
assert(jsonStatus.memoryExhausted === true, 'JSON status carries memoryExhausted = true');
assert(jsonStatus.memoryExhaustedReason === FATAL_V8_LINE, 'JSON status carries the evidence line');
assert(jsonStatus.oomKilled === false, 'the additive fields do not disturb oomKilled — a V8 self-abort still reports OOMKilled=false');
assert(jsonStatus.exitCode === 139 && jsonStatus.status === 'executed', 'the additive fields do not disturb status/exitCode either');

// An older `$` emits none of them. Absent must read as "unknown" (null), not as
// "observed to be false" — a `false` would be a verdict we have no evidence for.
const legacyStatus = parseSessionStatusOutput(JSON.stringify({ uuid: 'u', status: 'executed', exitCode: 137 }));
assert(legacyStatus.exitReason === null, 'a pre-0.33.0 `$ --status` yields exitReason = null');
assert(legacyStatus.memoryExhausted === null, 'a pre-0.33.0 `$ --status` yields memoryExhausted = null (unknown, not false)');
assert(legacyStatus.memoryExhaustedReason === null, 'a pre-0.33.0 `$ --status` yields memoryExhaustedReason = null');
assert(parseSessionStatusOutput('').memoryExhausted === null, 'empty `$ --status` output yields memoryExhausted = null');

// Links notation (`--output-format links-notation`), which is what `$` prints by
// default for a human: `  key value`, indented under the uuid.
const linksStatus = parseSessionStatusOutput(['edc7b051-e12f-4f7b-b677-c885f3208407', '  status executed', '  exitCode 134', '  oomKilled false', `  exitReason ${V8_REASON}`, '  memoryExhausted true', `  memoryExhaustedReason ${FATAL_V8_LINE}`, '  options', '    isolated docker'].join('\n'));
assert(linksStatus.exitReason === V8_REASON, 'links-notation status carries exitReason');
assert(linksStatus.memoryExhausted === true, 'links-notation status carries memoryExhausted');
assert(linksStatus.memoryExhaustedReason === FATAL_V8_LINE, 'links-notation status carries the evidence line');
assert(linksStatus.isolation === 'docker' && linksStatus.exitCode === 134, 'links-notation parsing of the pre-existing fields is unchanged');

// `--output-format text` uses padded, space-separated labels with a colon.
const textStatus = parseSessionStatusOutput(['Execution Status', '='.repeat(50), 'UUID:              edc7b051-e12f-4f7b-b677-c885f3208407', 'Status:            executed', 'Exit Code:         139', 'OOM Killed:        false', `Exit Reason:       ${V8_REASON}`, 'Memory Exhausted:  true', `Memory Evidence:   ${FATAL_V8_LINE}`].join('\n'));
assert(textStatus.exitReason === V8_REASON, 'text status carries exitReason');
assert(textStatus.memoryExhausted === true, 'text status carries memoryExhausted');
assert(textStatus.memoryExhaustedReason === FATAL_V8_LINE, 'text status carries the evidence line');

// `$ --list --output-format json` reports the same hints per execution.
const listed = parseSessionListOutput(
  JSON.stringify([
    { uuid: 'a', status: 'executed', exitCode: 139, exitReason: V8_REASON, memoryExhausted: true, memoryExhaustedReason: FATAL_V8_LINE },
    { uuid: 'b', status: 'executing' },
  ])
);
assert(listed.length === 2, '`$ --list` still returns every execution');
assert(listed[0].exitReason === V8_REASON && listed[0].memoryExhausted === true, '`$ --list` carries the 0.33.0 hints');
assert(listed[1].exitReason === null && listed[1].memoryExhausted === null, 'an execution without the hints reports null, not false');

// ---------------------------------------------------------------------------
// 2. The hints reach the kill verdict
// ---------------------------------------------------------------------------
console.log('\n2. describeKillCause consumes the upstream hints\n');

// The exact incident shape: exit 139, `oomKilled` false, cgroup `oom_kill` 0,
// gigabytes of host RAM free — and a log whose fatal line our bounded window
// missed. Before 0.33.0 this was reported as "forced kill".
const healthyHost = { memory: { availableBytes: 10.3e9, totalBytes: 11.7e9 }, cgroup: { oomKill: 0 }, victims: [] };
const upstreamOnly = describeKillCause({
  logText: 'nothing fatal here\n',
  exitCode: 139,
  oomKilled: false,
  system: healthyHost,
  reportedMemoryExhausted: true,
  reportedMemoryExhaustedReason: FATAL_V8_LINE,
  reportedExitReason: V8_REASON,
});
assert(upstreamOnly.cause === KILL_CAUSE_OUT_OF_MEMORY, `the upstream hint alone classifies the kill as out-of-memory (got ${upstreamOnly.cause})`);
assert(upstreamOnly.summary.includes('v8-heap-limit'), `the summary names the mechanism, not just "out of memory" (${upstreamOnly.summary})`);
assert(upstreamOnly.summary.includes(FATAL_V8_LINE), 'the summary quotes the evidence line `$` found');
assert(!/forced kill/i.test(upstreamOnly.summary), 'the incident wording ("forced kill") is gone');
assert(
  upstreamOnly.evidence.some(item => item.includes('memory exhaustion')),
  'the evidence list records where the finding came from'
);

// A hint we do not recognise as memory exhaustion is reported, but never
// upgrades the cause on its own — it is a hint, not a verdict.
const signalHint = describeKillCause({ exitCode: 139, system: healthyHost, reportedExitReason: 'signal (SIGSEGV)' });
assert(signalHint.cause === KILL_CAUSE_FORCED_KILL, `a non-memory exitReason does not manufacture an OOM verdict (got ${signalHint.cause})`);
assert(
  signalHint.evidence.some(item => item.includes('SIGSEGV')),
  'the non-memory hint is still surfaced as evidence'
);

// A clean exit is never upgraded, whatever a stale record claims.
const cleanExit = describeKillCause({ exitCode: 0, reportedMemoryExhausted: true, reportedMemoryExhaustedReason: FATAL_V8_LINE, reportedExitReason: V8_REASON });
assert(cleanExit.cause !== KILL_CAUSE_OUT_OF_MEMORY, `exit code 0 is never upgraded to out-of-memory (got ${cleanExit.cause})`);
assert(!cleanExit.evidence.some(item => item.includes('memory exhaustion')), 'a clean exit does not even report the hint');

// Any mechanism upstream may add later is matched by prefix, so a new upstream
// reason classifies correctly without a Hive Mind release.
for (const mechanism of ['kernel-oom-killer', 'go-runtime', 'allocation-failure', 'some-future-runtime']) {
  const byPrefix = describeKillCause({ exitCode: 137, system: healthyHost, reportedExitReason: `${UPSTREAM_MEMORY_EXHAUSTION_PREFIX} (${mechanism})` });
  assert(byPrefix.cause === KILL_CAUSE_OUT_OF_MEMORY, `\`${UPSTREAM_MEMORY_EXHAUSTION_PREFIX} (${mechanism})\` is classified as out-of-memory by prefix`);
}

// Defense in depth: with no upstream hint at all (an older `$`), the local
// log-marker scan still reaches the same verdict.
const localOnly = describeKillCause({ logText: `${FATAL_V8_LINE}\n`, exitCode: 139, oomKilled: false, system: healthyHost });
assert(localOnly.cause === KILL_CAUSE_OUT_OF_MEMORY, `the local scan alone still classifies the self-abort (got ${localOnly.cause})`);

// ---------------------------------------------------------------------------
// 3. The completion path actually forwards the fields
// ---------------------------------------------------------------------------
console.log('\n3. The completion path forwards `$ --status` to the diagnosis\n');

const { sections, diagnosis } = await buildKillCompletionSections({
  sessionName: 'session-under-test',
  sessionInfo: { args: [], locale: null },
  statusResult: { status: 'killed', exitCode: 139, oomKilled: false, logPath: null, exitReason: V8_REASON, memoryExhausted: true, memoryExhaustedReason: FATAL_V8_LINE },
  exitCode: 139,
  status: 'killed',
  env: {},
});
assert(diagnosis?.cause === KILL_CAUSE_OUT_OF_MEMORY, `a killed session with only upstream evidence is reported as out-of-memory (got ${diagnosis?.cause})`);
assert(sections.join('\n').includes('v8-heap-limit'), 'the Telegram/PR section names the mechanism');

// ---------------------------------------------------------------------------
// 4. Both images pin the version that delivers all of the above
// ---------------------------------------------------------------------------
console.log('\n4. Image pins\n');

for (const file of ['Dockerfile', 'Dockerfile.dind']) {
  const text = await fs.readFile(path.join(repoRoot, file), 'utf8');
  const pins = [...text.matchAll(/start-command@(\d+\.\d+\.\d+)/g)].map(match => match[1]);
  assert(pins.length > 0 && pins.every(version => version === '0.33.0'), `${file} installs start-command@0.33.0 (found ${JSON.stringify(pins)})`);
}

printSummary('Issue #2189 — start-command 0.33.0 adoption');
process.exit(getFailCount() > 0 ? 1 : 0);
