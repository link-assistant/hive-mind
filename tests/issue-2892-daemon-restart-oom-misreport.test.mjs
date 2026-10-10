/**
 * @hive-mind-test-suite default
 * Issue #2892: containers killed by a Docker daemon restart were reported as OOM-killed.
 *
 * Incident (docs/case-studies/issue-2892): at 12:11:39 UTC the kernel OOM-killed the HOST
 * dockerd; systemd restarted it and at 12:11:55 the restarting daemon force-killed every
 * container ("Container failed to exit within 10s of signal 15 - using the force"), exit 137.
 * Earlier that day each task container had survived a few cgroup OOM kills of a CHILD process
 * (rustc/clippy-driver), so Docker's sticky `State.OOMKilled` was still `true` and the cumulative
 * cgroup `oom_kill` counter was > 0. `$ --list` (start-command 0.35.4) said
 * `exitReason: memory-exhaustion (cgroup-oom-killer)` and the bot logged
 * `session_completed {"exitCode":137,"status":"oom-killed"}`; Telegram and the PR said
 * "out of memory".
 *
 * Covered here:
 *   1. start-command >= 0.36.0 attribution (`killed (docker daemon restart)`,
 *      `signal (SIGKILL; cause unknown)`, `options.exitEvidence`) is consumed instead of
 *      treating `OOMKilled && 137` as proof of an OOM kill.
 *   2. Hive Mind's own daemon-restart probe (containers finished in the same second, dockerd
 *      start time) catches the incident even when `$` cannot read the host journal — which is
 *      the case for the DinD root container — or is older than 0.36.0.
 *   3. A real exit-time OOM (`mainOom` evidence) is still reported as `oom-killed` (#2015).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';
import { resolveOomKilledState } from '../src/session-monitor.oom.lib.mjs';
import { getIsolationSessionState } from '../src/session-monitor.isolation-state.lib.mjs';
import { buildKillCompletionSections } from '../src/session-monitor.kill-sections.lib.mjs';
import { buildKillRecoveryNotice } from '../src/session-kill-recovery.lib.mjs';
import { describeKillCause, KILL_CAUSE_DAEMON_RESTART, KILL_CAUSE_FORCED_KILL, KILL_CAUSE_OUT_OF_MEMORY, UPSTREAM_CONTAINER_FLAG_REASON } from '../src/session-kill-diagnostics.lib.mjs';
import { parseSessionStatusOutput } from '../src/isolation-runner.parsers.lib.mjs';
import { detectDockerDaemonRestart, parseExitEvidenceFromLog, resolveExitAttribution, EXIT_ATTRIBUTION_DAEMON_RESTART, EXIT_ATTRIBUTION_MAIN_OOM, EXIT_ATTRIBUTION_NOT_MAIN_OOM, UPSTREAM_DAEMON_RESTART_EXIT_REASON, UPSTREAM_SIGKILL_UNKNOWN_EXIT_REASON } from '../src/session-exit-attribution.lib.mjs';

const SESSION = 'a3e1c7f0-0724-4b47-af4a-06290e562892';
const FINISHED_AT = '2026-10-09T12:11:55.418Z';
const LOG_PATH = '/tmp/issue-2892-no-such-log.log';

/** `$ --list` for router#724 as start-command 0.35.4 reported it (verbatim fields from the issue). */
function legacyIncidentStatus() {
  return {
    exists: true,
    status: 'executed',
    exitCode: 137,
    oomKilled: true,
    exitReason: 'memory-exhaustion (cgroup-oom-killer)',
    memoryExhausted: true,
    memoryExhaustedReason: UPSTREAM_CONTAINER_FLAG_REASON,
    cgroupMemory: { oomKills: 5, oomEvents: 5 },
    endTime: FINISHED_AT,
    isolation: 'docker',
    logPath: LOG_PATH,
  };
}

/** The same container as start-command 0.36.0 reports it when it could read the Docker journal. */
function daemonRestartStatus() {
  return { ...legacyIncidentStatus(), exitReason: UPSTREAM_DAEMON_RESTART_EXIT_REASON, memoryExhausted: null, memoryExhaustedReason: null, exitEvidence: { daemonRestart: true, mainOom: false } };
}

/** start-command 0.36.0 without journal access (e.g. `$` inside the DinD root container). */
function unknownSigkillStatus() {
  return { ...legacyIncidentStatus(), exitReason: UPSTREAM_SIGKILL_UNKNOWN_EXIT_REASON, memoryExhausted: null, memoryExhaustedReason: null, exitEvidence: { daemonRestart: false, mainOom: false } };
}

function makeSessionInfo() {
  return { chatId: 4242, messageId: 77, command: 'solve', tool: 'codex', isolationBackend: 'docker', sessionId: SESSION, logPath: LOG_PATH, locale: 'en', oomEventObservedAt: '2026-10-09T09:02:11.000Z' };
}

const deadBackend = async () => false;
const noFooter = () => null;

async function resolve(statusResult, { daemonRestartProbe = async () => null } = {}) {
  return await resolveOomKilledState(SESSION, makeSessionInfo(), statusResult, { runner: {}, exitFromLog: noFooter, backendAlive: deadBackend, daemonRestartProbe });
}

test('start-command 0.36.0 `killed (docker daemon restart)` is a daemon-restart kill, not oom-killed', async () => {
  let probed = false;
  const state = await resolve(daemonRestartStatus(), {
    daemonRestartProbe: async () => {
      probed = true;
      return null;
    },
  });
  assert.equal(state.running, false);
  assert.equal(state.exitCode, 137);
  assert.equal(state.status, 'killed', 'session_completed must not say oom-killed');
  assert.equal(state.statusResult.status, 'killed');
  assert.equal(state.statusResult.killAttribution, EXIT_ATTRIBUTION_DAEMON_RESTART);
  assert.equal(probed, false, 'upstream already attributed the exit; no extra docker calls');
});

test('start-command 0.36.0 `signal (SIGKILL; cause unknown)` with the sticky flag is a kill, not oom-killed', async () => {
  const state = await resolve(unknownSigkillStatus());
  assert.equal(state.status, 'killed');
  assert.equal(state.statusResult.killAttribution, EXIT_ATTRIBUTION_NOT_MAIN_OOM);
  assert.equal(state.oomEventObserved, true, 'the earlier child OOM is still remembered as an event');
});

test('the incident as start-command 0.35.4 reported it: our own probe detects the daemon restart', async () => {
  const restart = { detected: true, finishedAt: FINISHED_AT, siblings: [{ name: 'hive-mind', oomKilled: false }], evidence: ['3 other containers finished within 2s of this one'] };
  const state = await resolve(legacyIncidentStatus(), { daemonRestartProbe: async () => restart });
  assert.equal(state.status, 'killed');
  assert.equal(state.statusResult.killAttribution, EXIT_ATTRIBUTION_DAEMON_RESTART);
  assert.deepEqual(state.statusResult.dockerDaemonRestart, restart);
});

test('without any attribution the legacy verdict is unchanged (issue #2015)', async () => {
  const state = await resolve(legacyIncidentStatus(), { daemonRestartProbe: async () => ({ detected: false, evidence: [] }) });
  assert.equal(state.status, 'oom-killed');
});

test('a real exit-time OOM (`mainOom` evidence) is still oom-killed and skips the probe', async () => {
  let probed = false;
  const mainOom = { ...legacyIncidentStatus(), exitEvidence: { daemonRestart: false, mainOom: true } };
  const state = await resolve(mainOom, {
    daemonRestartProbe: async () => {
      probed = true;
      return { detected: true, evidence: [] };
    },
  });
  assert.equal(state.status, 'oom-killed');
  assert.equal(probed, false);
});

test('getIsolationSessionState wires the runner probe for docker sessions', async () => {
  const runner = {
    readSessionExitFromLog: noFooter,
    checkBackendSessionAlive: deadBackend,
    detectDockerDaemonRestart: async name => ({ detected: name === SESSION, finishedAt: FINISHED_AT, siblings: [], evidence: ['dockerd (re)started at 2026-10-09T12:11:45Z'] }),
  };
  const state = await getIsolationSessionState(SESSION, makeSessionInfo(), { statusProvider: async () => legacyIncidentStatus(), runnerProvider: async () => runner });
  assert.equal(state.status, 'killed');
  assert.equal(state.statusResult.killAttribution, EXIT_ATTRIBUTION_DAEMON_RESTART);
});

test('`$ --status` exitEvidence is parsed from JSON and links notation', () => {
  const json = parseSessionStatusOutput(JSON.stringify({ uuid: SESSION, status: 'executed', exitCode: 137, oomKilled: true, exitReason: UPSTREAM_DAEMON_RESTART_EXIT_REASON, options: { isolated: 'docker', exitEvidence: { daemonRestart: true, mainOom: false } } }));
  assert.deepEqual(json.exitEvidence, { daemonRestart: true, mainOom: false });
  assert.equal(json.exitReason, UPSTREAM_DAEMON_RESTART_EXIT_REASON);

  const lino = parseSessionStatusOutput([SESSION, '  status executed', '  exitCode 137', '  oomKilled true', `  exitReason "${UPSTREAM_SIGKILL_UNKNOWN_EXIT_REASON}"`, '  options', '    isolated docker', '    exitEvidence', '      daemonRestart false', '      mainOom false'].join('\n'));
  assert.deepEqual(lino.exitEvidence, { daemonRestart: false, mainOom: false });
  assert.equal(lino.exitReason, UPSTREAM_SIGKILL_UNKNOWN_EXIT_REASON);

  // Older `$` binaries do not report it at all: unknown, not "no main OOM".
  assert.equal(parseSessionStatusOutput(JSON.stringify({ uuid: SESSION, status: 'executed', exitCode: 137, oomKilled: true })).exitEvidence, null);
  assert.equal(parseSessionStatusOutput('').exitEvidence, null);
});

test('resolveExitAttribution follows start-command precedence: daemon restart > main OOM > unknown', () => {
  assert.equal(resolveExitAttribution({ exitReason: UPSTREAM_DAEMON_RESTART_EXIT_REASON }).kind, EXIT_ATTRIBUTION_DAEMON_RESTART);
  assert.equal(resolveExitAttribution({ exitEvidence: { daemonRestart: true, mainOom: true } }).kind, EXIT_ATTRIBUTION_DAEMON_RESTART);
  assert.equal(resolveExitAttribution({ exitEvidence: { daemonRestart: false, mainOom: true } }).kind, EXIT_ATTRIBUTION_MAIN_OOM);
  assert.equal(resolveExitAttribution({ exitReason: UPSTREAM_SIGKILL_UNKNOWN_EXIT_REASON }).kind, EXIT_ATTRIBUTION_NOT_MAIN_OOM);
  assert.equal(resolveExitAttribution({ exitEvidence: { daemonRestart: false, mainOom: false } }).kind, EXIT_ATTRIBUTION_NOT_MAIN_OOM);
  assert.equal(resolveExitAttribution({ dockerDaemonRestart: { detected: true } }).kind, EXIT_ATTRIBUTION_DAEMON_RESTART);
  // start-command 0.35.4 said `memory-exhaustion (cgroup-oom-killer)` from the sticky flag alone.
  assert.equal(resolveExitAttribution({ exitReason: 'memory-exhaustion (cgroup-oom-killer)' }).kind, null);
  assert.equal(resolveExitAttribution({}).kind, null);
  // The watcher's log line is the same evidence when the record lost it.
  const log = 'Exit Code: 137\nExit evidence: docker-daemon-restart (Docker service journal)\n';
  assert.equal(resolveExitAttribution({ logText: log }).kind, EXIT_ATTRIBUTION_DAEMON_RESTART);
});

test('the watcher `Exit evidence:` log line is parsed (last line wins)', () => {
  assert.deepEqual(parseExitEvidenceFromLog('x\nExit evidence: main-oom (recent cgroup oom_kill delta)\n'), { mainOom: true, daemonRestart: false, unavailable: false, line: 'Exit evidence: main-oom (recent cgroup oom_kill delta)' });
  const both = 'Exit evidence: main-oom (recent cgroup oom_kill delta)\nExit evidence: unavailable (no attributed exit-time OOM or daemon restart evidence)';
  assert.equal(parseExitEvidenceFromLog(both).unavailable, true);
  assert.equal(parseExitEvidenceFromLog(both).mainOom, false);
  assert.equal(parseExitEvidenceFromLog('Exit Code: 137'), null);
  assert.equal(parseExitEvidenceFromLog(null), null);
});

test('the diagnosis names the daemon restart and keeps the child OOM as an earlier event', () => {
  const diagnosis = describeKillCause({ oomKilled: true, exitCode: 137, reportedExitReason: UPSTREAM_DAEMON_RESTART_EXIT_REASON, reportedExitEvidence: { daemonRestart: true, mainOom: false }, reportedCgroupMemory: { oomKills: 5 } });
  assert.equal(diagnosis.cause, KILL_CAUSE_DAEMON_RESTART);
  assert.match(diagnosis.summary, /Docker daemon restart/);
  assert.match(diagnosis.summary, /earlier/);
  assert.doesNotMatch(diagnosis.summary, /^out of memory/);
  assert.match(diagnosis.evidence.join('\n'), /OOMKilled/, 'raw observations stay visible');
});

test('the diagnosis of `SIGKILL; cause unknown` is a forced kill, not out of memory', () => {
  const diagnosis = describeKillCause({ oomKilled: true, exitCode: 137, reportedExitReason: UPSTREAM_SIGKILL_UNKNOWN_EXIT_REASON, reportedExitEvidence: { daemonRestart: false, mainOom: false }, reportedCgroupMemory: { oomKills: 5 } });
  assert.equal(diagnosis.cause, KILL_CAUSE_FORCED_KILL);
  assert.match(diagnosis.summary, /cause unknown/);
  assert.match(diagnosis.summary, /earlier container OOM event/);

  // Same input with an exit-time OOM attribution is still out of memory.
  const real = describeKillCause({ oomKilled: true, exitCode: 137, reportedExitEvidence: { daemonRestart: false, mainOom: true }, reportedCgroupMemory: { oomKills: 6 } });
  assert.equal(real.cause, KILL_CAUSE_OUT_OF_MEMORY);
  // ...and so is the legacy record with no attribution at all (issue #2015 / #2134 behaviour).
  assert.equal(describeKillCause({ oomKilled: true, exitCode: 137 }).cause, KILL_CAUSE_OUT_OF_MEMORY);
});

test('Telegram sections and the PR notice say "Docker daemon restart", not "out of memory"', async () => {
  await initI18n('en');
  await preloadAllLocales();
  const sessionInfo = makeSessionInfo();
  const state = await resolve(daemonRestartStatus());
  const report = await buildKillCompletionSections({ sessionName: SESSION, sessionInfo, statusResult: state.statusResult, exitCode: state.exitCode, status: state.status, readFile: async () => '' });
  assert.equal(report.killed, true);
  assert.equal(report.diagnosis.cause, KILL_CAUSE_DAEMON_RESTART);
  const text = report.sections.join('\n');
  assert.match(text, /Docker daemon restart/);
  assert.doesNotMatch(text, /Cause: out of memory/);

  const notice = buildKillRecoveryNotice({ exitCode: 137, sessionName: SESSION, diagnosis: report.diagnosis, policy: 'report' });
  assert.match(notice, /## ❌ Working session was killed by a Docker daemon restart/);
  assert.doesNotMatch(notice, /killed: out of memory/);
  assert.match(notice, /live-restore/, 'the notice points the operator at the prevention');
});

/** Fake `docker`/`systemctl` for the probe, answering from a table of containers. */
function fakeRun({ containers, daemonStart = null }) {
  return async (cmd, args) => {
    if (cmd === 'systemctl') return daemonStart ? { ok: true, stdout: `${daemonStart}\n` } : { ok: false, stdout: '' };
    if (cmd !== 'docker') return { ok: false, stdout: '' };
    if (args[0] === 'ps') return { ok: true, stdout: containers.map(c => c.id).join('\n') };
    if (args[0] === 'inspect') {
      const targets = args.slice(3);
      const rows = containers.filter(c => targets.includes(c.id) || targets.includes(c.name));
      if (rows.length === 0) return { ok: false, stdout: '' };
      return { ok: true, stdout: rows.map(c => [c.id, `/${c.name}`, c.finishedAt, c.exitCode, c.oomKilled, c.running].join('|')).join('\n') };
    }
    return { ok: false, stdout: '' };
  };
}

const ID = n => String(n).repeat(64).slice(0, 64);
const incidentContainers = [
  { id: ID(1), name: SESSION, finishedAt: '2026-10-09T12:11:55.418311Z', exitCode: 137, oomKilled: true, running: false },
  { id: ID(2), name: 'router-725', finishedAt: '2026-10-09T12:11:55.402116Z', exitCode: 137, oomKilled: true, running: false },
  { id: ID(3), name: 'router-727', finishedAt: '2026-10-09T12:11:55.511020Z', exitCode: 137, oomKilled: true, running: false },
  // The DinD root container: no OOM events, killed in the same second, restarted by hand at 13:31.
  { id: ID(4), name: 'hive-mind', finishedAt: '2026-10-09T12:11:55.390210Z', exitCode: 0, oomKilled: false, running: true },
  { id: ID(5), name: 'unrelated', finishedAt: '2026-10-08T07:00:00.000000Z', exitCode: 0, oomKilled: false, running: false },
];

test('probe: containers force-killed in the same second, one without any OOM, mean a daemon restart', async () => {
  const result = await detectDockerDaemonRestart(SESSION, { run: fakeRun({ containers: incidentContainers }) });
  assert.equal(result.detected, true);
  assert.equal(result.finishedAt, '2026-10-09T12:11:55.418311Z');
  assert.deepEqual(result.siblings.map(s => s.name).sort(), ['hive-mind', 'router-725', 'router-727']);
  assert.match(result.evidence.join('\n'), /3 other container/);
  assert.match(result.evidence.join('\n'), /hive-mind/);
});

test('probe: simultaneous OOM kills alone are not a daemon restart (a host OOM storm sets OOMKilled on each)', async () => {
  const storm = incidentContainers.filter(c => c.oomKilled || c.name === 'unrelated');
  const result = await detectDockerDaemonRestart(SESSION, { run: fakeRun({ containers: storm }) });
  assert.equal(result.detected, false);
  assert.equal(result.siblings.length, 2);
});

test('probe: a lone container is not a daemon restart unless dockerd restarted around it', async () => {
  const alone = incidentContainers.filter(c => c.name === SESSION || c.name === 'unrelated');
  assert.equal((await detectDockerDaemonRestart(SESSION, { run: fakeRun({ containers: alone }) })).detected, false);
  const restarted = await detectDockerDaemonRestart(SESSION, { run: fakeRun({ containers: alone, daemonStart: '@1791547905' }) });
  assert.equal(restarted.detected, true, 'dockerd (re)started 10s before FinishedAt');
  assert.match(restarted.evidence.join('\n'), /dockerd/);
  const longAgo = await detectDockerDaemonRestart(SESSION, { run: fakeRun({ containers: alone, daemonStart: '@1791000000' }) });
  assert.equal(longAgo.detected, false, 'a daemon started days earlier explains nothing');
});

test('probe: never throws and returns null when docker is unavailable', async () => {
  assert.equal(await detectDockerDaemonRestart(SESSION, { run: async () => ({ ok: false, stdout: '' }) }), null);
  assert.equal(
    await detectDockerDaemonRestart(SESSION, {
      run: async () => {
        throw new Error('spawn docker ENOENT');
      },
    }),
    null
  );
  assert.equal(await detectDockerDaemonRestart('', { run: fakeRun({ containers: incidentContainers }) }), null);
});
