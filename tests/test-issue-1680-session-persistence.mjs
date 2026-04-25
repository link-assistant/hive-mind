#!/usr/bin/env node
/**
 * Regression test for issue #1680.
 *
 * A screen-isolated Telegram work session can outlive the bot process that
 * started it. The monitor must reload the persisted session metadata after a
 * restart, poll `$ --status`, and edit the original Telegram message.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { configureSessionPersistence, getActiveSessionCount, monitorSessions, resetSessionMonitorForTests, trackSession } from '../src/session-monitor.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #1680: persisted session completion monitoring');
console.log('='.repeat(60));

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-1680-session-store-'));
const storePath = path.join(tempDir, 'active-sessions.json');
const sessionName = '6a0ec9c3-04b5-4c22-acc2-8f21e934036e';
const issueUrl = 'https://github.com/ideav/crm/issues/2117';

resetSessionMonitorForTests();
configureSessionPersistence({ enabled: true, storePath, load: false });

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

const persisted = JSON.parse(await fs.readFile(storePath, 'utf8'));
assert(persisted.sessions.length === 1, 'Tracked session is written to the session store');
assert(persisted.sessions[0].sessionName === sessionName, 'Session store keeps the screen session name');

resetSessionMonitorForTests();
configureSessionPersistence({ enabled: true, storePath, load: true });
assert(getActiveSessionCount(false) === 1, 'Session metadata is reloaded after monitor restart');

const edits = [];
const bot = {
  telegram: {
    editMessageText: async (chatId, messageId, _inlineMessageId, text, options) => {
      edits.push({ chatId, messageId, text, options });
    },
    sendMessage: async () => {
      throw new Error('Expected monitor to edit the persisted original message');
    },
  },
};

await monitorSessions(bot, false, {
  statusProvider: async () => ({
    exists: true,
    uuid: 'e44d4086-0b1b-47f2-8733-3abe937e43c5',
    status: 'executed',
    exitCode: 0,
    startTime: '2026-04-25T09:19:53.475Z',
    endTime: '2026-04-25T09:25:26.858Z',
    raw: '',
  }),
});

assert(edits.length === 1, 'Monitor edits the original Telegram message after reload');
assert(edits[0].chatId === 12345 && edits[0].messageId === 67890, 'Reloaded chat/message IDs are used for the edit');
assert(edits[0].text.includes('*Work Session Completed*'), 'Completion edit contains terminal completed status');
assert(edits[0].text.includes('Duration: 5m 33s'), 'Completion edit uses persisted status timestamps');
assert(getActiveSessionCount(false) === 0, 'Completed persisted session is removed from memory');

const afterCompletion = JSON.parse(await fs.readFile(storePath, 'utf8'));
assert(afterCompletion.sessions.length === 0, 'Completed persisted session is removed from the session store');

resetSessionMonitorForTests({ clearStore: true });
await fs.rm(tempDir, { recursive: true, force: true });

printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
