#!/usr/bin/env node
/**
 * Unit tests for issue #2052: a session that was explicitly stopped by the
 * operator (Telegram `/stop <uuid>` → `docker stop` → SIGTERM then SIGKILL)
 * must be reported as "🛑 Stopped by user", NOT as
 * "killed — out of memory or forced kill (SIGKILL)".
 *
 * The distinguishing signal is `sessionInfo.stopRequestedByUser`, set by the
 * /stop command via session-monitor.markSessionStopRequested BEFORE the kill
 * signal is forwarded, so even a fast SIGKILL race still finds the flag when
 * the completion message is formatted.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2052
 */

import { formatSessionCompletionMessage } from '../src/work-session-formatting.lib.mjs';
import { markSessionStopRequested, trackSession, getTrackedSessionInfo, resetSessionMonitorForTests } from '../src/session-monitor.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #2052: stopped-by-user completion labeling');
console.log('='.repeat(60));

const baseArgs = {
  sessionName: 'sess-2052',
  observedEndTime: new Date('2026-07-12T19:10:49.822Z'),
};

// --- SIGKILL (137) after a user stop → "stopped by user", not OOM -------------
const killedByUser = formatSessionCompletionMessage({
  ...baseArgs,
  sessionInfo: { isolationBackend: 'docker', stopRequestedByUser: true, startTime: new Date('2026-07-12T19:00:00.000Z') },
  statusResult: { status: 'killed', exitCode: 137 },
  exitCode: 137,
});
assert(killedByUser.startsWith('🛑'), 'user-stopped SIGKILL message starts with 🛑');
assert(/stopped by user/i.test(killedByUser), 'user-stopped message says "stopped by user"');
assert(!/out of memory/i.test(killedByUser), 'user-stopped message NEVER mentions out of memory');
assert(!/finished successfully/.test(killedByUser), 'user-stopped message NEVER says "finished successfully"');

// --- SIGTERM (143) after a user stop → "stopped by user" ----------------------
const termByUser = formatSessionCompletionMessage({
  ...baseArgs,
  sessionInfo: { isolationBackend: 'docker', stopRequestedByUser: true, stopRequestedBy: '@konard' },
  statusResult: { status: 'terminated', exitCode: 143 },
  exitCode: 143,
});
assert(termByUser.startsWith('🛑'), 'user-stopped SIGTERM message starts with 🛑');
assert(/@konard/.test(termByUser), 'user-stopped message includes the requester when known');

// --- Without the flag, a SIGKILL is still an OOM/forced kill ------------------
const oomKill = formatSessionCompletionMessage({
  ...baseArgs,
  sessionInfo: { isolationBackend: 'docker' },
  statusResult: { status: 'killed', exitCode: 137 },
  exitCode: 137,
});
assert(oomKill.startsWith('❌'), 'unrequested SIGKILL still starts with ❌');
assert(/out of memory|SIGKILL/i.test(oomKill), 'unrequested SIGKILL still reads as a forced/OOM kill');
assert(!/stopped by user/i.test(oomKill), 'unrequested SIGKILL is NOT labeled stopped by user');

// --- markSessionStopRequested wires the flag onto the tracked session ---------
if (typeof resetSessionMonitorForTests === 'function') resetSessionMonitorForTests();
trackSession('screen-name-abc', { sessionId: 'uuid-123', isolationBackend: 'docker', startTime: new Date() });

// Match by UUID even though the registry is keyed by session name.
const markedByUuid = markSessionStopRequested('uuid-123', { requestedBy: '@op' });
assert(markedByUuid === true, 'markSessionStopRequested matches a session by its sessionId UUID');
const info = getTrackedSessionInfo('screen-name-abc');
assert(info && info.stopRequestedByUser === true, 'stopRequestedByUser flag is set on the tracked session');
assert(info.stopRequestedBy === '@op', 'stopRequestedBy records the requester');

// Match by tracking key too.
const markedByKey = markSessionStopRequested('screen-name-abc');
assert(markedByKey === true, 'markSessionStopRequested matches a session by its tracking key');

// Unknown session → no throw, returns false.
const missing = markSessionStopRequested('does-not-exist');
assert(missing === false, 'markSessionStopRequested returns false for an unknown session');

printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
