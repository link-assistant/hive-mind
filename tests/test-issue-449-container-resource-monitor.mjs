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
assert.match(formatContainerResourceLimitExceededSection(sessionInfo), /Writable layer: 101 B used; limit 100 B/);

console.log('✅ Container disk resource monitor tests passed (issue #449)');
