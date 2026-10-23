// Preview the kill notice for the #3533 scenario (host hard reset, survived blender OOM).
import { detectHostReboot } from '../src/host-boot-state.lib.mjs';
import { describeKillCause } from '../src/session-kill-diagnostics.lib.mjs';
import { buildKillRecoveryNotice } from '../src/session-kill-recovery.lib.mjs';
const event = detectHostReboot({ previous: { bootId: 'dc89e7dd-aaaa', lastHeartbeatAt: '2026-10-18T14:50:00.000Z' }, current: { bootId: '5b0f2a77-bbbb', bootedAt: '2026-10-18T15:00:00.000Z' } });
const hostReboot = { ...event, sessionEndedAt: '2026-10-18T14:50:29.000Z', affectedSessions: 2 };
const logText = '📈 [RESOURCES] phase=solve_start ts=2026-10-18T06:28:35.000Z memAvailableBytes=9234000000 memTotalBytes=12563000000 diskUsedPercent=41.0\n';
const diagnosis = describeKillCause({ logText, oomKilled: true, exitCode: 255, hostReboot, system: { sessionScoped: true, victims: [{ comm: 'blender', pid: 4242 }] } });
console.log(buildKillRecoveryNotice({ diagnosis, exitCode: 255, sessionName: 'a84a2357', observedAt: '2026-10-18T13:16:43.092Z', endedAt: hostReboot.sessionEndedAt, hostReboot }));
