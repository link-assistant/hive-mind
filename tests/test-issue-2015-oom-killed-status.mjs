#!/usr/bin/env node
/**
 * Regression coverage for issue #2015.
 *
 * start-command can report a docker-isolated session as still `executing` while
 * the same status payload also carries `oomKilled true`. The Telegram monitor
 * must treat that explicit OOM marker as terminal instead of leaving the chat
 * message stuck on "Executing...". The issue screenshots also showed the raw
 * i18n key `telegram.work_session_killed`, so this test keeps the locale path in
 * the repro.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2015
 */

import { parseSessionStatusOutput } from '../src/isolation-runner.lib.mjs';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';
import { monitorSessions, resetSessionMonitorForTests, trackSession, getActiveSessionCount, STALE_EXECUTING_MIN_AGE_MS, DOCKER_BACKEND_GONE_GRACE_MS } from '../src/session-monitor.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #2015: oomKilled status terminates Telegram sessions');
console.log('='.repeat(72));

const SESSION = '1e9e7513-edd7-43a2-b143-169cfd794af6';
const FALSE_POSITIVE_SESSION = '5ff719b9-9d2d-4479-b124-c4b8bda61dd0';

await initI18n('en');
await preloadAllLocales();

function makeBot() {
  const edits = [];
  return {
    edits,
    telegram: {
      editMessageText: async (chatId, messageId, _inline, text, options) => {
        edits.push({ chatId, messageId, text, options });
      },
      sendMessage: async () => {
        throw new Error('sendMessage should not be used when messageId is present');
      },
    },
  };
}

const linksNotationStatus = `${SESSION}
uuid "${SESSION}"
status executing
startTime "2026-07-02T09:00:00.000Z"
currentTime "2026-07-02T10:25:25.000Z"
oomKilled true
options
  isolated docker
  sessionName "${SESSION}"
`;

const parsedText = parseSessionStatusOutput(linksNotationStatus);
const parsedJson = parseSessionStatusOutput(
  JSON.stringify({
    uuid: SESSION,
    status: 'executing',
    oomKilled: true,
    currentTime: '2026-07-02T10:25:25.000Z',
    options: { isolated: 'docker', sessionName: SESSION },
  })
);

assert(parsedText.oomKilled === true, 'links-notation $ --status parses oomKilled true');
assert(parsedJson.oomKilled === true, 'JSON $ --status parses oomKilled true');

resetSessionMonitorForTests();
trackSession(
  SESSION,
  {
    chatId: 1001,
    messageId: 2002,
    startTime: new Date(Date.now() - STALE_EXECUTING_MIN_AGE_MS - 60_000),
    command: 'solve',
    tool: 'codex',
    url: 'https://github.com/evirma/evirma/pull/846',
    isolationBackend: 'docker',
    sessionId: SESSION,
    locale: 'ru',
  },
  false
);

const bot = makeBot();
let backendProbeCount = 0;
await monitorSessions(bot, false, {
  statusProvider: async () => parsedText,
  backendAlive: async () => {
    backendProbeCount++;
    return true;
  },
  dockerContainerSizeProvider: async () => null,
});

assert(backendProbeCount === 0, 'oomKilled true is terminal without a backend liveness probe');
assert(bot.edits.length === 1, 'Telegram message is completed when oomKilled true is present');
assert(/Рабочий сеанс/.test(bot.edits[0]?.text || ''), 'killed completion uses the requested locale');
assert(!String(bot.edits[0]?.text || '').includes('telegram.work_session_killed'), 'killed completion does not leak the raw i18n key');
assert(/SIGKILL/.test(bot.edits[0]?.text || ''), 'OOM completion names the SIGKILL signal');
assert(/exit code: 137/.test(bot.edits[0]?.text || ''), 'OOM completion reports synthesized exit code 137');
assert(getActiveSessionCount(false) === 0, 'OOM-killed session is removed from active tracking');

resetSessionMonitorForTests();
const falsePositiveInfo = {
  chatId: 1001,
  messageId: 2003,
  startTime: new Date(Date.now() - STALE_EXECUTING_MIN_AGE_MS - 60_000),
  command: 'solve',
  tool: 'claude',
  url: 'https://github.com/formal-ai/formal-ai/pull/635',
  isolationBackend: 'docker',
  sessionId: FALSE_POSITIVE_SESSION,
  locale: 'en',
};
trackSession(FALSE_POSITIVE_SESSION, falsePositiveInfo, false);

const falsePositiveBot = makeBot();
let dockerProbeCount = 0;
await monitorSessions(falsePositiveBot, false, {
  statusProvider: async () => ({ exists: true, status: 'executing', isolation: 'docker' }),
  exitFromLog: () => ({ finished: false, exitCode: null, endTime: null }),
  backendAlive: async (sessionId, backend) => {
    dockerProbeCount++;
    assert(sessionId === FALSE_POSITIVE_SESSION && backend === 'docker', 'docker backend-gone probe targets the session container');
    return false;
  },
  dockerContainerSizeProvider: async () => null,
});

assert(dockerProbeCount === 1, 'docker stale-executing state is probed after the age gate');
assert(falsePositiveBot.edits.length === 0, 'docker backend-gone alone is not reported as killed immediately');
assert(getActiveSessionCount(false) === 1, 'docker backend-gone grace keeps the session tracked');
assert(Boolean(falsePositiveInfo.dockerBackendGoneFirstSeenAt), 'docker backend-gone grace records the first missing-backend timestamp');

falsePositiveInfo.dockerBackendGoneFirstSeenAt = new Date(Date.now() - DOCKER_BACKEND_GONE_GRACE_MS - 1000).toISOString();
await monitorSessions(falsePositiveBot, false, {
  statusProvider: async () => ({ exists: true, status: 'executing', isolation: 'docker' }),
  exitFromLog: () => ({ finished: false, exitCode: null, endTime: null }),
  backendAlive: async () => false,
  dockerContainerSizeProvider: async () => null,
});

assert(falsePositiveBot.edits.length === 1, 'docker backend-gone still reports killed after the grace period expires');
assert(/Work session killed/.test(falsePositiveBot.edits[0]?.text || ''), 'expired docker backend-gone grace uses the killed completion copy');
assert(getActiveSessionCount(false) === 0, 'expired docker backend-gone session is removed from active tracking');

resetSessionMonitorForTests();
printSummary(72);

if (getFailCount() > 0) {
  process.exit(1);
}
