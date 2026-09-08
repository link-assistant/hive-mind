#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #2190: with `--use-router --isolation docker` the router is the only
 * way a task may authenticate. Three mechanisms make that true and are
 * tested here against fakes (the real-Docker probe for the first lives in
 * experiments/issue-2190/probe-router-bind.mjs, its log in the case study):
 *
 *   1. The sidecar is created on the internal network and binds that address
 *      only, so nothing outside the internal network — not the host, not a
 *      bridge container — can reach it. The upstream bridge is connected
 *      afterwards and never bound. A router left over from before this change
 *      is recognised by its primary network and replaced.
 *   2. A task's token is revoked the moment its container exits, whatever the
 *      reason, through a `docker wait` watcher; TTL and the maintenance tick
 *      remain the backstops.
 *   3. Inside the container an auth guard watches every place a vendor or
 *      GitHub credential could be written and stops the session with exit
 *      code 77 the moment one appears: a routed task uses its router token and
 *      no other way of auth.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireRouterSidecar, buildRouterSidecarRunArgs, readRouterSidecarPrimaryNetwork, resolveRouterUpstreamNetwork, ROUTER_SIDECAR_BIND_COMMAND, ROUTER_SIDECAR_UPSTREAM_NETWORK } from '../src/router-sidecar.lib.mjs';
import { watchRouterTaskContainer } from '../src/router-task-isolation.lib.mjs';
import { ROUTER_SIDECAR_CONTAINER_NAME, ROUTER_SIDECAR_IMAGE, ROUTER_SIDECAR_NETWORK_ALIAS, ROUTER_SIDECAR_NETWORK_NAME, ROUTER_SIDECAR_PORT } from '../src/router-isolation.lib.mjs';
import { CLAUDE_SETTINGS_AUTH_ENV_KEYS, DEFAULT_ROUTER_AUTH_GUARD_INTERVAL_MS, describeRouterAuthSurface, EXIT_CODE_ROUTER_AUTH_VIOLATION, formatRouterAuthViolation, inspectRouterAuthSurface, isRouterAuthGuardRequired, readCodexProviderPin, resolveRouterAuthGuardIntervalMs, ROUTER_CODEX_PROVIDER_ID, startRouterAuthGuard } from '../src/router-auth-guard.lib.mjs';
import { EXIT_CODE_INSUFFICIENT_DISK_SPACE } from '../src/disk-guard.lib.mjs';

let passed = 0;
let failed = 0;
const pass = label => {
  console.log(`  PASS: ${label}`);
  passed++;
};
const fail = (label, expected, actual) => {
  console.error(`  FAIL: ${label}`);
  if (expected !== undefined) console.error(`     expected: ${JSON.stringify(expected)}`);
  if (actual !== undefined) console.error(`     actual:   ${JSON.stringify(actual)}`);
  failed++;
};
const assertEqual = (actual, expected, label) => (actual === expected ? pass(label) : fail(label, expected, actual));
// Compare first, print a boolean: a failing run must never print the token or
// secret it was checking (CodeQL js/clear-text-logging).
const carries = (actual, expected) => String(actual ?? '').includes(expected);
const flagValue = (args, flag) => args.filter((value, index) => args[index - 1] === flag);

console.log('\n=== issue #2190: the router binds the internal network only ===');

const credentialMounts = [{ home: '.claude', target: '/data/claude', envVar: 'CLAUDE_CODE_HOME', source: '/home/box/.claude' }];
const runArgs = buildRouterSidecarRunArgs({ image: ROUTER_SIDECAR_IMAGE, tokenSecret: 'deadbeef', credentialMounts, env: {} });

assertEqual(flagValue(runArgs, '--network').join(''), ROUTER_SIDECAR_NETWORK_NAME, 'the sidecar is created on the internal network, so that is the only address it has at start-up');
assertEqual(flagValue(runArgs, '--network-alias').join(''), ROUTER_SIDECAR_NETWORK_ALIAS, 'with the alias tasks use, which the bind script resolves to find that address');
assertEqual(flagValue(runArgs, '--entrypoint').join(''), 'sh', 'the router image is entered through sh, because router serve has no bind-to-network option yet');
assertEqual(runArgs.at(-2), '-c', 'sh is handed the bind script as its command');
assertEqual(runArgs.at(-1), ROUTER_SIDECAR_BIND_COMMAND, 'and that script is the constant the real-Docker probe validates');
assertEqual(runArgs.includes('-p') || runArgs.includes('--publish'), false, 'no port is published to the host');
assertEqual(carries(ROUTER_SIDECAR_BIND_COMMAND, `getent hosts ${ROUTER_SIDECAR_NETWORK_ALIAS}`), true, 'the script looks up its own internal address by alias');
assertEqual(carries(ROUTER_SIDECAR_BIND_COMMAND, `exec router serve --host "$addr" --port ${ROUTER_SIDECAR_PORT}`), true, 'and binds that address alone on the port gh expects api.github.com on');
assertEqual(carries(ROUTER_SIDECAR_BIND_COMMAND, 'refusing to bind 0.0.0.0'), true, 'when the alias does not resolve the script refuses rather than fall back to every interface');
assertEqual(carries(ROUTER_SIDECAR_BIND_COMMAND, '--host 0.0.0.0'), false, 'so no branch of it ever asks for 0.0.0.0');
assertEqual(carries(ROUTER_SIDECAR_BIND_COMMAND, 'exit 1'), true, 'and that refusal ends the container, which acquire reports as unhealthy');

assertEqual(resolveRouterUpstreamNetwork({}), ROUTER_SIDECAR_UPSTREAM_NETWORK, 'the upstream network defaults to the docker bridge');
assertEqual(ROUTER_SIDECAR_UPSTREAM_NETWORK, 'bridge', 'which is the network with a route to the vendor APIs');
assertEqual(resolveRouterUpstreamNetwork({ HIVE_MIND_ROUTER_UPSTREAM_NETWORK: 'corp-egress' }), 'corp-egress', 'an operator may name another network with egress');
assertEqual(resolveRouterUpstreamNetwork({ HIVE_MIND_ROUTER_UPSTREAM_NETWORK: ROUTER_SIDECAR_NETWORK_NAME }), 'bridge', 'but naming the internal network is ignored: it has no egress and would leave the router with no upstream at all');

// A fake docker for acquire. `networkMode` is what `inspect --format
// {{.HostConfig.NetworkMode}}` answers, i.e. the network the container was
// created on; `bridgeConnect` decides whether attaching the upstream works.
const makeDocker = ({ networkMode = ROUTER_SIDECAR_NETWORK_NAME, running = false, bridgeConnect = 'ok' } = {}) => {
  const calls = [];
  let containerRunning = running;
  const run = async (binary, args) => {
    calls.push(args.join(' '));
    const [verb, second] = args;
    if (verb === 'run') {
      containerRunning = true;
      return { stdout: 'container-id\n' };
    }
    if (verb === 'inspect') {
      if (!containerRunning) throw new Error('No such object');
      if (args.includes('{{.HostConfig.NetworkMode}}')) return { stdout: `${networkMode}\n` };
      return { stdout: 'true|ghcr.io/link-assistant/router:latest|sha256:abc\n' };
    }
    if (verb === 'image') return { stdout: 'sha256:abc\n' };
    if (verb === 'network' && second === 'inspect') return { stdout: 'true|1\n' };
    if (verb === 'network' && second === 'connect' && args.includes('bridge')) {
      if (bridgeConnect === 'already') throw new Error(`endpoint with name ${ROUTER_SIDECAR_CONTAINER_NAME} already exists in network bridge`);
      if (bridgeConnect === 'fail') throw new Error('network bridge not found');
      return { stdout: '' };
    }
    if (verb === 'volume' && second === 'inspect') return { stdout: 'ok\n' };
    if (verb === 'exec' && args.includes('bun')) return { stdout: '' };
    if (verb === 'exec' && args.includes('issue')) return { stdout: `la_sk_h.${Buffer.from(JSON.stringify({ sub: 'bbbbbbbb-0000-4000-8000-00000000000b' })).toString('base64url')}.s\n` };
    if (verb === 'stop' || verb === 'rm') {
      containerRunning = false;
      return { stdout: '' };
    }
    return { stdout: '' };
  };
  return { calls, run, isRunning: () => containerRunning };
};

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-mind-test-2190-'));
const testEnv = { HIVE_MIND_STATE_DIR: stateDir, HOME: stateDir };
const acquireWith = (docker, extra = {}) => acquireRouterSidecar({ sessionId: extra.sessionId || 'session-2190', env: testEnv, run: docker.run, homeDir: '/home/box', existsSync: target => target.endsWith('.claude'), healthAttempts: 1, sleepImpl: async () => {}, ...extra });
const releaseWith = async (docker, sessionId = 'session-2190') => {
  const { releaseRouterSidecar } = await import('../src/router-sidecar.lib.mjs');
  return releaseRouterSidecar({ sessionId, env: testEnv, run: docker.run });
};

{
  const docker = makeDocker();
  const acquired = await acquireWith(docker);
  assertEqual(acquired.error, null, 'a fresh sidecar comes up against a healthy fake docker');
  const runIndex = docker.calls.findIndex(call => call.startsWith('run '));
  const bridgeIndex = docker.calls.findIndex(call => call === `network connect bridge ${ROUTER_SIDECAR_CONTAINER_NAME}`);
  const healthIndex = docker.calls.findIndex(call => call.includes('bun') && call.includes('/health'));
  assertEqual(bridgeIndex > runIndex, true, 'the upstream bridge is connected after the container was created on the internal network');
  assertEqual(healthIndex > bridgeIndex, true, 'and before health is probed, so an unhealthy verdict is never caused by a missing upstream');
  assertEqual(
    docker.calls.some(call => call.includes('bun') && call.includes(`https://${ROUTER_SIDECAR_NETWORK_ALIAS}:${ROUTER_SIDECAR_PORT}/health`)),
    true,
    'health is probed through the internal alias, the only address the router now answers on'
  );
  assertEqual(
    docker.calls.some(call => call.includes('127.0.0.1')),
    false,
    'loopback is never probed: the router does not bind it any more'
  );
  assertEqual(docker.calls.filter(call => call.startsWith('rm --force')).length, 0, 'a router created on the internal network is kept');
  await releaseWith(docker);
}

{
  const docker = makeDocker({ bridgeConnect: 'already' });
  const acquired = await acquireWith(docker);
  assertEqual(acquired.error, null, 'a bridge that is already attached counts as attached, so re-acquires against a running router succeed');
  await releaseWith(docker);
}

{
  const docker = makeDocker({ bridgeConnect: 'fail' });
  const acquired = await acquireWith(docker);
  assertEqual(carries(acquired.error, "could not be connected to its upstream network 'bridge'"), true, 'a router that cannot reach its upstream is reported rather than handed to a task');
  assertEqual(acquired.token, null, 'and no token is issued on it');
  assertEqual(
    docker.calls.some(call => call === `rm --force ${ROUTER_SIDECAR_CONTAINER_NAME}`),
    true,
    'the routeless container is removed, so the next acquire starts clean'
  );
}

{
  // A sidecar started by a release before issue #2190: created on the bridge,
  // bound 0.0.0.0, healthy. Its primary network gives it away.
  const docker = makeDocker({ networkMode: 'bridge', running: true });
  assertEqual(await readRouterSidecarPrimaryNetwork({ run: docker.run }), 'bridge', 'the primary network of a legacy container reads as the bridge');
  const logs = [];
  const acquired = await acquireWith(docker, { log: async message => logs.push(message) });
  assertEqual(acquired.error, null, 'acquiring against a legacy router succeeds');
  const rmIndex = docker.calls.findIndex(call => call === `rm --force ${ROUTER_SIDECAR_CONTAINER_NAME}`);
  const runIndex = docker.calls.findIndex(call => call.startsWith('run '));
  assertEqual(rmIndex >= 0 && runIndex > rmIndex, true, 'by replacing it: the legacy container is removed and a new one created on the internal network');
  assertEqual(
    logs.some(message => carries(message, "created on 'bridge'") && carries(message, 'issue #2190')),
    true,
    'and the operator is told why the router restarted'
  );
  await releaseWith(docker);
}

{
  const docker = makeDocker({ networkMode: 'bridge', running: true });
  const first = await acquireWith(docker, { sessionId: 'holder' });
  assertEqual(first.error, null, 'first task takes a lease (this recreates the legacy router)');
  // Now pretend the router is legacy again while a lease is live.
  const legacy = makeDocker({ networkMode: 'bridge', running: true });
  const logs = [];
  const second = await acquireRouterSidecar({ sessionId: 'second', env: testEnv, run: legacy.run, homeDir: '/home/box', existsSync: target => target.endsWith('.claude'), healthAttempts: 1, sleepImpl: async () => {}, log: async message => logs.push(message) });
  assertEqual(second.error, null, 'a second task still gets a token');
  assertEqual(
    legacy.calls.some(call => call.startsWith('rm --force')),
    false,
    'but a legacy router with a live lease is not restarted under the task holding it'
  );
  assertEqual(
    logs.some(message => carries(message, 'will be restarted on the internal network once its 1 lease(s) end')),
    true,
    'the restart is deferred and announced instead'
  );
  await releaseWith(legacy, 'second');
  await releaseWith(legacy, 'holder');
}

assertEqual(
  await readRouterSidecarPrimaryNetwork({
    run: async () => {
      throw new Error('No such object');
    },
  }),
  null,
  'reading the primary network of a missing container yields null rather than throwing into acquire'
);
fs.rmSync(stateDir, { recursive: true, force: true });

console.log('\n=== issue #2190: the token dies with the container ===');

// A fake `docker wait`: an EventEmitter with the stream and unref surface the
// watcher touches. The test decides when and how it ends.
const makeSpawn = () => {
  const children = [];
  const spawn = (binary, args) => {
    const child = new EventEmitter();
    child.args = [binary, ...args];
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.unref = () => {};
    child.stderr.unref = () => {};
    child.unref = () => {};
    child.killed = false;
    child.kill = () => {
      child.killed = true;
    };
    children.push(child);
    return child;
  };
  return { spawn, children };
};

const router = { baseUrl: 'https://link-assistant-router', token: 'la_sk_x', external: false };

{
  const { spawn, children } = makeSpawn();
  const released = [];
  const watcher = watchRouterTaskContainer({ router, sessionId: 'task-a', env: {}, spawn, release: async args => released.push(args) });
  assertEqual(children[0].args.join(' '), 'docker wait task-a', 'the watcher waits on the task container itself, not on the solve process');
  assertEqual(released.length, 0, 'nothing is revoked while the container runs');
  children[0].stdout.emit('data', '137\n');
  children[0].emit('close', 0);
  const outcome = await watcher.done;
  assertEqual(released.length, 1, 'the token is released the moment the container exits');
  assertEqual(released[0].sessionId, 'task-a', 'for the session that owned it');
  assertEqual(released[0].router, router, 'against the router that issued it');
  assertEqual(outcome.reason, 'container task-a exited with status 137', 'and the exit status is recorded, killed or not');
}

{
  const { spawn, children } = makeSpawn();
  const released = [];
  const watcher = watchRouterTaskContainer({ router, sessionId: 'task-b', env: {}, spawn, release: async args => released.push(args) });
  children[0].stderr.emit('data', 'Error response from daemon: No such container: task-b\n');
  children[0].emit('close', 1);
  const outcome = await watcher.done;
  assertEqual(released.length, 1, 'a container docker cannot wait on is not running either, so its token is released too');
  assertEqual(carries(outcome.reason, 'No such container'), true, 'with the daemon message as the reason');
}

{
  const { spawn, children } = makeSpawn();
  const released = [];
  const watcher = watchRouterTaskContainer({ router, sessionId: 'task-c', env: {}, spawn, release: async args => released.push(args) });
  watcher.stop();
  assertEqual(children[0].killed, true, 'stopping the watcher ends its docker wait');
  children[0].emit('close', null);
  const outcome = await watcher.done;
  assertEqual(released.length, 0, 'and a stopped watcher does not revoke: the caller took over the lease');
  assertEqual(outcome.reason, 'watcher stopped', 'which is what it reports');
}

{
  const { spawn, children } = makeSpawn();
  const released = [];
  const watcher = watchRouterTaskContainer({ router, sessionId: 'task-d', env: {}, spawn, release: async args => released.push(args) });
  children[0].emit('error', new Error('spawn docker ENOENT'));
  const outcome = await watcher.done;
  assertEqual(released.length, 0, 'a docker wait that could not run says nothing about the container, so the maintenance tick keeps the job');
  assertEqual(outcome.released, false, 'and the watcher reports that it did not release');
}

assertEqual(
  watchRouterTaskContainer({
    router: { ...router, external: true },
    sessionId: 'task-e',
    spawn: () => {
      throw new Error('must not spawn');
    },
  }),
  null,
  'an external router issues no per-task token, so there is nothing to watch'
);
assertEqual(
  watchRouterTaskContainer({
    router,
    sessionId: '',
    spawn: () => {
      throw new Error('must not spawn');
    },
  }),
  null,
  'and without a container name there is nothing to wait on'
);
assertEqual(
  watchRouterTaskContainer({
    router,
    sessionId: 'task-f',
    spawn: () => {
      throw new Error('docker missing');
    },
  }),
  null,
  'a spawn that throws is reported and leaves the token to the maintenance tick'
);

console.log('\n=== issue #2190: a routed task authenticates with its router token only ===');

assertEqual(EXIT_CODE_ROUTER_AUTH_VIOLATION, 77, 'a security violation has its own exit code');
assertEqual(EXIT_CODE_ROUTER_AUTH_VIOLATION === EXIT_CODE_INSUFFICIENT_DISK_SPACE, false, 'distinct from the disk-space code, so operators can tell them apart');
assertEqual(isRouterAuthGuardRequired({}), false, 'the guard is off for a task run without the router');
assertEqual(isRouterAuthGuardRequired({ HIVE_MIND_USE_ROUTER: '1' }), false, 'and off when no router token was handed to the task');
assertEqual(isRouterAuthGuardRequired({ HIVE_MIND_USE_ROUTER: '1', HIVE_MIND_ROUTER_TOKEN: 'la_sk_x' }), true, 'on for a task that holds a router token');
assertEqual(isRouterAuthGuardRequired({ HIVE_MIND_USE_ROUTER: '1', HIVE_MIND_ROUTER_TOKEN: 'la_sk_x', HIVE_MIND_ROUTER_AUTH_GUARD: '0' }), false, 'and an operator may switch it off with HIVE_MIND_ROUTER_AUTH_GUARD=0');
assertEqual(resolveRouterAuthGuardIntervalMs({}), DEFAULT_ROUTER_AUTH_GUARD_INTERVAL_MS, 'the check interval defaults to one second');
assertEqual(resolveRouterAuthGuardIntervalMs({ HIVE_MIND_ROUTER_AUTH_GUARD_INTERVAL_MS: '250' }), 250, 'and can be tuned');
assertEqual(resolveRouterAuthGuardIntervalMs({ HIVE_MIND_ROUTER_AUTH_GUARD_INTERVAL_MS: '5' }), DEFAULT_ROUTER_AUTH_GUARD_INTERVAL_MS, 'but a value below 100 ms, which would just burn CPU, falls back to the default');

const inactive = startRouterAuthGuard({ env: {} });
assertEqual(inactive.active, false, 'starting the guard without the router yields an inactive handle');
assertEqual(await inactive.check(), null, 'whose check never finds anything');

const makeHome = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-mind-guard-2190-'));
  const cwd = path.join(home, 'workspace');
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.mkdirSync(path.join(home, '.config', 'gh'), { recursive: true });
  return { home, cwd, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
};
const routedEnv = { HIVE_MIND_USE_ROUTER: '1', HIVE_MIND_ROUTER_TOKEN: 'la_sk_task', HIVE_MIND_ROUTER_URL: 'https://link-assistant-router', ANTHROPIC_BASE_URL: 'https://link-assistant-router', ANTHROPIC_AUTH_TOKEN: 'la_sk_task', OPENAI_BASE_URL: 'https://link-assistant-router/v1' };
const inspect = ({ tool, home, cwd, env = routedEnv }) => inspectRouterAuthSurface({ tool, homeDir: home, cwd, env: { ...env, CODEX_HOME: path.join(home, '.codex') } });
const firstReason = result => result.violations[0]?.reason ?? null;

{
  const { home, cwd, cleanup } = makeHome();
  const clean = inspect({ tool: 'claude', home, cwd });
  assertEqual(clean.violations.length, 0, 'a clean routed Claude home passes');
  assertEqual(clean.checked > 0, true, 'and the guard did look at something');
  assertEqual(
    describeRouterAuthSurface({ tool: 'claude', homeDir: home, cwd, env: routedEnv }).some(entry => entry.path === path.join(home, '.claude', '.credentials.json')),
    true,
    'the Claude OAuth credential file is on the watch list'
  );

  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-fake"}}');
  assertEqual(carries(firstReason(inspect({ tool: 'claude', home, cwd })), 'Claude OAuth credential file appeared'), true, 'a Claude OAuth credential appearing is a violation, however it got there');
  fs.rmSync(path.join(home, '.claude', '.credentials.json'));

  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, numStartups: 3 }));
  assertEqual(inspect({ tool: 'claude', home, cwd }).violations.length, 0, 'an ordinary ~/.claude.json with onboarding state is fine');
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ primaryApiKey: 'sk-ant-api03-fake' }));
  assertEqual(carries(firstReason(inspect({ tool: 'claude', home, cwd })), 'primaryApiKey'), true, 'an API key stored in ~/.claude.json is a violation');
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'someone@example.com' } }));
  assertEqual(carries(firstReason(inspect({ tool: 'claude', home, cwd })), 'oauthAccount'), true, 'and so is a recorded OAuth account: the task logged in as someone');
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ customApiKeyResponses: { approved: ['abcdef'] } }));
  assertEqual(carries(firstReason(inspect({ tool: 'claude', home, cwd })), 'custom API key was approved'), true, 'and an approved custom API key');
  fs.writeFileSync(path.join(home, '.claude.json'), 'not json {');
  assertEqual(inspect({ tool: 'claude', home, cwd }).violations.length, 0, 'a half-written ~/.claude.json is not a violation on its own (the CLI writes it non-atomically)');
  fs.rmSync(path.join(home, '.claude.json'));

  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ env: { ANTHROPIC_BASE_URL: routedEnv.ANTHROPIC_BASE_URL }, permissions: { allow: ['Bash'] } }));
  assertEqual(inspect({ tool: 'claude', home, cwd }).violations.length, 0, 'a settings file that repeats the router base URL changes nothing and passes');
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' } }));
  assertEqual(carries(firstReason(inspect({ tool: 'claude', home, cwd })), 'ANTHROPIC_BASE_URL was overridden'), true, 'pointing Claude away from the router through settings is a violation');
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ env: { ANTHROPIC_API_KEY: 'sk-ant-api03-fake' } }));
  assertEqual(carries(firstReason(inspect({ tool: 'claude', home, cwd })), 'ANTHROPIC_API_KEY was overridden'), true, 'and so is smuggling an API key in through settings');
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ apiKeyHelper: '/bin/echo sk-ant' }));
  assertEqual(carries(firstReason(inspect({ tool: 'claude', home, cwd })), 'apiKeyHelper'), true, 'and an apiKeyHelper, which would replace the token on every request');
  fs.rmSync(path.join(home, '.claude', 'settings.json'));
  fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.claude', 'settings.local.json'), JSON.stringify({ env: { CLAUDE_CODE_USE_BEDROCK: '1' } }));
  assertEqual(carries(firstReason(inspect({ tool: 'claude', home, cwd })), 'CLAUDE_CODE_USE_BEDROCK was overridden'), true, 'a project-level settings file in the workspace is watched too');
  fs.rmSync(path.join(cwd, '.claude'), { recursive: true, force: true });
  assertEqual(CLAUDE_SETTINGS_AUTH_ENV_KEYS.includes('ANTHROPIC_AUTH_TOKEN') && CLAUDE_SETTINGS_AUTH_ENV_KEYS.includes('CLAUDE_CODE_OAUTH_TOKEN'), true, 'every env key Claude accepts a credential through is on the list');

  // The guard only cares that the file exists; an empty store keeps the fixture
  // free of anything shaped like a credential.
  fs.writeFileSync(path.join(home, '.git-credentials'), '');
  assertEqual(carries(firstReason(inspect({ tool: 'claude', home, cwd })), '.git-credentials'), true, 'a git credential store appearing is a violation: GitHub goes through the router too');
  fs.rmSync(path.join(home, '.git-credentials'));
  fs.writeFileSync(path.join(cwd, '.netrc'), '');
  assertEqual(carries(firstReason(inspect({ tool: 'claude', home, cwd })), '.netrc in the workspace'), true, 'and so is a .netrc dropped into the workspace');
  fs.rmSync(path.join(cwd, '.netrc'));
  fs.writeFileSync(path.join(home, '.config', 'gh', 'hosts.yml'), 'github.com:\n    user: someone\n    git_protocol: https\n');
  assertEqual(inspect({ tool: 'claude', home, cwd }).violations.length, 0, 'a gh hosts.yml without a token (what transparent mode leaves) passes');
  fs.writeFileSync(path.join(home, '.config', 'gh', 'hosts.yml'), 'github.com:\n    user: someone\n    oauth_token: gho_fake\n');
  assertEqual(carries(firstReason(inspect({ tool: 'claude', home, cwd })), 'gh oauth_token'), true, 'a gh login inside the task is a violation');
  fs.rmSync(path.join(home, '.config', 'gh', 'hosts.yml'));
  const altGh = path.join(home, 'gh-alt');
  fs.mkdirSync(altGh);
  fs.writeFileSync(path.join(altGh, 'hosts.yml'), 'github.com:\n    oauth_token: gho_fake\n');
  assertEqual(carries(firstReason(inspect({ tool: 'claude', home, cwd, env: { ...routedEnv, GH_CONFIG_DIR: altGh } })), 'gh oauth_token'), true, 'and GH_CONFIG_DIR is honoured when looking for it');
  cleanup();
}

{
  const { home, cwd, cleanup } = makeHome();
  const configPath = path.join(home, '.codex', 'config.toml');
  const pinned = ['model_provider = "hive-mind-router"', '', '[model_providers.hive-mind-router]', 'name = "Hive Mind router"', `base_url = "${routedEnv.OPENAI_BASE_URL}"`, 'env_key = "OPENAI_API_KEY"', 'wire_api = "responses"', ''].join('\n');
  fs.writeFileSync(configPath, pinned);
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  assertEqual(inspect({ tool: 'codex', home, cwd }).violations.length, 0, 'a Codex home pinned to the router passes');
  assertEqual(
    describeRouterAuthSurface({ tool: 'codex', homeDir: home, cwd, env: { ...routedEnv, CODEX_HOME: path.join(home, '.codex') } }).some(entry => entry.path === configPath),
    true,
    'the config that pins the provider is on the watch list'
  );

  fs.writeFileSync(configPath, `${pinned}\n[projects."${cwd}"]\ntrust_level = "trusted"\n`);
  assertEqual(inspect({ tool: 'codex', home, cwd }).violations.length, 0, 'the trust table Codex appends for the workspace does not trip the guard');
  fs.writeFileSync(configPath, pinned.replace('model_provider = "hive-mind-router"', 'model_provider = "openai"'));
  assertEqual(carries(firstReason(inspect({ tool: 'codex', home, cwd })), "model_provider was changed to 'openai'"), true, 'switching Codex back to the openai provider is a violation');
  fs.writeFileSync(configPath, pinned.replace(routedEnv.OPENAI_BASE_URL, 'https://api.openai.com/v1'));
  assertEqual(carries(firstReason(inspect({ tool: 'codex', home, cwd })), 'base_url was changed'), true, "and so is repointing the router provider's base_url");
  fs.writeFileSync(configPath, pinned.replace('env_key = "OPENAI_API_KEY"', 'env_key = "MY_KEY"'));
  assertEqual(carries(firstReason(inspect({ tool: 'codex', home, cwd })), 'env_key was changed'), true, 'and reading the key from another variable');
  fs.writeFileSync(configPath, `${pinned}experimental_bearer_token = "sk-fake"\n`);
  assertEqual(carries(firstReason(inspect({ tool: 'codex', home, cwd })), 'bearer token was pinned'), true, 'and pinning a bearer token into the provider entry');
  fs.rmSync(configPath);
  assertEqual(carries(firstReason(inspect({ tool: 'codex', home, cwd })), 'config.toml that pins the router provider was removed'), true, 'removing the pin altogether is a violation: Codex would fall back to its default provider');
  fs.writeFileSync(configPath, pinned);

  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-fake' }));
  assertEqual(carries(firstReason(inspect({ tool: 'codex', home, cwd })), 'OPENAI_API_KEY was written to Codex auth.json'), true, 'an API key stored through codex login is a violation');
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), JSON.stringify({ tokens: { access_token: 'x', refresh_token: 'y' } }));
  assertEqual(carries(firstReason(inspect({ tool: 'codex', home, cwd })), 'ChatGPT tokens'), true, 'and so is a ChatGPT login');
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), 'garbage');
  assertEqual(carries(firstReason(inspect({ tool: 'codex', home, cwd })), 'unreadable Codex auth.json'), true, 'an auth.json the guard cannot read is treated as a violation, not ignored');
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  fs.mkdirSync(path.join(cwd, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.codex', 'config.toml'), 'model_provider = "openai"\n');
  assertEqual(carries(firstReason(inspect({ tool: 'codex', home, cwd })), 'project-level Codex config'), true, 'a project-level Codex config that redirects the provider is a violation');
  fs.writeFileSync(path.join(cwd, '.codex', 'config.toml'), 'approval_policy = "never"\n');
  assertEqual(inspect({ tool: 'codex', home, cwd }).violations.length, 0, 'while one that only tunes approvals is allowed');
  cleanup();
}

{
  const pin = readCodexProviderPin(['model_provider = "hive-mind-router"', '[model_providers.other]', 'base_url = "https://elsewhere"', '[model_providers.hive-mind-router]', 'base_url = "https://router/v1"', 'env_key = "OPENAI_API_KEY"', '[projects."/w"]', 'trust_level = "trusted"'].join('\n'));
  assertEqual(pin.modelProvider, ROUTER_CODEX_PROVIDER_ID, 'the pin reader finds the top-level provider');
  assertEqual(pin.baseUrl, 'https://router/v1', "and the router provider's own base_url, not another provider's");
  assertEqual(pin.envKey, 'OPENAI_API_KEY', 'and its env_key');
  assertEqual(readCodexProviderPin('').modelProvider, null, 'an empty config has no provider pinned');
}

{
  const { home, cwd, cleanup } = makeHome();
  const timers = [];
  const cleared = [];
  const fired = [];
  const logs = [];
  const guard = startRouterAuthGuard({
    tool: 'claude',
    homeDir: home,
    cwd,
    env: routedEnv,
    log: async message => logs.push(message),
    onViolation: async violation => fired.push(violation),
    setIntervalImpl: (callback, ms) => {
      const timer = { callback, ms, unref: () => {} };
      timers.push(timer);
      return timer;
    },
    clearIntervalImpl: timer => cleared.push(timer),
  });
  assertEqual(guard.active, true, 'the guard arms for a routed task');
  assertEqual(await guard.first, null, 'its first check ran at once and found the clean home clean');
  assertEqual(timers[0].ms, DEFAULT_ROUTER_AUTH_GUARD_INTERVAL_MS, 'the periodic check uses the configured interval');
  assertEqual(
    logs.some(message => carries(message, 'Router auth guard armed')),
    true,
    'arming is logged (verbose only)'
  );
  await timers[0].callback();
  assertEqual(guard.violation, null, 'a tick against a clean home finds nothing');
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  await timers[0].callback();
  assertEqual(guard.violation !== null, true, 'the tick after a credential file appears records the violation');
  assertEqual(fired.length, 1, 'and the handler fires once');
  assertEqual(cleared.includes(timers[0]), true, 'and the interval is cleared, so it cannot fire again');
  await timers[0].callback();
  await guard.check();
  assertEqual(fired.length, 1, 'later ticks and explicit checks do not fire the handler a second time');
  assertEqual(guard.violation.tool, 'claude', 'the violation names the tool');
  const message = formatRouterAuthViolation(guard.violation);
  assertEqual(carries(message, 'Security violation (issue #2190)'), true, 'the operator-facing message calls it what it is');
  assertEqual(carries(message, path.join(home, '.claude', '.credentials.json')), true, 'and names the path that tripped it');
  assertEqual(carries(message, 'router token'), true, 'and states the rule that was broken');
  guard.stop();
  cleanup();
}

{
  const { home, cwd, cleanup } = makeHome();
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  const fired = [];
  const guard = startRouterAuthGuard({ tool: 'claude', homeDir: home, cwd, env: routedEnv, onViolation: violation => fired.push(violation), setIntervalImpl: () => ({ unref: () => {} }), clearIntervalImpl: () => {} });
  await guard.first;
  assertEqual(fired.length, 1, 'a credential already present when the guard arms is caught before the CLI does any work');
  guard.stop();
  cleanup();
}

{
  const { home, cwd, cleanup } = makeHome();
  const cleared = [];
  const guard = startRouterAuthGuard({ tool: 'codex', homeDir: home, cwd, env: { ...routedEnv, CODEX_HOME: path.join(home, '.codex') }, setIntervalImpl: () => ({ id: 'timer', unref: () => {} }), clearIntervalImpl: timer => cleared.push(timer) });
  guard.stop();
  assertEqual(cleared.length, 1, 'stopping the guard clears its interval');
  guard.stop();
  assertEqual(cleared.length, 1, 'and stopping twice clears it once');
  cleanup();
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
