/**
 * @hive-mind-test-suite default
 * The `--isolation docker` preflight checks Docker live-restore (#2900).
 *
 * On 2026-10-09 the host had no /etc/docker/daemon.json, so live-restore was
 * off. The kernel OOM-killed the host dockerd; on restart dockerd force-killed
 * every container (exit 137): the bot, four running tasks and the in-memory
 * queue. With `"live-restore": true` dockerd re-attaches to the running
 * containers instead. The preflight warns when a daemon reports false.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLiveRestoreWarning, checkDockerLiveRestore, LIVE_RESTORE_MERGE_COMMAND, parseLiveRestoreEnabled, preflightLiveRestore } from '../src/docker-live-restore.lib.mjs';
import { preflightDockerIsolation } from '../src/isolation-runner.lib.mjs';

const DIND = { HIVE_MIND_DOCKER_ISOLATION_IMAGE: 'konard/hive-mind-dind', DIND_HOST_DOCKER_SOCK: '/var/run/host-docker.sock' };
const PLAIN = { HIVE_MIND_DOCKER_ISOLATION_IMAGE: 'konard/hive-mind' };

function captureLogger() {
  const lines = { log: [], warn: [] };
  return { lines, log: msg => lines.log.push(String(msg)), warn: msg => lines.warn.push(String(msg)) };
}

function baseOptions(overrides = {}) {
  return {
    env: PLAIN,
    existsSync: () => false,
    checkImagePresent: async () => true,
    checkStorageDriver: async () => 'overlay2',
    checkDiskSpace: async () => ({ availableGiB: 500, dataRoot: '/var/lib/docker' }),
    logger: captureLogger(),
    ...overrides,
  };
}

test('parseLiveRestoreEnabled reads the docker info template output', () => {
  assert.equal(parseLiveRestoreEnabled('true\n'), true);
  assert.equal(parseLiveRestoreEnabled(' false '), false);
  assert.equal(parseLiveRestoreEnabled(''), null);
  assert.equal(parseLiveRestoreEnabled('<no value>'), null);
  assert.equal(parseLiveRestoreEnabled(undefined), null);
});

test('checkDockerLiveRestore runs docker info with the LiveRestoreEnabled template, optionally against a host socket', async () => {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    return 'false\n';
  };
  assert.equal(await checkDockerLiveRestore(false, { run }), false);
  assert.equal(await checkDockerLiveRestore(false, { run, host: 'unix:///var/run/host-docker.sock' }), false);
  assert.deepEqual(calls, [
    ['docker', 'info', '-f', '{{.LiveRestoreEnabled}}'],
    ['docker', '-H', 'unix:///var/run/host-docker.sock', 'info', '-f', '{{.LiveRestoreEnabled}}'],
  ]);
});

test('checkDockerLiveRestore never throws: an unreachable daemon is unknown (null)', async () => {
  const run = async () => {
    throw new Error('Cannot connect to the Docker daemon at unix:///var/run/docker.sock');
  };
  assert.equal(await checkDockerLiveRestore(false, { run }), null);
  assert.equal(await checkDockerLiveRestore(false, { run: async () => '<no value>\n' }), null);
});

test('the warning carries the reload-not-restart remediation and the limits', () => {
  const w = buildLiveRestoreWarning();
  assert.match(w, /LiveRestoreEnabled=false/);
  assert.match(w, /"live-restore": true/);
  assert.match(w, /\/etc\/docker\/daemon\.json/);
  assert.match(w, /systemctl reload docker/);
  assert.match(w, /never restart/);
  assert.match(w, /host reboot/);
  assert.match(w, /--restart unless-stopped/);
  assert.match(w, /issue #2900/);
  assert.match(w, /docs\/DOCKER\.md#host-docker-daemon-settings/);
  // The merge snippet keeps other keys instead of overwriting daemon.json.
  assert.match(LIVE_RESTORE_MERGE_COMMAND, /json\.load\(open\(p\)\)/);
  assert.match(LIVE_RESTORE_MERGE_COMMAND, /d\["live-restore"\]=True/);
});

test('preflight: live-restore off on the task daemon warns, and never blocks (ok stays true)', async () => {
  const logger = captureLogger();
  const result = await preflightDockerIsolation(baseOptions({ logger, checkLiveRestore: async () => false }));
  assert.equal(result.liveRestore, false);
  assert.equal(result.hostLiveRestore, null);
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /live-restore disabled/);
  assert.match(result.warnings[0], /systemctl reload docker/);
  assert.equal(logger.lines.warn.length, 1);
  assert.match(logger.lines.warn[0], /^⚠️ .*live-restore/);
});

test('preflight: live-restore on or unknown does not warn', async () => {
  for (const value of [true, null]) {
    const result = await preflightDockerIsolation(baseOptions({ checkLiveRestore: async () => value }));
    assert.equal(result.liveRestore, value);
    assert.deepEqual(result.warnings, []);
  }
  const throwing = await preflightDockerIsolation(
    baseOptions({
      checkLiveRestore: async () => {
        throw new Error('boom');
      },
    })
  );
  assert.equal(throwing.liveRestore, null);
  assert.deepEqual(throwing.warnings, []);
});

test('preflight (DinD with the host socket mounted): checks the host daemon too, the one that runs the bot container', async () => {
  const hosts = [];
  const checkLiveRestore = async (_verbose, { host } = {}) => {
    hosts.push(host || null);
    return host ? false : true; // the incident: nested daemon fine, host daemon off
  };
  const result = await preflightDockerIsolation(baseOptions({ env: DIND, existsSync: () => true, checkLiveRestore }));
  assert.deepEqual(hosts, [null, 'unix:///var/run/host-docker.sock']);
  assert.equal(result.liveRestore, true);
  assert.equal(result.hostLiveRestore, false);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /^The host Docker daemon \(socket mounted at \/var\/run\/host-docker\.sock/);
});

test('preflight (DinD without the host socket): only the nested daemon is probed', async () => {
  const hosts = [];
  const result = await preflightLiveRestore({
    isDind: true,
    socketMounted: false,
    sock: '/var/run/host-docker.sock',
    checkLiveRestore: async (_verbose, { host } = {}) => {
      hosts.push(host || null);
      return false;
    },
  });
  assert.deepEqual(hosts, [null]);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /^The nested Docker daemon/);
});

test('Dockerfile.dind keeps --live-restore on for the nested dockerd', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile.dind', import.meta.url), 'utf8');
  assert.match(dockerfile, /^ENV DIND_LIVE_RESTORE="1"$/m);
});

test('docs: "Host Docker daemon settings" in all four languages, referenced from Quick Start and the README install section', () => {
  const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  const docs = { 'docs/DOCKER.md': '#host-docker-daemon-settings', 'docs/DOCKER.ru.md': '#настройки-docker-daemon-на-хосте', 'docs/DOCKER.zh.md': '#宿主机-docker-daemon-设置', 'docs/DOCKER.hi.md': '#host-docker-daemon-settings' };
  for (const [file, anchor] of Object.entries(docs)) {
    const text = read(file);
    assert.match(text, /"live-restore"\]=True/, `${file}: merge snippet`);
    assert.ok(text.includes(LIVE_RESTORE_MERGE_COMMAND), `${file}: the same merge command as the preflight warning`);
    assert.match(text, /DIND_LIVE_RESTORE=0/, `${file}: DinD opt-out`);
    assert.match(text, /systemctl reload docker/, `${file}: reload command`);
    assert.match(text, /LiveRestoreEnabled/, `${file}: verification`);
    assert.match(text, /--restart unless-stopped/, `${file}: restart policy limit`);
    assert.match(text, /issues\/2890/, `${file}: queue persistence limit`);
    assert.ok(text.split(`(${anchor})`).length - 1 >= 2, `${file}: referenced from Option 1 and Option 3`);
  }
  for (const [readme, doc] of [
    ['README.md', 'docs/DOCKER.md'],
    ['README.ru.md', 'docs/DOCKER.ru.md'],
    ['README.zh.md', 'docs/DOCKER.zh.md'],
    ['README.hi.md', 'docs/DOCKER.hi.md'],
  ]) {
    const text = read(readme);
    assert.ok(text.includes(`(./${doc}${docs[doc]})`), `${readme}: links the host daemon settings`);
    assert.match(text, /systemctl reload docker/, `${readme}: reload command`);
  }
});
