// Comprehensive unit tests for monitoring database module
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createMonitoringDatabase, EventType } from '../src/monitoring-database.lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to create temporary test directory
async function createTempTestDir() {
  const tempDir = path.join(__dirname, '../temp-test-db-' + Date.now());
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

// Helper to cleanup temporary test directory
async function cleanupTempTestDir(tempDir) {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch (err) {
    // Ignore cleanup errors
  }
}

test('MonitoringDatabase - initialization creates directory and files', async () => {
  const tempDir = await createTempTestDir();

  try {
    const db = await createMonitoringDatabase(tempDir);

    // Check that db.lino file was created
    const linoPath = path.join(tempDir, 'db.lino');
    const stats = await fs.stat(linoPath);
    assert.ok(stats.isFile(), 'db.lino should be created');

    // Check that database can be used
    assert.ok(db, 'Database instance should exist');
  } finally {
    await cleanupTempTestDir(tempDir);
  }
});

test('MonitoringDatabase - logRunStart appends event', async () => {
  const tempDir = await createTempTestDir();

  try {
    const db = await createMonitoringDatabase(tempDir);

    const runId = 'test-run-' + Date.now();
    const issueUrl = 'https://github.com/owner/repo/issues/123';
    const user = 'test-user';
    const model = 'sonnet';

    await db.logRunStart(runId, issueUrl, user, model);

    // Read events and verify
    const events = await db.readAllEvents();
    assert.equal(events.length, 1, 'Should have one event');
    assert.equal(events[0].type, EventType.RUN_START, 'Event type should be RUN_START');
    assert.equal(events[0].runId, runId, 'Run ID should match');
    assert.equal(events[0].issueUrl, issueUrl, 'Issue URL should match');
    assert.equal(events[0].user, user, 'User should match');
    assert.equal(events[0].model, model, 'Model should match');
    assert.ok(events[0].id, 'Event should have an ID');
    assert.ok(events[0].timestamp, 'Event should have a timestamp');
  } finally {
    await cleanupTempTestDir(tempDir);
  }
});

test('MonitoringDatabase - logRunComplete appends event', async () => {
  const tempDir = await createTempTestDir();

  try {
    const db = await createMonitoringDatabase(tempDir);

    const runId = 'test-run-' + Date.now();
    await db.logRunStart(runId, 'https://github.com/owner/repo/issues/123', 'user', 'sonnet');
    await db.logRunComplete(runId);

    const events = await db.readAllEvents();
    assert.equal(events.length, 2, 'Should have two events');
    assert.equal(events[1].type, EventType.RUN_COMPLETE, 'Second event should be RUN_COMPLETE');
    assert.equal(events[1].runId, runId, 'Run ID should match');
  } finally {
    await cleanupTempTestDir(tempDir);
  }
});

test('MonitoringDatabase - logRunError appends event with error message', async () => {
  const tempDir = await createTempTestDir();

  try {
    const db = await createMonitoringDatabase(tempDir);

    const runId = 'test-run-' + Date.now();
    await db.logRunStart(runId, 'https://github.com/owner/repo/issues/123', 'user', 'sonnet');

    const error = new Error('Test error message');
    await db.logRunError(runId, error);

    const events = await db.readAllEvents();
    assert.equal(events.length, 2, 'Should have two events');
    assert.equal(events[1].type, EventType.RUN_ERROR, 'Second event should be RUN_ERROR');
    assert.equal(events[1].runId, runId, 'Run ID should match');
    assert.equal(events[1].error, 'Test error message', 'Error message should match');
  } finally {
    await cleanupTempTestDir(tempDir);
  }
});

test('MonitoringDatabase - buildSnapshot reconstructs state correctly', async () => {
  const tempDir = await createTempTestDir();

  try {
    const db = await createMonitoringDatabase(tempDir);

    const runId1 = 'run-1-' + Date.now();
    const runId2 = 'run-2-' + Date.now();

    // Log first run - successful
    await db.logRunStart(runId1, 'https://github.com/owner/repo/issues/1', 'user1', 'sonnet');
    await db.logRunComplete(runId1);

    // Log second run - error
    await db.logRunStart(runId2, 'https://github.com/owner/repo/issues/2', 'user2', 'opus');
    await db.logRunError(runId2, new Error('Test error'));

    const snapshot = await db.buildSnapshot();

    // Verify runs
    assert.ok(snapshot.runs[runId1], 'First run should exist');
    assert.equal(snapshot.runs[runId1].status, 'completed', 'First run should be completed');
    assert.ok(snapshot.runs[runId2], 'Second run should exist');
    assert.equal(snapshot.runs[runId2].status, 'error', 'Second run should have error status');

    // Verify stats
    assert.equal(snapshot.stats.totalRuns, 2, 'Should have 2 total runs');
    assert.equal(snapshot.stats.successfulRuns, 1, 'Should have 1 successful run');
    assert.equal(snapshot.stats.failedRuns, 1, 'Should have 1 failed run');

    // Verify user stats
    assert.equal(snapshot.stats.userStats.user1.totalRuns, 1, 'User1 should have 1 run');
    assert.equal(snapshot.stats.userStats.user1.successfulRuns, 1, 'User1 should have 1 successful run');
    assert.equal(snapshot.stats.userStats.user2.totalRuns, 1, 'User2 should have 1 run');
    assert.equal(snapshot.stats.userStats.user2.failedRuns, 1, 'User2 should have 1 failed run');

    // Verify model stats
    assert.equal(snapshot.stats.modelStats.sonnet.totalRuns, 1, 'Sonnet should have 1 run');
    assert.equal(snapshot.stats.modelStats.opus.totalRuns, 1, 'Opus should have 1 run');
  } finally {
    await cleanupTempTestDir(tempDir);
  }
});

test('MonitoringDatabase - getRunsByStatus filters correctly', async () => {
  const tempDir = await createTempTestDir();

  try {
    const db = await createMonitoringDatabase(tempDir);

    const runId1 = 'run-1-' + Date.now();
    const runId2 = 'run-2-' + Date.now();
    const runId3 = 'run-3-' + Date.now();

    await db.logRunStart(runId1, 'https://github.com/owner/repo/issues/1', 'user', 'sonnet');
    await db.logRunComplete(runId1);

    await db.logRunStart(runId2, 'https://github.com/owner/repo/issues/2', 'user', 'sonnet');
    await db.logRunError(runId2, new Error('Error'));

    await db.logRunStart(runId3, 'https://github.com/owner/repo/issues/3', 'user', 'sonnet');

    const completedRuns = await db.getRunsByStatus('completed');
    const errorRuns = await db.getRunsByStatus('error');
    const runningRuns = await db.getRunsByStatus('running');

    assert.equal(completedRuns.length, 1, 'Should have 1 completed run');
    assert.equal(errorRuns.length, 1, 'Should have 1 error run');
    assert.equal(runningRuns.length, 1, 'Should have 1 running run');
  } finally {
    await cleanupTempTestDir(tempDir);
  }
});

test('MonitoringDatabase - getRunById retrieves specific run', async () => {
  const tempDir = await createTempTestDir();

  try {
    const db = await createMonitoringDatabase(tempDir);

    const runId = 'specific-run-' + Date.now();
    await db.logRunStart(runId, 'https://github.com/owner/repo/issues/1', 'user', 'sonnet');
    await db.logRunComplete(runId);

    const run = await db.getRunById(runId);

    assert.ok(run, 'Run should be found');
    assert.equal(run.runId, runId, 'Run ID should match');
    assert.equal(run.status, 'completed', 'Status should be completed');
  } finally {
    await cleanupTempTestDir(tempDir);
  }
});

test('MonitoringDatabase - locking prevents concurrent writes', async () => {
  const tempDir = await createTempTestDir();

  try {
    const db1 = await createMonitoringDatabase(tempDir);
    const db2 = await createMonitoringDatabase(tempDir);

    const runId1 = 'run-1-' + Date.now();
    const runId2 = 'run-2-' + Date.now();

    // Attempt concurrent writes
    const [result1, result2] = await Promise.all([
      db1.logRunStart(runId1, 'https://github.com/owner/repo/issues/1', 'user', 'sonnet'),
      db2.logRunStart(runId2, 'https://github.com/owner/repo/issues/2', 'user', 'opus')
    ]);

    // Both should succeed (locking ensures they don't corrupt each other)
    assert.ok(result1, 'First write should succeed');
    assert.ok(result2, 'Second write should succeed');

    // Verify both events are in the database
    const events = await db1.readAllEvents();
    assert.equal(events.length, 2, 'Should have 2 events');
  } finally {
    await cleanupTempTestDir(tempDir);
  }
});

test('MonitoringDatabase - append-only mode preserves all events', async () => {
  const tempDir = await createTempTestDir();

  try {
    const db = await createMonitoringDatabase(tempDir);

    const runId = 'test-run-' + Date.now();

    // Log multiple events
    await db.logRunStart(runId, 'https://github.com/owner/repo/issues/1', 'user', 'sonnet');
    await db.logIssueDescription(runId, 'Test description');
    await db.logRunComplete(runId);

    // All events should be preserved
    const events = await db.readAllEvents();
    assert.equal(events.length, 3, 'All 3 events should be preserved');

    // Events should be in order
    assert.equal(events[0].type, EventType.RUN_START);
    assert.equal(events[1].type, EventType.ISSUE_DESCRIPTION);
    assert.equal(events[2].type, EventType.RUN_COMPLETE);
  } finally {
    await cleanupTempTestDir(tempDir);
  }
});

test('MonitoringDatabase - snapshot caching works correctly', async () => {
  const tempDir = await createTempTestDir();

  try {
    const db = await createMonitoringDatabase(tempDir);

    const runId = 'test-run-' + Date.now();
    await db.logRunStart(runId, 'https://github.com/owner/repo/issues/1', 'user', 'sonnet');

    // First snapshot
    const snapshot1 = await db.buildSnapshot();
    const cacheTime1 = db.snapshotCacheTime;

    // Immediate second snapshot should use cache
    const snapshot2 = await db.buildSnapshot();
    const cacheTime2 = db.snapshotCacheTime;

    assert.equal(cacheTime1, cacheTime2, 'Cache time should be the same');
    assert.deepEqual(snapshot1, snapshot2, 'Snapshots should be identical');

    // Adding new event should invalidate cache
    await db.logRunComplete(runId);

    // New snapshot should have different cache time
    const snapshot3 = await db.buildSnapshot();
    assert.notEqual(snapshot1.stats.successfulRuns, snapshot3.stats.successfulRuns, 'Stats should be different after new event');
  } finally {
    await cleanupTempTestDir(tempDir);
  }
});

test('MonitoringDatabase - handles empty database', async () => {
  const tempDir = await createTempTestDir();

  try {
    const db = await createMonitoringDatabase(tempDir);

    const events = await db.readAllEvents();
    assert.equal(events.length, 0, 'Empty database should return empty events array');

    const snapshot = await db.buildSnapshot();
    assert.equal(snapshot.stats.totalRuns, 0, 'Empty database should have zero total runs');
    assert.deepEqual(snapshot.runs, {}, 'Empty database should have no runs');
  } finally {
    await cleanupTempTestDir(tempDir);
  }
});

console.log('All monitoring database tests completed!');
