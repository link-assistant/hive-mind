/**
 * @hive-mind-test-suite default
 * Issue #2888: the fresh recovery of router#725 was refused by solve's disk preflight — exit 75,
 * "the issue itself was not attempted" — and still used up attempt 1/3, and nothing started it
 * again. A refused recovery is now relaunched under the same attempt once space frees up, with
 * its own bound on how often that happens.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';
import { getTrackedSessionInfo, monitorSessions, resetSessionMonitorForTests, STALE_EXECUTING_MIN_AGE_MS, trackSession } from '../src/session-monitor.lib.mjs';
import { createDiskSpaceWait, DEFAULT_SESSION_KILL_DISK_RETRIES, formatDiskRefusedRecoverySection, isDiskRefusedRecovery, KILL_RECOVERY_DISK_DEFERRALS_FIELD, planDiskRefusedRelaunch, resolveDiskRetrySettings } from '../src/session-kill-resume.disk-retry.lib.mjs';
import { recoverKilledSession, runKillRecoveryForCompletion } from '../src/session-kill-resume.lib.mjs';

const ISSUE_URL = 'https://github.com/link-assistant/router/issues/725';
const THREAD = '019e0a7c-5c2a-7a43-b8a3-5b2f0e4ac725';
// No wait: these tests must not depend on the free space of the machine running them.
const NO_WAIT = { HIVE_MIND_SESSION_KILL_DISK_RETRY_DELAY: '0' };

/** The tracked record of a fresh recovery session, as startKillRecoverySession writes it. */
function refusedRecovery(overrides = {}) {
  return {
    command: 'solve',
    isolationBackend: 'docker',
    sessionId: 'recovery-725',
    url: ISSUE_URL,
    args: [ISSUE_URL, '--tool', 'codex', '--min-disk-space', '10240'],
    tool: 'codex',
    killRecoveryAttempts: 1,
    killRecoveryResumed: true,
    killRecoveryOfSession: 'original-725',
    killRecoveryInPlace: false,
    ...overrides,
  };
}

test('only a recovery session that exited 75 is a disk-refused recovery', () => {
  assert.equal(isDiskRefusedRecovery({ sessionInfo: refusedRecovery(), exitCode: 75 }), true);
  assert.equal(isDiskRefusedRecovery({ sessionInfo: refusedRecovery(), exitCode: 1 }), false);
  assert.equal(isDiskRefusedRecovery({ sessionInfo: refusedRecovery(), exitCode: null }), false);
  assert.equal(isDiskRefusedRecovery({ sessionInfo: refusedRecovery({ killRecoveryResumed: undefined }), exitCode: 75 }), false, 'a first run refused for disk is a plain failure');
});

test('settings default to 6 relaunches waiting up to 5 minutes for /tmp', () => {
  assert.deepEqual(resolveDiskRetrySettings({ env: {} }), { maxDeferrals: DEFAULT_SESSION_KILL_DISK_RETRIES, delayMs: 300_000, diskPath: '/tmp' });
  assert.deepEqual(resolveDiskRetrySettings({ env: { HIVE_MIND_SESSION_KILL_DISK_RETRIES: '0', HIVE_MIND_SESSION_KILL_DISK_RETRY_DELAY: '60', HIVE_MIND_SESSION_KILL_DISK_RETRY_PATH: '/var/lib/docker' } }), { maxDeferrals: 0, delayMs: 60_000, diskPath: '/var/lib/docker' });
  assert.deepEqual(resolveDiskRetrySettings({ env: { HIVE_MIND_SESSION_KILL_DISK_RETRIES: 'many', HIVE_MIND_SESSION_KILL_DISK_RETRY_DELAY: '-5' } }), { maxDeferrals: 6, delayMs: 300_000, diskPath: '/tmp' }, 'garbage falls back to the defaults');
});

test('the relaunch keeps the attempt number and counts a disk retry instead', () => {
  const plan = planDiskRefusedRelaunch({ sessionInfo: refusedRecovery(), exitCode: 75, env: {} });
  assert.equal(plan.shouldResume, true);
  assert.equal(plan.reason, 'disk-refused');
  assert.equal(plan.attempt, 1, 'attempt 1/3 is not spent');
  assert.equal(plan.maxAttempts, 3);
  assert.equal(plan.diskDeferral, 1);
  assert.equal(plan.requiredMB, 10240);
  assert.equal(plan.skipInPlace, true, 'a refused fresh run left nothing to re-enter');
  assert.deepEqual(plan.command.args, refusedRecovery().args);
  assert.match(plan.command.display, /^solve https:\/\/github\.com\/link-assistant\/router\/issues\/725 --tool codex/u);
});

test('the relaunch is bounded, honours the policy, /stop and a refused in-place resume', () => {
  const env = {};
  assert.equal(planDiskRefusedRelaunch({ sessionInfo: refusedRecovery({ [KILL_RECOVERY_DISK_DEFERRALS_FIELD]: 6 }), exitCode: 75, env }).reason, 'disk-retries-exhausted');
  assert.equal(planDiskRefusedRelaunch({ sessionInfo: refusedRecovery(), exitCode: 75, env: { HIVE_MIND_SESSION_KILL_DISK_RETRIES: '0' } }).reason, 'disk-retries-exhausted');
  assert.equal(planDiskRefusedRelaunch({ sessionInfo: refusedRecovery(), exitCode: 75, env: { HIVE_MIND_ON_SESSION_KILL: 'report' } }).reason, 'policy-report');
  assert.equal(planDiskRefusedRelaunch({ sessionInfo: refusedRecovery({ stopRequestedByUser: true }), exitCode: 75, env }).reason, 'stopped-by-user');
  assert.equal(planDiskRefusedRelaunch({ sessionInfo: refusedRecovery(), exitCode: 0, env }).reason, 'not-disk-refused');
  assert.equal(planDiskRefusedRelaunch({ sessionInfo: refusedRecovery({ killRecoveryInPlace: true }), exitCode: 75, env }).skipInPlace, false, 'a refused in-place resume goes back into the original container');
});

test('the wait ends as soon as enough disk is free, and otherwise after the delay', async () => {
  let clock = 0;
  const sleeps = [];
  const readings = [10215, 10230, 12000];
  const wait = createDiskSpaceWait({ requiredMB: 10240, pollMs: 30_000, getFreeMB: async () => readings.shift(), sleep: async ms => (sleeps.push(ms), (clock += ms)), now: () => clock });
  assert.deepEqual(await wait(300_000), { freeMB: 12000, enough: true });
  assert.deepEqual(sleeps, [30_000, 30_000], 'polled twice, then relaunched early');

  clock = 0;
  sleeps.length = 0;
  const stuck = createDiskSpaceWait({ requiredMB: 10240, pollMs: 40_000, getFreeMB: async () => null, sleep: async ms => (sleeps.push(ms), (clock += ms)), now: () => clock });
  assert.deepEqual(await stuck(100_000), { freeMB: null, enough: false });
  assert.deepEqual(sleeps, [40_000, 40_000, 20_000], 'an unreadable df waits the whole delay and no longer');
});

test('router#725 repro: the refused recovery is relaunched without spending attempt 1/3', async () => {
  const launches = [];
  const tracked = [];
  const sessionInfo = refusedRecovery();
  const runner = {
    generateSessionId: () => 'recovery-725-b',
    executeWithIsolation: async (binary, args, options) => (launches.push({ binary, args, options }), { success: true, executionUuid: 'uuid-b' }),
  };
  const result = await recoverKilledSession({
    sessionName: 'recovery-725',
    sessionInfo,
    killed: false,
    exitCode: 75,
    env: NO_WAIT,
    runner,
    trackSession: (id, info) => tracked.push({ id, info }),
    sleep: async () => {},
  });
  assert.equal(result.resumed, true);
  assert.equal(result.sessionId, 'recovery-725-b');
  assert.equal(result.attempt, 1);
  assert.equal(result.diskDeferral, 1);
  assert.equal(launches.length, 1, 'launched fresh, not in place');
  assert.deepEqual(launches[0].args, sessionInfo.args);
  assert.equal(tracked[0].info.killRecoveryAttempts, 1, 'the attempt counter is carried unchanged');
  assert.equal(tracked[0].info[KILL_RECOVERY_DISK_DEFERRALS_FIELD], 1);
  assert.equal(sessionInfo.killRecoverySessionId, 'recovery-725-b', 'a repeated completion reports this relaunch instead of starting another');
});

test('the disk wait replaces the random 30–90 s kill delay', async () => {
  const sleeps = [];
  const runner = { generateSessionId: () => 'recovery-2', executeWithIsolation: async () => ({ success: true }) };
  const result = await recoverKilledSession({
    sessionName: 'recovery-1',
    sessionInfo: refusedRecovery(),
    killed: false,
    exitCode: 75,
    env: { HIVE_MIND_SESSION_KILL_DISK_RETRY_DELAY: '0', HIVE_MIND_SESSION_KILL_DISK_RETRY_PATH: '/nonexistent-issue-2888' },
    runner,
    trackSession: () => {},
    random: () => 0.5,
    sleep: async ms => sleeps.push(ms),
  });
  assert.equal(result.resumed, true);
  assert.deepEqual(sleeps, [], 'a zero disk delay does not fall back to the 30–90 s kill delay');
});

test('a kill of a recovery session still uses the normal plan and spends an attempt', async () => {
  const tracked = [];
  const runner = { generateSessionId: () => 'recovery-3', executeWithIsolation: async () => ({ success: true }) };
  const result = await recoverKilledSession({
    sessionName: 'recovery-2',
    sessionInfo: refusedRecovery({ isolationBackend: 'screen', [KILL_RECOVERY_DISK_DEFERRALS_FIELD]: 2 }),
    killed: true,
    exitCode: 137,
    env: {},
    runner,
    trackSession: (id, info) => tracked.push(info),
    readLastSessionId: () => THREAD,
    sleep: async () => {},
  });
  assert.equal(result.resumed, true);
  assert.equal(result.attempt, 2);
  assert.equal(result.diskDeferral, undefined);
  assert.equal(tracked[0][KILL_RECOVERY_DISK_DEFERRALS_FIELD], undefined, 'disk retries are counted per attempt');
});

test('the completion message says the refused run was relaunched or why it was not', async () => {
  const runner = { generateSessionId: () => 'recovery-725-b', executeWithIsolation: async () => ({ success: true }) };
  const { recovery, section } = await runKillRecoveryForCompletion({ sessionName: 'recovery-725', sessionInfo: refusedRecovery(), killed: false, exitCode: 75, env: NO_WAIT, runner, trackSession: () => {}, sleep: async () => {} });
  assert.equal(recovery.resumed, true);
  assert.match(section, /exit 75/u);
  assert.match(section, /does not count as a recovery attempt/u);
  assert.match(section, /attempt 1\/3, disk retry 1\/6\): recovery-725-b$/u);

  const exhausted = await runKillRecoveryForCompletion({ sessionName: 'recovery-725', sessionInfo: refusedRecovery({ [KILL_RECOVERY_DISK_DEFERRALS_FIELD]: 6 }), killed: false, exitCode: 75, env: NO_WAIT, runner, trackSession: () => {}, sleep: async () => {} });
  assert.equal(exhausted.recovery.resumed, false);
  assert.match(exhausted.section, /all 6 disk retries were used/u);

  assert.equal(formatDiskRefusedRecoverySection({ recovery: { reason: 'policy-report' } }), '');
});

test('monitor: a recovery session that exits 75 is relaunched and the message says so', async () => {
  await initI18n('en');
  await preloadAllLocales();
  const sessionName = 'recovery-725';
  const logPath = path.join(os.tmpdir(), `hive-mind-issue-2888-disk-${process.pid}.log`);
  await fs.writeFile(logPath, '❌ Insufficient disk space: 10215MB available, 10240MB required\n');
  const edits = [];
  const launches = [];
  const bot = { telegram: { editMessageText: async (_chatId, _messageId, _inline, message) => edits.push(message), sendMessage: async () => ({ chat: { id: 4242 }, message_id: 1 }) } };
  const options = {
    statusProvider: async () => ({ exists: true, status: 'executed', exitCode: 75, isolation: 'docker', logPath }),
    // start-command's footer corroborates the exit code (issue #2117).
    exitFromLog: () => ({ finished: true, exitCode: 75, endTime: new Date().toISOString() }),
    backendAlive: async () => false,
    dockerContainerSizeProvider: async () => null,
    readFile: async file => await fs.readFile(file, 'utf8'),
    lookupLinkedPullRequest: async () => null,
    lookupPullRequestState: async () => null,
    env: NO_WAIT,
    sleepBeforeRecovery: async () => {},
    isolationRunner: { generateSessionId: () => 'recovery-725-b', executeWithIsolation: async (...args) => (launches.push(args), { success: true }) },
    runCommand: async () => ({ code: 0, stdout: '', stderr: '' }),
  };
  resetSessionMonitorForTests();
  try {
    trackSession(sessionName, { ...refusedRecovery(), chatId: 4242, messageId: 77, locale: 'en', logPath, startTime: new Date(Date.now() - STALE_EXECUTING_MIN_AGE_MS - 60_000) }, false);
    await monitorSessions(bot, process.env.DEBUG_2888 === '1', options);
    assert.equal(launches.length, 1, 'the refused recovery is started again');
    assert.deepEqual(launches[0][1], refusedRecovery().args);
    const relaunched = getTrackedSessionInfo('recovery-725-b');
    assert.equal(relaunched?.killRecoveryAttempts, 1, 'still attempt 1/3');
    assert.equal(relaunched?.[KILL_RECOVERY_DISK_DEFERRALS_FIELD], 1);
    assert.match(edits.join('\n'), /does not count as a recovery attempt/u);
  } finally {
    resetSessionMonitorForTests();
    await fs.rm(logPath, { force: true });
  }
});

test('monitor: an ordinary first run that exits 75 is not relaunched', async () => {
  const launches = [];
  const bot = { telegram: { editMessageText: async () => {}, sendMessage: async () => ({ chat: { id: 4242 }, message_id: 1 }) } };
  const options = {
    statusProvider: async () => ({ exists: true, status: 'executed', exitCode: 75, isolation: 'docker', logPath: '/nonexistent-issue-2888.log' }),
    exitFromLog: () => ({ finished: true, exitCode: 75, endTime: new Date().toISOString() }),
    backendAlive: async () => false,
    dockerContainerSizeProvider: async () => null,
    lookupLinkedPullRequest: async () => null,
    lookupPullRequestState: async () => null,
    env: NO_WAIT,
    sleepBeforeRecovery: async () => {},
    isolationRunner: { generateSessionId: () => 'never', executeWithIsolation: async (...args) => (launches.push(args), { success: true }) },
    runCommand: async () => ({ code: 0, stdout: '', stderr: '' }),
  };
  resetSessionMonitorForTests();
  try {
    const firstRun = refusedRecovery({ sessionId: 'first-725', killRecoveryAttempts: undefined, killRecoveryResumed: undefined, killRecoveryOfSession: undefined });
    trackSession('first-725', { ...firstRun, chatId: 4242, messageId: 78, locale: 'en', startTime: new Date(Date.now() - STALE_EXECUTING_MIN_AGE_MS - 60_000) }, false);
    await monitorSessions(bot, false, options);
    assert.equal(launches.length, 0, 'solve already reported the disk shortage; a first run is not a recovery');
  } finally {
    resetSessionMonitorForTests();
  }
});
