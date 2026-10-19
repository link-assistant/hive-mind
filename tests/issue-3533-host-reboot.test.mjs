/**
 * @hive-mind-test-suite default
 * A host reboot is named as the cause of every session it ended (#3533).
 *
 * In #3533 the host hard-reset at 14:50:29Z with two tasks running. After the
 * reboot dockerd marked both containers exit 255, and the bot reported each as
 * "forced kill — memory … within normal limits", with readings from session
 * start (8.5 h earlier), "Detected at" the time of a survived `blender` OOM kill,
 * and `State.OOMKilled = true` as diagnostics. Nothing said the host went down.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HOST_BOOT_STATE_FILE, createHostBootTracker, describeHostRebootCause, describeHostRebootScope, detectHostReboot, markSessionsEndedByHostReboot, readHostBootIdentity, readPreviousBootShutdownRecord, sessionRanIntoHostReboot } from '../src/host-boot-state.lib.mjs';
import { KILL_CAUSE_HOST_REBOOT, describeKillCause, describeReadingAge } from '../src/session-kill-diagnostics.lib.mjs';
import { buildKillRecoveryNotice, describeEventTimes } from '../src/session-kill-recovery.lib.mjs';
import { resolveSessionEndedAt } from '../src/session-monitor.kill-sections.lib.mjs';
import { resumeSessionsOnLaunch, createHeartbeat } from '../src/bot-lifecycle.lib.mjs';
import { serializeSessionInfo, deserializeSessionInfo } from '../src/session-store.lib.mjs';

const OLD_BOOT = 'dc89e7dd-5d3e-4f61-9b3c-6a1f0e2d4c11';
const NEW_BOOT = '5b0f2a77-1c9e-4d0a-8e6f-3b2d7c9a1e22';
const LAST_HEARTBEAT = '2026-10-18T14:50:00.000Z';
const BOOTED_AT = '2026-10-18T15:00:00.000Z';

test('a changed boot_id is a reboot; a missing stop record makes it a hard reset', () => {
  const previous = { bootId: OLD_BOOT, lastHeartbeatAt: LAST_HEARTBEAT, stoppedAt: null };
  const current = { bootId: NEW_BOOT, bootedAt: BOOTED_AT };
  const event = detectHostReboot({ previous, current });
  assert.equal(event.detectedBy, 'boot-id');
  assert.equal(event.shutdownRecorded, false);
  assert.equal(event.shutdownSource, 'bot-stop-record');
  assert.equal(event.lastHeartbeatAt, LAST_HEARTBEAT);
  // An orderly shutdown stopped the bot with SIGTERM first.
  const clean = detectHostReboot({ previous: { ...previous, stoppedAt: '2026-10-18T14:50:10.000Z' }, current });
  assert.equal(clean.shutdownRecorded, true);
  // The host journal, when readable, outranks the bot's own record.
  const journal = detectHostReboot({ previous: { ...previous, stoppedAt: '2026-10-18T14:50:10.000Z' }, current, journalShutdownRecorded: false });
  assert.deepEqual([journal.shutdownRecorded, journal.shutdownSource], [false, 'host-journal']);
  // The same boot, or no earlier state, is no reboot.
  assert.equal(detectHostReboot({ previous, current: { ...current, bootId: OLD_BOOT } }), null);
  assert.equal(detectHostReboot({ previous: null, current }), null);
});

test('without a boot_id, an uptime shorter than the time since the last heartbeat is a reboot', () => {
  const previous = { lastHeartbeatAt: LAST_HEARTBEAT };
  assert.equal(detectHostReboot({ previous, current: { bootedAt: BOOTED_AT } }).detectedBy, 'uptime');
  assert.equal(detectHostReboot({ previous, current: { bootedAt: '2026-10-18T14:51:00.000Z' } }), null, 'within the clock slack');
  assert.equal(detectHostReboot({ previous, current: { bootedAt: '2026-10-01T00:00:00.000Z' } }), null);
});

test('the boot identity and the journal are read defensively', async () => {
  const files = { '/proc/sys/kernel/random/boot_id': `${NEW_BOOT}\n`, '/proc/uptime': '600.25 1200.00\n' };
  const identity = await readHostBootIdentity({ readFile: async file => files[file], now: () => Date.parse('2026-10-18T15:10:00.250Z') });
  assert.deepEqual(identity, { bootId: NEW_BOOT, uptimeSeconds: 600.25, bootedAt: BOOTED_AT });
  assert.deepEqual(await readHostBootIdentity({ readFile: async () => Promise.reject(new Error('ENOENT')) }), { bootId: null, uptimeSeconds: null, bootedAt: null });
  assert.equal(await readPreviousBootShutdownRecord({ run: async () => ({ code: 0, stdout: 'Stopping…\nsystemd-journald: Journal stopped\n' }) }), true);
  assert.equal(await readPreviousBootShutdownRecord({ run: async () => ({ code: 0, stdout: 'sshd[1]: Accepted publickey\n' }) }), false, 'the journal ends mid-stream: hard reset');
  assert.equal(await readPreviousBootShutdownRecord({ run: async () => ({ code: 1, stdout: '' }) }), null, 'no host journal in the bot container');
  assert.equal(await readPreviousBootShutdownRecord({ run: async () => Promise.reject(new Error('ENOENT journalctl')) }), null);
});

test('the tracker records boots, heartbeats and stops, and reports a reboot once', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'host-boot-3533-'));
  let bootId = OLD_BOOT;
  let nowMs = Date.parse(LAST_HEARTBEAT);
  const make = () => createHostBootTracker({ stateDir, now: () => nowMs, readIdentity: async () => ({ bootId, bootedAt: '2026-10-18T06:00:00.000Z' }), readShutdownRecord: async () => null });
  try {
    assert.equal(await make().detect(), null, 'the first run has nothing to compare');
    const tracker = make();
    await tracker.recordHeartbeat();
    const saved = JSON.parse(await fs.readFile(path.join(stateDir, HOST_BOOT_STATE_FILE), 'utf8'));
    assert.deepEqual(saved, { bootId: OLD_BOOT, bootedAt: '2026-10-18T06:00:00.000Z', lastHeartbeatAt: LAST_HEARTBEAT, stoppedAt: null });
    // The host hard-resets; the bot comes back in a new boot.
    bootId = NEW_BOOT;
    nowMs = Date.parse('2026-10-18T15:01:04.000Z');
    const event = await make().detect();
    assert.equal(event.shutdownRecorded, false);
    assert.equal(event.lastHeartbeatAt, LAST_HEARTBEAT);
    assert.equal(await make().detect(), null, 'a second bot restart in the same boot is no reboot');
    // An orderly stop is remembered.
    await make().recordStop();
    bootId = 'third-boot';
    assert.equal((await make().detect()).shutdownRecorded, true);
    // A corrupt state file never throws.
    await fs.writeFile(path.join(stateDir, HOST_BOOT_STATE_FILE), '{not json');
    assert.equal(await make().detect(), null);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

const EVENT = detectHostReboot({ previous: { bootId: OLD_BOOT, lastHeartbeatAt: LAST_HEARTBEAT }, current: { bootId: NEW_BOOT, bootedAt: BOOTED_AT } });

test('every session the reboot ended is marked with the one shared event', async () => {
  const persisted = [];
  const mtimes = { '/logs/voice.log': Date.parse('2026-10-18T14:50:29.000Z'), '/logs/legal.log': Date.parse('2026-10-18T14:49:58.000Z'), '/logs/old.log': Date.parse('2026-10-18T10:00:00.000Z') };
  const sessions = [
    { sessionName: 'a84a2357', sessionInfo: { startTime: '2026-10-18T06:28:00.000Z', logPath: '/logs/voice.log' } },
    { sessionName: 'be86e099', sessionInfo: { startTime: '2026-10-18T14:09:00.000Z', logPath: '/logs/legal.log' } },
    { sessionName: 'reported', sessionInfo: { startTime: '2026-10-18T09:00:00.000Z', completionNotifiedAt: '2026-10-18T10:00:00.000Z' } },
    { sessionName: 'ended-earlier', sessionInfo: { startTime: '2026-10-18T09:00:00.000Z', logPath: '/logs/old.log' } },
    { sessionName: 'after-boot', sessionInfo: { startTime: '2026-10-18T15:05:00.000Z' } },
  ];
  const names = await markSessionsEndedByHostReboot({ sessions, event: EVENT, isHandled: info => Boolean(info.completionNotifiedAt), persist: (name, info) => persisted.push([name, info.hostReboot.sessionEndedAt]), statLog: async file => ({ mtimeMs: mtimes[file] }) });
  assert.deepEqual(names, ['a84a2357', 'be86e099']);
  assert.deepEqual(persisted, [
    ['a84a2357', '2026-10-18T14:50:29.000Z'],
    ['be86e099', '2026-10-18T14:49:58.000Z'],
  ]);
  assert.equal(sessions[0].sessionInfo.hostReboot.affectedSessions, 2);
  assert.equal(sessions[3].sessionInfo.hostReboot, undefined);
  // Marked once: a later bot restart does not mark again.
  assert.deepEqual(await markSessionsEndedByHostReboot({ sessions: sessions.slice(0, 1), event: EVENT }), []);
  assert.deepEqual(await markSessionsEndedByHostReboot({ sessions, event: null }), []);
  assert.equal(sessionRanIntoHostReboot({ startTime: '2026-10-18T06:00:00.000Z' }, EVENT, null), true, 'no log: assume it was running');
});

test('the session store keeps the reboot across another bot restart', () => {
  const hostReboot = { ...EVENT, sessionEndedAt: LAST_HEARTBEAT, affectedSessions: 2 };
  assert.deepEqual(deserializeSessionInfo(serializeSessionInfo({ startTime: new Date(0), hostReboot })).hostReboot, hostReboot);
});

const START_LOG = '📈 [RESOURCES] phase=solve_start ts=2026-10-18T06:28:35.000Z memAvailableBytes=9234000000 memTotalBytes=12563000000 diskUsedPercent=41.0\n';

test('stale readings say how old they are', () => {
  assert.equal(describeReadingAge('2026-10-18T06:28:35.000Z', '2026-10-18T14:58:35.000Z', 'solve_start'), ' (at session start, 8.5 h before the session ended)');
  assert.equal(describeReadingAge('2026-10-18T14:30:00.000Z', '2026-10-18T14:50:00.000Z', 'iteration'), ' (20 min before the session ended)');
  assert.equal(describeReadingAge('2026-10-18T14:49:00.000Z', '2026-10-18T14:50:00.000Z'), '', 'a fresh reading needs no label');
  assert.equal(describeReadingAge(null, '2026-10-18T14:50:00.000Z'), '');
});

test('the kill cause is the host reboot, and OOMKilled is the survived earlier event', () => {
  const hostReboot = { ...EVENT, shutdownRecorded: false, sessionEndedAt: '2026-10-18T14:50:29.000Z', affectedSessions: 2 };
  const logText = START_LOG;
  const diagnosis = describeKillCause({ logText, oomKilled: true, exitCode: 255, hostReboot });
  assert.equal(diagnosis.cause, KILL_CAUSE_HOST_REBOOT);
  assert.match(diagnosis.summary, /^host hard reset \(no shutdown recorded\) — last bot heartbeat before the outage at 2026-10-18T14:50:00\.000Z; the host came back up at 2026-10-18T15:00:00\.000Z/);
  assert.match(diagnosis.summary, /the last readings were within normal limits: memory \(.* at 2026-10-18T06:28:35\.000Z \(at session start, 8\.4 h before the session ended\)\)/);
  assert.doesNotMatch(diagnosis.summary, /forced kill/);
  const evidence = diagnosis.evidence.join('\n');
  assert.match(evidence, /`State\.OOMKilled = true` — left by an earlier OOM event .* survived; it is not what ended the session/);
  assert.match(evidence, /`boot_id` `dc89e7dd…` → `5b0f2a77…`/);
  assert.match(evidence, /all 2 tasks running on the host ended with it/);
  // A user stop and a clean exit are not attributed to the reboot.
  assert.notEqual(describeKillCause({ logText, exitCode: 255, hostReboot, stopRequestedByUser: true }).cause, KILL_CAUSE_HOST_REBOOT);
  assert.notEqual(describeKillCause({ logText, exitCode: 0, hostReboot }).cause, KILL_CAUSE_HOST_REBOOT);
});

test('"Detected at" is the end; a survived earlier OOM kill is listed on its own', () => {
  assert.deepEqual(describeEventTimes({ observedAt: '2026-10-18T13:16:43.092Z', endedAt: '2026-10-18T14:50:29.000Z', victim: 'blender' }), ['- **Detected at:** 2026-10-18T14:50:29.000Z', '- **Earlier OOM event:** OOM kill of `blender` at 2026-10-18T13:16:43.092Z, survived — the session kept running for 1 h 34 min after it']);
  // An OOM kill that ended the session is not called survived.
  assert.deepEqual(describeEventTimes({ observedAt: '2026-10-18T13:16:43.092Z', endedAt: '2026-10-18T13:40:00.000Z', endedByOom: true }), ['- **Detected at:** 2026-10-18T13:40:00.000Z', '- **OOM event observed at:** 2026-10-18T13:16:43.092Z']);
  assert.deepEqual(describeEventTimes({ endedAt: '2026-10-18T14:50:29.000Z' }), ['- **Detected at:** 2026-10-18T14:50:29.000Z']);
  assert.deepEqual(describeEventTimes({ observedAt: '2026-10-18T13:16:43.092Z' }), ['- **OOM event observed at:** 2026-10-18T13:16:43.092Z']);
});

test('the notice names the host restart as one event for all tasks', () => {
  const hostReboot = { ...EVENT, shutdownRecorded: false, sessionEndedAt: '2026-10-18T14:50:29.000Z', affectedSessions: 2 };
  const diagnosis = describeKillCause({ oomKilled: true, exitCode: 255, hostReboot });
  const body = buildKillRecoveryNotice({ diagnosis, exitCode: 255, sessionName: 'a84a2357', observedAt: '2026-10-18T13:16:43.092Z', endedAt: hostReboot.sessionEndedAt, hostReboot });
  assert.match(body, /Working session ended: the host restarted/);
  assert.match(body, /The host restarted; all 2 running tasks ended at the same moment\. This is one host event, not 2 separate failures\./);
  assert.match(body, /\*\*Detected at:\*\* 2026-10-18T14:50:29\.000Z/);
  assert.match(body, /\*\*Earlier OOM event:\*\* at 2026-10-18T13:16:43\.092Z, survived/);
  assert.equal(describeHostRebootScope({ affectedSessions: 1 }), 'The host restarted while this task was running; it was the only running task.');
  assert.equal(describeHostRebootCause({ shutdownRecorded: true }), 'host rebooted');
});

test('the end time prefers the reboot, then $ --status, then the log', async () => {
  const statFile = async () => ({ mtimeMs: Date.parse('2026-10-18T14:50:29.000Z') });
  assert.equal(await resolveSessionEndedAt({ sessionInfo: { hostReboot: { sessionEndedAt: 'reboot' } }, statusResult: { endTime: '2026-10-18T15:01:03Z' } }), 'reboot');
  assert.equal(await resolveSessionEndedAt({ statusResult: { endTime: '2026-10-18T15:01:03Z' }, logPath: '/l', statFile }), '2026-10-18T15:01:03.000Z');
  assert.equal(await resolveSessionEndedAt({ logPath: '/l', statFile }), '2026-10-18T14:50:29.000Z');
  assert.equal(await resolveSessionEndedAt({ logPath: '/l', statFile: async () => Promise.reject(new Error('ENOENT')) }), null);
});

test('the bot detects the reboot before it replays the sessions, and every beat records the boot', async () => {
  const order = [];
  const events = [];
  const logger = { event: type => events.push(type), info: () => {}, warn: () => {}, error: () => {} };
  const result = await resumeSessionsOnLaunch({
    detectHostReboot: async () => (order.push('detect'), EVENT),
    resumeTrackedSessions: async options => (order.push(['resume', options.hostReboot === EVENT]), { resumed: [], skipped: [] }),
    botStartTime: 0,
    logger,
    consoleImpl: { log: () => {}, warn: () => {}, error: () => {} },
  });
  assert.deepEqual(order, ['detect', ['resume', true]]);
  assert.equal(result.hostReboot, EVENT);
  assert.ok(events.includes('host_reboot_detected'));
  // A failing detector never blocks the resume.
  const failed = await resumeSessionsOnLaunch({ detectHostReboot: async () => Promise.reject(new Error('EACCES')), resumeTrackedSessions: async () => ({ resumed: [], skipped: [] }), logger, consoleImpl: { log: () => {}, warn: () => {}, error: () => {} } });
  assert.equal(failed.hostReboot, null);

  let beats = 0;
  let tick = null;
  const heartbeat = createHeartbeat({ logger: { heartbeat: () => {}, warn: () => {} }, getActiveSessionCount: () => 0, setIntervalImpl: fn => ((tick = fn), 1), clearIntervalImpl: () => {}, captureResources: () => null, onBeat: async () => (beats++, Promise.reject(new Error('disk full'))) });
  heartbeat.start();
  if (tick) tick();
  await new Promise(resolve => setImmediate(resolve));
  heartbeat.stop();
  assert.ok(beats >= 1, 'the boot state is recorded with the heartbeat, and its failure is swallowed');
});
