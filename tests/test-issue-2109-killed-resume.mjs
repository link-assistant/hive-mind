#!/usr/bin/env node
/**
 * Regression test for issue #2109.
 *
 * @hive-mind-test-suite default
 *
 * A long-running `/codex` task printed its real Codex thread id early enough
 * that it fell outside the final 256 KiB of the execution log. The old code
 * then selected the newest UUID-named log from start-command's shared log
 * directory, even though it belonged to another task. The resulting resume
 * command used both the wrong thread id and the terminal-only `solve` spelling.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2109
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { monitorSessions, resetSessionMonitorForTests, trackSession } from '../src/session-monitor.lib.mjs';
import { buildResumeCommand, readLastSessionIdFromLog } from '../src/session-resume.lib.mjs';
import { serializeSessionInfo } from '../src/session-store.lib.mjs';
import { buildExecuteAndUpdateMessage } from '../src/telegram-command-execution.lib.mjs';
import { createIsolationAwareQueueCallback } from '../src/telegram-isolation.lib.mjs';
import { createQueueExecuteCallback, SolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { assert, getFailCount, printSummary } from './test-helpers.mjs';

console.log('Testing issue #2109: safe killed-session resume instructions');
console.log('='.repeat(60));

const ACTUAL_THREAD = '019f980e-a0fd-75e1-907b-9167319836ad';
const UNRELATED_THREAD = '8b8e10af-0776-4706-aae6-72c95bebbd73';
const URL = 'https://github.com/link-assistant/formal-ai/issues/845';

function makeBot() {
  const edits = [];
  return {
    edits,
    telegram: {
      editMessageText: async (_chatId, _messageId, _inline, text) => {
        edits.push(text);
      },
      sendMessage: async () => ({ chat: { id: 555 }, message_id: 999 }),
    },
  };
}

async function monitorKilledSession({ logPath, commandAlias = 'codex' }) {
  resetSessionMonitorForTests();
  trackSession(
    'isolation-session',
    {
      chatId: 555,
      messageId: 777,
      startTime: new Date(Date.now() - 5 * 60 * 1000),
      url: URL,
      command: 'solve',
      commandAlias,
      tool: 'codex',
      args: [URL, '--tool', 'codex', '--think', 'xhigh'],
      isolationBackend: 'docker',
      sessionId: 'isolation-session',
      logPath,
    },
    false
  );

  const bot = makeBot();
  await monitorSessions(bot, false, {
    statusProvider: async () => ({ exists: true, status: 'executing', logPath }),
    exitFromLog: () => ({ finished: true, exitCode: 137, endTime: '2026-07-25 11:05:51.000' }),
    backendAlive: async () => true,
  });
  return bot.edits[0] || '';
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-2109-resume-'));
try {
  // Every Telegram launch path must retain the alias through tracking and
  // durable persistence; otherwise the completion monitor cannot reconstruct
  // the command the user can actually send back to the bot.
  const directTracked = [];
  const executeDirect = buildExecuteAndUpdateMessage({
    resolveIsolation: async () => ({
      backend: 'docker',
      runner: {
        generateSessionId: () => 'direct-isolation',
        executeWithIsolation: async () => ({ success: true, output: 'session: direct-isolation' }),
      },
    }),
    ISOLATION_BACKEND: null,
    isolationRunner: null,
    VERBOSE: false,
    executeStartScreen: async () => ({ success: false }),
    trackSession: (_session, info) => directTracked.push(info),
    untrackSession: () => {},
    AUTO_WATCH_MESSAGE: false,
    startAutoTerminalWatchForSession: async () => {},
    bot: {},
    formatExecutingWorkSessionMessage: () => 'executing',
    formatStartingWorkSessionMessage: () => 'starting',
  });
  await executeDirect({ chat: { id: 555 }, from: { id: 42 }, telegram: { editMessageText: async () => {} } }, { chat: { id: 555 }, message_id: 777 }, 'solve', [URL, '--tool', 'codex'], 'Issue', 'docker', 'codex', null, { commandAlias: 'codex' });
  assert(directTracked[0]?.commandAlias === 'codex', 'immediate Telegram execution retains the /codex alias');

  const queue = new SolveQueue({ autoStart: false });
  const queuedItem = queue.enqueue({
    url: URL,
    args: [URL, '--tool', 'codex'],
    ctx: { chat: { id: 555 } },
    commandAlias: 'codex',
    tool: 'codex',
  });
  assert(queuedItem.commandAlias === 'codex', 'queued Telegram work retains the /codex alias while waiting');

  const screenTracked = [];
  const executeQueuedScreen = createQueueExecuteCallback(
    async () => ({ success: true, output: 'session: queued-screen' }),
    (_session, info) => screenTracked.push(info)
  );
  await executeQueuedScreen(queuedItem);
  assert(screenTracked[0]?.commandAlias === 'codex', 'screen queue execution passes the /codex alias to session tracking');
  assert(JSON.stringify(screenTracked[0]?.args) === JSON.stringify(queuedItem.args), 'screen queue execution persists the original solve arguments');

  const isolationTracked = [];
  const executeQueuedIsolation = createIsolationAwareQueueCallback(
    'docker',
    {
      generateSessionId: () => 'queued-isolation',
      executeWithIsolation: async () => ({ success: true, output: 'session: queued-isolation' }),
    },
    (_session, info) => isolationTracked.push(info),
    async () => ({ success: false }),
    false
  );
  await executeQueuedIsolation({ ...queuedItem, perCommandIsolation: 'docker' });
  assert(isolationTracked[0]?.commandAlias === 'codex', 'isolated queue execution passes the /codex alias to session tracking');
  assert(JSON.stringify(isolationTracked[0]?.args) === JSON.stringify(queuedItem.args), 'isolated queue execution persists the original solve arguments');

  const serialized = serializeSessionInfo({ command: 'solve', commandAlias: 'codex' });
  assert(serialized.commandAlias === 'codex', 'durable session state preserves the Telegram alias across bot restarts');

  for (const commandAlias of ['solve', 'claude', 'codex']) {
    const resume = buildResumeCommand({
      sessionInfo: { command: 'solve', commandAlias, url: URL },
      lastSessionId: ACTUAL_THREAD,
    });
    assert(resume?.display.startsWith(`/${commandAlias} ${URL}`), `resume guidance uses the actual /${commandAlias} Telegram alias`);
  }

  // Reproduce the production layout: the correct marker is more than one
  // historical tail window from EOF, while an unrelated UUID log is present in
  // the same shared directory.
  const longLogPath = path.join(tmpDir, 'execution.log');
  fs.writeFileSync(longLogPath, `start\n📌 Session ID: ${ACTUAL_THREAD}\n${'x'.repeat(300 * 1024)}\nKilled\nExit Code: 137\n`);
  fs.writeFileSync(path.join(tmpDir, `${UNRELATED_THREAD}.log`), 'another task');

  assert(readLastSessionIdFromLog(longLogPath) === ACTUAL_THREAD, 'finds the last real thread id even when it is more than 256 KiB from EOF');

  // The overlap between backward chunks must preserve a marker whose label is
  // split exactly at a chunk boundary.
  const boundaryLogPath = path.join(tmpDir, 'boundary.log');
  const marker = `Session ID: ${ACTUAL_THREAD}\n`;
  const markerSplit = 5;
  const trailingBytes = 64 - (Buffer.byteLength(marker) - markerSplit);
  fs.writeFileSync(boundaryLogPath, `${'p'.repeat(100)}${marker}${'z'.repeat(trailingBytes)}`);
  assert(readLastSessionIdFromLog(boundaryLogPath, { tailBytes: 64 }) === ACTUAL_THREAD, 'finds a thread marker split across backward scan chunks');

  const resumeText = await monitorKilledSession({ logPath: longLogPath });
  assert(resumeText.includes(`--resume ${ACTUAL_THREAD}`), 'resume instruction uses the thread id from this task log');
  assert(!resumeText.includes(UNRELATED_THREAD), 'resume instruction never borrows a UUID log from another task');
  assert(resumeText.includes(`/codex ${URL}`), 'Telegram resume instruction reuses the actual /codex alias');
  assert(!resumeText.includes(`solve ${URL}`), 'Telegram resume instruction does not suggest a terminal solve command');

  // If this task never printed a tool thread id, an unrelated UUID file is not
  // evidence and no resume instruction is safer than a fabricated one.
  const noMarkerLogPath = path.join(tmpDir, 'no-marker.log');
  fs.writeFileSync(noMarkerLogPath, 'start\nwork\nKilled\nExit Code: 137\n');
  const noMarkerText = await monitorKilledSession({ logPath: noMarkerLogPath, commandAlias: 'solve' });
  assert(!noMarkerText.includes('Resume from last session'), 'does not offer resume when this task log has no tool thread id');
  assert(!noMarkerText.includes(UNRELATED_THREAD), 'does not use an unrelated UUID fallback when this task has no marker');
} finally {
  resetSessionMonitorForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
