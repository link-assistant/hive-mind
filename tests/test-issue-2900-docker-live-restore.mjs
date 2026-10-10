#!/usr/bin/env node
/**
 * Regression test for issue #2900 — a dockerd restart killed the bot and every
 * task because Docker `live-restore` was off on the host.
 *
 * With the Docker default (`"live-restore": false`) any dockerd restart (crash,
 * OOM kill, package upgrade, `systemctl restart docker`) stops every container
 * on that daemon. On 2026-10-09 the host dockerd was OOM-killed, systemd
 * restarted it, and it force-killed the bot container and all four running
 * tasks; the in-memory queue was lost with them.
 *
 * Covered here:
 *   - `preflightDockerIsolation` warns loudly, with the exact remediation, when
 *     a daemon whose restart would kill the bot or its tasks reports
 *     live-restore=false; it only logs for the nested DinD daemon, never
 *     duplicates the warning when the task and host daemons are the same, and
 *     never blocks or throws.
 *   - `checkDockerLiveRestore` never throws (null without docker).
 *   - `scripts/enable-docker-live-restore.sh` merges the key into daemon.json
 *     without dropping other keys, leaves invalid JSON untouched, and does not
 *     touch the daemon in `--no-reload` / `--dry-run` mode.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2900
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDockerLiveRestore, preflightDockerIsolation } from '../src/isolation-runner.lib.mjs';
import { assessDockerLiveRestore, buildLiveRestoreRemediation, parseLiveRestoreInfoOutput } from '../src/docker-live-restore.lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'scripts', 'enable-docker-live-restore.sh');

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  PASS: ${label}`);
  passed++;
}

function fail(label, expected, actual) {
  console.error(`  FAIL: ${label}`);
  if (expected !== undefined) console.error(`     expected: ${JSON.stringify(expected)}`);
  if (actual !== undefined) console.error(`     actual:   ${JSON.stringify(actual)}`);
  failed++;
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass(label);
  else fail(label, expected, actual);
}

function assertIncludes(haystack, needle, label) {
  if (typeof haystack === 'string' && haystack.includes(needle)) pass(label);
  else fail(label, `string containing ${needle}`, haystack);
}

function captureLogger() {
  const logs = [];
  const warns = [];
  return { logs, warns, log: (...a) => logs.push(a.join(' ')), warn: (...a) => warns.push(a.join(' ')) };
}

const HOST_SOCK = '/var/run/host-docker.sock';
const DIND = { HIVE_MIND_IMAGE_VARIANT: 'dind' };
const REGULAR = { HIVE_MIND_IMAGE_VARIANT: 'regular' };

// Probes for the unrelated checks, healthy so only live-restore can warn.
const HEALTHY = {
  checkImagePresent: async () => true,
  checkStorageDriver: async () => 'overlay2',
  checkDiskSpace: async () => ({ availableGiB: 500, dataRoot: '/var/lib/docker' }),
};

/**
 * Fake live-restore probe: `task` answers the CLI's default daemon, `host`
 * answers the mounted host socket. Records which sockets were queried.
 */
function fakeDaemons({ task = null, host = null } = {}) {
  const calls = [];
  const probe = async (_verbose, { socket = null } = {}) => {
    calls.push(socket);
    return socket ? host : task;
  };
  probe.calls = calls;
  return probe;
}

async function preflight({ env, socketMounted, probe }) {
  const logger = captureLogger();
  const result = await preflightDockerIsolation({ env, existsSync: p => socketMounted && p === HOST_SOCK, logger, checkLiveRestore: probe, ...HEALTHY });
  return { result, logger };
}

console.log('\n--- parseLiveRestoreInfoOutput ---');

assertEqual(parseLiveRestoreInfoOutput('false bccf6bc9-ad9b\n'), { enabled: false, daemonId: 'bccf6bc9-ad9b' }, 'parses false + daemon id');
assertEqual(parseLiveRestoreInfoOutput('true abc'), { enabled: true, daemonId: 'abc' }, 'parses true + daemon id');
assertEqual(parseLiveRestoreInfoOutput('TRUE'), { enabled: true, daemonId: null }, 'case-insensitive, id optional');
assertEqual(parseLiveRestoreInfoOutput(''), null, 'empty output is unknown');
assertEqual(parseLiveRestoreInfoOutput('<no value> abc'), null, 'non-boolean output is unknown');
assertEqual(parseLiveRestoreInfoOutput(undefined), null, 'undefined output is unknown');

console.log('\n--- checkDockerLiveRestore never throws ---');

const real = await checkDockerLiveRestore(false);
if (real === null || typeof real.enabled === 'boolean') pass('default daemon probe resolves to {enabled,daemonId}|null');
else fail('default daemon probe resolves to {enabled,daemonId}|null', '{enabled,daemonId}|null', real);
const missing = await checkDockerLiveRestore(false, { socket: path.join(os.tmpdir(), 'hive-mind-2900-no-such.sock') });
assertEqual(missing, null, 'probe of a missing socket resolves to null');

{
  // Docker CLI 27 and older print the zero-value template ("false ") and exit
  // 0 for an unreachable daemon (data/docker-cli-unreachable-daemon.log); CI
  // runners ship such a CLI. Only a report carrying a daemon ID is trusted.
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-mind-2900-bin-'));
  const savedPath = process.env.PATH;
  try {
    process.env.PATH = `${binDir}${path.delimiter}${savedPath}`;
    const fakeDocker = path.join(binDir, 'docker');
    fs.writeFileSync(fakeDocker, '#!/bin/sh\nprintf "false \\n"\n', { mode: 0o755 });
    assertEqual(await checkDockerLiveRestore(false), null, 'old CLI, unreachable daemon ("false ", exit 0) resolves to null');
    fs.writeFileSync(fakeDocker, '#!/bin/sh\nprintf "false daemon-xyz\\n"\n', { mode: 0o755 });
    assertEqual(await checkDockerLiveRestore(false), { enabled: false, daemonId: 'daemon-xyz' }, 'reachable daemon with live-restore off resolves to enabled=false');
  } finally {
    process.env.PATH = savedPath;
    fs.rmSync(binDir, { recursive: true, force: true });
  }
}

console.log('\n--- Incident: bot on the host daemon, live-restore off → loud warning ---');

{
  const probe = fakeDaemons({ task: { enabled: false, daemonId: 'host' } });
  const { result, logger } = await preflight({ env: REGULAR, socketMounted: false, probe });
  assertEqual(result.liveRestoreOk, false, 'liveRestoreOk=false');
  assertEqual(result.liveRestore.task, false, 'task daemon reported as false');
  assertEqual(result.warnings.length, 1, 'exactly one warning');
  const w = result.warnings[0] || '';
  assertIncludes(w, 'live-restore DISABLED', 'warning names the setting');
  assertIncludes(w, 'systemctl reload docker', 'warning gives the reload command');
  assertIncludes(w, "NEVER 'systemctl restart docker'", 'warning forbids restart while containers run');
  assertIncludes(w, '"live-restore": true', 'warning gives the daemon.json key');
  assertIncludes(w, '/etc/docker/daemon.json', 'warning names the config file');
  assertIncludes(w, 'enable-docker-live-restore.sh', 'warning links the helper script');
  assertIncludes(w, "docker info -f '{{.LiveRestoreEnabled}}'", 'warning gives the verification command');
  assertIncludes(w, 'in-memory solve queue', 'warning explains the queue is lost too');
  assertIncludes(w, '#2900', 'warning cites the issue');
  assertEqual(logger.warns.length, 1, 'warning is routed to logger.warn');
  assertEqual(probe.calls, [null], 'host socket is not probed when it is not mounted');
}

console.log('\n--- live-restore on → no warning, confirmation logged ---');

{
  const { result, logger } = await preflight({ env: REGULAR, socketMounted: false, probe: fakeDaemons({ task: { enabled: true, daemonId: 'host' } }) });
  assertEqual(result.liveRestoreOk, true, 'liveRestoreOk=true');
  assertEqual(result.warnings.length, 0, 'no warning');
  assertEqual(
    logger.logs.some(l => l.includes('live-restore is enabled')),
    true,
    'confirmation is logged'
  );
}

console.log('\n--- DinD with host socket: HOST daemon off → warning; nested only logged ---');

{
  const probe = fakeDaemons({ task: { enabled: false, daemonId: 'nested' }, host: { enabled: false, daemonId: 'host' } });
  const { result, logger } = await preflight({ env: DIND, socketMounted: true, probe });
  assertEqual(probe.calls, [null, HOST_SOCK], 'probes the default daemon and the mounted host socket');
  assertEqual(result.liveRestore, { task: false, host: false, sameDaemon: false, taskDaemonNested: true }, 'reports both daemons');
  assertEqual(result.warnings.length, 1, 'exactly one warning (the host daemon)');
  assertIncludes(result.warnings[0], 'HOST Docker daemon', 'warning targets the host daemon');
  assertIncludes(result.warnings[0], "this bot's own container", 'warning explains the bot container dies');
  assertEqual(
    logger.logs.some(l => l.includes('nested DinD Docker daemon has live-restore disabled')),
    true,
    'nested daemon setting is logged, not warned'
  );
}

{
  const probe = fakeDaemons({ task: { enabled: false, daemonId: 'nested' }, host: { enabled: true, daemonId: 'host' } });
  const { result } = await preflight({ env: DIND, socketMounted: true, probe });
  assertEqual(result.warnings.length, 0, 'host on + nested off → no warning');
  assertEqual(result.liveRestoreOk, true, 'host on + nested off → liveRestoreOk');
}

console.log('\n--- Docker-outside-of-Docker: same daemon on both paths → one warning ---');

{
  const probe = fakeDaemons({ task: { enabled: false, daemonId: 'host' }, host: { enabled: false, daemonId: 'host' } });
  const { result } = await preflight({ env: DIND, socketMounted: true, probe });
  assertEqual(result.liveRestore.sameDaemon, true, 'same daemon detected by ID');
  assertEqual(result.liveRestore.taskDaemonNested, false, 'task daemon is not nested');
  assertEqual(result.warnings.length, 1, 'warning is not duplicated');
}

{
  const probe = fakeDaemons({ task: { enabled: false, daemonId: 'host' } });
  const { result } = await preflight({ env: { ...DIND, DIND_SKIP_DAEMON: '1' }, socketMounted: false, probe });
  assertEqual(result.liveRestore.taskDaemonNested, false, 'DIND_SKIP_DAEMON=1 means the CLI talks to the host daemon');
  assertEqual(result.warnings.length, 1, 'DooD without the extra socket still warns');
}

{
  // Incident-style wiring: DinD image, but the CLI is pointed at the host
  // daemon through DOCKER_HOST, so tasks die with a host dockerd restart.
  const probe = fakeDaemons({ task: { enabled: false, daemonId: 'host' } });
  const { result } = await preflight({ env: { ...DIND, DOCKER_HOST: 'unix:///var/run/docker-host.sock' }, socketMounted: false, probe });
  assertEqual(result.liveRestore.taskDaemonNested, false, 'DOCKER_HOST pointing elsewhere means the task daemon is not the nested one');
  assertEqual(result.warnings.length, 1, 'DinD with DOCKER_HOST at the host daemon still warns');
}

console.log('\n--- DinD without host socket: host unknown → note, no warning ---');

{
  const { result, logger } = await preflight({ env: DIND, socketMounted: false, probe: fakeDaemons({ task: { enabled: false, daemonId: 'nested' } }) });
  assertEqual(result.warnings.length, 0, 'no warning for the nested daemon');
  assertEqual(result.liveRestore.host, null, 'host daemon unknown');
  assertEqual(
    logger.logs.some(l => l.includes('Could not check live-restore on the HOST') && l.includes('no host socket')),
    true,
    'tells the operator to check the host by hand'
  );
}

{
  const { logger } = await preflight({ env: DIND, socketMounted: true, probe: fakeDaemons({ task: { enabled: false, daemonId: 'nested' }, host: null }) });
  assertEqual(
    logger.logs.some(l => l.includes('did not answer')),
    true,
    'unreachable mounted socket is reported as such'
  );
}

console.log('\n--- Unknown daemon state never warns or throws ---');

{
  const { result } = await preflight({ env: REGULAR, socketMounted: false, probe: fakeDaemons() });
  assertEqual(result.warnings.length, 0, 'null probes → no warning');
  assertEqual(result.liveRestoreOk, true, 'null probes → liveRestoreOk');
}

{
  const assessed = await assessDockerLiveRestore({ sock: HOST_SOCK, socketMounted: false, isDind: false, env: {}, checkLiveRestore: fakeDaemons({ task: { enabled: false } }) });
  assertEqual(assessed.warnings.length, 1, 'assessDockerLiveRestore works without daemon IDs');
}

assertIncludes(buildLiveRestoreRemediation(), 'sudo bash', 'remediation is a copy-pasteable command');

console.log('\n--- scripts/enable-docker-live-restore.sh ---');

const bashSyntax = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
assertEqual(bashSyntax.status, 0, 'script passes bash -n');

const hasJsonTool = ['python3', 'jq'].some(tool => spawnSync('sh', ['-c', `command -v ${tool}`]).status === 0);
if (!hasJsonTool) {
  console.log('  SKIP: neither python3 nor jq is installed; script behaviour not exercised');
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-mind-2900-'));
  const run = (args, env = {}) => spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  try {
    const fresh = path.join(dir, 'missing', 'daemon.json');
    const created = run(['--config', fresh, '--no-reload']);
    assertEqual(created.status, 0, 'missing daemon.json: exit 0');
    assertEqual(JSON.parse(fs.readFileSync(fresh, 'utf8')), { 'live-restore': true }, 'missing daemon.json: created with only live-restore');

    const existing = path.join(dir, 'daemon.json');
    fs.writeFileSync(existing, JSON.stringify({ 'log-driver': 'json-file', 'log-opts': { 'max-size': '10m' }, 'live-restore': false }));
    const merged = run(['--config', existing, '--no-reload']);
    assertEqual(merged.status, 0, 'existing daemon.json: exit 0');
    assertEqual(JSON.parse(fs.readFileSync(existing, 'utf8')), { 'log-driver': 'json-file', 'log-opts': { 'max-size': '10m' }, 'live-restore': true }, 'existing daemon.json: other keys kept, live-restore set');
    assertEqual(
      fs.readdirSync(dir).some(f => f.startsWith('daemon.json.bak-')),
      true,
      'existing daemon.json: backup written'
    );
    assertIncludes(merged.stdout, 'NOT restart', '--no-reload tells the operator to reload, not restart');

    const again = run(['--config', existing, '--no-reload']);
    assertIncludes(again.stdout, 'already has', 'second run is a no-op');

    const empty = path.join(dir, 'empty.json');
    fs.writeFileSync(empty, '  \n');
    assertEqual(run(['--config', empty, '--no-reload']).status, 0, 'blank daemon.json is treated as {}');
    assertEqual(JSON.parse(fs.readFileSync(empty, 'utf8')), { 'live-restore': true }, 'blank daemon.json gets live-restore');

    const invalid = path.join(dir, 'invalid.json');
    fs.writeFileSync(invalid, '{ "log-driver": "json-file", }');
    const bad = run(['--config', invalid, '--no-reload']);
    assertEqual(bad.status, 1, 'invalid JSON: exit 1');
    assertEqual(fs.readFileSync(invalid, 'utf8'), '{ "log-driver": "json-file", }', 'invalid JSON: file left untouched');
    assertIncludes(bad.stderr, 'leaving it untouched', 'invalid JSON: warns');

    const array = path.join(dir, 'array.json');
    fs.writeFileSync(array, '[]');
    assertEqual(run(['--config', array, '--no-reload']).status, 1, 'non-object JSON: exit 1');
    assertEqual(fs.readFileSync(array, 'utf8'), '[]', 'non-object JSON: file left untouched');

    const dry = path.join(dir, 'dry.json');
    fs.writeFileSync(dry, '{"debug": true}');
    const dryRun = run(['--config', dry, '--dry-run']);
    assertEqual(dryRun.status, 0, '--dry-run: exit 0');
    assertEqual(fs.readFileSync(dry, 'utf8'), '{"debug": true}', '--dry-run: file unchanged');
    assertIncludes(dryRun.stdout, '"live-restore": true', '--dry-run: prints the merged config');

    // A fake docker that already reports live-restore=true: the script must
    // exit before touching daemon.json (covers a dockerd started with the
    // --live-restore flag, where adding the key too breaks the next start).
    const fakeDocker = path.join(dir, 'fake-docker');
    fs.writeFileSync(fakeDocker, '#!/bin/sh\necho true daemon-1\n', { mode: 0o755 });
    const untouched = path.join(dir, 'untouched.json');
    const already = run(['--config', untouched], { DOCKER: fakeDocker });
    assertEqual(already.status, 0, 'already enabled on the daemon: exit 0');
    assertIncludes(already.stdout, 'already enabled', 'already enabled on the daemon: says so');
    assertEqual(fs.existsSync(untouched), false, 'already enabled on the daemon: daemon.json not written');

    // An unreachable daemon renders the template as "false" and exits 1: the
    // script must stop instead of editing daemon.json and reloading blindly.
    const deadDocker = path.join(dir, 'dead-docker');
    fs.writeFileSync(deadDocker, '#!/bin/sh\necho false\nexit 1\n', { mode: 0o755 });
    const unreachable = run(['--config', untouched], { DOCKER: deadDocker });
    assertEqual(unreachable.status, 1, 'unreachable daemon: exit 1');
    assertIncludes(unreachable.stderr, 'cannot reach the Docker daemon', 'unreachable daemon: says so');
    assertEqual(fs.existsSync(untouched), false, 'unreachable daemon: daemon.json not written');

    // Docker CLI 27 and older exit 0 for an unreachable daemon; the empty
    // daemon ID still marks the report as unknown.
    const oldDeadDocker = path.join(dir, 'old-dead-docker');
    fs.writeFileSync(oldDeadDocker, '#!/bin/sh\necho "false "\n', { mode: 0o755 });
    const oldUnreachable = run(['--config', untouched], { DOCKER: oldDeadDocker });
    assertEqual(oldUnreachable.status, 1, 'unreachable daemon, old CLI (exit 0): exit 1');
    assertIncludes(oldUnreachable.stderr, 'cannot reach the Docker daemon', 'unreachable daemon, old CLI: says so');
    assertEqual(fs.existsSync(untouched), false, 'unreachable daemon, old CLI: daemon.json not written');

    assertEqual(run(['--bogus']).status, 2, 'unknown option: exit 2');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${failed === 0 ? '✅' : '❌'} issue-2900 docker live-restore: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
