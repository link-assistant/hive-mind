#!/usr/bin/env node
/**
 * Regression tests for issue #1979.
 *
 * Finished Docker-isolated task containers used to remain forever as exited
 * containers, keeping their writable layers on disk. The session monitor now
 * applies a success/failure-aware retention policy after the terminal
 * completion message has been handled.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1979
 */

import { __setIsolationRunnerForTests, buildDockerTaskContainerCompletionAction, getActiveSessionCount, monitorSessions, resetSessionMonitorForTests, resolveDockerTaskContainerKeepPolicy, trackSession } from '../src/session-monitor.lib.mjs';
import { assert, getFailCount, printSummary } from './test-helpers.mjs';

console.log('Testing issue #1979: docker task-container reaping');
console.log('='.repeat(60));

const terminalStatuses = new Set(['executed', 'completed', 'failed', 'cancelled', 'canceled', 'error', 'killed', 'terminated']);

__setIsolationRunnerForTests({
  isExecutingSessionStatus: status => status === 'executing' || status === 'running',
  isTerminalSessionStatus: status => terminalStatuses.has(status),
  isUnknownDockerExitCode: exitCode => exitCode === null || exitCode === undefined || Number(exitCode) === -1,
  isSessionRunning: async () => false,
  readSessionExitFromLog: () => ({ finished: false, exitCode: null, endTime: null }),
});

async function runCompletedDockerSession({ status, exitCode, env = {} }) {
  resetSessionMonitorForTests();
  const sessionName = `1979-${status}-${exitCode ?? 'none'}`;
  const removals = [];
  const edits = [];

  trackSession(
    sessionName,
    {
      chatId: 12345,
      messageId: 67890,
      startTime: new Date('2026-06-24T10:00:00.000Z'),
      url: 'https://github.com/link-assistant/hive-mind/issues/1979',
      command: 'solve',
      isolationBackend: 'docker',
      sessionId: sessionName,
      tool: 'codex',
    },
    false
  );

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

  await monitorSessions(bot, false, {
    env,
    statusProvider: async sessionId => ({
      exists: true,
      uuid: sessionId,
      status,
      exitCode,
      startTime: '2026-06-24T10:00:00.000Z',
      endTime: '2026-06-24T10:03:00.000Z',
      raw: '',
    }),
    removeDockerContainer: async (containerName, verbose) => {
      removals.push({ containerName, verbose });
      return { success: true, output: containerName, error: null };
    },
  });

  return { sessionName, removals, edits, activeCount: getActiveSessionCount(false) };
}

assert(resolveDockerTaskContainerKeepPolicy({ env: {} }) === 'on-failure', 'default keep policy is on-failure');
assert(resolveDockerTaskContainerKeepPolicy({ env: { HIVE_MIND_KEEP_TASK_CONTAINER: 'ALWAYS' } }) === 'always', 'keep policy is case-insensitive');
assert(resolveDockerTaskContainerKeepPolicy({ env: { HIVE_MIND_KEEP_TASK_CONTAINER: 'bogus' } }) === 'on-failure', 'invalid keep policy falls back to on-failure');

const nonDockerAction = buildDockerTaskContainerCompletionAction({
  sessionName: 'screen-session',
  sessionInfo: { isolationBackend: 'screen', sessionId: 'screen-session' },
  exitCode: 0,
  status: 'executed',
});
assert(nonDockerAction.applies === false && nonDockerAction.shouldRemove === false, 'non-docker sessions never trigger docker cleanup');

const ambiguousDockerAction = buildDockerTaskContainerCompletionAction({
  sessionName: 'ambiguous-docker-session',
  sessionInfo: { isolationBackend: 'docker', sessionId: 'ambiguous-docker-session' },
  exitCode: null,
  status: null,
});
assert(ambiguousDockerAction.applies === true && ambiguousDockerAction.shouldRemove === false, 'ambiguous docker completion keeps the container by default');
assert(ambiguousDockerAction.extraSection.includes('docker rm -f ambiguous-docker-session'), 'ambiguous kept container message includes manual cleanup');

const executedWithoutExitAction = buildDockerTaskContainerCompletionAction({
  sessionName: 'executed-without-exit',
  sessionInfo: { isolationBackend: 'docker', sessionId: 'executed-without-exit' },
  exitCode: null,
  status: 'executed',
});
assert(executedWithoutExitAction.shouldRemove === true, 'executed docker status without an exit code is removed after liveness checks pass');

const success = await runCompletedDockerSession({ status: 'executed', exitCode: 0 });
assert(success.removals.length === 1, 'successful docker task removes the container by default');
assert(success.removals[0].containerName === success.sessionName, 'cleanup targets the session UUID container name');
assert(!success.edits[0].text.includes('Docker container kept'), 'successful default cleanup does not show keep instructions');
assert(success.activeCount === 0, 'successful docker session is untracked after cleanup attempt');

const failure = await runCompletedDockerSession({ status: 'failed', exitCode: 2 });
assert(failure.removals.length === 0, 'failed docker task is kept by default');
assert(failure.edits[0].text.includes('*Docker container kept*'), 'failed docker task completion message says the container was kept');
assert(failure.edits[0].text.includes(`docker rm -f ${failure.sessionName}`), 'failed docker task message includes cleanup command');
assert(failure.activeCount === 0, 'failed docker session is still completed in the monitor');

const neverKeep = await runCompletedDockerSession({
  status: 'failed',
  exitCode: 2,
  env: { HIVE_MIND_KEEP_TASK_CONTAINER: 'never' },
});
assert(neverKeep.removals.length === 1, 'HIVE_MIND_KEEP_TASK_CONTAINER=never removes failed containers too');
assert(!neverKeep.edits[0].text.includes('Docker container kept'), 'never policy suppresses keep instructions');

const alwaysKeep = await runCompletedDockerSession({
  status: 'executed',
  exitCode: 0,
  env: { HIVE_MIND_KEEP_TASK_CONTAINER: 'always' },
});
assert(alwaysKeep.removals.length === 0, 'HIVE_MIND_KEEP_TASK_CONTAINER=always keeps successful containers');
assert(alwaysKeep.edits[0].text.includes('*Docker container kept*'), 'always policy surfaces keep instructions for successful containers');

resetSessionMonitorForTests();
__setIsolationRunnerForTests(null);

printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
