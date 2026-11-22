/* global console */
// Prints describeKillCause / buildKillRecoveryNotice for an operator stop during the watch phase (issue #4091).
import { describeKillCause } from '../src/session-kill-diagnostics.lib.mjs';
import { buildKillRecoveryNotice } from '../src/session-kill-recovery.lib.mjs';
const marker = '[2026-11-19T07:00:00.000Z] [HIVE-MIND SOLVE] {"phase":"watch","check":135,"blocker":"ci_pending","detail":"W pending","since":"2026-11-19T02:00:00.000Z","deadline":"2026-11-19T08:00:00.000Z","at":"2026-11-19T07:00:00.000Z"}';
const logText = ['some output', marker, '⚠️  Session interrupted by user (CTRL+C)'].join('\n');
const diagnosis = describeKillCause({ logText, exitCode: 137 });
console.log(JSON.stringify({ cause: diagnosis.cause, summary: diagnosis.summary, stoppedByOperator: diagnosis.stoppedByOperator, lastPhase: diagnosis.lastPhase }, null, 2));
console.log(buildKillRecoveryNotice({ diagnosis, exitCode: 137, sessionName: 's1' }));
