#!/usr/bin/env node
/**
 * Issue #2892: replay the router#724 status record through the session monitor
 * and print the verdict, the diagnosis and the pull-request title.
 *
 *   node experiments/issue-2892-daemon-restart-attribution.mjs            # incident replay
 *   node experiments/issue-2892-daemon-restart-attribution.mjs <container> # probe a real container (verbose)
 */
import { resolveOomKilledState } from '../src/session-monitor.oom.lib.mjs';
import { describeKillCause } from '../src/session-kill-diagnostics.lib.mjs';
import { buildKillRecoveryNotice } from '../src/session-kill-recovery.lib.mjs';

const container = process.argv[2];
if (container) {
  const { detectDockerDaemonRestart } = await import('../src/session-exit-attribution.lib.mjs');
  console.log(JSON.stringify(await detectDockerDaemonRestart(container, { verbose: true }), null, 2));
  process.exit(0);
}

const SESSION = 'a3e1c7f0-0724-4b47-af4a-06290e562892';
// The four task containers and the root `hive-mind` container finished in the same second.
const containers = [
  { id: 'a724', name: SESSION, oomKilled: true },
  { id: 'a725', name: 'task-725', oomKilled: true },
  { id: 'a727', name: 'task-727', oomKilled: true },
  { id: 'root', name: 'hive-mind', oomKilled: false },
];
const run = async (cmd, args) => {
  if (cmd === 'systemctl') return { ok: false, stdout: '' }; // inside the DinD root container: no host systemd
  if (args[0] === 'ps') return { ok: true, stdout: containers.map(c => c.id).join('\n') };
  const wanted = args.slice(3);
  const rows = containers.filter(c => wanted.includes(c.id) || wanted.includes(c.name));
  return { ok: true, stdout: rows.map(c => `${c.id}|/${c.name}|2026-10-09T12:11:55.4${c.id.length}Z|137|${c.oomKilled}|false`).join('\n') };
};

const statuses = {
  'start-command 0.35.4 (incident record)': { exitReason: 'memory-exhaustion (cgroup-oom-killer)' },
  'start-command 0.36.0, journal readable': { exitReason: 'killed (docker daemon restart)', exitEvidence: { daemonRestart: true, mainOom: false } },
  'start-command 0.36.0, no journal (DinD)': { exitReason: 'signal (SIGKILL; cause unknown)', exitEvidence: { daemonRestart: false, mainOom: false } },
};
const { detectDockerDaemonRestart } = await import('../src/session-exit-attribution.lib.mjs').catch(() => ({}));
for (const [label, extra] of Object.entries(statuses)) {
  const statusResult = { exists: true, status: 'executed', exitCode: 137, oomKilled: true, isolation: 'docker', cgroupMemory: { oomKills: 5 }, ...extra };
  const sessionInfo = { isolationBackend: 'docker', sessionId: SESSION, startTime: new Date(Date.now() - 3_600_000) };
  const daemonRestartProbe = detectDockerDaemonRestart ? name => detectDockerDaemonRestart(name, { run }) : undefined;
  const state = await resolveOomKilledState(SESSION, sessionInfo, statusResult, { runner: {}, exitFromLog: () => null, backendAlive: async () => false, daemonRestartProbe });
  const result = state.statusResult;
  const diagnosis = describeKillCause({ oomKilled: true, exitCode: 137, reportedExitReason: result.exitReason, reportedExitEvidence: result.exitEvidence, reportedCgroupMemory: result.cgroupMemory, dockerDaemonRestart: result.dockerDaemonRestart, killAttribution: result.killAttribution });
  const title = buildKillRecoveryNotice({ exitCode: 137, diagnosis }).split('\n')[1];
  console.log(`\n== ${label}\nstatus:    ${state.status}\ncause:     ${diagnosis.cause}\nsummary:   ${diagnosis.summary}\nPR title:  ${title}`);
}
