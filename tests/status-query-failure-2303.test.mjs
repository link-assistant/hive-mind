#!/usr/bin/env node
/**
 * Regression test for issue #2303, remaining item RC4: a session whose
 * `$ --status` query keeps failing used to end on the first failure as
 * "⚠️ Work session ended, but its exit status is unknown" — no kill diagnosis
 * and no `--on-session-kill=resume` recovery.
 *
 * Asserted here: a failed status query keeps the session tracked; a written log
 * footer still settles the outcome at once; after STATUS_QUERY_ERROR_LIMIT
 * consecutive failures the monitor asks docker directly and reports the session
 * as still running, finished with docker's own exit code, or killed (container
 * gone) — and a kill starts the automatic resume.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2303
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';
import { isExecutingSessionStatus, isTerminalSessionStatus } from '../src/session-status.lib.mjs';
import { isUnknownDockerExitCode, withStatusQueryError } from '../src/isolation-runner.parsers.lib.mjs';
import { __setIsolationRunnerForTests, getActiveSessionCount, getIsolationSessionStateForTests, monitorSessions, resetSessionMonitorForTests, trackSession } from '../src/session-monitor.lib.mjs';
import { STATUS_QUERY_ERROR_LIMIT, parseDockerContainerState } from '../src/session-monitor.status-query.lib.mjs';
import { serializeSessionInfo } from '../src/session-store.lib.mjs';

await initI18n('en');
await preloadAllLocales();

const SESSION = '56291848-d17d-4326-8b41-3ac995221efc';
const TOOL_SESSION = 'a1b2c3d4-0000-4000-8000-000000002303';
const NOT_FINISHED = { finished: false, exitCode: null, endTime: null };
const queryFailure = { exists: false, status: null, exitCode: null, queryError: 'Error: store is locked' };

function stubRunner(world) {
  return {
    isExecutingSessionStatus,
    isTerminalSessionStatus,
    isUnknownDockerExitCode,
    readSessionExitFromLog: () => world.footer || NOT_FINISHED,
    querySessionStatus: async () => {
      world.queries = (world.queries || 0) + 1;
      if (world.throws) throw new Error(world.throws);
      return world.status;
    },
    isSessionRunning: async () => world.alive === true,
    checkBackendSessionAlive: async () => world.alive ?? null,
    inspectDockerContainerState: async () => {
      world.inspects = (world.inspects || 0) + 1;
      return world.docker ?? null;
    },
    getDockerContainerWritableLayerSize: async () => null,
  };
}

async function pollUntilLimit(sessionInfo) {
  let state = null;
  for (let attempt = 1; attempt <= STATUS_QUERY_ERROR_LIMIT; attempt++) state = await getIsolationSessionStateForTests(SESSION, sessionInfo);
  return state;
}

test('$ --status: a failed query is told apart from a missing record', () => {
  const empty = { exists: false, status: null };
  assert.equal(withStatusQueryError(empty, { code: 1, stderr: 'Error: database is locked\n' }).queryError, 'Error: database is locked');
  assert.match(withStatusQueryError(empty, { code: 2, stderr: '' }).queryError, /exited with code 2/);
  assert.equal(withStatusQueryError(empty, { code: 1, stderr: 'Error: No execution found with UUID or session name: x' }).queryError, undefined, 'no record is not a failure');
  assert.equal(withStatusQueryError(empty, { code: 0, stderr: '' }).queryError, undefined);
  const found = { exists: true, status: 'executing' };
  assert.equal(withStatusQueryError(found, { code: 1, stderr: 'warning' }), found, 'a parsed record is kept as is');
});

test('docker inspect state: running, exited, never finished, gone', () => {
  assert.deepEqual(parseDockerContainerState('{"Running":true,"ExitCode":0,"OOMKilled":false,"FinishedAt":"0001-01-01T00:00:00Z"}'), { exists: true, running: true, exitCode: null, oomKilled: false, finishedAt: null });
  assert.deepEqual(parseDockerContainerState('{"Running":false,"ExitCode":137,"OOMKilled":true,"FinishedAt":"2026-09-26T07:26:04.1Z"}'), { exists: true, running: false, exitCode: 137, oomKilled: true, finishedAt: '2026-09-26T07:26:04.1Z' });
  assert.deepEqual(parseDockerContainerState('{"Running":false,"ExitCode":0,"FinishedAt":"0001-01-01T00:00:00Z"}'), { exists: true, running: false, exitCode: null, oomKilled: false, finishedAt: null }, 'a zero FinishedAt is no exit');
  assert.equal(parseDockerContainerState('not json'), null);
});

test('a failing status query keeps the session tracked, then docker decides', async t => {
  t.after(() => __setIsolationRunnerForTests(null));
  const world = { throws: 'spawn $ ENOENT', alive: null, docker: { exists: false } };
  __setIsolationRunnerForTests(stubRunner(world));
  const sessionInfo = { isolationBackend: 'docker', sessionId: SESSION, containerSeenAt: new Date().toISOString(), logPath: '/tmp/session-2303.log' };

  for (let attempt = 1; attempt < STATUS_QUERY_ERROR_LIMIT; attempt++) {
    const state = await getIsolationSessionStateForTests(SESSION, sessionInfo);
    assert.equal(state.running, true, `attempt ${attempt}: still tracked`);
    assert.equal(state.statusQueryError, 'spawn $ ENOENT');
    assert.equal(sessionInfo.statusQueryErrorCount, attempt);
  }
  assert.equal(world.inspects || 0, 0, 'docker is not asked before the limit');
  assert.equal(serializeSessionInfo(sessionInfo).statusQueryErrorCount, STATUS_QUERY_ERROR_LIMIT - 1, 'the streak survives a bot restart');
  const killed = await getIsolationSessionStateForTests(SESSION, sessionInfo);
  assert.equal(killed.running, false);
  assert.equal(killed.status, 'killed', 'a container that is gone without a footer was killed');
  assert.equal(killed.exitCode, null);
  assert.match(killed.statusResult.statusQueryFailure, /could not be read 5 times in a row.*container is gone/);
  assert.equal(killed.statusResult.containerRemoved, true);
  assert.equal(world.inspects, 1);

  // Still running: kept tracked, and docker is asked again on every later poll.
  world.docker = { exists: true, running: true, exitCode: null, oomKilled: false, finishedAt: null };
  sessionInfo.statusQueryErrorCount = 0;
  const running = await pollUntilLimit(sessionInfo);
  assert.equal(running.running, true);
  assert.equal(running.unverifiedRunning, undefined, 'docker confirmed it, so it counts as observed');

  // Finished: docker's own exit code wins.
  world.docker = { exists: true, running: false, exitCode: 0, oomKilled: false, finishedAt: '2026-09-26T07:26:04Z' };
  sessionInfo.statusQueryErrorCount = 0;
  const finished = await pollUntilLimit(sessionInfo);
  assert.deepEqual([finished.running, finished.status, finished.exitCode], [false, 'executed', 0]);

  // OOM-killed: reported as the kill it was.
  world.docker = { exists: true, running: false, exitCode: 137, oomKilled: true, finishedAt: '2026-09-26T07:26:04Z' };
  sessionInfo.statusQueryErrorCount = 0;
  const oom = await pollUntilLimit(sessionInfo);
  assert.deepEqual([oom.status, oom.exitCode, oom.statusResult.oomKilled], ['killed', 137, true]);

  // A successful query resets the streak.
  world.throws = null;
  world.status = { exists: true, status: 'executing', exitCode: null, isolation: 'docker' };
  world.alive = true;
  sessionInfo.statusQueryErrorCount = 3;
  const recovered = await getIsolationSessionStateForTests(SESSION, sessionInfo);
  assert.equal(recovered.running, true);
  assert.equal(sessionInfo.statusQueryErrorCount, undefined, 'the error streak is cleared');
});

test('the production shape (queryError on the record) and the footer shortcut', async t => {
  t.after(() => __setIsolationRunnerForTests(null));
  const world = { status: queryFailure, footer: { finished: true, exitCode: 0, endTime: '2026-09-26 07:26:04.000' }, docker: null };
  __setIsolationRunnerForTests(stubRunner(world));
  const sessionInfo = { isolationBackend: 'docker', sessionId: SESSION, containerSeenAt: new Date().toISOString(), logPath: '/tmp/session-2303.log' };
  const finished = await getIsolationSessionStateForTests(SESSION, sessionInfo);
  assert.deepEqual([finished.running, finished.status, finished.exitCode], [false, 'executed', 0], 'a written footer settles it at once');

  world.footer = { finished: true, exitCode: -1, endTime: null };
  const unknownFooter = await getIsolationSessionStateForTests(SESSION, { ...sessionInfo });
  assert.equal(unknownFooter.running, true, 'a -1 docker footer is no exit and does not end tracking');

  // Not docker, and the backend probe cannot tell: given up as unknown, never as success.
  world.footer = null;
  world.alive = null;
  const screenInfo = { isolationBackend: 'screen', sessionId: SESSION, containerSeenAt: new Date().toISOString() };
  const unknown = await pollUntilLimit(screenInfo);
  assert.deepEqual([unknown.running, unknown.status, unknown.exitCode], [false, null, null]);
  world.alive = false;
  screenInfo.statusQueryErrorCount = 0;
  const screenKilled = await pollUntilLimit(screenInfo);
  assert.equal(screenKilled.status, 'killed', 'a screen session that is gone without a footer was killed');
  assert.equal(screenKilled.statusResult.containerRemoved, undefined);
});

test('end to end: status query keeps failing, container gone, kill reported and auto-resumed', async t => {
  const logPath = path.join(os.tmpdir(), `hive-mind-test-2303-query-${process.pid}.log`);
  fs.writeFileSync(logPath, `📌 Session ID: ${TOOL_SESSION}\nNo space left on device\n`, 'utf8');
  const world = { status: { exists: true, status: 'executing', exitCode: null, isolation: 'docker', logPath }, alive: true, docker: null };
  t.after(() => {
    fs.rmSync(logPath, { force: true });
    __setIsolationRunnerForTests(null);
    resetSessionMonitorForTests();
  });
  resetSessionMonitorForTests();
  __setIsolationRunnerForTests(stubRunner(world));
  const sessionInfo = {
    chatId: 1001,
    messageId: 2002,
    startTime: new Date(Date.now() - 13 * 60 * 60 * 1000),
    command: 'solve',
    tool: 'claude',
    url: 'https://github.com/link-foundation/meta-language/pull/196',
    urlContext: { type: 'pull', owner: 'link-foundation', repo: 'meta-language', number: 196, normalized: 'https://github.com/link-foundation/meta-language/pull/196' },
    args: ['https://github.com/link-foundation/meta-language/pull/196', '--attach-logs'],
    isolationBackend: 'docker',
    sessionId: SESSION,
    logPath,
    locale: 'en',
  };
  trackSession(SESSION, sessionInfo, false);
  const edits = [];
  const bot = { telegram: { editMessageText: async (chatId, messageId, _inline, text) => edits.push({ chatId, messageId, text }), sendMessage: async () => assert.fail('the original reply is edited') } };
  const recoveryLaunches = [];
  const removedContainers = [];
  const options = {
    dockerContainerSizeProvider: async () => 1e9,
    hostDiskProvider: async () => ({ bavail: 120, blocks: 192, bsize: 1e9 }),
    lookupLinkedPullRequest: async () => 'https://github.com/link-foundation/meta-language/pull/196',
    lookupPullRequestState: async () => ({ merged: false, mergedAt: null }),
    env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
    runCommand: async () => ({ code: 0, stdout: 'https://github.com/link-foundation/meta-language/pull/196#issuecomment-1\n', stderr: '' }),
    attachLog: async () => true,
    removeDockerContainer: async name => {
      removedContainers.push(name);
      return { success: true };
    },
    isolationRunner: {
      generateSessionId: () => 'recovery-2303-0000-0000-000000000000',
      executeWithIsolation: async (command, args) => {
        recoveryLaunches.push({ command, args });
        return { success: true };
      },
    },
  };

  await monitorSessions(bot, false, options); // observed running
  world.status = queryFailure;
  world.alive = false;
  world.docker = { exists: false };
  for (let attempt = 1; attempt < STATUS_QUERY_ERROR_LIMIT; attempt++) await monitorSessions(bot, false, options);
  assert.equal(edits.length, 0, 'nothing is reported while the status query fails');
  assert.equal(getActiveSessionCount(false), 1);

  await monitorSessions(bot, false, options);
  const completion = edits.at(-1)?.text || '';
  const headline = completion.split('\n')[0];
  assert.doesNotMatch(headline, /status is unknown|successfully/i, headline);
  assert.match(headline, /recovering from a kill/i);
  assert.match(completion, /Kill diagnostics/);
  assert.match(completion, /status could not be read/);
  assert.equal(recoveryLaunches.length, 1, 'the default --on-session-kill=resume policy restarts the work');
  assert.ok(recoveryLaunches[0].args.includes('--resume') && recoveryLaunches[0].args.includes(TOOL_SESSION), 'the restart resumes the last tool session');
  assert.doesNotMatch(completion, /Docker container kept/, 'a container that is gone is not advertised as kept');
  assert.equal(removedContainers.length, 0);
  assert.equal(getActiveSessionCount(false), 1, 'only the recovery session remains tracked');
});
