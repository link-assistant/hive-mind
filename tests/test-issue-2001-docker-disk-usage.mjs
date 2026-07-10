#!/usr/bin/env node
/**
 * Issue #2001 regression tests.
 *
 * Docker task disk usage must stay scoped to the executing task container. A
 * filesystem-capacity snapshot from `statfs('/')` can describe the parent
 * deployment's backing filesystem and must not be reported as per-task usage.
 *
 * Run with: node tests/test-issue-2001-docker-disk-usage.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2001
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DISK_PHASE_AFTER_AGENT, DISK_PHASE_AFTER_CLONE, buildDiskMarker } from '../src/solve.disk-diagnostics.lib.mjs';
import { RESOURCE_PHASE_SOLVE_EXIT, RESOURCE_PHASE_SOLVE_START, buildResourceMarker } from '../src/solve.resource-diagnostics.lib.mjs';
import { __setIsolationRunnerForTests, buildDiskDiagnosticsExtraSection, getActiveSessionCount, monitorSessions, resetSessionMonitorForTests, trackSession } from '../src/session-monitor.lib.mjs';

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

function writeFakeLog(lines) {
  const file = path.join(os.tmpdir(), `hm-2001-monitor-${Date.now()}-${Math.floor(Math.random() * 1e6)}.log`);
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

function resourceSnapshot(phase, usedBytes) {
  return {
    phase,
    timestamp: new Date('2026-06-30T22:00:00.000Z').toISOString(),
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
      totalBytes: 80 * 1024 ** 3,
      availableBytes: 80 * 1024 ** 3 - usedBytes,
      usedBytes,
      usedPercent: (usedBytes / (80 * 1024 ** 3)) * 100,
      error: null,
    },
  };
}

const smallRepoMarkers = [
  buildDiskMarker({ phase: DISK_PHASE_AFTER_CLONE, bytes: 10 * 1024 ** 2, path: '/tmp/gh-issue-solver-2001' }),
  buildDiskMarker({
    phase: DISK_PHASE_AFTER_AGENT,
    bytes: 12 * 1024 ** 2,
    deltaBytes: 2 * 1024 ** 2,
    path: '/tmp/gh-issue-solver-2001',
  }),
];

await test('resource statfs markers are not used as Docker task filesystem usage', async () => {
  const logFile = writeFakeLog([smallRepoMarkers[0], buildResourceMarker(resourceSnapshot(RESOURCE_PHASE_SOLVE_START, 54.8 * 1024 ** 3)), smallRepoMarkers[1], buildResourceMarker(resourceSnapshot(RESOURCE_PHASE_SOLVE_EXIT, 55.2 * 1024 ** 3))]);

  try {
    const block = await buildDiskDiagnosticsExtraSection(logFile, {
      isolationBackend: 'docker',
      containerFilesystemStartBytes: 52 * 1024,
      containerFilesystemAfterBytes: null,
    });

    assert.match(block, /Repository size:/);
    assert.match(block, /Cloned:\s+10 MB/);
    assert.match(block, /On completion:\s+12 MB \(\+2 MB\)/);
    assert.match(block, /Container filesystem size:/);
    assert.match(block, /On start:\s+52 KB/);
    assert.doesNotMatch(block, /54\.8 GB/);
    assert.doesNotMatch(block, /55\.2 GB/);
    assert.doesNotMatch(block, /Total disk usage per task exceeds 5\.0 GB/);
  } finally {
    fs.rmSync(logFile, { force: true });
  }
});

await test('session monitor falls back to last Docker writable-layer sample', async () => {
  resetSessionMonitorForTests();
  __setIsolationRunnerForTests({
    isExecutingSessionStatus: status => status === 'executing',
    isTerminalSessionStatus: status => ['executed', 'completed', 'failed', 'killed'].includes(status),
    isUnknownDockerExitCode: exitCode => exitCode === null || exitCode === undefined || Number(exitCode) === -1,
    isSessionRunning: async () => false,
    readSessionExitFromLog: () => ({ finished: false, exitCode: null, endTime: null }),
  });

  const sessionName = 'issue-2001-docker-session';
  const logFile = writeFakeLog([smallRepoMarkers[0], buildResourceMarker(resourceSnapshot(RESOURCE_PHASE_SOLVE_START, 54.8 * 1024 ** 3)), smallRepoMarkers[1], buildResourceMarker(resourceSnapshot(RESOURCE_PHASE_SOLVE_EXIT, 55.2 * 1024 ** 3))]);
  const edits = [];
  let statusCalls = 0;
  let sizeCalls = 0;
  const bot = {
    telegram: {
      editMessageText: async (chatId, messageId, _inlineMessageId, text, options) => {
        edits.push({ chatId, messageId, text, options });
      },
      sendMessage: async () => {
        throw new Error('Expected monitor to edit the original Telegram message');
      },
    },
  };

  try {
    trackSession(
      sessionName,
      {
        chatId: 42,
        messageId: 24,
        startTime: new Date(),
        url: 'https://github.com/example/project/issues/2001',
        command: 'solve',
        isolationBackend: 'docker',
        sessionId: sessionName,
        containerFilesystemStartBytes: 52 * 1024,
        logPath: logFile,
        tool: 'codex',
      },
      false
    );

    const statusProvider = async () => {
      statusCalls++;
      if (statusCalls === 1) {
        return { exists: true, status: 'executing', exitCode: null, logPath: logFile, raw: '' };
      }
      return {
        exists: true,
        status: 'executed',
        exitCode: 0,
        startTime: new Date(Date.now() - 60_000).toISOString(),
        endTime: new Date().toISOString(),
        logPath: logFile,
        raw: '',
      };
    };

    const dockerContainerSizeProvider = async () => {
      sizeCalls++;
      return sizeCalls === 1 ? 120 * 1024 ** 2 : null;
    };

    await monitorSessions(bot, false, { statusProvider, dockerContainerSizeProvider });
    assert.equal(getActiveSessionCount(false), 1, 'running session remains tracked after the first monitor pass');
    assert.equal(sizeCalls, 1, 'running docker session records a writable-layer sample');

    await monitorSessions(bot, false, {
      statusProvider,
      dockerContainerSizeProvider,
      removeDockerContainer: async () => ({ success: true }),
    });

    assert.equal(getActiveSessionCount(false), 0, 'completed session is removed after notification');
    assert.equal(sizeCalls, 2, 'terminal pass retries a fresh writable-layer sample');
    assert.equal(edits.length, 1, 'completion message was edited once');
    assert.match(edits[0].text, /Container filesystem size:/);
    assert.match(edits[0].text, /On start:\s+52 KB/);
    assert.match(edits[0].text, /On completion:\s+120 MB/);
    assert.doesNotMatch(edits[0].text, /55\.2 GB/);
    assert.doesNotMatch(edits[0].text, /Total disk usage per task exceeds 5\.0 GB/);
  } finally {
    fs.rmSync(logFile, { force: true });
    __setIsolationRunnerForTests(null);
    resetSessionMonitorForTests();
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
