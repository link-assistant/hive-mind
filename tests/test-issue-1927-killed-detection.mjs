#!/usr/bin/env node
/**
 * Core regression test for issue #1927.
 *
 * Reproduces the exact failure from the issue: a detached /solve was OOM-killed
 * (exit 137) but `$ --status` kept reporting `executing` (a lingering shell held
 * the screen session alive, so start-command's `enrichDetachedStatus` flipped the
 * completed `executed/137` record back to `executing`). The bot stayed alive and
 * NEVER reported the failure — the session just vanished.
 *
 * These tests drive the real session monitor (`monitorSessions`) with injected
 * `$ --status` / log-footer / backend-liveness providers and assert that a stuck
 * `executing` status is cross-checked and the kill is finally reported, while a
 * just-launched session is never falsely declared dead.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1927
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { trackSession, monitorSessions, resetSessionMonitorForTests, getActiveSessionCount, STALE_EXECUTING_MIN_AGE_MS } from '../src/session-monitor.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #1927: killed-session detection (the regression)');
console.log('='.repeat(60));

const SESSION = 'a1b2c3d4-0000-4000-8000-000000000001';
const URL = 'https://github.com/acme/widgets/issues/42';

function makeBot() {
  const edits = [];
  const sends = [];
  return {
    edits,
    sends,
    telegram: {
      editMessageText: async (chatId, messageId, _inline, text, options) => {
        edits.push({ chatId, messageId, text, options });
      },
      sendMessage: async (chatId, text, options) => {
        sends.push({ chatId, text, options });
        return { chat: { id: chatId }, message_id: 999 };
      },
    },
  };
}

function trackOom({ startMsAgo = 5 * 60 * 1000, logPath = null } = {}) {
  resetSessionMonitorForTests();
  trackSession(
    SESSION,
    {
      chatId: 555,
      messageId: 777,
      startTime: new Date(Date.now() - startMsAgo),
      url: URL,
      command: 'solve',
      isolationBackend: 'screen',
      sessionId: SESSION,
      tool: 'claude',
      ...(logPath ? { logPath } : {}),
    },
    false
  );
}

// =============================================================================
// Scenario 1: lingering-shell flip — $ --status stuck on `executing`, but the
// log footer proves the command exited 137. The footer is authoritative.
// =============================================================================
{
  trackOom();
  const bot = makeBot();
  let footerReads = 0;
  await monitorSessions(bot, false, {
    statusProvider: async () => ({ exists: true, status: 'executing', logPath: '/fake/session.log' }),
    exitFromLog: logPath => {
      footerReads++;
      assert(logPath === '/fake/session.log', 'footer reader is called with the start-command log path');
      return { finished: true, exitCode: 137, endTime: '2026-06-14 19:10:49.822' };
    },
    backendAlive: async () => true, // even if backend looks alive, the footer wins
  });
  assert(footerReads >= 1, 'Scenario 1: the log footer is consulted for an executing session');
  assert(bot.edits.length === 1, 'Scenario 1: the bot reports completion (edits the original message)');
  assert(/Work session killed/.test(bot.edits[0].text), 'Scenario 1: the report says "Work session killed" (NOT a silent vanish)');
  assert(/SIGKILL/.test(bot.edits[0].text) && /exit code: 137/.test(bot.edits[0].text), 'Scenario 1: the report names SIGKILL and exit 137');
  assert(getActiveSessionCount(false) === 0, 'Scenario 1: the killed session is removed from tracking');
}

// =============================================================================
// Scenario 2: hard-killed wrapper — no footer was written, but the backing
// screen session is gone and the session is old enough to have registered.
// =============================================================================
{
  trackOom({ startMsAgo: STALE_EXECUTING_MIN_AGE_MS + 60 * 1000 });
  const bot = makeBot();
  let probes = 0;
  await monitorSessions(bot, false, {
    statusProvider: async () => ({ exists: true, status: 'executing' }), // no logPath
    exitFromLog: () => ({ finished: false, exitCode: null, endTime: null }),
    backendAlive: async (sessionId, backend) => {
      probes++;
      assert(sessionId === SESSION && backend === 'screen', 'Scenario 2: liveness probe targets the session backend');
      return false; // the screen session is gone
    },
  });
  assert(probes === 1, 'Scenario 2: the backend-liveness probe runs (no footer available)');
  assert(bot.edits.length === 1, 'Scenario 2: the bot reports completion');
  assert(/Work session killed/.test(bot.edits[0].text), 'Scenario 2: a vanished backend is reported as killed');
  assert(!/exit code: 1\b/.test(bot.edits[0].text), 'Scenario 2: no misleading "(exit code: 1)" when the real code is unknown');
  assert(getActiveSessionCount(false) === 0, 'Scenario 2: the killed session is removed from tracking');
}

// =============================================================================
// Scenario 3: age gate — a just-launched session whose backend has not
// registered yet must NOT be declared dead on a liveness probe.
// =============================================================================
{
  trackOom({ startMsAgo: 1000 }); // 1s old, well under the 90s gate
  const bot = makeBot();
  let probes = 0;
  await monitorSessions(bot, false, {
    statusProvider: async () => ({ exists: true, status: 'executing' }),
    exitFromLog: () => ({ finished: false, exitCode: null, endTime: null }),
    backendAlive: async () => {
      probes++;
      return false;
    },
  });
  assert(probes === 0, 'Scenario 3: a freshly-launched session is NOT liveness-probed (age gate)');
  assert(bot.edits.length === 0 && bot.sends.length === 0, 'Scenario 3: no false completion is sent');
  assert(getActiveSessionCount(false) === 1, 'Scenario 3: the session stays tracked (still running)');
}

// =============================================================================
// Scenario 4: a genuinely-running session (backend alive) is never killed,
// even past the age gate.
// =============================================================================
{
  trackOom({ startMsAgo: STALE_EXECUTING_MIN_AGE_MS + 60 * 1000 });
  const bot = makeBot();
  await monitorSessions(bot, false, {
    statusProvider: async () => ({ exists: true, status: 'executing' }),
    exitFromLog: () => ({ finished: false, exitCode: null, endTime: null }),
    backendAlive: async () => true, // still alive
  });
  assert(bot.edits.length === 0 && bot.sends.length === 0, 'Scenario 4: a live session is not reported complete');
  assert(getActiveSessionCount(false) === 1, 'Scenario 4: the live session stays tracked');
}

// =============================================================================
// Scenario 5: terminal status but a nulled exit code (reverse-flip) — recover
// the real 137 from the footer so it is labeled a kill, not a generic failure.
// =============================================================================
{
  trackOom();
  const bot = makeBot();
  await monitorSessions(bot, false, {
    statusProvider: async () => ({ exists: true, status: 'executed', exitCode: null, logPath: '/fake/session.log' }),
    exitFromLog: () => ({ finished: true, exitCode: 137, endTime: '2026-06-14 19:10:49.822' }),
  });
  assert(bot.edits.length === 1, 'Scenario 5: completion is reported');
  assert(/Work session killed/.test(bot.edits[0].text) && /exit code: 137/.test(bot.edits[0].text), 'Scenario 5: a nulled exit code is recovered from the footer and labeled a 137 kill');
  assert(getActiveSessionCount(false) === 0, 'Scenario 5: the session is removed from tracking');
}

// =============================================================================
// Scenario 6: kill-while-bot-down — the $ --status record was garbage-collected,
// the backend is not running, but the persisted logPath still has the footer.
// This is the resume case: a session killed while the bot was offline is finally
// reported instead of silently disappearing. Uses a REAL temp log file.
// =============================================================================
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-1927-killed-'));
  try {
    const logPath = path.join(tmpDir, 'session.log');
    fs.writeFileSync(logPath, `solve output...\n${'='.repeat(50)}\nFinished: 2026-06-14 19:10:49.822\nExit Code: 137\n`);
    trackOom({ logPath });
    const bot = makeBot();
    // statusProvider reports the record is gone (exists:false). The monitor then
    // falls back to a backend liveness check (here injected as "not running", so
    // the test does not depend on the real `$`/`screen` binaries) and reads the
    // footer from the persisted logPath to recover the real exit code.
    let runningChecks = 0;
    await monitorSessions(bot, false, {
      statusProvider: async () => ({ exists: false }),
      sessionRunning: async (sessionId, opts) => {
        runningChecks++;
        assert(sessionId === SESSION && opts.backend === 'screen', 'Scenario 6: liveness fallback targets the session backend');
        return false; // the screen session no longer exists
      },
    });
    assert(runningChecks === 1, 'Scenario 6: the backend liveness fallback runs when the status record is gone');
    assert(bot.edits.length === 1, 'Scenario 6: a session killed while the bot was down is reported on resume');
    assert(/Work session killed/.test(bot.edits[0].text) && /exit code: 137/.test(bot.edits[0].text), 'Scenario 6: the real 137 is recovered from the persisted log footer');
    assert(getActiveSessionCount(false) === 0, 'Scenario 6: the session is removed from tracking');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

resetSessionMonitorForTests();
printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
