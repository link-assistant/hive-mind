#!/usr/bin/env node
/**
 * Tests for full-container resource diagnostics added for issue #1999.
 *
 * The solve process writes CPU, memory, and full filesystem snapshots to the
 * captured log as `📈 [RESOURCES]` markers. The Telegram monitor can parse those
 * markers later even if Docker can no longer inspect the exited task container.
 *
 * Run with: node tests/test-issue-1999-resource-diagnostics.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1999
 */

import assert from 'node:assert/strict';

import { RESOURCE_MARKER_PREFIX, RESOURCE_PHASE_AFTER_AGENT, RESOURCE_PHASE_AFTER_CLONE, RESOURCE_PHASE_SOLVE_EXIT, RESOURCE_PHASE_SOLVE_START, buildResourceMarker, captureResourceSnapshot, formatResourceSnapshotForLog, parseResourceMarkers, selectBestDiskResourceMarker, summarizeResourceSnapshot } from '../src/solve.resource-diagnostics.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(error?.stack || error);
    failed++;
  }
}

const fakeOs = {
  loadavg: () => [1.25, 0.75, 0.5],
  cpus: () => [{}, {}, {}, {}],
  totalmem: () => 16 * 1024 ** 3,
  freemem: () => 6 * 1024 ** 3,
};

const fakeFs = {
  readFileSync: file => {
    assert.equal(file, '/proc/meminfo');
    return 'MemTotal:       16777216 kB\nMemAvailable:    8388608 kB\n';
  },
  statfsSync: targetPath => {
    assert.equal(targetPath, '/');
    return {
      bsize: 4096,
      blocks: 10_000_000,
      bfree: 2_500_000,
      bavail: 2_000_000,
    };
  },
};

const fakeProcess = {
  platform: 'linux',
  memoryUsage: () => ({
    rss: 128 * 1024 ** 2,
    heapUsed: 64 * 1024 ** 2,
  }),
};

function fakeSnapshot(phase, usedBytes) {
  return {
    phase,
    timestamp: `2026-06-29T18:00:0${usedBytes % 10}.000Z`,
    cpu: { load1: 1, load5: 0.5, load15: 0.25, cpuCount: 4 },
    memory: {
      totalBytes: 16 * 1024 ** 3,
      availableBytes: 8 * 1024 ** 3,
      usedBytes: 8 * 1024 ** 3,
      processRssBytes: 128 * 1024 ** 2,
      processHeapUsedBytes: 64 * 1024 ** 2,
    },
    disk: {
      path: '/',
      totalBytes: 40 * 1024 ** 3,
      freeBytes: 40 * 1024 ** 3 - usedBytes,
      availableBytes: 40 * 1024 ** 3 - usedBytes,
      usedBytes,
      usedPercent: (usedBytes / (40 * 1024 ** 3)) * 100,
      error: null,
    },
  };
}

await test('captureResourceSnapshot records CPU, memory, process, and filesystem stats', () => {
  const snapshot = captureResourceSnapshot({
    phase: RESOURCE_PHASE_SOLVE_START,
    diskPath: '/',
    now: () => new Date('2026-06-29T18:00:00.000Z'),
    osImpl: fakeOs,
    fsImpl: fakeFs,
    processImpl: fakeProcess,
  });

  assert.equal(snapshot.phase, RESOURCE_PHASE_SOLVE_START);
  assert.equal(snapshot.timestamp, '2026-06-29T18:00:00.000Z');
  assert.equal(snapshot.cpu.load1, 1.25);
  assert.equal(snapshot.cpu.cpuCount, 4);
  assert.equal(snapshot.memory.totalBytes, 16 * 1024 ** 3);
  assert.equal(snapshot.memory.availableBytes, 8 * 1024 ** 3);
  assert.equal(snapshot.memory.usedBytes, 8 * 1024 ** 3);
  assert.equal(snapshot.memory.processRssBytes, 128 * 1024 ** 2);
  assert.equal(snapshot.disk.path, '/');
  assert.equal(snapshot.disk.totalBytes, 40_960_000_000);
  assert.equal(snapshot.disk.usedBytes, 30_720_000_000);
});

await test('resource marker round-trips through a captured log haystack', () => {
  const start = fakeSnapshot(RESOURCE_PHASE_SOLVE_START, 1 * 1024 ** 3);
  const exit = fakeSnapshot(RESOURCE_PHASE_SOLVE_EXIT, 7 * 1024 ** 3);
  const logText = ['[2026-06-29T18:00:00Z] start', buildResourceMarker(start), '[2026-06-29T18:10:00Z] done', buildResourceMarker(exit)].join('\n');

  const parsed = parseResourceMarkers(logText);
  assert.equal(parsed.markers.length, 2);
  assert.equal(parsed.byPhase[RESOURCE_PHASE_SOLVE_START].disk.usedBytes, 1 * 1024 ** 3);
  assert.equal(parsed.byPhase[RESOURCE_PHASE_SOLVE_EXIT].disk.usedBytes, 7 * 1024 ** 3);
  assert.equal(parsed.byPhase[RESOURCE_PHASE_SOLVE_EXIT].disk.path, '/');
});

await test('selectBestDiskResourceMarker prefers final solve snapshots over earlier checkpoints', () => {
  const parsed = parseResourceMarkers([buildResourceMarker(fakeSnapshot(RESOURCE_PHASE_AFTER_CLONE, 2 * 1024 ** 3)), buildResourceMarker(fakeSnapshot(RESOURCE_PHASE_AFTER_AGENT, 5 * 1024 ** 3)), buildResourceMarker(fakeSnapshot(RESOURCE_PHASE_SOLVE_EXIT, 6 * 1024 ** 3))].join('\n'));

  const marker = selectBestDiskResourceMarker(parsed);
  assert.equal(marker.phase, RESOURCE_PHASE_SOLVE_EXIT);
  assert.equal(marker.disk.usedBytes, 6 * 1024 ** 3);
});

await test('formatResourceSnapshotForLog prints a human block plus the parseable marker', () => {
  const text = formatResourceSnapshotForLog(fakeSnapshot(RESOURCE_PHASE_SOLVE_EXIT, 7 * 1024 ** 3), 'solve exit 0');
  assert.match(text, /^📈 Resource usage \(solve exit 0\):/);
  assert.match(text, /CPU load:/);
  assert.match(text, /Memory:/);
  assert.match(text, /Process RSS:/);
  assert.match(text, /Disk \(\//);
  assert.match(text, new RegExp(RESOURCE_MARKER_PREFIX.replace('[', '\\[').replace(']', '\\]')));
});

await test('summarizeResourceSnapshot keeps heartbeat metadata compact and structured', () => {
  const summary = summarizeResourceSnapshot(fakeSnapshot(RESOURCE_PHASE_SOLVE_EXIT, 3 * 1024 ** 3));
  assert.deepEqual(Object.keys(summary).sort(), ['cpu', 'disk', 'memory', 'phase', 'timestamp']);
  assert.equal(summary.memory.processRssBytes, 128 * 1024 ** 2);
  assert.equal(summary.disk.usedBytes, 3 * 1024 ** 3);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
