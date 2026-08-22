#!/usr/bin/env node
/**
 * Regression test for the `hive-mind-router` sidecar lifecycle (issue #2164).
 *
 * The whole feature rests on a handful of properties that are easy to break and
 * invisible when they are: the container must keep an outbound route, the
 * credential mounts must be writable, the signing secret must never reach a
 * task, every task must get its own token, and the container must go away once
 * nothing needs it. Each is asserted here against a fake `docker`, so the suite
 * runs without a daemon.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2164
 */

import { acquireRouterSidecar, buildRouterSidecarRunArgs, decodeRouterTokenId, getRouterCredentialMounts, isRouterSidecarEnabled, releaseRouterSidecar, resolveRouterSidecarImage, resolveRouterTokenSecret } from '../src/router-sidecar.lib.mjs';
import { acquireRouterForTask, attachRouterTaskContainer, releaseRouterForTask } from '../src/router-task-isolation.lib.mjs';
import { runRouterMaintenanceTick, startRouterMaintenance, stopIdleRouterSidecar } from '../src/router-maintenance.lib.mjs';
import { ROUTER_DATA_MOUNT, ROUTER_DATA_VOLUME_NAME, ROUTER_SIDECAR_CONTAINER_NAME, ROUTER_SIDECAR_NETWORK_ALIAS, ROUTER_SIDECAR_NETWORK_NAME } from '../src/router-isolation.lib.mjs';

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
  if (actual === expected) pass(label);
  else fail(label, expected, actual);
}

// The signing secret mints subscription access, so assertions about it compare
// first and report a boolean: a failing test in CI prints its label, never the
// secret it was checking (CodeQL js/clear-text-logging).
const holds = (actual, expected) => actual === expected;

console.log('\n=== issue #2164: router sidecar run arguments ===');

const credentialMounts = [
  { home: '.claude', target: '/data/claude', envVar: 'CLAUDE_CODE_HOME', source: '/home/box/.claude' },
  { home: '.codex', target: '/data/codex', envVar: 'CODEX_HOME', source: '/home/box/.codex' },
];
const runArgs = buildRouterSidecarRunArgs({ image: 'ghcr.io/link-assistant/router:latest', tokenSecret: 'deadbeef', credentialMounts, env: {} });

const flagValue = (args, flag, prefix) => args.filter((value, index) => args[index - 1] === flag && value.startsWith(prefix)).map(value => value.slice(prefix.length));

// The sidecar is the one container that must reach api.anthropic.com. A
// `--network` here would replace its default bridge with our internal network
// and silently leave it with no upstream at all.
assertEqual(runArgs.includes('--network'), false, 'the sidecar is not launched onto the internal network, so it keeps its outbound bridge');
assertEqual(runArgs.includes('-p') || runArgs.includes('--publish'), false, 'no port is published to the host');
assertEqual(runArgs.slice(0, 2).join(' '), 'run --detach', 'the container is started detached');
assertEqual(flagValue(runArgs, '--name', '').join(''), ROUTER_SIDECAR_CONTAINER_NAME, 'the container carries the stable reconciliation name');
assertEqual(holds(flagValue(runArgs, '--env', 'TOKEN_SECRET=').join(''), 'deadbeef'), true, 'the signing secret is passed to the router');
assertEqual(flagValue(runArgs, '--env', 'DATA_DIR=').join(''), ROUTER_DATA_MOUNT, 'DATA_DIR points at the mounted volume so request logs persist (R8)');
assertEqual(
  runArgs.some((value, index) => runArgs[index - 1] === '--volume' && value === `${ROUTER_DATA_VOLUME_NAME}:${ROUTER_DATA_MOUNT}`),
  true,
  'the audit volume is mounted by name (R8)'
);

// Vendor OAuth credentials are refresh tokens: the CLI rewrites them when they
// expire, so a :ro mount would discard every rotation and leave the operator
// with credentials that stop working.
const credentialVolumes = runArgs.filter((value, index) => runArgs[index - 1] === '--volume' && value.startsWith('/home/box/'));
assertEqual(credentialVolumes.length, 2, 'every discovered credential directory is mounted into the sidecar (R3)');
assertEqual(
  credentialVolumes.every(volume => !volume.endsWith(':ro')),
  true,
  'credential mounts are writable, so refreshed tokens survive a restart'
);
assertEqual(flagValue(runArgs, '--env', 'CLAUDE_CODE_HOME=').join(''), '/data/claude', 'the router is told where each credential home landed');
assertEqual(flagValue(runArgs, '--env', 'CODEX_HOME=').join(''), '/data/codex', 'the codex credential home is wired too');
assertEqual(runArgs.slice(-5).join(' '), 'serve --host 0.0.0.0 --port 8080', 'the router is started in serve mode, listening on every interface of the internal network');

console.log('\n=== issue #2164: credential discovery ===');

const discovered = getRouterCredentialMounts({ homeDir: '/home/box', existsSync: target => target.endsWith('.claude') || target.endsWith('.qwen') });
assertEqual(discovered.map(mount => mount.home).join(','), '.claude,.qwen', 'only credential directories that exist on the host are mounted');

console.log('\n=== issue #2164: token identity ===');

const claims = Buffer.from(JSON.stringify({ sub: 'b3f0e1d2-0000-4000-8000-000000000001', label: 'hive-mind:s1' })).toString('base64url');
assertEqual(decodeRouterTokenId(`la_sk_header.${claims}.signature`), 'b3f0e1d2-0000-4000-8000-000000000001', 'the token id is read from the JWT subject, without needing the signing secret');
assertEqual(decodeRouterTokenId('sk-ant-not-a-router-token'), null, 'a non-router credential yields no id rather than a wrong one');
assertEqual(decodeRouterTokenId('la_sk_only-one-segment'), null, 'a malformed token yields no id');

console.log('\n=== issue #2164: signing secret ===');

const generated = resolveRouterTokenSecret({ state: {}, env: {}, generate: () => 'fresh-secret' });
assertEqual(holds(generated.secret, 'fresh-secret'), true, 'a first run generates a secret');
assertEqual(generated.generated, true, 'and reports that it did');
assertEqual(holds(resolveRouterTokenSecret({ state: { tokenSecret: 'kept' }, env: {}, generate: () => 'fresh' }).secret, 'kept'), true, 'a restart reuses the stored secret, so tokens already handed to running tasks stay valid');
assertEqual(holds(resolveRouterTokenSecret({ state: { tokenSecret: 'kept' }, env: { HIVE_MIND_ROUTER_TOKEN_SECRET: 'operator' }, generate: () => 'fresh' }).secret, 'operator'), true, 'an operator-supplied secret wins');

console.log('\n=== issue #2164: sidecar toggles ===');

assertEqual(isRouterSidecarEnabled({}), true, 'Hive Mind manages the router container by default');
assertEqual(isRouterSidecarEnabled({ HIVE_MIND_ROUTER_SIDECAR: '0' }), false, 'an operator can opt out of container management');
assertEqual(resolveRouterSidecarImage({}), 'ghcr.io/link-assistant/router:latest', 'the published image is the default');
assertEqual(resolveRouterSidecarImage({ HIVE_MIND_ROUTER_IMAGE: 'local/router:dev' }), 'local/router:dev', 'the image can be pinned or replaced');

console.log('\n=== issue #2164: acquire and release against a fake docker ===');

/**
 * A fake `docker` that records every invocation. Container state is a single
 * boolean because the assertions here are about the command sequence, not about
 * reproducing Docker's own semantics.
 */
const makeDocker = ({ tokenSubject = 'aaaaaaaa-0000-4000-8000-00000000000a', liveContainers = [] } = {}) => {
  const calls = [];
  let containerRunning = false;
  const run = async (binary, args) => {
    calls.push(args.join(' '));
    const [verb, second] = args;
    if (verb === 'run') {
      containerRunning = true;
      return { stdout: 'container-id\n' };
    }
    if (verb === 'inspect') {
      if (args[1] === ROUTER_SIDECAR_CONTAINER_NAME) {
        if (!containerRunning) throw new Error('No such object');
        return { stdout: `true|ghcr.io/link-assistant/router:latest|sha256:abc\n` };
      }
      // Anything else inspected is a task container; only the ones the test
      // declares alive exist, so a lease can be made stale on purpose.
      if (liveContainers.includes(args[1])) return { stdout: 'true|task-image|sha256:task\n' };
      throw new Error('No such object');
    }
    if (verb === 'image') return { stdout: 'sha256:abc\n' };
    if (verb === 'network' && second === 'inspect') return { stdout: 'true|1\n' };
    if (verb === 'volume' && second === 'inspect') return { stdout: 'ok\n' };
    if (verb === 'exec' && args.includes('bun')) return { stdout: '' };
    if (verb === 'exec' && args.includes('issue')) {
      const payload = Buffer.from(JSON.stringify({ sub: tokenSubject })).toString('base64url');
      return { stdout: `la_sk_h.${payload}.s\n` };
    }
    if (verb === 'stop' || verb === 'rm') {
      containerRunning = false;
      return { stdout: '' };
    }
    return { stdout: '' };
  };
  return { calls, run, isRunning: () => containerRunning };
};

const stateDir = `/tmp/hive-mind-test-2164-${process.pid}`;
const testEnv = { HIVE_MIND_STATE_DIR: stateDir, HOME: stateDir };
const docker = makeDocker();
const acquired = await acquireRouterSidecar({
  sessionId: 'session-one',
  env: testEnv,
  run: docker.run,
  homeDir: '/home/box',
  existsSync: target => target.endsWith('.claude'),
  healthAttempts: 1,
  sleepImpl: async () => {},
});

assertEqual(acquired.error, null, 'the sidecar comes up against a healthy fake docker');
assertEqual(acquired.baseUrl, `http://${ROUTER_SIDECAR_NETWORK_ALIAS}:8080`, 'the task is pointed at the internal alias');
assertEqual(acquired.tokenId, 'aaaaaaaa-0000-4000-8000-00000000000a', 'the lease records the id of the token it minted');
assertEqual(acquired.leaseCount, 1, 'the acquiring task holds the only lease');
assertEqual(
  docker.calls.some(call => call === `network connect --alias ${ROUTER_SIDECAR_NETWORK_ALIAS} ${ROUTER_SIDECAR_NETWORK_NAME} ${ROUTER_SIDECAR_CONTAINER_NAME}`),
  true,
  'the internal network is attached after creation, not at run time'
);
assertEqual(
  docker.calls.some(call => call.includes('tokens issue') && call.includes('hive-mind:session-one')),
  true,
  'the token is labelled with the session that owns it, so its log can be found later (R6)'
);

// The secret signs tokens held by live tasks; it must be on disk but never in a
// task's environment, and never world-readable.
const { statSync } = await import('node:fs');
const stateMode = statSync(`${stateDir}/router-sidecar.json`).mode & 0o777;
assertEqual(stateMode, 0o600, 'the state file holding TOKEN_SECRET is owner-only');

const released = await releaseRouterSidecar({ sessionId: 'session-one', env: testEnv, run: docker.run });
assertEqual(released.leaseCount, 0, 'releasing the last task leaves no leases');
assertEqual(released.stopped, true, 'and stops the sidecar, so it only runs while a task needs it (R5)');
assertEqual(
  docker.calls.some(call => call === `exec ${ROUTER_SIDECAR_CONTAINER_NAME} router tokens revoke aaaaaaaa-0000-4000-8000-00000000000a`),
  true,
  "the finishing task's token is revoked rather than left live until its TTL"
);
assertEqual(
  docker.calls.some(call => call.startsWith(`volume rm ${ROUTER_DATA_VOLUME_NAME}`)),
  false,
  'the audit volume is never removed (R8)'
);

const { rmSync } = await import('node:fs');
rmSync(stateDir, { recursive: true, force: true });

console.log('\n=== issue #2164: launch policy fails closed ===');

const withoutFlag = await acquireRouterForTask({ backend: 'docker', useRouter: false, sessionId: 's', env: {} });
assertEqual(withoutFlag.router, null, 'a default run does not touch the router');
assertEqual(withoutFlag.error, null, 'and is not an error');

const notDocker = await acquireRouterForTask({ backend: 'screen', useRouter: true, sessionId: 's', env: {} });
assertEqual(notDocker.router, null, 'router isolation only applies to the docker backend');

const refused = await acquireRouterForTask({ backend: 'docker', useRouter: true, sessionId: 's', env: {}, log: async () => {}, acquire: async () => ({ error: 'daemon unreachable' }) });
assertEqual(refused.router, null, 'an unavailable router yields no router handle');
assertEqual(typeof refused.error === 'string' && refused.error.includes('daemon unreachable'), true, 'and the launch is refused with the underlying reason, not silently given the credentials it was told to withhold');

const threw = await acquireRouterForTask({
  backend: 'docker',
  useRouter: true,
  sessionId: 's',
  env: {},
  log: async () => {},
  acquire: async () => {
    throw new Error('boom');
  },
});
assertEqual(typeof threw.error === 'string' && threw.error.includes('boom'), true, 'a thrown acquire is reported rather than crashing the launch');

const attachFailed = await attachRouterTaskContainer({ router: { token: 't' }, sessionId: 's', attach: async () => ({ attached: false, error: 'no such container' }) });
assertEqual(attachFailed, 'no such container', 'a failed network attach is reported so the caller can stop the container');
assertEqual(await attachRouterTaskContainer({ router: { token: 't', external: true }, sessionId: 's' }), null, 'an external router has no network of ours to join');
assertEqual(await releaseRouterForTask({ router: null, sessionId: 's' }), null, 'releasing a run that never routed does nothing');

console.log('\n=== issue #2164: idle maintenance stops a sidecar nothing is using (R5) ===');

/** Acquire one lease against a fresh fake docker and state dir. */
const setUpLease = async ({ sessionId, dir, live = [], acquiredAt = null }) => {
  const fake = makeDocker({ liveContainers: live });
  const env = { HIVE_MIND_STATE_DIR: dir, HOME: dir };
  await acquireRouterSidecar({
    sessionId,
    env,
    run: fake.run,
    homeDir: '/home/box',
    existsSync: target => target.endsWith('.claude'),
    healthAttempts: 1,
    sleepImpl: async () => {},
    ...(acquiredAt ? { now: () => acquiredAt } : {}),
  });
  fake.calls.length = 0;
  return { fake, env };
};

// A task container that never appeared and is now past the launch grace is a
// task that died: its lease must not keep the subscription proxy alive forever.
const staleDir = `/tmp/hive-mind-test-2164-stale-${process.pid}`;
const stale = await setUpLease({ sessionId: 'session-crashed', dir: staleDir, acquiredAt: new Date(Date.now() - 3 * 60 * 60 * 1000) });
const staleOutcome = await stopIdleRouterSidecar({ env: stale.env, run: stale.fake.run });
assertEqual(staleOutcome.leaseCount, 0, 'a lease whose task container is gone is dropped');
assertEqual(staleOutcome.stopped, true, 'and the sidecar it was holding up is stopped');
assertEqual(
  stale.fake.calls.some(call => call === `exec ${ROUTER_SIDECAR_CONTAINER_NAME} router tokens revoke aaaaaaaa-0000-4000-8000-00000000000a`),
  true,
  "the dead task's token is revoked, not left usable for the rest of its TTL"
);
assertEqual(
  stale.fake.calls.some(call => call.startsWith('volume rm')),
  false,
  'the audit volume survives the teardown (R8)'
);

// The mirror image: a task that is still running must not have the router
// pulled out from under it.
const liveDir = `/tmp/hive-mind-test-2164-live-${process.pid}`;
const liveLease = await setUpLease({ sessionId: 'session-live', dir: liveDir, live: ['session-live'], acquiredAt: new Date(Date.now() - 3 * 60 * 60 * 1000) });
const liveOutcome = await stopIdleRouterSidecar({ env: liveLease.env, run: liveLease.fake.run });
assertEqual(liveOutcome.leaseCount, 1, 'a lease whose task container is still running is kept');
assertEqual(liveOutcome.stopped, false, 'and the router keeps serving it');
assertEqual(
  liveLease.fake.calls.some(call => call === `stop ${ROUTER_SIDECAR_CONTAINER_NAME}`),
  false,
  'no stop is even attempted while a task holds a lease'
);

assertEqual((await stopIdleRouterSidecar({ env: { HIVE_MIND_STATE_DIR: liveDir, HIVE_MIND_ROUTER_SIDECAR: '0' }, run: liveLease.fake.run })).skipped !== undefined, true, 'an operator-managed router is left alone');

// Maintenance runs inside the bot: a broken tick must be reported, never thrown.
const messages = [];
const tick = await runRouterMaintenanceTick({
  env: {},
  log: async message => messages.push(message),
  stopIdle: async () => {
    throw new Error('docker daemon is not running');
  },
});
assertEqual(tick.errors.length, 1, 'a failing tick collects the failure instead of rejecting');
assertEqual(
  messages.some(message => message.includes('docker daemon is not running')),
  true,
  'and says what went wrong, so an idle router is never silently left running'
);

let ticks = 0;
const timerHandle = { unref: () => {} };
const maintenance = startRouterMaintenance({
  intervalMs: 60_000,
  runTick: async () => {
    ticks += 1;
  },
  setIntervalImpl: () => timerHandle,
  clearIntervalImpl: handle => {
    if (handle === timerHandle) ticks = -1;
  },
});
await new Promise(resolve => setImmediate(resolve));
assertEqual(ticks, 1, 'the loop reconciles immediately rather than waiting a full interval after a bot restart');
maintenance.stop();
assertEqual(ticks, -1, 'and the timer is cleared on shutdown');

rmSync(staleDir, { recursive: true, force: true });
rmSync(liveDir, { recursive: true, force: true });

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
