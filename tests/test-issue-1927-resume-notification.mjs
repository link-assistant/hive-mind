#!/usr/bin/env node
/**
 * Integration test (issue #1927 review follow-up): the killed-session completion
 * message carries a ready-to-run `--resume <lastSessionId>` command.
 *
 * Drives the real session monitor (`monitorSessions`) with injected providers so
 * a detached /solve is detected as killed (exit 137). A multi-session capture log
 * proves the "use the LAST session" rule end-to-end: the resume command must name
 * the LAST `Session ID:` marker, not the first. A successful (exit 0) session and
 * a /hive session must NOT get a resume command — backward compatibility.
 *
 * @see https://github.com/link-assistant/hive-mind/pull/1928
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { trackSession, monitorSessions, resetSessionMonitorForTests } from '../src/session-monitor.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #1927: resume command in killed-session notification');
console.log('='.repeat(60));

const FIRST = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const LAST = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const URL = 'https://github.com/acme/widgets/issues/42';

function makeBot() {
  const edits = [];
  return {
    edits,
    telegram: {
      editMessageText: async (chatId, messageId, _inline, text, options) => {
        edits.push({ chatId, messageId, text, options });
      },
      sendMessage: async (chatId, text, options) => ({ chat: { id: chatId }, message_id: 999, text, options }),
    },
  };
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-1927-resume-notify-'));
try {
  // A log with TWO sessions: an auto-continue produced a second, more-advanced
  // session before the OOM kill. Resume must pick the LAST one.
  const logPath = path.join(tmpDir, 'session.log');
  fs.writeFileSync(logPath, `start\n📌 Session ID: ${FIRST}\n... usage limit, resuming ...\n📌 Session ID: ${LAST}\nKilled\nExit Code: 137\n`);

  function trackOom({ command = 'solve', tool = 'claude', args = undefined } = {}) {
    resetSessionMonitorForTests();
    trackSession(
      'sess-1',
      {
        chatId: 555,
        messageId: 777,
        startTime: new Date(Date.now() - 5 * 60 * 1000),
        url: URL,
        command,
        tool,
        isolationBackend: 'screen',
        sessionId: 'sess-1',
        logPath,
        ...(args ? { args } : {}),
      },
      false
    );
  }

  // --- killed /solve → resume command names the LAST session --------------------
  {
    trackOom();
    const bot = makeBot();
    await monitorSessions(bot, false, {
      statusProvider: async () => ({ exists: true, status: 'executing', logPath }),
      exitFromLog: () => ({ finished: true, exitCode: 137, endTime: '2026-06-14 19:10:49.822' }),
      backendAlive: async () => true,
    });
    const text = bot.edits[0]?.text || '';
    assert(/Work session killed/.test(text), 'killed /solve is reported as killed');
    assert(text.includes('Resume'), 'killed /solve message includes a Resume section');
    assert(text.includes(LAST), 'resume command names the LAST session id');
    assert(!text.includes(`--resume ${FIRST}`), 'resume command does NOT name the first session id');
    assert(text.includes(`solve ${URL} --resume ${LAST}`), 'resume command is a runnable solve --resume invocation');
  }

  // --- killed /solve with persisted args → args reused -------------------------
  {
    trackOom({ tool: 'codex', args: [URL, '--tool', 'codex', '--model', 'gpt-5'] });
    const bot = makeBot();
    await monitorSessions(bot, false, {
      statusProvider: async () => ({ exists: true, status: 'executing', logPath }),
      exitFromLog: () => ({ finished: true, exitCode: 137, endTime: '2026-06-14 19:10:49.822' }),
      backendAlive: async () => true,
    });
    const text = bot.edits[0]?.text || '';
    assert(text.includes('--tool codex') && text.includes('--model gpt-5'), 'resume command reuses the original persisted args');
    assert(text.includes(`--resume ${LAST}`), 'resume command appends --resume <lastId> to the original args');
  }

  // --- successful /solve → NO resume section (backward compatible) -------------
  {
    trackOom();
    const bot = makeBot();
    await monitorSessions(bot, false, {
      statusProvider: async () => ({ exists: true, status: 'executed', exitCode: 0 }),
      exitFromLog: () => ({ finished: true, exitCode: 0, endTime: '2026-06-14 19:10:49.822' }),
      backendAlive: async () => false,
    });
    const text = bot.edits[0]?.text || '';
    assert(!text.includes('Resume'), 'a successful session gets NO resume section');
  }

  // --- killed /solve, NO tool session id in the log → NO bogus resume ----------
  // The isolation session id (sessionInfo.sessionId) is a DIFFERENT namespace
  // from the AI tool's --resume id, so when the log carries no `Session ID:`
  // marker and there is no `<sessionId>.log`, we must offer nothing rather than a
  // wrong id.
  {
    const emptyLog = path.join(tmpDir, 'no-markers.log');
    fs.writeFileSync(emptyLog, 'start\n... work ...\nKilled\nExit Code: 137\n');
    resetSessionMonitorForTests();
    trackSession(
      'sess-iso-uuid-not-a-tool-id',
      {
        chatId: 555,
        messageId: 777,
        startTime: new Date(Date.now() - 5 * 60 * 1000),
        url: URL,
        command: 'solve',
        tool: 'claude',
        isolationBackend: 'screen',
        sessionId: 'sess-iso-uuid-not-a-tool-id',
        logPath: emptyLog,
      },
      false
    );
    const bot = makeBot();
    await monitorSessions(bot, false, {
      statusProvider: async () => ({ exists: true, status: 'executing', logPath: emptyLog }),
      exitFromLog: () => ({ finished: true, exitCode: 137, endTime: '2026-06-14 19:10:49.822' }),
      backendAlive: async () => true,
    });
    const text = bot.edits[0]?.text || '';
    assert(/Work session killed/.test(text), 'killed /solve without a tool session id is still reported as killed');
    assert(!text.includes('Resume'), 'no resume section when only the isolation session id is known (avoids a bogus --resume id)');
    assert(!text.includes('--resume sess-iso-uuid-not-a-tool-id'), 'the isolation session id is never used as a --resume id');
  }

  // --- killed /hive → NO resume section (only /solve is --resume-able) ---------
  {
    trackOom({ command: 'hive' });
    const bot = makeBot();
    await monitorSessions(bot, false, {
      statusProvider: async () => ({ exists: true, status: 'executing', logPath }),
      exitFromLog: () => ({ finished: true, exitCode: 137, endTime: '2026-06-14 19:10:49.822' }),
      backendAlive: async () => true,
    });
    const text = bot.edits[0]?.text || '';
    assert(/Work session killed/.test(text), 'killed /hive is still reported as killed');
    assert(!text.includes('Resume'), 'killed /hive gets NO resume section');
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
