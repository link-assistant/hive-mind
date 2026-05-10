#!/usr/bin/env node
/**
 * Regression test for issue #1680.
 *
 * Screen-isolated Telegram work sessions must remain in the in-memory session
 * monitor until `$ --status` reaches a terminal state and the original
 * Telegram message is successfully updated.
 */

import { getActiveSessionCount, getSessionStats, monitorSessions, resetSessionMonitorForTests, trackSession } from '../src/session-monitor.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #1680: in-memory screen isolation monitoring');
console.log('='.repeat(60));

const sessionName = '6a0ec9c3-04b5-4c22-acc2-8f21e934036e';
const issueUrl = 'https://github.com/ideav/crm/issues/2117';

resetSessionMonitorForTests();
trackSession(
  sessionName,
  {
    chatId: 12345,
    messageId: 67890,
    startTime: new Date('2026-04-25T09:19:53.475Z'),
    url: issueUrl,
    command: 'solve',
    isolationBackend: 'screen',
    sessionId: sessionName,
    tool: 'codex',
  },
  false
);

const stats = getSessionStats(false);
assert(stats.storageType === 'in-memory', 'Session monitor keeps Telegram task state in memory');
assert(!('storagePath' in stats), 'Session monitor does not expose a JSON session store path');
assert(getActiveSessionCount(false) === 1, 'Tracked screen-isolated session is stored in memory');

let statusCalls = 0;
let editCalls = 0;
const edits = [];
const bot = {
  telegram: {
    editMessageText: async (chatId, messageId, _inlineMessageId, text, options) => {
      editCalls++;
      edits.push({ chatId, messageId, text, options });
      if (editCalls === 1) {
        throw new Error('temporary Telegram API failure');
      }
    },
    sendMessage: async () => {
      throw new Error('Expected monitor to edit the original Telegram message');
    },
  },
};

const terminalStatusProvider = async sessionId => {
  statusCalls++;
  assert(sessionId === sessionName, 'Monitor polls the tracked screen session with $ --status');
  return {
    exists: true,
    uuid: 'e44d4086-0b1b-47f2-8733-3abe937e43c5',
    status: 'executed',
    exitCode: 0,
    startTime: '2026-04-25T09:19:53.475Z',
    endTime: '2026-04-25T09:26:08.736Z',
    raw: '',
  };
};

await monitorSessions(bot, false, { statusProvider: terminalStatusProvider });
assert(statusCalls === 1, 'Monitor checks terminal $ --status on the first pass');
assert(editCalls === 1, 'Monitor attempts to update the original Telegram message');
assert(getActiveSessionCount(false) === 1, 'Session remains tracked when Telegram update fails');

await monitorSessions(bot, false, { statusProvider: terminalStatusProvider });
assert(statusCalls === 2, 'Monitor polls $ --status again while the completion update is pending');
assert(editCalls === 2, 'Monitor retries the completion message update');
assert(edits[1].chatId === 12345 && edits[1].messageId === 67890, 'Retry uses the original chat and message IDs');
assert(edits[1].text.includes('*Work session finished successfully*'), 'Completion edit contains terminal completed status');
assert(edits[1].text.includes('Duration: 6m 15s'), 'Completion edit uses $ --status timestamps');
assert(getActiveSessionCount(false) === 0, 'Session is removed from memory only after message update succeeds');

resetSessionMonitorForTests();

printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
