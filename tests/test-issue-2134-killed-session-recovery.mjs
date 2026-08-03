#!/usr/bin/env node
/**
 * Regression coverage for issue #2134 — "Better handling of killed task".
 *
 * Reproduces the reported sequence: the host ran out of memory, docker set
 * `State.OOMKilled = true` on the container, `$ --status` reported
 * `executed / exitCode 137`, and Hive Mind announced
 * "Work session killed — out of memory or forced kill (SIGKILL) (exit code: 137)"
 * and stopped tracking — while the container kept running for another 3.5 hours
 * and auto-merged its pull request with nothing said in the PR.
 *
 * What is asserted here:
 *   1. an OOM flag contradicted by a live container is NOT reported as a kill;
 *   2. the session that survives the event completes with a
 *      "recovered from out of memory" warning instead of a plain success;
 *   3. the kill cause is diagnosed exactly (out of memory / disk full / forced
 *      kill) from the resource markers, cgroup counters and kernel OOM report;
 *   4. the pull request gets the same report, with the intermediate log uploaded
 *      only when `--attach-logs` is enabled;
 *   5. the on-kill behaviour is configurable via flag and environment variable;
 *   6. `${sessionId}` and friends are never offered as a resume session id.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2134
 */

import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';
import { monitorSessions, resetSessionMonitorForTests, trackSession, getActiveSessionCount, STALE_EXECUTING_MIN_AGE_MS } from '../src/session-monitor.lib.mjs';
import { resolveOomKilledState, getOomEventObservedAt } from '../src/session-monitor.oom.lib.mjs';
import { describeKillCause, parseOomVictims, KILL_CAUSE_OUT_OF_MEMORY, KILL_CAUSE_DISK_FULL, KILL_CAUSE_FORCED_KILL } from '../src/session-kill-diagnostics.lib.mjs';
import { resolveOnSessionKillPolicy, resolveSessionKillResumeAttempts, shouldResumeKilledSession, ON_SESSION_KILL_RESUME, ON_SESSION_KILL_REPORT } from '../src/session-kill-policy.lib.mjs';
import { buildKillRecoveryNotice, postKillRecoveryNotice, attachIntermediateSessionLog, parsePullRequestUrl } from '../src/session-kill-recovery.lib.mjs';
import { argsIncludeAttachLogs, argvFromSessionArgs, buildKillCompletionSections } from '../src/session-monitor.kill-sections.lib.mjs';
import { isPlausibleSessionId } from '../src/session-resume.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #2134: killed work sessions are verified, diagnosed and reported');
console.log('='.repeat(78));

await initI18n('en');
await preloadAllLocales();

const SESSION = '30920087-c181-47f0-bc75-66a78402d400';
const LOG_PATH = `/tmp/start-command/logs/isolation/docker/${SESSION}.log`;

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
        return { chat: { id: chatId }, message_id: 1 };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 1. The OOM ladder itself.
// ---------------------------------------------------------------------------
console.log('\n-- resolveOomKilledState evidence ladder --');

const aliveSessionInfo = { isolationBackend: 'docker', sessionId: SESSION, logPath: LOG_PATH };
let persisted = 0;
const aliveState = await resolveOomKilledState(
  SESSION,
  aliveSessionInfo,
  { exists: true, status: 'executed', exitCode: 137, oomKilled: true, logPath: LOG_PATH },
  {
    exitFromLog: () => ({ finished: false, exitCode: null, endTime: null }),
    backendAlive: async () => true,
    persistSnapshot: () => {
      persisted++;
    },
  }
);
assert(aliveState.running === true, 'a live container is not reported as OOM-killed (root cause of #2134)');
assert(aliveState.oomEventObserved === true, 'the OOM event is remembered while the session keeps running');
assert(Boolean(getOomEventObservedAt(aliveSessionInfo)), 'the OOM observation is written to the session snapshot');
assert(persisted === 1, 'the OOM observation is persisted so it survives a bot restart');

const survivedSessionInfo = { isolationBackend: 'docker', sessionId: SESSION, logPath: LOG_PATH };
const survivedState = await resolveOomKilledState(
  SESSION,
  survivedSessionInfo,
  { exists: true, status: 'executed', exitCode: 137, oomKilled: true, logPath: LOG_PATH },
  {
    exitFromLog: () => ({ finished: true, exitCode: 0, endTime: '2026-08-02T21:11:07.000Z' }),
    backendAlive: async () => false,
    persistSnapshot: () => {},
  }
);
assert(survivedState.running === false && survivedState.exitCode === 0, 'a log footer with exit 0 beats the container OOM flag');
assert(survivedState.status === 'executed', 'a session that survived the OOM event completes as executed');
assert(Boolean(getOomEventObservedAt(survivedSessionInfo)), 'surviving an OOM event is still recorded for the completion warning');

const killedState = await resolveOomKilledState(
  SESSION,
  { isolationBackend: 'docker', sessionId: SESSION, logPath: LOG_PATH },
  { exists: true, status: 'executed', exitCode: 137, oomKilled: true, logPath: LOG_PATH },
  {
    exitFromLog: () => ({ finished: false, exitCode: null, endTime: null }),
    backendAlive: async () => false,
    persistSnapshot: () => {},
  }
);
assert(killedState.running === false && killedState.status === 'oom-killed' && killedState.exitCode === 137, 'a dead container with an OOM flag is still terminal (issue #2015 preserved)');

// ---------------------------------------------------------------------------
// 2. End-to-end through the monitor: no false kill, then a recovery warning.
// ---------------------------------------------------------------------------
console.log('\n-- monitor: false kill is not announced, recovery is --');

resetSessionMonitorForTests();
const sessionInfo = {
  chatId: 4242,
  messageId: 77,
  startTime: new Date(Date.now() - STALE_EXECUTING_MIN_AGE_MS - 60_000),
  command: 'solve',
  tool: 'claude',
  url: 'https://github.com/link-assistant/hive-mind/issues/2130',
  urlContext: { type: 'issue', owner: 'link-assistant', repo: 'hive-mind', number: 2130 },
  isolationBackend: 'docker',
  sessionId: SESSION,
  logPath: LOG_PATH,
  locale: 'en',
};
trackSession(SESSION, sessionInfo, false);

const oomStatus = { exists: true, status: 'executed', exitCode: 137, oomKilled: true, isolation: 'docker', logPath: LOG_PATH };
const bot = makeBot();
await monitorSessions(bot, false, {
  statusProvider: async () => oomStatus,
  exitFromLog: () => ({ finished: false, exitCode: null, endTime: null }),
  backendAlive: async () => true,
  dockerContainerSizeProvider: async () => null,
  readFile: async () => '',
});

assert(bot.edits.length === 0 && bot.sends.length === 0, 'no completion is announced while the container is alive (the #2134 defect)');
assert(getActiveSessionCount(false) === 1, 'the session stays tracked after a container-level OOM event');
assert(Boolean(sessionInfo.oomEventObservedAt), 'the monitor records the OOM event on the tracked session');

const recoveredBot = makeBot();
const postedComments = [];
await monitorSessions(recoveredBot, false, {
  statusProvider: async () => ({ ...oomStatus, exitCode: 0, status: 'executed' }),
  exitFromLog: () => ({ finished: true, exitCode: 0, endTime: '2026-08-02T21:11:07.000Z' }),
  backendAlive: async () => false,
  dockerContainerSizeProvider: async () => null,
  readFile: async () => '📈 [RESOURCES] phase=before-agent memAvailableBytes=822000000 memTotalBytes=12500000000 diskUsedPercent=41.0\n',
  lookupLinkedPullRequest: async () => 'https://github.com/link-assistant/hive-mind/pull/2131',
  runCommand: async (command, args) => {
    postedComments.push({ command, args });
    return { code: 0, stdout: 'https://github.com/link-assistant/hive-mind/pull/2131#issuecomment-1\n', stderr: '' };
  },
});

const recoveredText = recoveredBot.edits[0]?.text || '';
assert(recoveredBot.edits.length === 1, 'the surviving session is completed once its footer appears');
assert(/recovered from out of memory/i.test(recoveredText), 'the completion warns that the session recovered from out of memory');
assert(!/Work session killed/.test(recoveredText), 'a recovered session is not reported as killed');
assert(/Kill diagnostics/.test(recoveredText), 'the completion carries the kill diagnostics section');
assert(
  postedComments.some(entry => entry.command === 'gh' && entry.args[0] === 'pr' && entry.args[1] === 'comment'),
  'the same report is posted to the pull request (issue #2134 R2)'
);

resetSessionMonitorForTests();

// ---------------------------------------------------------------------------
// 3. Exact kill cause.
// ---------------------------------------------------------------------------
console.log('\n-- kill cause diagnostics --');

const oomLog = '📈 [RESOURCES] phase=before-agent memAvailableBytes=822000000 memTotalBytes=12500000000 diskUsedPercent=41.0\n';
const oomDiagnosis = describeKillCause({ logText: oomLog, exitCode: 137 });
assert(oomDiagnosis.cause === KILL_CAUSE_OUT_OF_MEMORY, 'nearly exhausted RAM is diagnosed as out of memory');
assert(/out of memory/i.test(oomDiagnosis.summary), 'the OOM summary says the session ran out of memory');
assert(oomDiagnosis.evidence.length > 0, 'the OOM verdict comes with its evidence');

const diskLog = '📈 [RESOURCES] phase=before-agent memAvailableBytes=8000000000 memTotalBytes=12500000000 diskUsedPercent=98.4\n';
const diskDiagnosis = describeKillCause({ logText: diskLog, exitCode: 137 });
assert(diskDiagnosis.cause === KILL_CAUSE_DISK_FULL, 'a full disk with healthy memory is diagnosed as disk exhaustion');

const forcedLog = '📈 [RESOURCES] phase=before-agent memAvailableBytes=8000000000 memTotalBytes=12500000000 diskUsedPercent=41.0\n';
const forcedDiagnosis = describeKillCause({ logText: forcedLog, exitCode: 137 });
assert(forcedDiagnosis.cause === KILL_CAUSE_FORCED_KILL, 'a signal kill with healthy resources is diagnosed as a forced kill');

const victims = parseOomVictims(['[Sat Aug  2 17:40:30 2026] Out of memory: Killed process 4711 (node) total-vm:9000000kB', '[Sat Aug  2 17:40:30 2026] oom-kill:constraint=CONSTRAINT_NONE,task=claude,pid=4712'].join('\n'));
assert(victims.length === 2, 'both kernel OOM report formats are parsed');
assert(victims[0].comm === 'node' && victims[0].pid === 4711, 'the classic OOM line names the victim process');
assert(victims[1].comm === 'claude' && victims[1].pid === 4712, 'the modern oom-kill line names the victim process');

const victimDiagnosis = describeKillCause({ logText: forcedLog, exitCode: 137, system: { victims, cgroup: {}, memory: {} } });
assert(victimDiagnosis.cause === KILL_CAUSE_OUT_OF_MEMORY, 'a kernel OOM report outweighs healthy resource markers');
assert(/claude/.test(victimDiagnosis.summary), 'the summary names the process the kernel killed');

// ---------------------------------------------------------------------------
// 4. Pull-request notice and --attach-logs gating.
// ---------------------------------------------------------------------------
console.log('\n-- pull request notice --');

const notice = buildKillRecoveryNotice({ diagnosis: oomDiagnosis, exitCode: 137, sessionName: SESSION, observedAt: '2026-08-02T17:42:06.000Z', policy: ON_SESSION_KILL_RESUME, resumed: true, resumeCommand: 'solve --resume abc', attachLogs: false });
assert(/recovered from out of memory/.test(notice), 'the PR notice uses the same wording as the Telegram warning');
assert(/new working session was started/.test(notice), 'the PR notice states that a new working session was started');
assert(/`--attach-logs` is disabled/.test(notice), 'the PR notice explains why no log was uploaded');
assert(/solve --resume abc/.test(notice), 'the PR notice offers the resume command');

const attachedNotice = buildKillRecoveryNotice({ diagnosis: oomDiagnosis, exitCode: 137, attachLogs: true, logAttached: true });
assert(/uploaded as a separate comment/.test(attachedNotice), 'the PR notice points at the uploaded intermediate log');
assert(!/`--attach-logs` is disabled/.test(attachedNotice), 'the disabled-logs note is dropped when logs are attached');

let uploads = 0;
const skipped = await attachIntermediateSessionLog({ attachLogs: false, logPath: LOG_PATH, pullRequestUrl: 'https://github.com/link-assistant/hive-mind/pull/2131', attachLog: async () => ((uploads += 1), true) });
assert(skipped.uploaded === false && skipped.skipped === 'attach-logs-disabled', 'the intermediate log is not uploaded without --attach-logs');
assert(uploads === 0, 'no upload is attempted without --attach-logs');

const uploaded = await attachIntermediateSessionLog({ attachLogs: true, logPath: LOG_PATH, pullRequestUrl: 'https://github.com/link-assistant/hive-mind/pull/2131', attachLog: async options => ((uploads += 1), assert(options.targetNumber === 2131 && options.owner === 'link-assistant' && options.repo === 'hive-mind', 'the upload targets the right pull request'), true) });
assert(uploaded.uploaded === true && uploads === 1, 'the intermediate log is uploaded when --attach-logs is enabled');

assert(parsePullRequestUrl('https://github.com/link-assistant/hive-mind/pull/2131')?.number === 2131, 'pull request URLs are parsed');
assert(parsePullRequestUrl('not a url') === null, 'non-PR URLs are rejected');

const writes = [];
const posted = await postKillRecoveryNotice({
  pullRequestUrl: 'https://github.com/o/r/pull/7',
  body: '# hello',
  runCommand: async (command, args) => {
    writes.push({ command, args });
    return { code: 0, stdout: 'https://github.com/o/r/pull/7#issuecomment-2', stderr: '' };
  },
  writeFile: async () => {},
  unlink: async () => {},
});
assert(posted.posted === true && posted.url === 'https://github.com/o/r/pull/7#issuecomment-2', 'the notice is posted and its URL returned');
assert(writes[0].args.includes('--body-file'), 'the notice body is passed via --body-file, never the command line');

const failedPost = await postKillRecoveryNotice({ pullRequestUrl: 'https://github.com/o/r/pull/7', body: 'x', runCommand: async () => ({ code: 1, stdout: '', stderr: 'no auth' }), writeFile: async () => {}, unlink: async () => {} });
assert(failedPost.posted === false && /no auth/.test(failedPost.error), 'a failed post is reported, not thrown');

// ---------------------------------------------------------------------------
// 5. Configurable behaviour, identical for every surface.
// ---------------------------------------------------------------------------
console.log('\n-- on-kill policy --');

assert(resolveOnSessionKillPolicy({ argv: {}, env: {} }) === ON_SESSION_KILL_REPORT, 'report is the default on-kill policy');
assert(resolveOnSessionKillPolicy({ argv: { 'on-session-kill': 'resume' }, env: {} }) === ON_SESSION_KILL_RESUME, '--on-session-kill selects the policy');
assert(resolveOnSessionKillPolicy({ argv: {}, env: { HIVE_MIND_ON_SESSION_KILL: 'resume' } }) === ON_SESSION_KILL_RESUME, 'HIVE_MIND_ON_SESSION_KILL selects the policy');
assert(resolveOnSessionKillPolicy({ argv: { onSessionKill: 'report' }, env: { HIVE_MIND_ON_SESSION_KILL: 'resume' } }) === ON_SESSION_KILL_REPORT, 'the flag wins over the environment');
assert(resolveOnSessionKillPolicy({ argv: { onSessionKill: 'nonsense' }, env: {} }) === ON_SESSION_KILL_REPORT, 'an invalid policy falls back to the default');
assert(resolveSessionKillResumeAttempts({ argv: {}, env: {} }) === 1, 'one automatic resume attempt by default');
assert(resolveSessionKillResumeAttempts({ argv: {}, env: { HIVE_MIND_SESSION_KILL_RESUME_ATTEMPTS: '3' } }) === 3, 'the resume attempt cap is configurable');
assert(shouldResumeKilledSession({ policy: ON_SESSION_KILL_RESUME, killed: true }) === true, 'resume policy resumes a killed session');
assert(shouldResumeKilledSession({ policy: ON_SESSION_KILL_REPORT, killed: true }) === false, 'report policy never auto-resumes');
assert(shouldResumeKilledSession({ policy: ON_SESSION_KILL_RESUME, killed: false }) === false, 'a session that was not killed is never resumed');

assert(argsIncludeAttachLogs(['--attach-logs']) === true, '--attach-logs is detected on the tracked session args');
assert(argsIncludeAttachLogs(['--verbose']) === false, 'a session without --attach-logs is detected as such');
assert(argvFromSessionArgs(['--on-session-kill', 'resume', '--verbose']).onSessionKill === undefined, 'kebab-case args stay kebab-case');
assert(argvFromSessionArgs(['--on-session-kill', 'resume'])['on-session-kill'] === 'resume', 'session args are parsed into an argv-like object');

const killSections = await buildKillCompletionSections({ sessionName: SESSION, sessionInfo: { locale: 'en', logPath: LOG_PATH, args: ['--attach-logs'] }, statusResult: { logPath: LOG_PATH }, exitCode: 137, status: 'killed', readFile: async () => oomLog });
assert(killSections.killed === true, 'a killed session is recognised at completion time');
assert(
  killSections.sections.some(section => /Kill diagnostics/.test(section)),
  'a killed session reports its diagnosis'
);
assert(killSections.policy === ON_SESSION_KILL_REPORT, 'the completion carries the resolved on-kill policy');

const cleanSections = await buildKillCompletionSections({ sessionName: SESSION, sessionInfo: { locale: 'en' }, exitCode: 0, status: 'executed' });
assert(cleanSections.sections.length === 0, 'an ordinary successful session gains no kill sections');

// ---------------------------------------------------------------------------
// 6. Resume ids are never placeholders (issue #2109 follow-up seen in #2134).
// ---------------------------------------------------------------------------
console.log('\n-- resume session id sanity --');

assert(isPlausibleSessionId('30920087-c181-47f0-bc75-66a78402d400') === true, 'a real session id is accepted');
assert(isPlausibleSessionId('${sessionId}') === false, 'an unexpanded ${sessionId} placeholder is rejected');
assert(isPlausibleSessionId('unknown') === false, 'the literal "unknown" is rejected');
assert(isPlausibleSessionId('abc') === false, 'a too-short id is rejected');

printSummary(78);

if (getFailCount() > 0) {
  process.exit(1);
}
