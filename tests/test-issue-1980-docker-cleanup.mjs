#!/usr/bin/env node
/**
 * Regression tests for issue #1980.
 *
 * hive-cleanup must clean Docker-isolation task containers by session UUID,
 * without falling back to host-wide `docker system prune -f`.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/1980
 */

import assert from 'node:assert/strict';

import { DEFAULT_DOCKER_ISOLATION_CLEANUP_MODE, formatDockerIsolationContainerSummary, normalizeDockerIsolationCleanupMode, planDockerIsolationCleanup } from '../src/cleanup.lib.mjs';
import { parseDockerPsJsonLines } from '../src/cleanup.os.lib.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.stack || error.message}`);
    failed++;
  }
}

const SUCCESS = '11111111-1111-4111-8111-111111111111';
const FAILED = '22222222-2222-4222-8222-222222222222';
const RUNNING = '33333333-3333-4333-8333-333333333333';
const UNKNOWN = '44444444-4444-4444-8444-444444444444';

function dockerPsFixture() {
  return [
    { ID: 'abc123', Image: 'konard/hive-mind-dind:latest', Names: SUCCESS, State: 'exited', Status: 'Exited (0) 2 hours ago' },
    { ID: 'def456', Image: 'konard/hive-mind-dind:latest', Names: FAILED, State: 'exited', Status: 'Exited (1) 1 hour ago' },
    { ID: 'ghi789', Image: 'konard/hive-mind-dind:latest', Names: RUNNING, State: 'running', Status: 'Up 4 minutes' },
    { ID: 'jkl012', Image: 'custom/hive-task:dev', Names: UNKNOWN, State: 'exited', Status: 'Exited (137) 10 minutes ago' },
    { ID: 'mno345', Image: 'postgres:16', Names: 'unrelated-db', State: 'exited', Status: 'Exited (0) 5 hours ago' },
  ]
    .map(record => JSON.stringify(record))
    .join('\n');
}

function sessionTasks() {
  return [
    {
      owner: 'link-assistant',
      repo: 'hive-mind',
      type: 'issue',
      number: 1980,
      sessionId: SUCCESS,
      sessionName: SUCCESS,
      status: 'executed',
      exitCode: 0,
      isolation: 'docker',
      terminal: true,
    },
    {
      owner: 'link-assistant',
      repo: 'hive-mind',
      type: 'issue',
      number: 1979,
      sessionId: FAILED,
      sessionName: FAILED,
      status: 'failed',
      exitCode: 1,
      isolation: 'docker',
      terminal: true,
    },
    {
      owner: 'link-assistant',
      repo: 'hive-mind',
      type: 'issue',
      number: 1946,
      sessionId: RUNNING,
      sessionName: RUNNING,
      status: 'executing',
      exitCode: null,
      isolation: 'docker',
      terminal: false,
    },
  ];
}

function byName(items) {
  return new Map(items.map(item => [item.name, item]));
}

test('parseDockerPsJsonLines filters UUID-named task containers and parses state', () => {
  const containers = parseDockerPsJsonLines(dockerPsFixture());
  assert.deepEqual(containers.map(container => container.name).sort(), [FAILED, RUNNING, SUCCESS, UNKNOWN].sort());
  assert.equal(containers.find(container => container.name === SUCCESS).exitCode, 0);
  assert.equal(containers.find(container => container.name === FAILED).exitCode, 1);
  assert.equal(containers.find(container => container.name === RUNNING).running, true);
  assert.equal(
    containers.some(container => container.name === 'unrelated-db'),
    false
  );
});

test('default docker-isolation cleanup removes successful exited containers and keeps failed ones', () => {
  assert.equal(DEFAULT_DOCKER_ISOLATION_CLEANUP_MODE, 'failed-kept');
  const plan = planDockerIsolationCleanup({
    containers: parseDockerPsJsonLines(dockerPsFixture()),
    sessionTasks: sessionTasks(),
  });
  const remove = byName(plan.remove);
  const keep = byName(plan.keep);

  assert.deepEqual([...remove.keys()], [SUCCESS]);
  assert.equal(remove.get(SUCCESS).command, `docker rm -f ${SUCCESS}`);

  assert.equal(keep.get(FAILED).reason, 'failed-container-kept');
  assert.equal(keep.get(FAILED).command, `docker rm -f ${FAILED}`);
  assert.equal(keep.get(RUNNING).reason, 'active-container');
  assert.equal(keep.get(UNKNOWN).reason, 'failed-container-kept');
  assert.equal(keep.get(UNKNOWN).command, `docker rm -f ${UNKNOWN}`);
});

test('docker ps exit status wins over stale unknown session exit code', () => {
  const staleSessions = sessionTasks().map(task => (task.sessionId === SUCCESS ? { ...task, exitCode: -1 } : task));
  const plan = planDockerIsolationCleanup({
    containers: parseDockerPsJsonLines(dockerPsFixture()),
    sessionTasks: staleSessions,
  });

  assert.deepEqual(
    plan.remove.map(item => item.name),
    [SUCCESS]
  );
  assert.equal(plan.remove[0].exitCode, 0);
  assert.equal(plan.remove[0].reason, 'successful-container');
});

test('running containers are protected even in all mode', () => {
  const plan = planDockerIsolationCleanup({
    containers: parseDockerPsJsonLines(dockerPsFixture()),
    sessionTasks: sessionTasks(),
    mode: 'all',
  });

  assert.deepEqual(plan.remove.map(item => item.name).sort(), [FAILED, SUCCESS, UNKNOWN].sort());
  assert.equal(byName(plan.keep).get(RUNNING).reason, 'active-container');
});

test('finished mode removes failed terminal containers too', () => {
  const plan = planDockerIsolationCleanup({
    containers: parseDockerPsJsonLines(dockerPsFixture()),
    sessionTasks: sessionTasks(),
    mode: 'finished',
  });

  assert.deepEqual(plan.remove.map(item => item.name).sort(), [FAILED, SUCCESS, UNKNOWN].sort());
});

test('none mode disables docker-isolation cleanup without hiding discovered containers', () => {
  const plan = planDockerIsolationCleanup({
    containers: parseDockerPsJsonLines(dockerPsFixture()),
    sessionTasks: sessionTasks(),
    mode: 'none',
  });

  assert.deepEqual(plan.remove, []);
  assert.equal(plan.keep.length, 4);
  assert.ok(plan.keep.every(item => item.reason === 'disabled'));
});

test('normalizes docker-isolation cleanup mode aliases', () => {
  assert.equal(normalizeDockerIsolationCleanupMode(null), 'failed-kept');
  assert.equal(normalizeDockerIsolationCleanupMode(''), 'failed-kept');
  assert.equal(normalizeDockerIsolationCleanupMode('true'), 'failed-kept');
  assert.equal(normalizeDockerIsolationCleanupMode('off'), 'none');
  assert.equal(normalizeDockerIsolationCleanupMode('success'), 'failed-kept');
  assert.equal(normalizeDockerIsolationCleanupMode('finished'), 'finished');
  assert.throws(() => normalizeDockerIsolationCleanupMode('surprise'), /Invalid docker isolation cleanup mode/);
});

test('docker container summary includes session and cleanup context', () => {
  const plan = planDockerIsolationCleanup({
    containers: parseDockerPsJsonLines(dockerPsFixture()),
    sessionTasks: sessionTasks(),
  });
  const failedRecord = byName(plan.keep).get(FAILED);
  const summary = formatDockerIsolationContainerSummary(failedRecord);

  assert.ok(summary.includes(FAILED));
  assert.ok(summary.includes('exit 1'));
  assert.ok(summary.includes('link-assistant/hive-mind issue #1979'));
  assert.ok(summary.includes(`remove when done: docker rm -f ${FAILED}`));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
