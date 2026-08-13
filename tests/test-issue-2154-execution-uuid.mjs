#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Issue #2154, "no way to see UUIDs of each task's log" and "these tasks are
 * not in list".
 *
 * Every isolated task carries *two* UUIDs, and until now Hive Mind only ever
 * showed one of them. Hive Mind generates the session name and passes it to
 * start-command as `--session`; start-command then mints its own execution UUID
 * and prints it in the launch banner:
 *
 * ```
 * │ session   edc7b051-e12f-4f7b-b677-c885f3208407
 * │ start     2026-08-12 22:36:05.577
 * │
 * │ isolation docker
 * │ mode      detached
 * │ image     konard/hive-mind-dind:2.12.2
 * │ container 0a3627ef-f1f1-4801-a073-3678b9453db7
 * ```
 *
 * `$ --list` reports the *execution* UUID. Telegram, the structured log and the
 * durable session snapshot all reported the *session* UUID. So when the
 * maintainer compared the bot with `$ --list` and saw `d5b8f0af-…` and
 * `edc7b051-…`, nothing the bot had ever printed could be matched against them —
 * even for the two tasks that were running perfectly well.
 *
 * These tests pin the correlation: the execution UUID is parsed from the launch
 * banner, travels with the session, is persisted, is logged, and is shown next
 * to the session UUID in Telegram.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2154
 */

import assert from 'assert/strict';

import { parseStartCommandExecutionUuid } from '../src/isolation-runner.lib.mjs';
import { buildExecuteAndUpdateMessage } from '../src/telegram-command-execution.lib.mjs';
import { formatExecutingWorkSessionMessage, formatSessionCompletionMessage, formatStartingWorkSessionMessage } from '../src/work-session-formatting.lib.mjs';
import { serializeSessionInfo } from '../src/session-store.lib.mjs';
import { monitorSessions, resetSessionMonitorForTests, setSessionLogger, setSessionStore, trackSession } from '../src/session-monitor.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.stack || error.message}`);
    failed++;
  }
}

const SESSION = '0a3627ef-f1f1-4801-a073-3678b9453db7';
const EXECUTION = 'edc7b051-e12f-4f7b-b677-c885f3208407';

/** The launch banner exactly as it appears in the issue's bot log. */
const LAUNCH_OUTPUT = ['│ session   edc7b051-e12f-4f7b-b677-c885f3208407', '│ start     2026-08-12 22:36:05.577', '│', '│ isolation docker', '│ mode      detached', '│ image     konard/hive-mind-dind:2.12.2', '│ container 0a3627ef-f1f1-4801-a073-3678b9453db7', ''].join('\n');

await test('the execution UUID is read from the real launch banner', async () => {
  assert.equal(parseStartCommandExecutionUuid(LAUNCH_OUTPUT), EXECUTION);
});

await test('the container/session UUID is not mistaken for the execution UUID', async () => {
  // Both UUIDs appear in the same banner; picking the wrong one would be worse
  // than picking none, because it would look like a correlation that is false.
  assert.notEqual(parseStartCommandExecutionUuid(LAUNCH_OUTPUT), SESSION);
});

await test('a banner without the box-drawing prefix still parses', async () => {
  assert.equal(parseStartCommandExecutionUuid(`session   ${EXECUTION}\nmode detached\n`), EXECUTION);
});

await test('a JSON launch record is accepted too', async () => {
  assert.equal(parseStartCommandExecutionUuid(JSON.stringify({ uuid: EXECUTION, status: 'executing' })), EXECUTION);
});

await test('output with no execution UUID yields null, never a guess', async () => {
  assert.equal(parseStartCommandExecutionUuid(''), null);
  assert.equal(parseStartCommandExecutionUuid(null), null);
  assert.equal(parseStartCommandExecutionUuid('session   not-a-uuid'), null);
  assert.equal(parseStartCommandExecutionUuid('nothing useful here'), null);
});

await test('the executing reply shows the execution UUID next to the session UUID', async () => {
  const message = formatExecutingWorkSessionMessage({ sessionName: SESSION, executionUuid: EXECUTION, isolationBackend: 'docker', infoBlock: '' });
  assert.ok(message.includes(SESSION), 'the session UUID is still there');
  assert.ok(message.includes(EXECUTION), 'and the UUID `$ --list` shows is there too');
});

await test('a session with no execution UUID renders exactly as before', async () => {
  const message = formatExecutingWorkSessionMessage({ sessionName: SESSION, isolationBackend: 'docker', infoBlock: '' });
  assert.ok(message.includes(SESSION));
  assert.ok(!message.includes('Execution'), 'no empty label is added when there is nothing to show');
});

await test('the execution UUID is persisted with the session', async () => {
  const serialized = serializeSessionInfo({ sessionId: SESSION, executionUuid: EXECUTION, isolationBackend: 'docker', command: 'solve' });
  assert.equal(serialized.executionUuid, EXECUTION, 'a bot restart can still correlate the session with `$ --list`');
});

await test('the structured session_tracked event carries the execution UUID', async () => {
  resetSessionMonitorForTests();
  const events = [];
  setSessionLogger({ event: (type, data) => events.push({ type, data }) });
  setSessionStore({ persist: () => {}, remove: () => {} });

  trackSession(SESSION, { startTime: new Date(0), command: 'solve', isolationBackend: 'docker', sessionId: SESSION, executionUuid: EXECUTION }, false);

  const tracked = events.find(entry => entry.type === 'session_tracked');
  assert.equal(tracked.data.executionUuid, EXECUTION, 'the timestamped log can be joined to `$ --list`');

  resetSessionMonitorForTests();
});

await test('the Telegram launch path records the execution UUID the runner reports', async () => {
  const tracked = [];
  let executingMessage = '';
  const deps = {
    resolveIsolation: async () => ({
      backend: 'docker',
      runner: {
        generateSessionId: () => SESSION,
        executeWithIsolation: async () => ({ success: true, sessionId: SESSION, executionUuid: EXECUTION, output: LAUNCH_OUTPUT }),
      },
    }),
    ISOLATION_BACKEND: 'docker',
    isolationRunner: {},
    VERBOSE: false,
    executeStartScreen: async () => ({ success: false, error: 'unused' }),
    trackSession: (name, info) => tracked.push({ name, info }),
    untrackSession: () => {},
    AUTO_WATCH_MESSAGE: false,
    startAutoTerminalWatchForSession: async () => {},
    bot: {},
    formatExecutingWorkSessionMessage: args => {
      executingMessage = formatExecutingWorkSessionMessage(args);
      return executingMessage;
    },
    formatStartingWorkSessionMessage,
  };
  const ctx = { from: { id: 7 }, chat: { id: 42 }, telegram: { editMessageText: async () => {} } };

  await buildExecuteAndUpdateMessage(deps)(ctx, { chat: { id: 42 }, message_id: 100 }, 'solve', ['https://github.com/o/r/issues/1'], 'Issue: x', 'docker', 'claude');

  const last = tracked.at(-1);
  assert.equal(last.info.executionUuid, EXECUTION, 'the tracked session knows both UUIDs');
  assert.ok(executingMessage.includes(EXECUTION), 'and the operator is told the one `$ --list` uses');
});

await test('a session whose banner was never parsed learns its execution UUID from `$ --status`', async () => {
  // A session resumed from a snapshot written before this fix — or launched by a
  // start-command whose banner we could not parse — has no executionUuid. The
  // status record start-command keeps for it does carry one (the incident log
  // shows `"uuid": "edc7b051-…"` in every status query for session `0a3627ef-…`),
  // so the monitor backfills it instead of leaving the session uncorrelatable.
  resetSessionMonitorForTests();
  const persisted = [];
  setSessionLogger({ event: () => {} });
  setSessionStore({ persist: (name, info) => persisted.push({ name, info }), remove: () => {} });

  const sessionInfo = { chatId: 42, messageId: 1, startTime: new Date(), command: 'solve', isolationBackend: 'docker', sessionId: SESSION };
  trackSession(SESSION, sessionInfo, false);
  assert.equal(sessionInfo.executionUuid, undefined, 'precondition: the correlation is unknown');

  const bot = { telegram: { editMessageText: async () => {}, sendMessage: async () => {} } };
  await monitorSessions(bot, false, {
    statusProvider: async () => ({ exists: true, uuid: EXECUTION, status: 'executing', exitCode: null, isolation: 'docker' }),
    exitFromLog: () => ({ finished: false, exitCode: null, endTime: null }),
    dockerContainerSizeProvider: async () => null,
  });

  assert.equal(sessionInfo.executionUuid, EXECUTION, 'the live session now knows the UUID `$ --list` prints');
  assert.ok(
    persisted.some(entry => entry.info.executionUuid === EXECUTION),
    'and the durable snapshot was rewritten so a restart keeps it'
  );

  resetSessionMonitorForTests();
});

await test('the completion message keeps both UUIDs, so the finished task stays findable', async () => {
  // The completion reply is the last thing the Telegram thread ever says about
  // a task; it is where an operator goes to fetch the log afterwards. Without
  // the execution UUID, `$ --log <session>` and the archived `--list` rows still
  // could not be reached from the thread.
  const message = formatSessionCompletionMessage({
    sessionName: SESSION,
    sessionInfo: { isolationBackend: 'docker', executionUuid: EXECUTION, startTime: new Date(0) },
    statusResult: { status: 'executed', exitCode: 0 },
    exitCode: 0,
  });
  assert.ok(message.includes(SESSION), 'the session UUID is still there');
  assert.ok(message.includes(EXECUTION), 'and so is the one `$ --list` prints');

  const withoutExecution = formatSessionCompletionMessage({
    sessionName: SESSION,
    sessionInfo: { isolationBackend: 'docker', startTime: new Date(0) },
    statusResult: { status: 'executed', exitCode: 0 },
    exitCode: 0,
  });
  assert.ok(!withoutExecution.includes('Execution'), 'an unknown execution UUID adds no empty label');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
