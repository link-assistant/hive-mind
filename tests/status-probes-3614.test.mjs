#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Issue #3614: the bot's real status callers share one rate-limited check.
 *
 * Stub `$`, `docker`, `tmux`, `pgrep` and `screen` binaries on PATH append a
 * line to a counter file every time they start, so each test counts the
 * processes the bot actually spawns:
 * - concurrent `querySessionStatus()` / `isSessionRunning()` calls for the
 *   same session run `$ --status` once, and again only after the interval;
 * - launching or stopping a session invalidates the cached status;
 * - `findStartCommandBinary()` no longer starts `which $` per call;
 * - docker / screen liveness is answered from one listing for all sessions;
 * - the monitor's `docker inspect` fallback and the container exists / size
 *   probes run docker without a shell; the fallback is shared and cleared on stop;
 * - `getRunningProcesses()` runs one `pgrep` for every tool;
 * - `checkTmuxSessionRunning()` reads tmux's exit code (it used to report a
 *   missing session as running).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3614
 */

import assert from 'assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const stubDir = await mkdtemp(path.join(os.tmpdir(), 'hive-3614-stubs-'));
const counterFile = path.join(stubDir, 'calls.log');
await writeFile(counterFile, '');

async function writeStub(name, body) {
  const file = path.join(stubDir, name);
  await writeFile(file, `#!/bin/sh\necho "${name} $*" >> '${counterFile}'\n${body}\n`);
  await chmod(file, 0o755);
}

await writeStub(
  '$',
  `case "$1" in
  --status) printf '{"uuid":"%s","status":"executing","exitCode":null,"options":{"isolated":"docker"}}\\n' "$2" ;;
  --list) printf '[]\\n' ;;
  --stop) echo stopped ;;
esac`
);
await writeStub(
  'docker',
  `if [ "$1" = inspect ]; then
  for last; do :; done
  [ "$last" = gone ] && { echo "Error: No such object: gone" >&2; exit 1; }
  [ "$2" = --size ] && { echo 4096; exit 0; }
  case "$3" in
    *.State.Running*) case "$last" in aaaaaaaaaaaa|bbbb) echo true ;; a) echo 'ambiguous ID' >&2; exit 1 ;; *) echo false ;; esac ;;
    *.State.Status*) echo running ;; *) printf '{"Running":false,"ExitCode":3,"OOMKilled":false,"FinishedAt":"2026-10-20T10:00:00Z"}\\n' ;; esac
  exit 0
fi
printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\tsession-a\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\tsession-b,alias-b\\n'`
);
await writeStub('screen', `printf 'There are screens on:\\n\\t123.screen-a\\t(Detached)\\n'; exit 1`);
await writeStub('tmux', `[ "$3" = "alive" ] && exit 0; exit 1`);
await writeStub('pgrep', `printf '101 claude\\n102 codex\\n103 claude\\n'`);

process.env.PATH = `${stubDir}${path.delimiter}${process.env.PATH}`;
process.env.HIVE_MIND_DOCKER_STATUS_MIN_INTERVAL_MS = '60000';

const { resetStatusCheckCacheForTests, statusCheckCache, configureDockerStatusMinIntervalMs } = await import('../src/status-check-cache.lib.mjs');
const { findStartCommandBinary, resetStartCommandBinaryCacheForTests, runStartCommandQuery } = await import('../src/start-command-cli.lib.mjs');
const { checkBackendSessionAlive, checkDockerContainerExists, checkDockerContainerRunning, getDockerContainerWritableLayerSize, checkScreenSessionRunning, checkTmuxSessionRunning, isSessionRunning, listIsolationSessions, querySessionStatus, stopIsolatedSession } = await import('../src/isolation-runner.lib.mjs');
const { getRunningProcesses, parsePgrepOutput, PGREP_TOOL_NAMES } = await import('../src/telegram-solve-queue.helpers.lib.mjs');
const { parseDockerPsNames, runProbe } = await import('../src/status-probes.lib.mjs');
const { inspectDockerContainerState } = await import('../src/session-monitor.status-query.lib.mjs');

async function calls(prefix) {
  const lines = (await readFile(counterFile, 'utf8')).split('\n').filter(Boolean);
  return prefix ? lines.filter(line => line.startsWith(`${prefix} `)) : lines;
}

async function reset() {
  resetStatusCheckCacheForTests();
  resetStartCommandBinaryCacheForTests();
  configureDockerStatusMinIntervalMs(null);
  await writeFile(counterFile, '');
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await reset();
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.stack || error.message}`);
    failed++;
  }
}

try {
  await test('findStartCommandBinary() resolves $ from PATH once and shares concurrent lookups', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => findStartCommandBinary()));
    for (const result of results) assert.equal(result, path.join(stubDir, '$'));
    assert.equal(await findStartCommandBinary(), path.join(stubDir, '$'));
    assert.equal((await calls()).length, 0, 'no process is started to find $');
  });

  await test('concurrent querySessionStatus() calls for one session run $ --status once', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => querySessionStatus('task-1')));
    for (const result of results) {
      assert.equal(result.exists, true);
      assert.equal(result.status, 'executing');
      assert.equal(result.uuid, 'task-1');
    }
    assert.equal((await calls('$')).length, 1);
    await querySessionStatus('task-1');
    assert.equal((await calls('$')).length, 1, 'a later caller inside the interval reuses the result');
    await querySessionStatus('task-2');
    assert.equal((await calls('$')).length, 2, 'other sessions are checked separately');
  });

  await test('isSessionRunning() from every caller shares the same $ --status', async () => {
    // Session monitor, queue count, /limits, /queue and /log asking at once.
    const answers = await Promise.all([isSessionRunning('task-3', { backend: 'docker' }), isSessionRunning('task-3', { backend: 'docker' }), isSessionRunning('task-3', false), querySessionStatus('task-3')]);
    assert.deepEqual(answers.slice(0, 3), [true, true, true]);
    assert.equal((await calls('$')).length, 1);
  });

  await test('callers cannot change the cached status of other callers', async () => {
    const first = await querySessionStatus('task-4');
    first.status = 'executed';
    first.processIds.injected = 1;
    const second = await querySessionStatus('task-4');
    assert.equal(second.status, 'executing');
    assert.equal(second.processIds.injected, undefined);
  });

  await test('interval 0 checks every time but still shares concurrent checks', async () => {
    configureDockerStatusMinIntervalMs(0);
    await Promise.all([querySessionStatus('task-5'), querySessionStatus('task-5')]);
    assert.equal((await calls('$')).length, 1);
    await querySessionStatus('task-5');
    assert.equal((await calls('$')).length, 2);
  });

  await test('stopIsolatedSession() invalidates the cached status', async () => {
    await querySessionStatus('task-6');
    await stopIsolatedSession('task-6');
    await querySessionStatus('task-6');
    assert.equal((await calls('$')).filter(line => line.includes('--status')).length, 2);
  });

  await test('listIsolationSessions() is shared like --status', async () => {
    const lists = await Promise.all([listIsolationSessions(), listIsolationSessions(), listIsolationSessions()]);
    for (const list of lists) assert.deepEqual(list, []);
    assert.equal((await calls('$')).filter(line => line.includes('--list')).length, 1);
  });

  await test('$ queries run without a shell', async () => {
    const result = await runStartCommandQuery(path.join(stubDir, '$'), ['--status', 'with space; echo injected', '--output-format', 'json']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /"uuid":"with space; echo injected"/);
    assert.deepEqual(await calls(), ['$ --status with space; echo injected --output-format json']);
  });

  await test('docker liveness for many containers comes from one docker ps', async () => {
    const answers = await Promise.all([checkDockerContainerRunning('session-a'), checkDockerContainerRunning('session-b'), checkDockerContainerRunning('alias-b'), checkDockerContainerRunning('gone'), checkBackendSessionAlive('session-a', 'docker')]);
    assert.deepEqual(answers, [true, true, true, false, true]);
    const docker = await calls('docker');
    assert.equal(docker.length, 1);
    assert.match(docker[0], /^docker ps --no-trunc --format/);
    assert.equal(await checkDockerContainerRunning(''), false);
  });

  await test('batched docker liveness retains full IDs, unique ID prefixes and slash-prefixed names', async () => {
    const answers = await Promise.all([checkDockerContainerRunning('a'.repeat(64)), checkDockerContainerRunning('a'.repeat(12)), checkDockerContainerRunning('bbbb'), checkDockerContainerRunning('/session-b'), checkDockerContainerRunning('session'), checkDockerContainerRunning('cccc'), checkDockerContainerRunning('a')]);
    assert.deepEqual(answers, [true, true, true, true, false, false, false]);
    assert.equal((await calls('docker')).filter(line => line.startsWith('docker ps ')).length, 1);
    await checkDockerContainerRunning('a'.repeat(12));
    assert.equal((await calls('docker')).length, 5, 'abbreviated IDs reuse engine lookups within the interval');
    await stopIsolatedSession('a'.repeat(12));
    await checkDockerContainerRunning('a'.repeat(12));
    assert.equal((await calls('docker')).length, 7, 'stop invalidates both the ID lookup and shared listing');
  });

  await test('screen liveness for many sessions comes from one screen -ls', async () => {
    const answers = await Promise.all([checkScreenSessionRunning('screen-a'), checkScreenSessionRunning('screen-b'), checkBackendSessionAlive('screen-a', 'screen')]);
    assert.deepEqual(answers, [true, false, true]);
    assert.equal((await calls('screen')).length, 1);
  });

  await test('checkTmuxSessionRunning() reports a missing session as not running', async () => {
    assert.equal(await checkTmuxSessionRunning('alive'), true);
    assert.equal(await checkTmuxSessionRunning('missing'), false);
    assert.equal(await checkTmuxSessionRunning('missing'), false);
    assert.equal((await calls('tmux')).length, 2, 'each session is checked once per interval');
  });

  await test("the monitor's docker inspect fallback is shared and runs without a shell", async () => {
    const states = await Promise.all([inspectDockerContainerState('task-8'), inspectDockerContainerState('task-8')]);
    for (const state of states) assert.deepEqual(state, { exists: true, running: false, exitCode: 3, oomKilled: false, finishedAt: '2026-10-20T10:00:00Z' });
    states[0].exitCode = 99;
    assert.equal((await inspectDockerContainerState('task-8')).exitCode, 3, 'callers get their own copy');
    assert.deepEqual(await calls('docker'), ['docker inspect -f {{json .State}} task-8']);
    assert.deepEqual(await inspectDockerContainerState('gone'), { exists: false });
    await stopIsolatedSession('task-8');
    await inspectDockerContainerState('task-8');
    assert.equal((await calls('docker')).filter(line => line.includes('task-8')).length, 2, 'stopping the session invalidates the cached state');
  });

  await test('docker container exists / writable-layer size probes run docker directly', async () => {
    assert.equal(await checkDockerContainerExists('session-a'), true);
    assert.equal(await checkDockerContainerExists('gone'), false);
    assert.equal(await getDockerContainerWritableLayerSize('session-a'), 4096);
    assert.equal(await getDockerContainerWritableLayerSize('gone'), null);
    assert.deepEqual(await calls('docker'), ['docker inspect -f {{.State.Status}} session-a', 'docker inspect -f {{.State.Status}} gone', 'docker inspect --size -f {{.SizeRw}} session-a', 'docker inspect --size -f {{.SizeRw}} gone']);
  });

  await test('getRunningProcesses() counts every tool from one pgrep', async () => {
    const counts = await Promise.all(PGREP_TOOL_NAMES.map(name => getRunningProcesses(name)));
    assert.deepEqual(Object.fromEntries(PGREP_TOOL_NAMES.map((name, i) => [name, counts[i].count])), { claude: 2, agent: 0, codex: 1, qwen: 0, gemini: 0 });
    const pgrep = await calls('pgrep');
    assert.deepEqual(pgrep, ['pgrep -l -x claude|agent|codex|qwen|gemini']);
  });

  await test('getRunningProcesses() rejects names that are not plain process names', async () => {
    const result = await getRunningProcesses('claude; rm -rf /');
    assert.equal(result.count, 0);
    assert.equal((await calls('pgrep')).length, 0);
  });

  await test('parsers: pgrep -l and docker ps output', () => {
    assert.deepEqual(parsePgrepOutput('12 claude\n\n 13 codex \n'), [
      { pid: '12', name: 'claude' },
      { pid: '13', name: 'codex' },
    ]);
    assert.deepEqual([...parseDockerPsNames('abc\tone,two\n\ndef\tthree\n')].sort(), ['abc', 'def', 'one', 'three', 'two']);
  });

  await test('runProbe() maps a missing binary to exit code 127 and never throws', async () => {
    const result = await runProbe(path.join(stubDir, 'does-not-exist'), []);
    assert.equal(result.code, 127);
    assert.ok(result.error);
  });

  await test('the shared cache counts hits and joins', async () => {
    await Promise.all([querySessionStatus('task-7'), querySessionStatus('task-7')]);
    await querySessionStatus('task-7');
    const stats = statusCheckCache.getStats();
    assert.equal(stats.misses, 1);
    assert.equal(stats.inflightJoins, 1);
    assert.equal(stats.hits, 1);
  });
} finally {
  await rm(stubDir, { recursive: true, force: true });
}

console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
