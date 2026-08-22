#!/usr/bin/env node
/**
 * Regression test for issue #2117 — "❌ Work session failed (exit code: 1)" for a
 * `/solve` run that merged its pull request and exited 0.
 *
 * Root cause (upstream): start-command derives the exit code of a detached
 * docker session from an UNANCHORED `Exit Code: N` scan over the whole execution
 * log (`status-formatter.js#readExitCodeFromLog`). In the incident the agent
 * running inside the container printed the tail of an unrelated execution log —
 * including the line `42-Exit Code: 1` — into its own log 21 minutes before the
 * command finished. When the container stopped, `$ --status` stamped the record
 * with that fabricated 1, about two seconds before start-command's detached
 * docker watcher appended the real footer (`Exit Code: 0`). The Telegram monitor
 * trusted the status verbatim and announced a failure that never happened.
 *
 * Hive Mind's own footer parser is anchored on the `=====` separator and was
 * never fooled, so the fix is to make the monitor prefer it:
 *
 *   1. When the log footer exists it wins over the exit code `$ --status`
 *      reports (they only disagree when one of them is fabricated).
 *   2. A docker terminal FAILURE that no footer corroborates is provisional:
 *      it is deferred for DOCKER_TERMINAL_FOOTER_GRACE_MS so the real footer can
 *      appear, and only then reported (so a watcher that never writes a footer
 *      still surfaces the failure).
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2117
 * @see https://github.com/link-foundation/start/issues/150
 */

import { parseSessionExitFooter } from '../src/isolation-runner.lib.mjs';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';
import { monitorSessions, resetSessionMonitorForTests, trackSession, getActiveSessionCount, DOCKER_TERMINAL_FOOTER_GRACE_MS, getIsolationSessionStateForTests, __setIsolationRunnerForTests } from '../src/session-monitor.lib.mjs';
import { isUnknownDockerExitCode, isExecutingSessionStatus, isTerminalSessionStatus } from '../src/isolation-runner.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #2117: a fabricated terminal exit code must not fail a successful session');
console.log('='.repeat(72));

await initI18n('en');
await preloadAllLocales();

const SESSION = 'f5d5c5b7-cf3a-4f6f-9a6f-3f1d9c0b2117';

// ---------------------------------------------------------------------------
// 1. The exact log text from the incident must not be mistaken for a footer.
// ---------------------------------------------------------------------------

// What the containerized agent echoed into the log at 06:17:26 (an `rg -n` dump
// of an older execution log, embedded in a JSON tool-result line).
const echoedForeignFooter = String.raw`{"type":"item.completed","item":{"aggregated_output":"40-==================================================\n41-Finished: 2026-07-28 20:04:52.316\n42-Exit Code: 1\n","exit_code":0,"status":"completed"}}`;

const echoed = parseSessionExitFooter(echoedForeignFooter);
assert(echoed.finished === false, 'an echoed foreign "Exit Code: 1" is not parsed as this session’s footer');

const realFooter = parseSessionExitFooter(`${echoedForeignFooter}\n\n${'='.repeat(50)}\nFinished: 2026-07-30 06:38:21.188\nExit Code: 0\n`);
assert(realFooter.finished === true && realFooter.exitCode === 0, 'the real anchored footer is still parsed after foreign "Exit Code:" text');

// ---------------------------------------------------------------------------
// 2. getIsolationSessionState: the footer wins over a disagreeing status.
// ---------------------------------------------------------------------------

function stubRunner({ status, exitCode, footer = { finished: false, exitCode: null, endTime: null }, isSessionRunning = false, isolation = 'docker', endTime = undefined }) {
  return {
    isExecutingSessionStatus,
    isTerminalSessionStatus,
    isUnknownDockerExitCode,
    readSessionExitFromLog: () => footer,
    querySessionStatus: async () => ({ exists: true, status, exitCode, isolation, endTime, logPath: '/tmp/session-2117.log' }),
    isSessionRunning: async () => isSessionRunning,
  };
}

__setIsolationRunnerForTests(stubRunner({ status: 'executed', exitCode: 1, footer: { finished: true, exitCode: 0, endTime: '2026-07-30 06:38:21.188' } }));
const footerWins = await getIsolationSessionStateForTests(SESSION, { isolationBackend: 'docker', sessionId: SESSION });
assert(footerWins.running === false, 'a session whose footer is written is reported finished');
assert(footerWins.exitCode === 0, 'the anchored log footer overrides the fabricated status exit code');
assert(footerWins.status === 'executed', 'the corrected status reflects the footer exit code');

// A footer that agrees with the status is simply passed through.
__setIsolationRunnerForTests(stubRunner({ status: 'executed', exitCode: 127, footer: { finished: true, exitCode: 127, endTime: '2026-07-30 06:38:21.188' } }));
const genuineFailure = await getIsolationSessionStateForTests(SESSION, { isolationBackend: 'docker', sessionId: SESSION });
assert(genuineFailure.running === false && genuineFailure.exitCode === 127, 'a genuine failure corroborated by the footer is reported immediately');
assert(genuineFailure.status === 'failed', 'a corroborated non-zero exit is classified as failed');

// ---------------------------------------------------------------------------
// 3. A docker terminal failure with no footer is deferred, then accepted.
// ---------------------------------------------------------------------------

__setIsolationRunnerForTests(stubRunner({ status: 'executed', exitCode: 1 }));
const deferredInfo = { isolationBackend: 'docker', sessionId: SESSION };
const deferred = await getIsolationSessionStateForTests(SESSION, deferredInfo);
assert(deferred.running === true, 'an uncorroborated docker terminal failure is not reported as finished right away');
assert(Boolean(deferredInfo.dockerTerminalUnverifiedFirstSeenAt), 'the first uncorroborated terminal failure sighting is recorded');

const stillDeferred = await getIsolationSessionStateForTests(SESSION, deferredInfo);
assert(stillDeferred.running === true, 'the deferral holds while the grace period has not expired');

deferredInfo.dockerTerminalUnverifiedFirstSeenAt = new Date(Date.now() - DOCKER_TERMINAL_FOOTER_GRACE_MS - 1000).toISOString();
const accepted = await getIsolationSessionStateForTests(SESSION, deferredInfo);
assert(accepted.running === false && accepted.exitCode === 1, 'a failure that never gets a footer is reported once the grace period expires');

// The deferral marker is cleared once the footer arrives.
const resolvedInfo = { isolationBackend: 'docker', sessionId: SESSION, dockerTerminalUnverifiedFirstSeenAt: new Date().toISOString() };
__setIsolationRunnerForTests(stubRunner({ status: 'executed', exitCode: 1, footer: { finished: true, exitCode: 0, endTime: '2026-07-30 06:38:21.188' } }));
const resolved = await getIsolationSessionStateForTests(SESSION, resolvedInfo);
assert(resolved.exitCode === 0 && !resolvedInfo.dockerTerminalUnverifiedFirstSeenAt, 'the deferral marker is cleared when the footer resolves the session');

// ---------------------------------------------------------------------------
// 4. Behaviour that must NOT change.
// ---------------------------------------------------------------------------

__setIsolationRunnerForTests(stubRunner({ status: 'executed', exitCode: 0, isSessionRunning: true }));
const successNoFooter = await getIsolationSessionStateForTests(SESSION, { isolationBackend: 'docker', sessionId: SESSION });
assert(successNoFooter.running === false && successNoFooter.exitCode === 0, 'a terminal success without a footer is still reported immediately');

__setIsolationRunnerForTests(stubRunner({ status: 'failed', exitCode: 1, isolation: 'screen' }));
const screenFailure = await getIsolationSessionStateForTests(SESSION, { isolationBackend: 'screen', sessionId: SESSION });
assert(screenFailure.running === false && screenFailure.exitCode === 1, 'non-docker terminal failures are unaffected by the docker-only deferral');

// The fabrication race is only open while the reported end time is fresh: a
// docker failure that ended long ago has had all the time it needed for the
// footer, so it is reported without delay (this is the issue #1979 case).
__setIsolationRunnerForTests(stubRunner({ status: 'failed', exitCode: 2, endTime: '2026-06-24T10:03:00.000Z' }));
const staleInfo = { isolationBackend: 'docker', sessionId: SESSION };
const staleFailure = await getIsolationSessionStateForTests(SESSION, staleInfo);
assert(staleFailure.running === false && staleFailure.exitCode === 2, 'a docker failure whose reported end time predates the grace period is not deferred');
assert(!staleInfo.dockerTerminalUnverifiedFirstSeenAt, 'no deferral marker is recorded for an old terminal record');

// A failure that ended moments ago is still deferred, end time or not.
__setIsolationRunnerForTests(stubRunner({ status: 'failed', exitCode: 2, endTime: new Date().toISOString() }));
const freshFailure = await getIsolationSessionStateForTests(SESSION, { isolationBackend: 'docker', sessionId: SESSION });
assert(freshFailure.running === true, 'a docker failure reported as having just ended is still deferred');

__setIsolationRunnerForTests(null);

// ---------------------------------------------------------------------------
// 5. End to end: the Telegram monitor reports success, not a false failure.
// ---------------------------------------------------------------------------

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

resetSessionMonitorForTests();
const sessionInfo = {
  chatId: 1001,
  messageId: 2002,
  startTime: new Date(Date.now() - 24 * 60 * 1000),
  command: 'solve',
  tool: 'codex',
  url: 'https://github.com/link-assistant/use-m/issues/68',
  isolationBackend: 'docker',
  sessionId: SESSION,
  logPath: '/tmp/session-2117.log',
  locale: 'en',
};
trackSession(SESSION, sessionInfo, false);

const bot = makeBot();
// Poll #1 — the container has stopped and `$ --status` reports the fabricated
// exit 1, but start-command has not written the footer yet.
await monitorSessions(bot, false, {
  statusProvider: async () => ({ exists: true, status: 'executed', exitCode: 1, isolation: 'docker', logPath: '/tmp/session-2117.log' }),
  exitFromLog: () => ({ finished: false, exitCode: null, endTime: null }),
  dockerContainerSizeProvider: async () => null,
});

assert(bot.edits.length === 0, 'no failure notification is sent while the terminal failure is uncorroborated');
assert(getActiveSessionCount(false) === 1, 'the session stays tracked during the deferral');

// Poll #2 — start-command appended the real footer: exit 0.
await monitorSessions(bot, false, {
  statusProvider: async () => ({ exists: true, status: 'executed', exitCode: 1, isolation: 'docker', logPath: '/tmp/session-2117.log' }),
  exitFromLog: () => ({ finished: true, exitCode: 0, endTime: '2026-07-30 06:38:21.188' }),
  dockerContainerSizeProvider: async () => null,
});

const completion = bot.edits[0]?.text || '';
assert(bot.edits.length === 1, 'the session is completed once the footer corroborates the outcome');
assert(!/failed/i.test(completion), `the completion message does not report a failure (got: ${completion.split('\n')[0]})`);
assert(!/exit code: 1\b/.test(completion), 'the fabricated exit code 1 never reaches the user');
assert(/successfully/i.test(completion), 'the completion message reports success');
assert(getActiveSessionCount(false) === 0, 'the completed session is untracked');

resetSessionMonitorForTests();
printSummary(72);

if (getFailCount() > 0) {
  process.exit(1);
}
