#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Integration coverage for issue #449 disk enforcement in the session monitor.
 */
import assert from 'node:assert/strict';
import { enforceContainerDiskLimitForSession, formatContainerResourceLimitExceededSection, resetSessionMonitorForTests, shouldRefreshDockerFilesystemSize } from '../src/session-monitor.lib.mjs';

resetSessionMonitorForTests();

const recentlyMeasured = {
  isolationBackend: 'docker',
  containerFilesystemLastObservedAt: new Date().toISOString(),
  containerResourceLimits: { diskBytes: 100 },
};
assert.equal(shouldRefreshDockerFilesystemSize(recentlyMeasured, { stillRunning: true }), true, 'a disk quota is checked on every monitor tick');

const sessionInfo = {
  isolationBackend: 'docker',
  sessionId: 'issue-449-container',
  containerResourceLimits: { diskBytes: 100 },
};
const kills = [];
assert.equal(await enforceContainerDiskLimitForSession('issue-449', sessionInfo, 100, { killContainer: async () => ({ success: true }) }), null, 'usage equal to the limit is allowed');
const breach = await enforceContainerDiskLimitForSession('issue-449', sessionInfo, 101, {
  killContainer: async containerName => {
    kills.push(containerName);
    return { success: true, error: null };
  },
});
assert.equal(breach.stopped, true, 'over-quota container is stopped');
assert.deepEqual(kills, ['issue-449-container']);
assert.equal(sessionInfo.containerResourceLimitExceeded.resource, 'disk', 'breach is retained for completion reporting and restart recovery');
assert.equal(sessionInfo.containerResourceLimitExceeded.stopped, true, 'the persisted breach records that Docker stopped the container');
assert.match(formatContainerResourceLimitExceededSection(sessionInfo), /Writable layer: 101 B used; limit 100 B/);

const failedStopSession = { isolationBackend: 'docker', sessionId: 'issue-449-stop-failed', containerResourceLimits: { diskBytes: 100 } };
const failedStop = await enforceContainerDiskLimitForSession('issue-449-stop-failed', failedStopSession, 101, {
  killContainer: async () => ({ success: false, error: 'Docker daemon unavailable' }),
});
assert.equal(failedStop.stopped, false, 'a failed Docker kill is not reported as a successful stop');
assert.equal(failedStopSession.containerResourceLimitExceeded.stopped, false, 'the failed enforcement outcome is retained for completion reporting');
assert.match(formatContainerResourceLimitExceededSection(failedStopSession), /could not be stopped/i, 'the completion report does not claim that a failed kill stopped the task');

const thrownStopSession = { isolationBackend: 'docker', sessionId: 'issue-449-stop-threw', containerResourceLimits: { diskBytes: 100 } };
const thrownStop = await enforceContainerDiskLimitForSession('issue-449-stop-threw', thrownStopSession, 101, {
  killContainer: async () => {
    throw new Error('Docker socket closed');
  },
});
assert.equal(thrownStop.stopped, false, 'a thrown Docker kill error is contained so monitoring can retry');

console.log('✅ Container disk resource monitor tests passed (issue #449)');
