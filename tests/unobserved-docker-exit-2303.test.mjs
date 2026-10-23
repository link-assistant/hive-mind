#!/usr/bin/env node
/**
 * Regression test for issue #2303: "✅ Work session finished successfully" for
 * a docker `/solve` session that was actually killed.
 *
 * start-command 0.34.0's detached docker watcher followed the container with
 * `docker logs -f C >> LOG`. On a full disk that write failed with ENOSPC and
 * returned while the container was STILL RUNNING; `docker inspect` of a running
 * container reports `ExitCode 0` and no `FinishedAt`, so the watcher removed the
 * live container (killing the work), wrote an `Exit Code: 0` footer and
 * finalized the record as `executed` / `0` with `endTimeSource: 'observed-at'`.
 * Hive Mind trusted the footer and reported success.
 *
 * start-command >= 0.34.1 records the same situation as exit `-1` with
 * `exitReason: 'watcher-lost-container'`; Hive Mind reported that as a plain
 * "failed (exit code: -1)" — no kill diagnosis, no pull request notice and no
 * automatic `--on-session-kill=resume` recovery.
 *
 * Asserted here: both shapes are reported as a kill (never a success), the kill
 * names its cause when the disk was seen full, the default resume policy starts
 * a recovery, and a real docker exit is left alone.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2303
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';
import { isExecutingSessionStatus, isTerminalSessionStatus } from '../src/session-status.lib.mjs';
import { isUnknownDockerExitCode, parseSessionStatusOutput } from '../src/isolation-runner.parsers.lib.mjs';
import { __setIsolationRunnerForTests, getActiveSessionCount, getIsolationSessionStateForTests, monitorSessions, resetSessionMonitorForTests, trackSession } from '../src/session-monitor.lib.mjs';
import { detectUnobservedDockerExit, reclassifyUnobservedDockerExit } from '../src/session-monitor.unobserved-exit.lib.mjs';
import { describeObservedHostDisk, observeHostDiskForSession } from '../src/session-monitor.host-disk.lib.mjs';
import { describeKillCause, findDiskFullMarker, KILL_CAUSE_DISK_FULL, KILL_CAUSE_UNKNOWN } from '../src/session-kill-diagnostics.lib.mjs';
import { formatSessionCompletionMessage } from '../src/work-session-formatting.lib.mjs';
import { serializeSessionInfo } from '../src/session-store.lib.mjs';

await initI18n('en');
await preloadAllLocales();

const SESSION = '56291848-d17d-4326-8b41-3ac995221efc';
const TOOL_SESSION = 'a1b2c3d4-0000-4000-8000-000000002303';
const GIB = 1024 ** 3;
const dockerInfo = () => ({ isolationBackend: 'docker', sessionId: SESSION });

// What `$ --status --output-format json` returned for the incident: executed / 0,
// but docker never reported a finish time.
const incidentStatus = {
  exists: true,
  uuid: 'b105ce98-52a1-4c2d-949a-bfa872c4f784',
  status: 'executed',
  exitCode: 0,
  isolation: 'docker',
  logPath: '/tmp/session-2303.log',
  endTime: '2026-09-26T07:26:04.000Z',
  endTimeSource: 'observed-at',
  observedAt: '2026-09-26T07:26:04.000Z',
  oomKilled: false,
};
// start-command >= 0.34.1: the same situation, recorded honestly as unknown.
const lostContainerStatus = { ...incidentStatus, exitCode: -1, exitReason: 'watcher-lost-container' };
const healthyMarker = '[2026-09-26T06:34:23.901Z] [INFO] 📈 [RESOURCES] phase=log_upload_start diskPath=%2F diskTotalBytes=206900281344 diskAvailableBytes=43535716352 diskUsedBytes=163347787776 diskUsedPercent=78.9500075664044\n';

function stubRunner({ status = incidentStatus, footer = { finished: false, exitCode: null, endTime: null }, alive = false } = {}) {
  return {
    isExecutingSessionStatus,
    isTerminalSessionStatus,
    isUnknownDockerExitCode,
    readSessionExitFromLog: () => footer,
    querySessionStatus: async () => status,
    isSessionRunning: async () => alive,
    checkBackendSessionAlive: async () => alive,
  };
}

test('$ --status: endTimeSource and observedAt are parsed from JSON and text output', () => {
  const json = parseSessionStatusOutput(JSON.stringify({ uuid: 'u', status: 'executed', exitCode: 0, endTimeSource: 'observed-at', observedAt: '2026-09-26T07:26:04.000Z' }));
  assert.equal(json.endTimeSource, 'observed-at');
  assert.equal(json.observedAt, '2026-09-26T07:26:04.000Z');
  const text = parseSessionStatusOutput('u\n  status executed\n  exitCode -1\n  exitReason watcher-lost-container\n  endTimeSource observed-at\n  observedAt 2026-09-26T07:26:04.000Z\n');
  assert.equal(text.endTimeSource, 'observed-at');
  assert.equal(text.observedAt, '2026-09-26T07:26:04.000Z');
  assert.equal(text.exitReason, 'watcher-lost-container');
  const labelled = parseSessionStatusOutput('u\nStatus:            executed\nEnd Time Source:   docker-finished-at\n');
  assert.equal(labelled.endTimeSource, 'docker-finished-at');
});

test('detection is narrow: docker + a reported exit docker never observed', () => {
  const info = dockerInfo();
  assert.ok(detectUnobservedDockerExit({ sessionInfo: info, statusResult: incidentStatus, exitCode: 0, status: 'executed' }), 'executed/0 with endTimeSource=observed-at');
  assert.ok(detectUnobservedDockerExit({ sessionInfo: info, statusResult: incidentStatus, exitCode: null, status: 'executed' }), 'null exit with an executed status');
  assert.ok(detectUnobservedDockerExit({ sessionInfo: info, statusResult: lostContainerStatus, exitCode: -1, status: 'failed' }), 'watcher-lost-container (-1)');
  assert.equal(detectUnobservedDockerExit({ sessionInfo: info, statusResult: { ...incidentStatus, endTimeSource: 'docker-finished-at' }, exitCode: 0, status: 'executed' }), null, 'a container docker saw finish is a real success');
  assert.equal(detectUnobservedDockerExit({ sessionInfo: info, statusResult: { ...incidentStatus, endTimeSource: 'log-footer' }, exitCode: 0, status: 'executed' }), null);
  assert.equal(detectUnobservedDockerExit({ sessionInfo: info, statusResult: { ...incidentStatus, endTimeSource: undefined }, exitCode: 0, status: 'executed' }), null, 'an older start-command without endTimeSource is left alone');
  assert.equal(detectUnobservedDockerExit({ sessionInfo: { isolationBackend: 'screen' }, statusResult: { ...incidentStatus, isolation: 'screen' }, exitCode: 0, status: 'executed' }), null, 'non-docker isolation is never reclassified');
  assert.equal(detectUnobservedDockerExit({ sessionInfo: info, statusResult: { ...incidentStatus, exitCode: 1 }, exitCode: 1, status: 'failed' }), null, 'an observed-at failure stays an ordinary failure');
  assert.equal(detectUnobservedDockerExit({ sessionInfo: info, statusResult: { ...lostContainerStatus, exitReason: null }, exitCode: -1, status: 'executed' }), null, 'a -1 without the watcher reason is left to the normal path');
  const untouched = { running: false, exitCode: 0, status: 'executed', statusResult: { ...incidentStatus, endTimeSource: 'docker-finished-at' } };
  assert.equal(reclassifyUnobservedDockerExit(SESSION, info, untouched), untouched, 'nothing wrong: the very same state is returned');
  const running = { running: true, exitCode: null, status: 'executing', statusResult: lostContainerStatus };
  assert.equal(reclassifyUnobservedDockerExit(SESSION, info, running), running, 'a running session is not touched');
});

test('the isolation state reports an unobserved docker exit as killed, never as success', async t => {
  t.after(() => __setIsolationRunnerForTests(null));

  // The old watcher wrote `Exit Code: 0` from the same bogus inspect result, so
  // the footer is not independent evidence and must not rescue the success.
  __setIsolationRunnerForTests(stubRunner({ footer: { finished: true, exitCode: 0, endTime: '2026-09-26 07:26:04.000' } }));
  const withFooter = await getIsolationSessionStateForTests(SESSION, dockerInfo());
  assert.equal(withFooter.running, false);
  assert.equal(withFooter.status, 'killed', 'the footer-backed exit 0 is a kill');
  assert.equal(withFooter.exitCode, null, 'the fabricated exit 0 is dropped');
  assert.equal(withFooter.statusResult.status, 'killed', 'the payload the formatter reads is corrected too');
  assert.equal(withFooter.statusResult.reportedExitCode, 0, 'the reported exit is kept for diagnostics');
  assert.match(withFooter.statusResult.unobservedExit, /finish time/);

  __setIsolationRunnerForTests(stubRunner());
  const withoutFooter = await getIsolationSessionStateForTests(SESSION, dockerInfo());
  assert.equal(withoutFooter.running, false);
  assert.equal(withoutFooter.status, 'killed', 'without a footer the unobserved exit is still a kill');

  // start-command >= 0.34.1: `-1` / watcher-lost-container, with and without its `Exit Code: -1` footer.
  for (const footer of [
    { finished: true, exitCode: -1, endTime: '2026-09-26 07:26:04.000' },
    { finished: false, exitCode: null, endTime: null },
  ]) {
    __setIsolationRunnerForTests(stubRunner({ status: lostContainerStatus, footer }));
    const lost = await getIsolationSessionStateForTests(SESSION, dockerInfo());
    assert.equal(lost.running, false);
    assert.equal(lost.status, 'killed', `watcher-lost-container is a kill, not "failed (exit code: -1)" (footer ${footer.finished ? 'present' : 'absent'}, got ${lost.status}/${lost.exitCode})`);
    assert.equal(lost.statusResult.reportedExitCode, -1);
  }

  // The watcher lost the container, but the container is still running: the work is not over.
  __setIsolationRunnerForTests(stubRunner({ status: lostContainerStatus, footer: { finished: true, exitCode: -1, endTime: '2026-09-26 07:26:04.000' }, alive: true }));
  const stillAlive = await getIsolationSessionStateForTests(SESSION, dockerInfo());
  assert.equal(stillAlive.running, true, 'a live container is not reported as ended because the watcher lost it');

  __setIsolationRunnerForTests(stubRunner({ status: { ...incidentStatus, endTimeSource: 'docker-finished-at' }, footer: { finished: true, exitCode: 0, endTime: '2026-09-26 07:26:04.000' } }));
  const realSuccess = await getIsolationSessionStateForTests(SESSION, dockerInfo());
  assert.deepEqual([realSuccess.running, realSuccess.exitCode, realSuccess.status], [false, 0, 'executed'], 'a real docker success is still a success');
});

test('disk-full evidence: host disk samples and ENOSPC lines name the cause', async () => {
  const info = { ...dockerInfo(), logPath: '/var/log/start/session.log' };
  const targets = [];
  for (const bavail of [30 * GIB, 0.2 * GIB, 120 * GIB]) {
    await observeHostDiskForSession(info, {
      statfs: async target => {
        targets.push(target);
        return { bavail, blocks: 192 * GIB, bsize: 1 };
      },
    });
  }
  assert.ok(
    targets.every(target => target === '/var/log/start'),
    'the filesystem holding the session log is sampled'
  );
  assert.equal(info.hostDiskMinAvailableBytes, Math.round(0.2 * GIB), 'the lowest reading is kept');
  assert.equal(info.hostDiskTotalBytes, 192 * GIB);
  assert.ok(info.hostDiskMinAvailableAt);
  const persisted = serializeSessionInfo(info);
  assert.equal(persisted.hostDiskMinAvailableBytes, info.hostDiskMinAvailableBytes, 'the reading survives a bot restart');
  const failing = dockerInfo();
  assert.equal(
    await observeHostDiskForSession(failing, {
      statfs: async () => {
        throw new Error('EACCES');
      },
    }),
    null
  );
  assert.equal(failing.hostDiskMinAvailableBytes, undefined, 'a failed statfs records nothing');

  const observedDisk = describeObservedHostDisk(info);
  const fromHost = describeKillCause({ logText: healthyMarker, exitCode: null, observedDisk });
  assert.equal(fromHost.cause, KILL_CAUSE_DISK_FULL, 'a full host disk diagnoses the kill even when the last log marker looked healthy');
  assert.ok(fromHost.evidence.some(line => /host disk/i.test(line)));
  assert.equal(describeKillCause({ logText: healthyMarker, exitCode: null, observedDisk: { availableBytes: 40 * GIB, totalBytes: 192 * GIB, path: '/' } }).cause, KILL_CAUSE_UNKNOWN, 'a healthy host disk does not invent a verdict');

  const enospcLog = `${healthyMarker}[2026-09-26T07:25:59.000Z] [ERROR] Error: ENOSPC: no space left on device, write\n`;
  assert.ok(findDiskFullMarker(enospcLog));
  assert.ok(findDiskFullMarker("cp: error writing 'x': No space left on device"));
  assert.equal(findDiskFullMarker(healthyMarker), null);
  assert.equal(describeKillCause({ logText: enospcLog, exitCode: null }).cause, KILL_CAUSE_DISK_FULL, 'an ENOSPC line in an abnormal exit names the full disk');
  assert.notEqual(describeKillCause({ logText: enospcLog, exitCode: 0 }).cause, KILL_CAUSE_DISK_FULL, 'an ENOSPC line in a clean exit manufactures nothing');

  const unexplained = describeKillCause({ logText: healthyMarker, exitCode: null, unobservedExit: 'docker never reported a finish time' });
  assert.ok(
    unexplained.evidence.some(line => /never reported a finish time/.test(line)),
    'the evidence says why the reported exit was not trusted'
  );
});

test('the headline says killed and names the cause', () => {
  const base = { sessionName: SESSION, sessionInfo: { ...dockerInfo(), startTime: new Date() }, statusResult: { status: 'killed', exitCode: null }, exitCode: null };
  const killed = formatSessionCompletionMessage({ ...base, killCause: KILL_CAUSE_DISK_FULL, locale: 'en' }).split('\n')[0];
  assert.match(killed, /killed \(disk full\)/);
  assert.doesNotMatch(killed, /successfully|exit code/);
  const recovering = formatSessionCompletionMessage({ ...base, resumedAs: 'recovery-2303', recoveryCount: 1, killCause: KILL_CAUSE_DISK_FULL, locale: 'en' }).split('\n')[0];
  assert.match(recovering, /recovering from a kill \(disk full\)/);
  assert.doesNotMatch(recovering, /exit code/, 'the sentinel exit 1 of a status-only kill is not shown as an exit code');
  for (const locale of ['ru', 'hi', 'zh']) {
    const localized = formatSessionCompletionMessage({ ...base, resumedAs: 'recovery-2303', recoveryCount: 1, killCause: KILL_CAUSE_DISK_FULL, locale }).split('\n')[0];
    assert.match(localized, /\(disk full\)/, `${locale}: ${localized}`);
    assert.doesNotMatch(localized, /\{\{|telegram\./, `${locale} is translated`);
  }
});

test('end to end: killed, diagnosed as disk full, announced and auto-resumed', async t => {
  const logPath = path.join(os.tmpdir(), `hive-mind-test-2303-${process.pid}.log`);
  fs.writeFileSync(logPath, `📌 Session ID: ${TOOL_SESSION}\n${healthyMarker}\n${'='.repeat(50)}\nFinished: 2026-09-26 07:26:04.000\nExit Code: 0\n`, 'utf8');
  t.after(() => {
    fs.rmSync(logPath, { force: true });
    resetSessionMonitorForTests();
  });
  resetSessionMonitorForTests();
  const sessionInfo = {
    chatId: 1001,
    messageId: 2002,
    startTime: new Date(Date.now() - 13 * 60 * 60 * 1000),
    command: 'solve',
    tool: 'claude',
    url: 'https://github.com/link-foundation/meta-language/pull/196',
    urlContext: { type: 'pull', owner: 'link-foundation', repo: 'meta-language', number: 196, normalized: 'https://github.com/link-foundation/meta-language/pull/196' },
    args: ['https://github.com/link-foundation/meta-language/pull/196', '--attach-logs', '--verbose'],
    isolationBackend: 'docker',
    sessionId: SESSION,
    logPath,
    locale: 'en',
  };
  trackSession(SESSION, sessionInfo, false);

  const edits = [];
  const bot = {
    telegram: {
      editMessageText: async (chatId, messageId, _inline, text) => edits.push({ chatId, messageId, text }),
      sendMessage: async () => {
        throw new Error('sendMessage should not be used when messageId is present');
      },
    },
  };
  const recoveryLaunches = [];
  const removedContainers = [];
  const prComments = [];
  const logComments = [];
  const statusResult = { ...incidentStatus, logPath };
  const common = {
    dockerContainerSizeProvider: async () => 122.7 * 1e9,
    lookupLinkedPullRequest: async () => 'https://github.com/link-foundation/meta-language/pull/196',
    lookupPullRequestState: async () => ({ merged: false, mergedAt: null }),
    env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
    runCommand: async (_command, args) => {
      prComments.push(args.join(' '));
      return { code: 0, stdout: 'https://github.com/link-foundation/meta-language/pull/196#issuecomment-1\n', stderr: '' };
    },
    // Issue #3530: with --attach-logs the kill notice leads the log comment.
    attachLog: async options => {
      logComments.push(options.leadingSection);
      await options.onCommentPosted?.({ commentId: '1' });
      return true;
    },
    removeDockerContainer: async name => {
      removedContainers.push(name);
      return { success: true };
    },
    isolationRunner: {
      generateSessionId: () => 'recovery-2303-0000-0000-000000000000',
      executeWithIsolation: async (command, args) => {
        recoveryLaunches.push({ command, args });
        return { success: true };
      },
    },
  };

  // Poll #1: still running while the disk fills up.
  await monitorSessions(bot, false, {
    ...common,
    statusProvider: async () => ({ ...statusResult, status: 'executing', exitCode: null, endTime: null, endTimeSource: undefined, observedAt: undefined }),
    exitFromLog: () => ({ finished: false, exitCode: null, endTime: null }),
    backendAlive: async () => true,
    hostDiskProvider: async () => ({ bavail: 0.1 * GIB, blocks: 192 * GIB, bsize: 1 }),
  });
  assert.equal(edits.length, 0, 'nothing is reported while the session runs');
  assert.equal(sessionInfo.hostDiskMinAvailableBytes, Math.round(0.1 * GIB), 'the monitor samples the host disk while the session runs');

  // Poll #2: the watcher removed the container and finalized exit 0.
  await monitorSessions(bot, false, {
    ...common,
    statusProvider: async () => statusResult,
    exitFromLog: () => ({ finished: true, exitCode: 0, endTime: '2026-09-26 07:26:04.000' }),
    backendAlive: async () => false,
    sessionRunning: async () => false,
    hostDiskProvider: async () => ({ bavail: 120 * GIB, blocks: 192 * GIB, bsize: 1 }),
  });

  const completion = edits.at(-1)?.text || '';
  const headline = completion.split('\n')[0];
  assert.ok(!edits.some(edit => /successfully/i.test(edit.text.split('\n')[0])), `never reported as success (got: ${headline})`);
  assert.match(headline, /recovering from a kill \(disk full\)/i);
  assert.match(completion, /Kill diagnostics/);
  assert.match(completion, /disk full/);
  assert.equal(recoveryLaunches.length, 1, 'the default --on-session-kill=resume policy restarts the work');
  assert.ok(recoveryLaunches[0].args.includes('--resume') && recoveryLaunches[0].args.includes(TOOL_SESSION), 'the restart resumes the last tool session');
  assert.doesNotMatch(completion, /Docker container kept/, 'a container start-command already removed is not advertised as kept');
  assert.equal(removedContainers.length, 0, 'Hive Mind does not try to remove a container that is already gone');
  assert.equal(logComments.length, 1, 'the kill is announced on the pull request, in one comment with the log');
  assert.match(logComments[0], /disk full/i);
  assert.equal(getActiveSessionCount(false), 1, 'only the recovery session remains tracked');
});
