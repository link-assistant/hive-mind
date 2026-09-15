#!/usr/bin/env node
/**
 * Regression test for issue #2244: the session monitor must snapshot a Docker
 * task container BEFORE its retention policy removes it, and must name the
 * snapshot in the completion message. Capturing afterwards would inspect a
 * container that no longer exists — which is exactly why the incident had no
 * evidence beyond `exitCode=137`.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2244
 */

import assert from 'node:assert/strict';
import { __setIsolationRunnerForTests, monitorSessions, resetSessionMonitorForTests, trackSession } from '../src/session-monitor.lib.mjs';

const terminalStatuses = new Set(['executed', 'completed', 'failed', 'cancelled', 'canceled', 'error', 'killed', 'terminated']);

__setIsolationRunnerForTests({
  isExecutingSessionStatus: status => status === 'executing' || status === 'running',
  isTerminalSessionStatus: status => terminalStatuses.has(status),
  isUnknownDockerExitCode: exitCode => exitCode === null || exitCode === undefined || Number(exitCode) === -1,
  isSessionRunning: async () => false,
  readSessionExitFromLog: () => ({ finished: false, exitCode: null, endTime: null }),
});

async function runDockerSession({ status, exitCode, env = {}, oomKilled = false }) {
  resetSessionMonitorForTests();
  const sessionName = `2244-${status}-${exitCode ?? 'none'}`;
  const events = [];
  const edits = [];

  trackSession(
    sessionName,
    {
      chatId: 1,
      messageId: 2,
      startTime: new Date('2026-09-09T17:43:01.000Z'),
      url: 'https://github.com/link-assistant/hive-mind/issues/2244',
      command: 'solve',
      isolationBackend: 'docker',
      sessionId: sessionName,
      tool: 'claude',
    },
    false
  );

  const bot = {
    telegram: {
      editMessageText: async (chatId, messageId, _inline, text) => {
        edits.push(text);
        events.push('notify');
      },
      sendMessage: async text => {
        edits.push(text);
        events.push('notify');
        return { chat: { id: 1 }, message_id: 2 };
      },
    },
  };

  await monitorSessions(bot, false, {
    env,
    statusProvider: async sessionId => ({
      exists: true,
      uuid: sessionId,
      status,
      exitCode,
      logPath: '/tmp/start-command/logs/isolation/docker/2244.log',
      startTime: '2026-09-09T17:43:01.000Z',
      endTime: '2026-09-09T17:43:07.000Z',
      raw: '',
    }),
    captureDockerDiagnostics: async args => {
      events.push('capture');
      return {
        captured: true,
        directory: '/tmp/start-command/logs/isolation/docker/2244.diagnostics',
        files: ['container-inspect.json', 'container-logs.txt', 'dockerd.log', 'summary.txt'],
        facts: { exitCode: args.exitCode, signal: 'SIGKILL', oomKilled, status: 'exited', lifetimeMs: 5563 },
        errors: [],
      };
    },
    removeDockerContainer: async () => {
      events.push('remove');
      return { success: true, output: '', error: null };
    },
    lookupLinkedPullRequest: async () => null,
    readFile: async () => {
      throw Object.assign(new Error('no log in this test'), { code: 'ENOENT' });
    },
  });

  return { events, message: edits.join('\n') };
}

console.log('Testing issue #2244: container diagnostics are captured before reaping');

const killed = await runDockerSession({ status: 'killed', exitCode: 137, env: { HIVE_MIND_KEEP_TASK_CONTAINER: 'never' } });
assert.deepEqual(
  killed.events.filter(event => event !== 'notify'),
  ['capture', 'remove'],
  'the container must be snapshotted before it is removed'
);
assert.ok(killed.events.indexOf('capture') < killed.events.indexOf('notify'), 'the snapshot must exist before the user is told where it is');
assert.match(killed.message, /Container diagnostics saved/);
assert.match(killed.message, /2244\.diagnostics/);
assert.match(killed.message, /SIGKILL/);

// The container's own OOMKilled flag is ground truth: it must reach the kill
// verdict, which otherwise falls back to "forced kill" as it did in the incident.
const oomKilled = await runDockerSession({ status: 'killed', exitCode: 137, oomKilled: true });
assert.match(oomKilled.message, /out of memory/i);
assert.match(oomKilled.message, /State\.OOMKilled = true/);

const succeeded = await runDockerSession({ status: 'executed', exitCode: 0 });
assert.ok(!succeeded.events.includes('capture'), 'a clean run costs no extra docker calls');
assert.ok(!/Container diagnostics saved/.test(succeeded.message), 'a clean run says nothing about diagnostics');

console.log('PASS issue #2244: diagnostics captured before container removal');
