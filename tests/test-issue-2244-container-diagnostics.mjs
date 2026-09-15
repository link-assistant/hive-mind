#!/usr/bin/env node
/**
 * Regression tests for issue #2244: when a Docker-isolated task container dies
 * abnormally, everything that could explain it — the container's own state, its
 * stdout/stderr and the nested daemon's log — used to be destroyed together with
 * the container, leaving a session log that said only `exitCode=137`.
 *
 * The monitor now snapshots those artifacts to the host BEFORE the container is
 * reaped, and says where it put them.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2244
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureDockerTaskContainerDiagnostics, describeDockerExitCode, formatDockerDiagnosticsSection, resolveDockerDiagnosticsDirectory, resolveDockerDiagnosticsPolicy, shouldCaptureDockerDiagnostics } from '../src/docker-task-diagnostics.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
    failed++;
  }
}

const INSPECT_JSON = JSON.stringify([
  {
    Id: 'ffffffffffff',
    Name: '/6eeae339',
    State: { Status: 'exited', Running: false, ExitCode: 137, OOMKilled: false, Error: '', StartedAt: '2026-09-09T17:43:01.500Z', FinishedAt: '2026-09-09T17:43:07.000Z' },
    Config: { Image: 'konard/hive-mind-dind:2.22.0' },
    HostConfig: { Privileged: true, Memory: 0 },
    RestartCount: 0,
  },
]);

function makeExecFile({ failures = {} } = {}) {
  const calls = [];
  const options = [];
  return {
    calls,
    options,
    execFileImpl: async (file, args, opts) => {
      calls.push([file, ...args]);
      options.push(opts);
      const verb = args[0];
      if (failures[verb]) throw new Error(failures[verb]);
      if (verb === 'inspect') return { stdout: INSPECT_JSON, stderr: '' };
      if (verb === 'logs') return { stdout: 'task stdout line\n', stderr: '[dind-entrypoint] Starting dockerd\n' };
      if (verb === 'cp') return { stdout: '', stderr: '' };
      return { stdout: '', stderr: '' };
    },
  };
}

function makeTempLog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2244-diag-'));
  const logPath = path.join(dir, '9f3e8af1.log');
  fs.writeFileSync(logPath, 'Log file: 9f3e8af1.log\n');
  return { dir, logPath };
}

await test('exit code 137 is named as the SIGKILL it is', () => {
  const killed = describeDockerExitCode(137);
  assert.equal(killed.signal, 'SIGKILL');
  assert.match(killed.description, /killed/i);
  assert.equal(describeDockerExitCode(0).signal, null);
  assert.equal(describeDockerExitCode(1).signal, null);
  assert.equal(describeDockerExitCode(143).signal, 'SIGTERM');
  assert.equal(describeDockerExitCode(null).signal, null);
});

await test('diagnostics default to failure-only and can be forced or disabled', () => {
  assert.equal(resolveDockerDiagnosticsPolicy({ env: {} }), 'on-failure');
  assert.equal(resolveDockerDiagnosticsPolicy({ env: { HIVE_MIND_DOCKER_DIAGNOSTICS: 'ALWAYS' } }), 'always');
  assert.equal(resolveDockerDiagnosticsPolicy({ env: { HIVE_MIND_DOCKER_DIAGNOSTICS: 'off' } }), 'off');
  assert.equal(resolveDockerDiagnosticsPolicy({ env: { HIVE_MIND_DOCKER_DIAGNOSTICS: 'nonsense' } }), 'on-failure');

  assert.equal(shouldCaptureDockerDiagnostics({ isolationBackend: 'docker', exitCode: 137, status: 'killed', env: {} }), true);
  assert.equal(shouldCaptureDockerDiagnostics({ isolationBackend: 'docker', exitCode: 0, status: 'executed', env: {} }), false);
  assert.equal(shouldCaptureDockerDiagnostics({ isolationBackend: 'docker', exitCode: 0, status: 'executed', env: { HIVE_MIND_DOCKER_DIAGNOSTICS: 'always' } }), true);
  assert.equal(shouldCaptureDockerDiagnostics({ isolationBackend: 'docker', exitCode: 137, status: 'killed', env: { HIVE_MIND_DOCKER_DIAGNOSTICS: 'off' } }), false);
  assert.equal(shouldCaptureDockerDiagnostics({ isolationBackend: 'screen', exitCode: 137, status: 'killed', env: {} }), false);
});

await test('the snapshot lands next to the session log start-command already keeps', () => {
  const directory = resolveDockerDiagnosticsDirectory({ logPath: '/tmp/start-command/logs/isolation/docker/9f3e8af1.log', containerName: '6eeae339' });
  assert.equal(directory, '/tmp/start-command/logs/isolation/docker/9f3e8af1.diagnostics');
  const fallback = resolveDockerDiagnosticsDirectory({ logPath: null, containerName: '6eeae339', tmpDir: '/tmp' });
  assert.equal(fallback, '/tmp/hive-mind/docker-diagnostics/6eeae339');
});

await test('a killed container leaves its state, output and daemon log on the host', async () => {
  const { dir, logPath } = makeTempLog();
  const { calls, options, execFileImpl } = makeExecFile();
  const capture = await captureDockerTaskContainerDiagnostics({
    containerName: '6eeae339',
    logPath,
    exitCode: 137,
    status: 'killed',
    execFileImpl,
  });

  assert.equal(capture.captured, true);
  assert.equal(capture.directory, path.join(dir, '9f3e8af1.diagnostics'));
  assert.deepEqual(new Set(capture.files), new Set(['container-inspect.json', 'container-logs.txt', 'dockerd.log', 'summary.txt']));
  assert.equal(capture.facts.exitCode, 137);
  assert.equal(capture.facts.oomKilled, false);
  assert.equal(capture.facts.signal, 'SIGKILL');
  assert.equal(capture.facts.startedAt, '2026-09-09T17:43:01.500Z');
  assert.equal(capture.facts.finishedAt, '2026-09-09T17:43:07.000Z');
  assert.equal(capture.facts.image, 'konard/hive-mind-dind:2.22.0');
  assert.equal(capture.facts.lifetimeMs, 5500);

  const inspect = JSON.parse(fs.readFileSync(path.join(capture.directory, 'container-inspect.json'), 'utf8'));
  assert.equal(inspect[0].State.ExitCode, 137);
  const logs = fs.readFileSync(path.join(capture.directory, 'container-logs.txt'), 'utf8');
  assert.match(logs, /task stdout line/);
  assert.match(logs, /Starting dockerd/);
  const summary = fs.readFileSync(path.join(capture.directory, 'summary.txt'), 'utf8');
  assert.match(summary, /exitCode=137/);
  assert.match(summary, /SIGKILL/);

  // The daemon log is copied out of the container, not read after removal.
  const cpCall = calls.find(call => call[1] === 'cp');
  assert.deepEqual(cpCall?.slice(0, 3), ['docker', 'cp', '6eeae339:/var/log/dockerd.log']);
  // Every docker call is bounded so a hung daemon cannot block completion (the
  // very failure mode issue #2244 started from).
  assert.ok(options.length >= 3);
  assert.ok(
    options.every(opts => Number.isFinite(opts?.timeout) && opts.timeout > 0),
    'every docker probe must carry a finite timeout'
  );
});

await test('a missing daemon log or a failing inspect never breaks completion', async () => {
  const { logPath } = makeTempLog();
  const { execFileImpl } = makeExecFile({ failures: { cp: 'Could not find the file /var/log/dockerd.log', inspect: 'No such object' } });
  const capture = await captureDockerTaskContainerDiagnostics({ containerName: 'gone', logPath, exitCode: 137, status: 'killed', execFileImpl });
  assert.equal(capture.captured, true);
  assert.ok(!capture.files.includes('dockerd.log'));
  assert.ok(!capture.files.includes('container-inspect.json'));
  assert.ok(capture.files.includes('container-logs.txt'));
  assert.ok(capture.errors.some(message => /inspect/.test(message)));
});

await test('an unwritable destination degrades to a reported failure, not a throw', async () => {
  const { execFileImpl } = makeExecFile();
  // A regular file where a directory has to go: mkdir -p fails with ENOTDIR.
  const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2244-blocked-')), 'not-a-directory');
  fs.writeFileSync(blocker, 'occupied');
  const capture = await captureDockerTaskContainerDiagnostics({
    containerName: 'unwritable',
    logPath: null,
    tmpDir: blocker,
    exitCode: 137,
    status: 'killed',
    execFileImpl,
  });
  assert.equal(capture.captured, false);
  assert.ok(capture.errors.length > 0);
});

await test('the completion message points a human at the saved evidence', () => {
  const section = formatDockerDiagnosticsSection({
    captured: true,
    directory: '/tmp/logs/9f3e8af1.diagnostics',
    files: ['container-inspect.json', 'container-logs.txt', 'dockerd.log', 'summary.txt'],
    facts: { exitCode: 137, signal: 'SIGKILL', oomKilled: false, startedAt: '2026-09-09T17:43:01.500Z', finishedAt: '2026-09-09T17:43:07.000Z', lifetimeMs: 5500, status: 'exited', image: 'konard/hive-mind-dind:2.22.0' },
    errors: [],
  });
  assert.match(section, /Container diagnostics/);
  assert.match(section, /9f3e8af1\.diagnostics/);
  assert.match(section, /SIGKILL/);
  assert.match(section, /5\.5s/);
  assert.equal(formatDockerDiagnosticsSection(null), '');
  assert.equal(formatDockerDiagnosticsSection({ captured: false, errors: ['nope'], files: [], facts: {} }), '');
});

console.log(`issue #2244 container diagnostics: ${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
