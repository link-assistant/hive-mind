#!/usr/bin/env node
/**
 * Integration test: the captured solve log markers from
 * `solve.disk-diagnostics.lib.mjs` are recovered by
 * `session-monitor.lib.mjs` and turned into the expected Telegram extraSection
 * with the right warnings on (issue #1945).
 *
 * This test does NOT spawn a real solve run or attach to Telegram. It writes a
 * synthetic captured-log file that contains the two `📊 [DISK]` markers and
 * checks that `parseDiskMarkers` + `formatDiskDiagnosticsBlock` produce the
 * Markdown block shape the session monitor appends to
 * `formatSessionCompletionMessage`.
 *
 * Run with: node tests/test-issue-1945-session-monitor-integration.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1945
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildDiskMarker, parseDiskMarkers, formatDiskDiagnosticsBlock, WARNING_THRESHOLD_BYTES, DISK_PHASE_AFTER_CLONE, DISK_PHASE_AFTER_AGENT } from '../src/solve.disk-diagnostics.lib.mjs';
import { formatSessionCompletionMessage } from '../src/work-session-formatting.lib.mjs';

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

function writeFakeLog(lines) {
  const file = path.join(os.tmpdir(), `hm-1945-monitor-${Date.now()}-${Math.floor(Math.random() * 1e6)}.log`);
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

await test('captured log → disk block surfaces in the completion message', async () => {
  const logFile = writeFakeLog([
    '[2026-06-19T10:00:00Z] 🚀 solve v2.0.6',
    buildDiskMarker({ phase: DISK_PHASE_AFTER_CLONE, bytes: 12 * 1024 ** 3, path: '/tmp/gh-issue-solver-1' }),
    '[2026-06-19T10:30:00Z] ⏳ Executing...',
    buildDiskMarker({
      phase: DISK_PHASE_AFTER_AGENT,
      bytes: 13 * 1024 ** 3,
      deltaBytes: 1 * 1024 ** 3,
      path: '/tmp/gh-issue-solver-1',
    }),
    '[2026-06-19T11:00:00Z] ✅ Done',
  ]);
  try {
    const logText = fs.readFileSync(logFile, 'utf8');
    const parsed = parseDiskMarkers(logText);
    const block = formatDiskDiagnosticsBlock(parsed);
    const message = formatSessionCompletionMessage({
      sessionName: 'test-session',
      sessionInfo: { startTime: new Date('2026-06-19T10:00:00Z') },
      exitCode: 0,
      extraSections: [block],
    });
    assert.match(message, /Work session finished successfully/);
    assert.match(message, /💾 Disk usage/);
    assert.match(message, /Cloned repository: 12\.0 GB/);
    assert.match(message, /After agent:\s+13\.0 GB \(\+1\.0 GB\)/);
    // Only the cloned-repo threshold is crossed (12 > 5; total 13 > 5; delta 1 < 5).
    assert.match(message, /⚠️ Cloned repository exceeds 5\.0 GB/);
    assert.match(message, /⚠️ Total disk usage exceeds 5\.0 GB/);
    assert.doesNotMatch(message, /Folder grew by more than/);
  } finally {
    fs.rmSync(logFile, { force: true });
  }
});

await test('captured log with only the AFTER_CLONE marker (agent crashed) still warns', async () => {
  const logFile = writeFakeLog([buildDiskMarker({ phase: DISK_PHASE_AFTER_CLONE, bytes: 6 * 1024 ** 3, path: '/tmp/foo' }), '[2026-06-19T10:01:00Z] ❌ Agent crashed']);
  try {
    const parsed = parseDiskMarkers(fs.readFileSync(logFile, 'utf8'));
    const block = formatDiskDiagnosticsBlock(parsed);
    assert.match(block, /Cloned repository: 6\.0 GB/);
    assert.match(block, /⚠️ Cloned repository exceeds 5\.0 GB/);
    assert.doesNotMatch(block, /After agent:/);
  } finally {
    fs.rmSync(logFile, { force: true });
  }
});

await test('captured log with delta > 5 GB only flags the delta warning', async () => {
  const logFile = writeFakeLog([
    buildDiskMarker({ phase: DISK_PHASE_AFTER_CLONE, bytes: 100 * 1024 * 1024, path: '/tmp/foo' }),
    buildDiskMarker({
      phase: DISK_PHASE_AFTER_AGENT,
      bytes: WARNING_THRESHOLD_BYTES + 100 * 1024 * 1024,
      deltaBytes: WARNING_THRESHOLD_BYTES,
      path: '/tmp/foo',
    }),
  ]);
  try {
    const parsed = parseDiskMarkers(fs.readFileSync(logFile, 'utf8'));
    const block = formatDiskDiagnosticsBlock(parsed);
    // delta is EXACTLY 5 GB (== threshold) — must NOT warn (strict >).
    assert.doesNotMatch(block, /Folder grew by more than/);
    // total IS strictly greater than threshold.
    assert.match(block, /⚠️ Total disk usage exceeds 5\.0 GB/);
  } finally {
    fs.rmSync(logFile, { force: true });
  }
});

await test('a log with no disk markers produces no disk block', async () => {
  const logFile = writeFakeLog(['[2026-06-19T10:00:00Z] 🚀 solve v2.0.6', '[2026-06-19T11:00:00Z] ✅ Done']);
  try {
    const parsed = parseDiskMarkers(fs.readFileSync(logFile, 'utf8'));
    const block = formatDiskDiagnosticsBlock(parsed);
    assert.equal(block, '', 'no markers must produce empty block (no Telegram noise)');
  } finally {
    fs.rmSync(logFile, { force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
