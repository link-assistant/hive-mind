#!/usr/bin/env node

/**
 * Tests for `hive-screens` (src/hive-screens.mjs + src/hive-screens.lib.mjs).
 *
 * Covers issue #1649: the JS port of the `hive-screens.sh` script embedded
 * in README.md. The critical invariant under test is that `--list`,
 * `--enter`, and `--close` all route through the same matching predicate,
 * so anything visible under `--list` will be acted on by the other flags.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { HIVE_SCREENS_HELP, captureSessionScrollback, findMatchingSessions, listDetachedSessions, parseHiveScreensArgs, runHiveScreens, selectMatches, sessionMatches } from '../src/hive-screens.lib.mjs';

// --- package.json contract ---
const pkg = JSON.parse(await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf-8'));
assert.equal(pkg.bin['hive-screens'], './src/hive-screens.mjs', 'package.json should expose hive-screens as a bin command');
assert.ok(pkg.scripts['build:pre'].includes('chmod +x src/hive-screens.mjs'), 'build:pre should mark hive-screens.mjs executable');

// --- arg parsing ---
assert.deepEqual(parseHiveScreensArgs(['--list']), { enter: false, close: false, list: true, selection: 'oldest', help: false, error: null }, '--list defaults to --oldest selection');
assert.deepEqual(parseHiveScreensArgs(['--enter', '--newest']), { enter: true, close: false, list: false, selection: 'newest', help: false, error: null }, '--enter + --newest are parsed together');
assert.deepEqual(parseHiveScreensArgs(['--close', '--all']), { enter: false, close: true, list: false, selection: 'all', help: false, error: null }, '--close + --all are parsed together');
assert.equal(parseHiveScreensArgs([]).error, 'Must specify --list, --enter, or --close', 'missing action is an error');
assert.equal(parseHiveScreensArgs(['--enter', '--close']).error, 'Specify only one of --list, --enter, --close', 'conflicting actions rejected');
assert.equal(parseHiveScreensArgs(['--list', '--oldest', '--newest']).error, 'Conflicting selection flags: --oldest and --newest', 'conflicting selection rejected');
assert.equal(parseHiveScreensArgs(['--bogus']).error, 'Unknown option: --bogus', 'unknown option rejected');
assert.equal(parseHiveScreensArgs(['--help']).help, true, '--help sets help');
assert.equal(parseHiveScreensArgs(['-h']).help, true, '-h sets help');

// --- sessionMatches (shared predicate) ---
const POSITIVE_TEXT = ['some earlier output', 'Process completed.', 'Full log file: /tmp/solve-123.log', 'Issue: https://github.com/link-assistant/hive-mind/issues/42', 'PR is mergeable! enabling auto-merge'].join('\n');
const positive = sessionMatches(POSITIVE_TEXT);
assert.equal(positive.matched, true, 'completed+mergeable scrollback matches');
assert.equal(positive.logPath, '/tmp/solve-123.log', 'last Full log file: path is extracted');
assert.equal(positive.issueUrl, 'https://github.com/link-assistant/hive-mind/issues/42', 'Issue URL is extracted');

const MERGED_TEXT = 'process completed\nPR merged!\nIssue: https://github.com/example/repo/issues/1\nFull log file: /tmp/a.log';
assert.equal(sessionMatches(MERGED_TEXT).matched, true, '"PR merged!" also qualifies');

assert.equal(sessionMatches('process completed\n(no mergeable/merged line)').matched, false, 'missing merge line does not match');
assert.equal(sessionMatches('pr is mergeable!\n(no completion line)').matched, false, 'missing completion line does not match');
assert.equal(sessionMatches('').matched, false, 'empty scrollback does not match');
assert.equal(sessionMatches(null).matched, false, 'null scrollback does not match');

// Both orderings matter — if either regex is independently absent, no match.
assert.equal(sessionMatches('Process Completed\nPR Is Mergeable!').matched, true, 'predicate is case-insensitive');

// --- listDetachedSessions ---
const fakeScreenLs = () =>
  Promise.resolve({
    stdout: ['There are screens on:', '\t20001.solve-b\t(04/20/2026 10:00:00)\t(Detached)', '\t10001.solve-a\t(04/20/2026 09:00:00)\t(Detached)', '\t30001.solve-c\t(04/20/2026 11:00:00)\t(Attached)', '3 Sockets in /run/screen.'].join('\n'),
  });
const sessions = await listDetachedSessions({ exec: fakeScreenLs });
assert.deepEqual(sessions, ['10001.solve-a', '20001.solve-b'], 'only detached sessions, sorted oldest first by PID');

const noSessionsExec = () => Promise.reject(Object.assign(new Error('no sessions'), { stdout: 'No Sockets found.\n' }));
assert.deepEqual(await listDetachedSessions({ exec: noSessionsExec }), [], 'no sessions yields empty array');

// --- selectMatches ---
const MATCHES = [
  { session: '10001.a', logPath: null, issueUrl: null },
  { session: '20001.b', logPath: null, issueUrl: null },
  { session: '30001.c', logPath: null, issueUrl: null },
];
assert.deepEqual(selectMatches(MATCHES, 'oldest'), [MATCHES[0]], '--oldest picks the first in oldest-first order');
assert.deepEqual(selectMatches(MATCHES, 'all'), MATCHES, '--all returns every match');
assert.deepEqual(selectMatches([], 'all'), [], 'empty match list stays empty');

// --- findMatchingSessions uses sessionMatches for every session ---
// This is the core safety invariant from #1649: list/enter/close share the
// matching function, so anything visible in list is actionable.
const scrollbackBySession = {
  '10001.solve-a': 'process completed\nPR is mergeable!\nFull log file: /tmp/a.log\nIssue: https://github.com/o/r/issues/1',
  '20001.solve-b': 'nothing interesting here',
  '30001.solve-c': 'Process Completed\nPR merged!\nFull log file: /tmp/c.log\nIssue: https://github.com/o/r/issues/3',
};
const captureCalls = [];
const stubCapture = async session => {
  captureCalls.push(session);
  return scrollbackBySession[session] || '';
};

const fakeScreenLsFull = () =>
  Promise.resolve({
    stdout: ['There are screens on:', '\t10001.solve-a\t(04/20/2026 09:00:00)\t(Detached)', '\t20001.solve-b\t(04/20/2026 10:00:00)\t(Detached)', '\t30001.solve-c\t(04/20/2026 11:00:00)\t(Detached)', '3 Sockets in /run/screen.'].join('\n'),
  });

// Monkey-patch captureSessionScrollback via a wrapper so findMatchingSessions
// can reuse the stub instead of shelling out.
const findMatchingSessionsWithStub = async order => {
  const listed = await listDetachedSessions({ exec: fakeScreenLsFull });
  const ordered = order === 'newest' ? [...listed].reverse() : listed;
  const out = [];
  for (const session of ordered) {
    const text = await stubCapture(session);
    const res = sessionMatches(text);
    if (res.matched) out.push({ session, logPath: res.logPath, issueUrl: res.issueUrl });
  }
  return out;
};
const oldestFirst = await findMatchingSessionsWithStub('oldest');
assert.deepEqual(
  oldestFirst.map(m => m.session),
  ['10001.solve-a', '30001.solve-c'],
  'matching sessions returned oldest-first'
);
const newestFirst = await findMatchingSessionsWithStub('newest');
assert.deepEqual(
  newestFirst.map(m => m.session),
  ['30001.solve-c', '10001.solve-a'],
  'newest order reverses the list'
);

// sanity: the orchestrator above touches every session — this is what makes
// --list a safe preview of --close.
assert.equal(captureCalls.length, 6, 'capture is attempted for every detached session');

// --- findMatchingSessions (real helper) wired through fake exec+fs ---
const stdoutBySession = {
  '10001.solve-a': 'process completed\nPR is mergeable!\nFull log file: /tmp/a.log\nIssue: https://github.com/o/r/issues/1',
  '20001.solve-b': 'nothing interesting here',
};
let nextReadContent = '';
const fakeExec = cmd => {
  if (cmd === 'screen -ls') {
    return Promise.resolve({
      stdout: ['There are screens on:', '\t10001.solve-a\t(04/20/2026 09:00:00)\t(Detached)', '\t20001.solve-b\t(04/20/2026 10:00:00)\t(Detached)', '2 Sockets in /run/screen.'].join('\n'),
    });
  }
  const hardcopyMatch = cmd.match(/hardcopy -h '([^']+)'/);
  if (hardcopyMatch) {
    const sessionMatch = cmd.match(/screen -S '([^']+)'/);
    nextReadContent = stdoutBySession[sessionMatch[1]] || '';
    return Promise.resolve({ stdout: '' });
  }
  return Promise.resolve({ stdout: '' });
};
const fakeFs = {
  readFile: async () => nextReadContent,
  unlink: async () => {},
};
const realMatches = await findMatchingSessions({
  exec: fakeExec,
  fsModule: fakeFs,
  order: 'oldest',
  captureOptions: { settleMs: 0 },
});
assert.deepEqual(
  realMatches.map(m => m.session),
  ['10001.solve-a'],
  'findMatchingSessions reads hardcopy output via exec+fs stubs'
);
assert.equal(realMatches[0].logPath, '/tmp/a.log', 'logPath extracted through the full pipeline');
assert.equal(realMatches[0].issueUrl, 'https://github.com/o/r/issues/1', 'issueUrl extracted through the full pipeline');

// --- captureSessionScrollback strips non-printable characters ---
const fakeExec2 = () => Promise.resolve({ stdout: '' });
const fakeFs2 = {
  readFile: async () => 'clean text\n\x00\x01garbage\x1b[31mmore\x1b[0m',
  unlink: async () => {},
};
const captured = await captureSessionScrollback('42.solve', { exec: fakeExec2, fsModule: fakeFs2, settleMs: 0 });
assert.ok(captured.includes('clean text'), 'printable text is preserved');
assert.ok(!captured.includes('\x00'), 'NUL bytes are stripped');
assert.ok(!captured.includes('\x1b'), 'ANSI escape bytes are stripped');

// --- runHiveScreens --list with no sessions ---
const logs = [];
const errs = [];
const noSessionsCode = await runHiveScreens(['--list'], {
  exec: () => Promise.resolve({ stdout: 'No Sockets found.\n' }),
  fsModule: { readFile: async () => '', unlink: async () => {} },
  log: (...a) => logs.push(a.join(' ')),
  error: (...a) => errs.push(a.join(' ')),
  captureOptions: { settleMs: 0 },
});
assert.equal(noSessionsCode, 0, 'no sessions exits 0');
assert.ok(
  logs.some(line => line === 'No matching sessions'),
  'prints "No matching sessions"'
);

// --- runHiveScreens --list prints each match and no side effects ---
const logs2 = [];
const errs2 = [];
const listCode = await runHiveScreens(['--list', '--all'], {
  exec: fakeExec,
  fsModule: fakeFs,
  log: (...a) => logs2.push(a.join(' ')),
  error: (...a) => errs2.push(a.join(' ')),
  captureOptions: { settleMs: 0 },
});
assert.equal(listCode, 0, '--list returns 0');
assert.ok(
  logs2.some(l => l.startsWith('Session: 10001.solve-a')),
  '--list prints matched session'
);
assert.ok(!logs2.some(l => l.startsWith('Entering')), '--list never enters a session');
assert.ok(!logs2.some(l => l.startsWith('Closing')), '--list never closes a session');

// --- runHiveScreens --close sends screen -X stuff exit ---
const closeExecCalls = [];
const closeExec = cmd => {
  closeExecCalls.push(cmd);
  return fakeExec(cmd);
};
const logs3 = [];
await runHiveScreens(['--close', '--all'], {
  exec: closeExec,
  fsModule: fakeFs,
  log: (...a) => logs3.push(a.join(' ')),
  error: () => {},
  captureOptions: { settleMs: 0 },
});
assert.ok(
  closeExecCalls.some(cmd => /screen -S '10001\.solve-a' -X stuff \$'exit\\n'/.test(cmd)),
  '--close sends "exit\\n" via screen -X stuff'
);
assert.ok(
  logs3.some(l => l === 'Closing 10001.solve-a'),
  '--close logs "Closing <session>"'
);

// --- runHiveScreens --enter spawns screen -r via injected hook ---
const enterCalls = [];
const logs4 = [];
await runHiveScreens(['--enter', '--oldest'], {
  exec: fakeExec,
  fsModule: fakeFs,
  log: (...a) => logs4.push(a.join(' ')),
  error: () => {},
  spawnScreen: session => {
    enterCalls.push(session);
    return Promise.resolve();
  },
  captureOptions: { settleMs: 0 },
});
assert.deepEqual(enterCalls, ['10001.solve-a'], '--enter invokes spawnScreen with the selected session');
assert.ok(
  logs4.some(l => l === 'Entering 10001.solve-a'),
  '--enter logs "Entering <session>"'
);
assert.ok(
  logs4.some(l => l === 'Left 10001.solve-a'),
  '--enter logs "Left <session>" after spawnScreen resolves'
);

// --- runHiveScreens --help exits 0 and prints help ---
const helpLogs = [];
const helpCode = await runHiveScreens(['--help'], { log: (...a) => helpLogs.push(a.join(' ')), error: () => {} });
assert.equal(helpCode, 0, '--help exits 0');
assert.ok(helpLogs.join('\n').includes('hive-screens'), 'help text includes command name');
assert.ok(HIVE_SCREENS_HELP.includes('--list'), 'help text includes --list');
assert.ok(HIVE_SCREENS_HELP.includes('--enter'), 'help text includes --enter');
assert.ok(HIVE_SCREENS_HELP.includes('--close'), 'help text includes --close');
assert.ok(HIVE_SCREENS_HELP.includes('issue #1649') || HIVE_SCREENS_HELP.includes('issues/1649'), 'help text references issue #1649');

// --- bin smoke test: spawn the real mjs file with no args and confirm the validation error ---
const runBin = (args = []) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/hive-screens.mjs', ...args], { stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });

const noArgs = await runBin([]);
assert.equal(noArgs.code, 1, 'bin exits 1 when no action flag is given');
assert.ok(noArgs.stderr.includes('Must specify'), 'bin prints validation error to stderr');

const helpRun = await runBin(['--help']);
assert.equal(helpRun.code, 0, 'bin exits 0 for --help');
assert.ok(helpRun.stdout.includes('hive-screens'), 'bin prints help to stdout');

console.log('All hive-screens tests passed');
