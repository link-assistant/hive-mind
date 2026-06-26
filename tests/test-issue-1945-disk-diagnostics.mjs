#!/usr/bin/env node
/**
 * Tests for src/solve.disk-diagnostics.lib.mjs (issues #1945/#1988).
 *
 * Covers:
 *   - measureDirectorySize() returns a finite byte count on a real dir, null
 *     on a missing path, and tolerates plain-file targets.
 *   - formatBytes / formatBytesDelta render the issue "12.0 GB" / "+500 MB"
 *     forms.
 *   - buildDiskMarker + parseDiskMarkers round-trip both phases and recover
 *     bytes/deltaBytes/path even when surrounded by other log content.
 *   - computeDiskWarnings flags only the right threshold(s).
 *   - formatDiskDiagnosticsBlock includes warnings only when crossed, returns
 *     empty when there is nothing to show.
 *   - recordAfterCloneSize / recordAfterAgentSize emit a parseable marker via
 *     the provided log function (no real filesystem mutation needed).
 *
 * Run with: node tests/test-issue-1945-disk-diagnostics.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1945
 * @see https://github.com/link-assistant/hive-mind/issues/1988
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { WARNING_THRESHOLD_BYTES, DISK_MARKER_PREFIX, DISK_PHASE_AFTER_CLONE, DISK_PHASE_AFTER_AGENT, measureDirectorySize, formatBytes, formatBytesDelta, buildDiskMarker, parseDiskMarkers, computeDiskWarnings, formatDiskDiagnosticsBlock, recordAfterCloneSize, recordAfterAgentSize } from '../src/solve.disk-diagnostics.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`❌ ${name}`);
    console.error(e?.stack || e);
    failed++;
  }
}

// --- Constants ---
await test('WARNING_THRESHOLD_BYTES is exactly 5 GB (binary)', () => {
  assert.equal(WARNING_THRESHOLD_BYTES, 5 * 1024 * 1024 * 1024);
});

await test('marker prefix is the issue emoji form', () => {
  assert.equal(DISK_MARKER_PREFIX, '📊 [DISK]');
});

// --- formatBytes ---
await test('formatBytes renders the issue "12.0 GB" form', () => {
  assert.equal(formatBytes(12 * 1024 * 1024 * 1024), '12.0 GB');
  assert.equal(formatBytes(5 * 1024 * 1024 * 1024), '5.0 GB');
});

await test('formatBytes returns "? B" for null/NaN (defensive)', () => {
  assert.equal(formatBytes(null), '? B');
  assert.equal(formatBytes(NaN), '? B');
});

await test('formatBytes uses no decimals for MB and below', () => {
  assert.equal(formatBytes(500 * 1024 * 1024), '500 MB');
  assert.equal(formatBytes(2 * 1024 * 1024), '2 MB');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(512), '512 B');
});

await test('formatBytesDelta adds an explicit sign', () => {
  assert.equal(formatBytesDelta(0), '±0 B');
  assert.equal(formatBytesDelta(500 * 1024 * 1024), '+500 MB');
  assert.equal(formatBytesDelta(-1024 * 1024 * 1024), '-1.0 GB');
});

// --- measureDirectorySize ---
await test('measureDirectorySize returns a positive number for an existing dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-disk-diag-'));
  try {
    // Drop a few small files so the dir has measurable content.
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'world');
    const bytes = measureDirectorySize(dir);
    assert.ok(Number.isFinite(bytes), 'bytes must be finite');
    assert.ok(bytes >= 0, 'bytes must be non-negative');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('measureDirectorySize returns null for a missing path', () => {
  const bogus = path.join(os.tmpdir(), `hm-disk-diag-missing-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  assert.equal(measureDirectorySize(bogus), null);
});

await test('measureDirectorySize handles a plain file too', () => {
  const file = path.join(os.tmpdir(), `hm-disk-diag-file-${Date.now()}.txt`);
  fs.writeFileSync(file, 'x'.repeat(123));
  try {
    const bytes = measureDirectorySize(file);
    assert.ok(Number.isFinite(bytes) && bytes >= 0);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

await test('measureDirectorySize returns null for an empty/blank path', () => {
  assert.equal(measureDirectorySize(''), null);
  assert.equal(measureDirectorySize(null), null);
});

// --- buildDiskMarker / parseDiskMarkers round-trip ---
await test('buildDiskMarker after_clone shape is parseable', () => {
  const marker = buildDiskMarker({
    phase: DISK_PHASE_AFTER_CLONE,
    bytes: 12 * 1024 * 1024 * 1024,
    path: '/tmp/gh-issue-solver-1234',
  });
  assert.ok(marker.startsWith(DISK_MARKER_PREFIX));
  assert.match(marker, /phase=after_clone/);
  assert.match(marker, /bytes=12884901888/);
  assert.match(marker, /path=\/tmp\/gh-issue-solver-1234/);
  assert.match(marker, /size=12\.0 GB/);
});

await test('buildDiskMarker after_agent shape includes deltaBytes', () => {
  const marker = buildDiskMarker({
    phase: DISK_PHASE_AFTER_AGENT,
    bytes: 13_000_000_000,
    deltaBytes: 524_288_000,
    path: '/tmp/gh-issue-solver-1234',
  });
  assert.match(marker, /phase=after_agent/);
  assert.match(marker, /bytes=13000000000/);
  assert.match(marker, /deltaBytes=524288000/);
  assert.match(marker, /delta=\+500 MB/);
});

await test('parseDiskMarkers round-trips both phases out of a log haystack', () => {
  const log = [
    '[2026-06-19T10:00:00Z] 🔧 Raw command executed:',
    '[2026-06-19T10:00:01Z]    /solve https://github.com/link-assistant/hive-mind/issues/1945',
    buildDiskMarker({ phase: DISK_PHASE_AFTER_CLONE, bytes: 12 * 1024 ** 3, path: '/tmp/foo' }),
    '[2026-06-19T10:30:00Z] ⏳ Executing...',
    buildDiskMarker({
      phase: DISK_PHASE_AFTER_AGENT,
      bytes: 13 * 1024 ** 3,
      deltaBytes: 1 * 1024 ** 3,
      path: '/tmp/foo',
    }),
  ].join('\n');
  const parsed = parseDiskMarkers(log);
  assert.ok(parsed.afterClone, 'afterClone must be present');
  assert.equal(parsed.afterClone.bytes, 12 * 1024 ** 3);
  assert.equal(parsed.afterClone.path, '/tmp/foo');
  assert.ok(parsed.afterAgent, 'afterAgent must be present');
  assert.equal(parsed.afterAgent.bytes, 13 * 1024 ** 3);
  assert.equal(parsed.afterAgent.deltaBytes, 1 * 1024 ** 3);
});

await test('parseDiskMarkers returns {null,null} for an empty / non-string log', () => {
  assert.deepEqual(parseDiskMarkers(''), { afterClone: null, afterAgent: null });
  assert.deepEqual(parseDiskMarkers(null), { afterClone: null, afterAgent: null });
  assert.deepEqual(parseDiskMarkers(undefined), { afterClone: null, afterAgent: null });
});

await test('parseDiskMarkers keeps the LAST marker per phase (auto-restart safety)', () => {
  const log = [buildDiskMarker({ phase: DISK_PHASE_AFTER_CLONE, bytes: 1 * 1024 ** 3, path: '/tmp/a' }), buildDiskMarker({ phase: DISK_PHASE_AFTER_CLONE, bytes: 2 * 1024 ** 3, path: '/tmp/b' })].join('\n');
  const parsed = parseDiskMarkers(log);
  assert.equal(parsed.afterClone.bytes, 2 * 1024 ** 3);
  assert.equal(parsed.afterClone.path, '/tmp/b');
});

// --- computeDiskWarnings ---
await test('computeDiskWarnings: clone > 5 GB flags cloneTooLarge AND totalTooLarge', () => {
  const w = computeDiskWarnings({
    afterClone: { bytes: 6 * 1024 ** 3, path: '/tmp/x' },
    afterAgent: null,
  });
  assert.equal(w.cloneTooLarge, true);
  assert.equal(w.totalTooLarge, true, 'total falls back to clone size when no after_agent');
  assert.equal(w.deltaTooLarge, false);
});

await test('computeDiskWarnings: delta > 5 GB flags deltaTooLarge', () => {
  const w = computeDiskWarnings({
    afterClone: { bytes: 1 * 1024 ** 3, path: '/tmp/x' },
    afterAgent: { bytes: 7 * 1024 ** 3, deltaBytes: 6 * 1024 ** 3, path: '/tmp/x' },
  });
  assert.equal(w.cloneTooLarge, false);
  assert.equal(w.deltaTooLarge, true);
  assert.equal(w.totalTooLarge, true);
});

await test('computeDiskWarnings: exactly 5 GB is NOT a warning (must be >, not >=)', () => {
  const w = computeDiskWarnings({
    afterClone: { bytes: 5 * 1024 ** 3, path: '/tmp/x' },
    afterAgent: { bytes: 5 * 1024 ** 3, deltaBytes: 0, path: '/tmp/x' },
  });
  assert.equal(w.cloneTooLarge, false);
  assert.equal(w.totalTooLarge, false);
  assert.equal(w.deltaTooLarge, false);
});

await test('computeDiskWarnings: no markers → no warnings', () => {
  const w = computeDiskWarnings({ afterClone: null, afterAgent: null });
  assert.equal(w.cloneTooLarge, false);
  assert.equal(w.deltaTooLarge, false);
  assert.equal(w.totalTooLarge, false);
});

// --- formatDiskDiagnosticsBlock ---
await test('formatDiskDiagnosticsBlock: empty input → empty string', () => {
  assert.equal(formatDiskDiagnosticsBlock(null), '');
  assert.equal(formatDiskDiagnosticsBlock({ afterClone: null, afterAgent: null }), '');
});

await test('formatDiskDiagnosticsBlock: under threshold → no warnings tail', () => {
  const block = formatDiskDiagnosticsBlock({
    afterClone: { bytes: 1 * 1024 ** 3, path: '/tmp/x' },
    afterAgent: { bytes: 2 * 1024 ** 3, deltaBytes: 1 * 1024 ** 3, path: '/tmp/x' },
  });
  assert.match(block, /^💾 Disk usage/);
  assert.match(block, /Repository size:/);
  assert.match(block, /Cloned:\s+1\.0 GB/);
  assert.match(block, /On completion:\s+2\.0 GB \(\+1\.0 GB\)/);
  assert.doesNotMatch(block, /Container filesystem size:/);
  assert.doesNotMatch(block, /Threshold:/);
  assert.doesNotMatch(block, /⚠️/);
});

await test('formatDiskDiagnosticsBlock: above threshold → emits a task-total warning', () => {
  const block = formatDiskDiagnosticsBlock({
    afterClone: { bytes: 6 * 1024 ** 3, path: '/tmp/x' },
    afterAgent: { bytes: 12 * 1024 ** 3, deltaBytes: 6 * 1024 ** 3, path: '/tmp/x' },
  });
  assert.match(block, /⚠️ Total disk usage per task exceeds 5\.0 GB/);
  assert.doesNotMatch(block, /Cloned repository exceeds/);
  assert.doesNotMatch(block, /Folder grew by more than/);
  assert.doesNotMatch(block, /Threshold:/);
});

await test('formatDiskDiagnosticsBlock: only clone known → block still renders', () => {
  const block = formatDiskDiagnosticsBlock({
    afterClone: { bytes: 6 * 1024 ** 3, path: '/tmp/x' },
    afterAgent: null,
  });
  assert.match(block, /Cloned:\s+6\.0 GB/);
  assert.match(block, /⚠️ Total disk usage per task exceeds 5\.0 GB/);
  // No "After agent" line because the second checkpoint was never reached.
  assert.doesNotMatch(block, /On completion:/);
});

await test('formatDiskDiagnosticsBlock: docker isolation includes container filesystem size', () => {
  const block = formatDiskDiagnosticsBlock(
    {
      afterClone: { bytes: 248 * 1024 ** 2, path: '/tmp/x' },
      afterAgent: { bytes: 13 * 1024 ** 3, deltaBytes: 13 * 1024 ** 3 - 248 * 1024 ** 2, path: '/tmp/x' },
    },
    {
      isolationBackend: 'docker',
      containerFilesystemStartBytes: 300 * 1024 ** 2,
      containerFilesystemAfterBytes: 14 * 1024 ** 3,
    }
  );
  assert.match(block, /Repository size:/);
  assert.match(block, /Cloned:\s+248 MB/);
  assert.match(block, /On completion:\s+13\.0 GB \(\+12\.8 GB\)/);
  assert.match(block, /Container filesystem size:/);
  assert.match(block, /On start:\s+300 MB/);
  assert.match(block, /On completion:\s+14\.0 GB/);
  assert.match(block, /⚠️ Total disk usage per task exceeds 5\.0 GB/);
});

await test('formatDiskDiagnosticsBlock: screen isolation shows repository size only', () => {
  const block = formatDiskDiagnosticsBlock(
    {
      afterClone: { bytes: 248 * 1024 ** 2, path: '/tmp/x' },
      afterAgent: { bytes: 300 * 1024 ** 2, deltaBytes: 52 * 1024 ** 2, path: '/tmp/x' },
    },
    {
      isolationBackend: 'screen',
      containerFilesystemStartBytes: 10 * 1024 ** 3,
      containerFilesystemAfterBytes: 11 * 1024 ** 3,
    }
  );
  assert.match(block, /Repository size:/);
  assert.doesNotMatch(block, /Container filesystem size:/);
});

// --- recordAfterCloneSize / recordAfterAgentSize emit a marker via log ---
await test('recordAfterCloneSize emits a parseable marker via the log function', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-disk-diag-emit-'));
  try {
    const lines = [];
    const log = async msg => lines.push(msg);
    const bytes = await recordAfterCloneSize({ tempDir: dir, log });
    assert.ok(Number.isFinite(bytes), 'must return finite bytes');
    const joined = lines.join('\n');
    const parsed = parseDiskMarkers(joined);
    assert.ok(parsed.afterClone, 'log must contain after_clone marker');
    assert.equal(parsed.afterClone.bytes, bytes);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('recordAfterAgentSize computes the delta against beforeBytes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-disk-diag-delta-'));
  try {
    const lines = [];
    const log = async msg => lines.push(msg);
    // Pretend the AFTER_CLONE checkpoint already recorded a known baseline.
    const before = await recordAfterCloneSize({ tempDir: dir, log });
    // Add a measurable file so the AFTER_AGENT measurement is strictly larger.
    fs.writeFileSync(path.join(dir, 'grown.bin'), 'x'.repeat(64 * 1024));
    const after = await recordAfterAgentSize({ tempDir: dir, beforeBytes: before, log });
    const joined = lines.join('\n');
    const parsed = parseDiskMarkers(joined);
    assert.ok(parsed.afterAgent, 'log must contain after_agent marker');
    assert.equal(parsed.afterAgent.bytes, after);
    assert.equal(parsed.afterAgent.deltaBytes, after - before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('recordAfterAgentSize: deltaBytes is null when beforeBytes is null', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-disk-diag-nullbefore-'));
  try {
    const lines = [];
    const log = async msg => lines.push(msg);
    await recordAfterAgentSize({ tempDir: dir, beforeBytes: null, log });
    const parsed = parseDiskMarkers(lines.join('\n'));
    assert.ok(parsed.afterAgent);
    assert.equal(parsed.afterAgent.deltaBytes, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
