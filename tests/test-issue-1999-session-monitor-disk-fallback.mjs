#!/usr/bin/env node
/**
 * Issue #1999/#2001 regression test: Docker completion messages should show
 * Docker-native task filesystem usage when it is available, but must not use
 * solve-log `📈 [RESOURCES]` statfs snapshots as a per-task fallback.
 *
 * Run with: node tests/test-issue-1999-session-monitor-disk-fallback.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1999
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DISK_PHASE_AFTER_AGENT, DISK_PHASE_AFTER_CLONE, buildDiskMarker } from '../src/solve.disk-diagnostics.lib.mjs';
import { RESOURCE_PHASE_AFTER_AGENT, RESOURCE_PHASE_SOLVE_EXIT, RESOURCE_PHASE_SOLVE_START, buildResourceMarker } from '../src/solve.resource-diagnostics.lib.mjs';
import { buildDiskDiagnosticsExtraSection } from '../src/session-monitor.lib.mjs';

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

function resourceSnapshot(phase, usedBytes) {
  return {
    phase,
    timestamp: new Date('2026-06-29T18:00:00.000Z').toISOString(),
    cpu: { load1: 1, load5: 0.75, load15: 0.5, cpuCount: 4 },
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
      availableBytes: 40 * 1024 ** 3 - usedBytes,
      usedBytes,
      usedPercent: (usedBytes / (40 * 1024 ** 3)) * 100,
      error: null,
    },
  };
}

function writeFakeLog(lines) {
  const file = path.join(os.tmpdir(), `hm-1999-monitor-${Date.now()}-${Math.floor(Math.random() * 1e6)}.log`);
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

await test('docker disk block does not use solve_exit statfs usage when Docker after-size is unavailable', async () => {
  const logFile = writeFakeLog([
    buildDiskMarker({ phase: DISK_PHASE_AFTER_CLONE, bytes: 250 * 1024 ** 2, path: '/tmp/gh-issue-solver-1999' }),
    buildResourceMarker(resourceSnapshot(RESOURCE_PHASE_SOLVE_START, 52 * 1024)),
    buildDiskMarker({
      phase: DISK_PHASE_AFTER_AGENT,
      bytes: 750 * 1024 ** 2,
      deltaBytes: 500 * 1024 ** 2,
      path: '/tmp/gh-issue-solver-1999',
    }),
    buildResourceMarker(resourceSnapshot(RESOURCE_PHASE_AFTER_AGENT, 6 * 1024 ** 3)),
    buildResourceMarker(resourceSnapshot(RESOURCE_PHASE_SOLVE_EXIT, 7 * 1024 ** 3)),
  ]);

  try {
    const block = await buildDiskDiagnosticsExtraSection(logFile, {
      isolationBackend: 'docker',
      containerFilesystemStartBytes: 52 * 1024,
      containerFilesystemAfterBytes: null,
    });

    assert.match(block, /Repository size:/);
    assert.match(block, /Cloned:\s+250 MB/);
    assert.match(block, /On completion:\s+750 MB \(\+500 MB\)/);
    assert.match(block, /Container filesystem size:/);
    assert.match(block, /On start:\s+52 KB/);
    assert.doesNotMatch(block, /On completion:\s+7\.0 GB/);
    assert.doesNotMatch(block, /⚠️ Total disk usage per task exceeds 5\.0 GB/);
  } finally {
    fs.rmSync(logFile, { force: true });
  }
});

await test('explicit Docker completion size wins over resource-marker fallback', async () => {
  const logFile = writeFakeLog([buildResourceMarker(resourceSnapshot(RESOURCE_PHASE_SOLVE_START, 1 * 1024 ** 3)), buildResourceMarker(resourceSnapshot(RESOURCE_PHASE_SOLVE_EXIT, 7 * 1024 ** 3))]);

  try {
    const block = await buildDiskDiagnosticsExtraSection(logFile, {
      isolationBackend: 'docker',
      containerFilesystemStartBytes: 500 * 1024 ** 2,
      containerFilesystemAfterBytes: 2 * 1024 ** 3,
    });

    assert.match(block, /Container filesystem size:/);
    assert.match(block, /On start:\s+500 MB/);
    assert.match(block, /On completion:\s+2\.0 GB/);
    assert.doesNotMatch(block, /7\.0 GB/);
  } finally {
    fs.rmSync(logFile, { force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
