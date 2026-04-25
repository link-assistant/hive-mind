#!/usr/bin/env node
/**
 * Tests for issue #1670: screen-isolated solve completion monitoring.
 *
 * Verifies that:
 * - `$ --status` text and JSON outputs are parsed with exit codes
 * - terminal `$ --status` values are authoritative for screen isolation
 * - duplicate URL checks refresh isolation status before blocking
 * - queue processing counts use max($ --status executing count, pgrep count)
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1670
 */

import { parseSessionStatusOutput, shouldFallbackToScreenStatus } from '../src/isolation-runner.lib.mjs';
import { trackSession, hasActiveSessionForUrlAsync, getActiveSessionCount, getRunningTrackedIsolationSessions, formatSessionCompletionMessage } from '../src/session-monitor.lib.mjs';
import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #1670: screen status monitoring');
console.log('='.repeat(60));

console.log('\n  $ --status parser:');
const jsonStatus = parseSessionStatusOutput(
  JSON.stringify({
    uuid: 'ac33ba27-b642-4b88-889d-bc562aa184ce',
    status: 'executed',
    exitCode: 1,
    startTime: '2026-04-24T15:18:18.154Z',
    endTime: '2026-04-24T17:38:32.324Z',
  })
);
assert(jsonStatus.exists === true, 'JSON status exists');
assert(jsonStatus.status === 'executed', 'JSON status parses executed');
assert(jsonStatus.exitCode === 1, 'JSON status parses non-zero exit code');
assert(shouldFallbackToScreenStatus(jsonStatus) === false, 'Executed status does not fall back to screen -ls');

const textStatus = parseSessionStatusOutput(`ac33ba27-b642-4b88-889d-bc562aa184ce
  uuid ac33ba27-b642-4b88-889d-bc562aa184ce
  status executing
  command "solve https://github.com/example/repo/pull/2 --tool codex"
  startTime "2026-04-24T17:35:30.970Z"
  currentTime "2026-04-24T17:44:26.028Z"
`);
assert(textStatus.exists === true, 'Text status exists');
assert(textStatus.uuid === 'ac33ba27-b642-4b88-889d-bc562aa184ce', 'Text status parses UUID');
assert(textStatus.status === 'executing', 'Text status parses executing');
assert(textStatus.currentTime === '2026-04-24T17:44:26.028Z', 'Text status parses currentTime');

console.log('\n  Active session refresh:');
const url = 'https://github.com/example/repo/pull/2';
const executedSession = 'issue-1670-executed-session';
trackSession(
  executedSession,
  {
    chatId: 1,
    messageId: 2,
    startTime: new Date('2026-04-24T15:18:18.154Z'),
    url,
    command: 'solve',
    isolationBackend: 'screen',
    sessionId: executedSession,
    tool: 'codex',
  },
  false
);
const duplicateResult = await hasActiveSessionForUrlAsync(url, false, {
  statusProvider: async () => ({ exists: true, status: 'executed', exitCode: 1, raw: '' }),
});
assert(duplicateResult.isActive === false, 'Completed isolation session does not block duplicate URL');
assert(getActiveSessionCount(false) === 1, 'Completed isolation session stays tracked for completion notification');

const runningSession = 'issue-1670-running-session';
trackSession(
  runningSession,
  {
    chatId: 1,
    messageId: 3,
    startTime: new Date(),
    url,
    command: 'solve',
    isolationBackend: 'screen',
    sessionId: runningSession,
    tool: 'codex',
  },
  false
);
const runningResult = await hasActiveSessionForUrlAsync(url, false, {
  statusProvider: async sessionId => ({
    exists: true,
    status: sessionId === runningSession ? 'executing' : 'executed',
    exitCode: sessionId === runningSession ? null : 1,
    raw: '',
  }),
});
assert(runningResult.isActive === true, 'Executing isolation session blocks duplicate URL');
assert(runningResult.sessionName === runningSession, 'Executing duplicate result includes session name');

const runningCounts = await getRunningTrackedIsolationSessions(false, {
  statusProvider: async sessionId => ({
    exists: true,
    status: sessionId === runningSession ? 'executing' : 'executed',
    exitCode: sessionId === runningSession ? null : 1,
    raw: '',
  }),
});
assert(runningCounts.count === 1, 'Only executing isolation sessions are counted');
assert(runningCounts.byTool.codex === 1, 'Executing isolation session is counted under its tool');

console.log('\n  Queue processing counts:');
const queue = new SolveQueue({
  verbose: false,
  getRunningProcesses: async tool => ({ count: tool === 'claude' ? 5 : tool === 'codex' ? 2 : 0, processes: [] }),
  getRunningIsolatedSessions: async () => ({
    count: 4,
    sessions: ['a', 'b', 'c', 'd'],
    byTool: { claude: 1, codex: 4 },
  }),
});

const snapshot = await queue.getExternalProcessingSnapshot(['claude', 'agent', 'codex']);
assert(snapshot.byTool.claude === 5, 'Queue uses pgrep count when it is higher than status count');
assert(snapshot.byTool.codex === 4, 'Queue uses status count when it is higher than pgrep count');
assert(snapshot.byTool.agent === 0, 'Queue reports zero when both sources are zero');
assert(snapshot.total === 7, 'Queue total uses max(total pgrep count, total status count)');

const formattedStatus = await queue.formatStatus();
assert(formattedStatus.includes('claude (pending: 0, processing: 5)'), 'Formatted status shows max claude processing count');
assert(formattedStatus.includes('codex (pending: 0, processing: 4)'), 'Formatted status shows max codex processing count');
queue.stop();

console.log('\n  Telegram message formatting:');
const queuedEdits = [];
const messageQueue = new SolveQueue({ verbose: false });
messageQueue.executeCallback = async () => ({
  success: true,
  sessionId: 'issue-1670-format-session',
  isolationBackend: 'screen',
  output: 'session: issue-1670-format-session',
});
const messageItem = messageQueue.enqueue({
  url: 'https://github.com/example/repo/issues/1670',
  args: ['https://github.com/example/repo/issues/1670'],
  ctx: {
    chat: { id: 42 },
    telegram: {
      editMessageText: async (_chatId, _messageId, _inline, text) => {
        queuedEdits.push(text);
      },
    },
  },
  requester: '@tester',
  infoBlock: 'Requested by: @tester\nURL: https://github.com/example/repo/issues/1670',
  tool: 'codex',
});
messageItem.messageInfo = { chatId: 42, messageId: 100 };
await messageQueue.executeItem(messageItem);
messageQueue.stop();

const executingMessage = queuedEdits.at(-1) || '';
assert(executingMessage.startsWith('⏳ Solve command executing...'), 'Executing message uses in-progress hourglass status');
assert(!executingMessage.includes('Status: `Executing...`'), 'Executing message does not duplicate the status line');
assert(!executingMessage.includes('This message will update when the session finishes'), 'Executing message omits the update footer');
assert(executingMessage.includes('📊 Session: `issue-1670-format-session`'), 'Executing message includes session id');
assert(executingMessage.includes('🔒 Isolation: `screen`'), 'Executing message includes isolation backend');

const completionMessage = formatSessionCompletionMessage({
  sessionName: 'issue-1670-completed-session',
  sessionInfo: {
    startTime: new Date('2026-04-24T20:00:00.000Z'),
    url: 'https://github.com/example/repo/issues/1670',
    isolationBackend: 'screen',
  },
  statusResult: {
    status: 'executed',
    exitCode: 1,
    startTime: '2026-04-24T21:17:56.192Z',
    endTime: '2026-04-24T21:39:03.630Z',
  },
  observedEndTime: new Date('2026-04-24T21:50:00.000Z'),
});
assert(completionMessage.includes('❌ *Work Session Failed (exit code: 1)*'), 'Completion message treats non-zero exit code as failed');
assert(completionMessage.includes('⏱️ Duration: 21m 7s'), 'Completion message uses start/end times from status output');
assert(!completionMessage.includes('This message will update when the session finishes'), 'Completion message omits transient update footer');

const successfulCompletionMessage = formatSessionCompletionMessage({
  sessionName: 'issue-1670-success-session',
  sessionInfo: {
    startTime: new Date('2026-04-24T20:55:18.953Z'),
    url: 'https://github.com/example/repo/pull/548',
    isolationBackend: 'screen',
  },
  statusResult: {
    status: 'executed',
    exitCode: 0,
    startTime: '2026-04-24T20:55:18.953Z',
    endTime: '2026-04-24T21:12:59.725Z',
  },
});
assert(successfulCompletionMessage.includes('✅ *Work Session Completed*'), 'Completion message treats zero exit code as completed');
assert(successfulCompletionMessage.includes('⏱️ Duration: 17m 41s'), 'Successful completion uses status timestamps for duration');

printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
