/**
 * @hive-mind-test-suite default
 *
 * Issue #3215: a plain start-screen session (no isolation) keeps its screen
 * alive with `exec bash`, so the session monitor never saw the work end. It
 * expired the session after 10 minutes and, since #3209, reported
 * "⚠️ Work session ended, but its exit status is unknown" for every such run —
 * even while the work was still running. start-screen now records the exit
 * status in a file the monitor reads; a session without one says it is no
 * longer tracked instead of claiming it ended.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScreenExitMarkerSuffix, getNonIsolationSessionProgress, getScreenExitMarkerPath, parseScreenExitMarkerPath, prepareScreenExitMarker, readScreenExitMarker, NON_ISOLATION_MARKED_SESSION_TIMEOUT_MS, NON_ISOLATION_SESSION_TIMEOUT_MS } from '../src/start-screen-exit-marker.lib.mjs';
import { hasActiveSessionForUrl, monitorSessions, resetSessionMonitorForTests, trackSession } from '../src/session-monitor.lib.mjs';
import { buildExecuteAndUpdateMessage } from '../src/telegram-command-execution.lib.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const makeTmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hive-mind-3215-exit-'));

test('marker paths keep only shell-safe characters and the suffix records $?', async () => {
  const tmpDir = makeTmpDir();
  try {
    const markerPath = getScreenExitMarkerPath("solve-owner-re'po;rm -rf-1", { tmpDir });
    assert.equal(path.basename(markerPath), 'solve-owner-re_po_rm_-rf-1.exit');
    prepareScreenExitMarker(markerPath);
    const run = spawnSync('bash', ['-c', `(exit 7)${buildScreenExitMarkerSuffix(markerPath)}; exit 0`]);
    assert.equal(run.status, 0);
    assert.equal(await readScreenExitMarker(markerPath), 7);
    assert.throws(() => buildScreenExitMarkerSuffix("/tmp/a'b.exit"), /Unsupported exit marker path/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('a missing, empty or partial marker means the command is still running', async () => {
  const tmpDir = makeTmpDir();
  try {
    const markerPath = path.join(tmpDir, 's.exit');
    assert.equal(await readScreenExitMarker(null), null);
    assert.equal(await readScreenExitMarker(markerPath), null);
    fs.writeFileSync(markerPath, '');
    assert.equal(await readScreenExitMarker(markerPath), null);
    fs.writeFileSync(markerPath, '0\n');
    assert.equal(await readScreenExitMarker(markerPath), 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('the bot reads the marker path from start-screen output', () => {
  assert.equal(parseScreenExitMarkerPath('Started solve in detached screen session: solve-a-b-1\nExit status file: /tmp/hive-mind-screen-exit/solve-a-b-1.exit\n'), '/tmp/hive-mind-screen-exit/solve-a-b-1.exit');
  // An older start-screen prints no marker; the session keeps the 10 minute expiry.
  assert.equal(parseScreenExitMarkerPath('Started solve in detached screen session: solve-a-b-1\n'), null);
});

test('progress: a recorded status finishes the session; without one the legacy and marker windows differ', () => {
  const now = Date.now();
  const thirtyMinutesAgo = new Date(now - 30 * 60 * 1000);
  const legacy = getNonIsolationSessionProgress({ startTime: thirtyMinutesAgo }, { now });
  assert.deepEqual([legacy.finished, legacy.expired, legacy.timeoutMs], [false, true, NON_ISOLATION_SESSION_TIMEOUT_MS]);
  const marked = getNonIsolationSessionProgress({ startTime: thirtyMinutesAgo, exitMarkerPath: '/tmp/s.exit' }, { now });
  assert.deepEqual([marked.finished, marked.expired, marked.timeoutMs], [false, false, NON_ISOLATION_MARKED_SESSION_TIMEOUT_MS]);
  // The monitor caches what it read from the marker; the synchronous queries use that.
  const finished = getNonIsolationSessionProgress({ startTime: thirtyMinutesAgo, exitMarkerPath: '/tmp/s.exit', recordedExitCode: 3 }, { now });
  assert.deepEqual([finished.finished, finished.exitCode, finished.expired], [true, 3, false]);
});

function screenBot() {
  const edits = [];
  return {
    edits,
    bot: {
      telegram: {
        editMessageText: async (_chatId, _messageId, _inline, message) => {
          edits.push(message);
        },
        sendMessage: async () => ({ chat: { id: 1 }, message_id: 1 }),
      },
    },
  };
}

const monitorOptions = { lookupLinkedPullRequest: async () => null, lookupPullRequestState: async () => null, readFile: async () => '' };

test('monitor: the recorded exit status ends the session with that code', async () => {
  const tmpDir = makeTmpDir();
  const markerPath = path.join(tmpDir, 'solve-o-r-1.exit');
  fs.writeFileSync(markerPath, '0\n');
  const { bot, edits } = screenBot();
  resetSessionMonitorForTests();
  try {
    trackSession('solve-o-r-1', { chatId: 1, messageId: 2, startTime: new Date(Date.now() - 60_000), url: 'https://github.com/o/r/issues/1', command: 'solve', tool: 'claude', exitMarkerPath: markerPath }, false);
    await monitorSessions(bot, false, monitorOptions);
    assert.equal(hasActiveSessionForUrl('https://github.com/o/r/issues/1').isActive, false, 'a finished session no longer blocks the URL');
    assert.equal(edits.length, 1);
    assert.match(edits[0], /✅ \*Work session finished successfully\*/);
    assert.doesNotMatch(edits[0], /status is unknown/);
    const deadline = Date.now() + 5_000;
    while (fs.existsSync(markerPath) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(fs.existsSync(markerPath), false, 'the marker is removed once reported');
  } finally {
    resetSessionMonitorForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('monitor: a failing exit status is reported as a failure', async () => {
  const tmpDir = makeTmpDir();
  const markerPath = path.join(tmpDir, 'solve-o-r-2.exit');
  fs.writeFileSync(markerPath, '1\n');
  const { bot, edits } = screenBot();
  resetSessionMonitorForTests();
  try {
    trackSession('solve-o-r-2', { chatId: 1, messageId: 2, startTime: new Date(Date.now() - 60_000), url: 'https://github.com/o/r/issues/2', command: 'solve', tool: 'claude', exitMarkerPath: markerPath }, false);
    await monitorSessions(bot, false, monitorOptions);
    assert.match(edits[0] || '', /Work session failed \(exit code: 1\)/);
  } finally {
    resetSessionMonitorForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('a session with a marker path still blocks duplicates after 10 minutes', () => {
  const tmpDir = makeTmpDir();
  resetSessionMonitorForTests();
  try {
    const url = 'https://github.com/o/r/issues/3';
    trackSession('solve-o-r-3', { chatId: 1, messageId: 2, startTime: new Date(Date.now() - NON_ISOLATION_SESSION_TIMEOUT_MS - 60_000), url, command: 'solve', tool: 'claude', exitMarkerPath: path.join(tmpDir, 'solve-o-r-3.exit') }, false);
    assert.equal(hasActiveSessionForUrl(url).isActive, true, 'the running session keeps blocking duplicates');
  } finally {
    resetSessionMonitorForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('monitor: an expired session without a status says it is no longer tracked, not that it ended', async () => {
  const { bot, edits } = screenBot();
  resetSessionMonitorForTests();
  try {
    trackSession('solve-o-r-4', { chatId: 1, messageId: 2, startTime: new Date(Date.now() - NON_ISOLATION_SESSION_TIMEOUT_MS - 60_000), url: 'https://github.com/o/r/issues/4', command: 'solve', tool: 'claude' }, false);
    await monitorSessions(bot, false, monitorOptions);
    assert.equal(edits.length, 1);
    assert.match(edits[0], /ℹ️ \*Stopped tracking the work session after 10 minutes without an exit status; it may still be running in its screen session\*/);
    assert.match(edits[0], /Session: `solve-o-r-4`/);
    assert.doesNotMatch(edits[0], /✅|⚠️ Work session ended/);
  } finally {
    resetSessionMonitorForTests();
  }
});

test('bot: the screen launch path stores the marker path on the tracked session', async () => {
  const tracked = [];
  const execute = buildExecuteAndUpdateMessage({
    resolveIsolation: async () => null,
    VERBOSE: false,
    executeStartScreen: async () => ({ success: true, output: 'Started solve in detached screen session: solve-o-r-5\nExit status file: /tmp/hive-mind-screen-exit/solve-o-r-5.exit\n' }),
    trackSession: (name, info) => tracked.push({ name, info }),
    formatExecutingWorkSessionMessage: () => 'executing',
  });
  const ctx = { chat: { id: 1 }, from: { id: 2 }, telegram: { editMessageText: async () => {} } };
  await execute(ctx, { chat: { id: 1 }, message_id: 3 }, 'solve', ['https://github.com/o/r/issues/5'], '');
  assert.equal(tracked.length, 1);
  assert.equal(tracked[0].name, 'solve-o-r-5');
  assert.equal(tracked[0].info.exitMarkerPath, '/tmp/hive-mind-screen-exit/solve-o-r-5.exit');
});

const hasScreen = spawnSync('sh', ['-c', 'command -v screen']).status === 0;

test('start-screen records the exit status of the launched command', { skip: hasScreen ? false : 'GNU screen is not installed', timeout: 60_000 }, async () => {
  const tmpDir = makeTmpDir();
  const binDir = path.join(tmpDir, 'bin');
  fs.mkdirSync(binDir);
  // A stand-in `solve` that exits with a recognisable code.
  fs.writeFileSync(path.join(binDir, 'solve'), '#!/bin/sh\nexit 4\n', { mode: 0o755 });
  const issueNumber = String(process.pid);
  const sessionName = `solve-hive-mind-test-exit-marker-${issueNumber}`;
  const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}`, TMPDIR: tmpDir, HIVE_MIND_SUPPRESS_DEPRECATIONS: '1' };
  try {
    const run = spawnSync(process.execPath, [path.join(repoRoot, 'src/start-screen.mjs'), 'solve', `https://github.com/hive-mind-test/exit-marker/issues/${issueNumber}`], { env, encoding: 'utf8', cwd: tmpDir, timeout: 45_000 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const markerPath = parseScreenExitMarkerPath(run.stdout);
    assert.equal(markerPath, getScreenExitMarkerPath(sessionName, { tmpDir }));
    const deadline = Date.now() + 20_000;
    while ((await readScreenExitMarker(markerPath)) === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await readScreenExitMarker(markerPath), 4);
  } finally {
    spawnSync('screen', ['-S', sessionName, '-X', 'quit']);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
