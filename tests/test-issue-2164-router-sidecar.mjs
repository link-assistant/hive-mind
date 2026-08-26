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

import { acquireRouterSidecar, attachRouterToNetwork, buildRouterSidecarRunArgs, decodeRouterTokenId, getRouterCredentialMounts, issueRouterTaskToken, isRouterSidecarEnabled, readRouterCaCertificate, readRouterNetworkIp, registerRouterProvider, releaseRouterSidecar, resolveRouterSidecarImage, resolveRouterTokenSecret, wireRouterTaskContainer } from '../src/router-sidecar.lib.mjs';
import { acquireRouterForTask, attachRouterTaskContainer, registerFormalAiWithRouter, releaseRouterForTask } from '../src/router-task-isolation.lib.mjs';
import { runRouterMaintenanceTick, startRouterMaintenance, stopIdleRouterSidecar } from '../src/router-maintenance.lib.mjs';
import { FORMAL_AI_SIDECAR_NETWORK_NAME } from '../src/formal-ai-sidecar.lib.mjs';
import { buildRouterFormalAiProviderArgs, getInternalRouterBaseUrl, ROUTER_DATA_MOUNT, ROUTER_DATA_VOLUME_NAME, ROUTER_SIDECAR_CONTAINER_NAME, ROUTER_SIDECAR_IMAGE, ROUTER_SIDECAR_NETWORK_ALIAS, ROUTER_FORMAL_AI_MODEL, ROUTER_FORMAL_AI_PROVIDER_NAME, ROUTER_SIDECAR_NETWORK_NAME, ROUTER_TLS_DNS_NAMES } from '../src/router-isolation.lib.mjs';

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
// Same reasoning for containment: comparing first keeps a command line that
// carries `--api-key` out of the failure printer. Whole-hostname regexes rather
// than `includes` on URL-shaped values, which CodeQL flags as
// js/incomplete-url-substring-sanitization.
const carries = (actual, expected) => String(actual ?? '').includes(expected);
const GITHUB_API_HOST = /\bapi\.github\.com\b/;

console.log('\n=== issue #2164: router sidecar run arguments ===');

const credentialMounts = [
  { home: '.claude', target: '/data/claude', envVar: 'CLAUDE_CODE_HOME', source: '/home/box/.claude' },
  { home: '.codex', target: '/data/codex', envVar: 'CODEX_HOME', source: '/home/box/.codex' },
];
credentialMounts.push({ home: '.config/gh', target: '/data/gh', envVar: 'GH_CONFIG_DIR', source: '/home/box/.config/gh', readOnly: true });
const runArgs = buildRouterSidecarRunArgs({ image: ROUTER_SIDECAR_IMAGE, tokenSecret: 'deadbeef', credentialMounts, env: {} });

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
// Measured in experiments/issue-2164/probe-formal-ai-provider.sh: the file is
// created on the first authorised request and then holds one JSON line per
// mediated call — time, token id, label, provider, surface, path and model.
assertEqual(flagValue(runArgs, '--env', 'AUDIT_LOG=').join(''), `${ROUTER_DATA_MOUNT}/audit.jsonl`, 'and the audit log is written into that same volume, so who asked for what survives the container (R8)');
assertEqual(
  runArgs.some((value, index) => runArgs[index - 1] === '--volume' && value === `${ROUTER_DATA_VOLUME_NAME}:${ROUTER_DATA_MOUNT}`),
  true,
  'the audit volume is mounted by name (R8)'
);

// Vendor OAuth credentials are refresh tokens: the CLI rewrites them when they
// expire, so a :ro mount would discard every rotation and leave the operator
// with credentials that stop working.
const credentialVolumes = runArgs.filter((value, index) => runArgs[index - 1] === '--volume' && value.startsWith('/home/box/'));
assertEqual(credentialVolumes.length, 3, 'every discovered credential directory is mounted into the sidecar (R3)');
assertEqual(
  credentialVolumes.filter(volume => !volume.startsWith('/home/box/.config/gh')).every(volume => !volume.endsWith(':ro')),
  true,
  'credential mounts are writable, so refreshed tokens survive a restart'
);
// The router only ever reads the gh credential to present it upstream; nothing
// in it needs rewriting, and a read-only mount keeps a proxied call from
// editing the operator's own hosts.yml.
assertEqual(
  credentialVolumes.some(volume => volume === '/home/box/.config/gh:/data/gh:ro'),
  true,
  'the GitHub credential the router presents upstream is mounted read-only (R12)'
);
assertEqual(flagValue(runArgs, '--env', 'GH_CONFIG_DIR=').join(''), '/data/gh', 'and named through GH_CONFIG_DIR, which is where the router looks for it');
assertEqual(flagValue(runArgs, '--env', 'CLAUDE_CODE_HOME=').join(''), '/data/claude', 'the router is told where each credential home landed');
assertEqual(flagValue(runArgs, '--env', 'CODEX_HOME=').join(''), '/data/codex', 'the codex credential home is wired too');
assertEqual(runArgs.slice(-5).join(' '), 'serve --host 0.0.0.0 --port 443', 'the router is started in serve mode on 443, the only port an unmodified gh will build an api.github.com endpoint for');

// Without TLS there is no interception: gh, git and codex all speak https to
// api.github.com, and a plaintext router can only be reached by rewriting every
// client's configuration.
assertEqual(flagValue(runArgs, '--env', 'TLS_SELF_SIGNED=').join(''), '1', 'the router terminates TLS with a certificate of its own');
assertEqual(flagValue(runArgs, '--env', 'TLS_SELF_SIGNED_DNS=').join(''), ROUTER_TLS_DNS_NAMES, 'whose names cover both the internal alias and api.github.com');
assertEqual(GITHUB_API_HOST.test(ROUTER_TLS_DNS_NAMES), true, 'which is what lets an unmodified gh verify the interception');

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
// A floating :latest would change the router under running tasks; the tag is
// bumped deliberately, with the behaviour re-measured (experiments/issue-2164).
assertEqual(resolveRouterSidecarImage({}), ROUTER_SIDECAR_IMAGE, 'the published image is the default');
assertEqual(/:\d+\.\d+\.\d+$/.test(resolveRouterSidecarImage({})), true, 'pinned to an exact version rather than :latest');
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
assertEqual(acquired.baseUrl, getInternalRouterBaseUrl(), 'the task is pointed at the internal alias over HTTPS');
assertEqual(acquired.baseUrl, `https://${ROUTER_SIDECAR_NETWORK_ALIAS}`, 'on the default port, so the URL carries no port for gh to disagree about');
assertEqual(
  docker.calls.some(call => call.includes('bun') && call.includes('https://127.0.0.1:443/health')),
  true,
  'health is probed over the same TLS endpoint a task will use, not a plaintext one that no longer exists'
);
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

console.log('\n=== issue #2164: the token is confined to one repository ===');

const scopeCalls = [];
await issueRouterTaskToken({
  sessionId: 'session-scoped',
  githubRepo: 'link-assistant/hive-mind',
  run: async (binary, args) => {
    scopeCalls.push(args);
    return { stdout: `la_sk_h.${Buffer.from(JSON.stringify({ sub: 'id' })).toString('base64url')}.s\n` };
  },
});
// The router enforces this on both surfaces: a call about another repository is
// refused with "outside this token's repositories" on REST and at
// GET /info/refs for git, so a leaked task token is worth one repository.
assertEqual(scopeCalls[0].join(' ').includes('--github-repo link-assistant/hive-mind'), true, "the task's token names the repository it may touch, so it cannot be replayed against another (R13)");
assertEqual((await issueRouterTaskToken({ sessionId: 's', run: async () => ({ stdout: 'ghp_a_real_github_token\n' }) })).token, null, 'and anything that is not a router token is refused rather than handed to a task');

console.log('\n=== issue #2164: the task container is finished off from the host ===');

const CA_PEM = '-----BEGIN CERTIFICATE-----\nMIIBtest\n-----END CERTIFICATE-----';
const makeWiringDocker = ({ ca = CA_PEM, ip = '172.31.0.2' } = {}) => {
  const calls = [];
  const run = async (binary, args) => {
    calls.push(args);
    if (args[0] === 'inspect') return { stdout: `${ip}\n` };
    if (args.includes('tls')) return { stdout: ca ? `${ca}\n` : '\n' };
    return { stdout: '' };
  };
  return { calls, run };
};

const wiringDocker = makeWiringDocker();
const wired = await wireRouterTaskContainer({ sessionId: 'sess-2164', tool: 'claude', run: wiringDocker.run });
assertEqual(wired.wired, true, 'a healthy router wires the task container');
const execCall = wiringDocker.calls.find(args => args[0] === 'exec' && args.includes('sh'));
assertEqual(execCall.slice(0, 3).join(' '), 'exec --user 0', 'as root, because /etc/hosts and the CA store belong to root while the agent does not');
assertEqual(execCall[3], 'sess-2164', 'inside the task container, not the sidecar');
assertEqual(execCall.at(-1).includes(CA_PEM), true, 'and the CA the router just printed is what gets installed');
assertEqual(execCall.at(-1).includes('172.31.0.2'), true, "with api.github.com pointed at the router's address on the internal network");

// Every failure here is returned, not thrown: the caller tears the container
// down on a non-null error, and a task that reached this point holds no
// credential of its own — launching it unwired would simply strand it.
assertEqual((await wireRouterTaskContainer({ sessionId: 's', run: makeWiringDocker({ ca: null }).run })).error?.includes('router tls ca'), true, 'a router that prints no CA is reported rather than leaving the task unable to verify it');
assertEqual(GITHUB_API_HOST.test((await wireRouterTaskContainer({ sessionId: 's', run: makeWiringDocker({ ip: 'not-an-address' }).run })).error ?? ''), true, 'and so is a router with no address to intercept GitHub through');
assertEqual((await wireRouterTaskContainer({ sessionId: '', run: makeWiringDocker().run })).wired, false, 'a missing container name is refused outright');
assertEqual(await readRouterCaCertificate({ run: async () => ({ stdout: 'not a certificate\n' }) }), null, 'a CA read that returns something other than PEM yields null rather than a broken trust file');
assertEqual(
  await readRouterNetworkIp({
    run: async () => {
      throw new Error('No such object');
    },
  }),
  null,
  'and an address read against a missing container yields null rather than throwing into the launch path'
);

const attachedThenWired = [];
const attachOk = await attachRouterTaskContainer({
  router: { token: 't', tool: 'codex', githubMode: 'transparent', baseUrl: 'https://link-assistant-router' },
  sessionId: 'sess-2164',
  attach: async () => ({ attached: true }),
  wire: async options => {
    attachedThenWired.push(options);
    return { wired: true };
  },
});
assertEqual(attachOk, null, 'attach and wire together report success as no error');
assertEqual(attachedThenWired[0].tool, 'codex', 'the tool travels with the lease, so the wiring step writes the right provider config');
assertEqual(await attachRouterTaskContainer({ router: { token: 't' }, sessionId: 's', attach: async () => ({ attached: true }), wire: async () => ({ wired: false, error: 'exec refused' }) }), 'exec refused', 'and a container that could not be wired fails the launch instead of running with a partly-configured trust store');

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

console.log('\n=== issue #2164 R11: --model formal-ai is served by the same router ===');

// Measured in experiments/issue-2164/probe-formal-ai-provider.sh against router
// 0.109.0: a provider stored this way is advertised on GET /v1/models as
// {"id":"formal-ai","owned_by":"hive-mind-formal-ai"} and answers a chat
// completion for that id with HTTP 200, recorded in /data/router/audit.jsonl.
// Compared before printing: the argv carries `--api-key`, and a CI failure must
// print the label rather than the command line (CodeQL js/clear-text-logging).
assertEqual(holds(buildRouterFormalAiProviderArgs({ baseUrl: 'http://link-assistant-formal-ai:8080' }).join(' '), `providers add --name ${ROUTER_FORMAL_AI_PROVIDER_NAME} --base-url http://link-assistant-formal-ai:8080/v1 --model ${ROUTER_FORMAL_AI_MODEL} --models ${ROUTER_FORMAL_AI_MODEL} --api-key unused`), true, 'the Formal AI sidecar is stored as an OpenAI-compatible provider under the model id a task asks for');
assertEqual(buildRouterFormalAiProviderArgs({ baseUrl: 'http://link-assistant-formal-ai:8080/v1/' }).includes('http://link-assistant-formal-ai:8080/v1'), true, 'a base URL that already names the API version is not versioned twice');
assertEqual(buildRouterFormalAiProviderArgs({}), null, 'and no endpoint yields no command rather than a half-formed one');

const providerCalls = [];
const providerDocker = {
  run: async (binary, args) => {
    providerCalls.push(args);
    return { stdout: 'ok', stderr: '' };
  },
};
assertEqual((await registerRouterProvider({ providerArgs: buildRouterFormalAiProviderArgs({ baseUrl: 'http://link-assistant-formal-ai:8080' }), run: providerDocker.run })).registered, true, 'registering a provider succeeds when the router accepts it');
assertEqual(providerCalls[0].slice(0, 4).join(' '), `exec ${ROUTER_SIDECAR_CONTAINER_NAME} router providers`, 'the CLI is invoked inside the sidecar, naming the binary because docker exec bypasses the entrypoint');
assertEqual(
  (
    await registerRouterProvider({
      providerArgs: ['providers', 'add'],
      run: async () => {
        throw Object.assign(new Error('exit 1'), { stderr: 'unknown provider kind' });
      },
    })
  ).error,
  'unknown provider kind',
  "and a refusal is reported with the router's own words"
);

const networkCalls = [];
assertEqual((await attachRouterToNetwork({ network: FORMAL_AI_SIDECAR_NETWORK_NAME, run: async (binary, args) => (networkCalls.push(args), { stdout: '', stderr: '' }) })).attached, true, 'the router joins the Formal AI network so it can resolve the alias');
assertEqual(networkCalls[0].join(' '), `network connect ${FORMAL_AI_SIDECAR_NETWORK_NAME} ${ROUTER_SIDECAR_CONTAINER_NAME}`, 'no alias is requested: nothing on that network calls the router by name');

assertEqual(await registerFormalAiWithRouter({ router: null, sidecar: { dnsBaseUrl: 'http://link-assistant-formal-ai:8080' } }), null, 'a Formal AI task without routing is left alone');
assertEqual(await registerFormalAiWithRouter({ router: { token: 't' }, sidecar: null }), null, 'and a routed task that is not a Formal AI task registers nothing');

const wiredProvider = [];
assertEqual(
  await registerFormalAiWithRouter({
    router: { token: 't' },
    sidecar: { dnsBaseUrl: 'http://link-assistant-formal-ai:8080', baseUrl: 'http://172.20.0.3:8080' },
    log: async () => {},
    attach: async options => (wiredProvider.push(options.network), { attached: true }),
    register: async options => (wiredProvider.push(options.providerArgs.join(' ')), { registered: true }),
  }),
  null,
  'with both sidecars up the router is taught to serve formal-ai itself'
);
assertEqual(wiredProvider[0], FORMAL_AI_SIDECAR_NETWORK_NAME, 'the network is joined first, because the provider is useless until the alias resolves');
assertEqual(carries(wiredProvider[1], 'http://link-assistant-formal-ai:8080/v1'), true, 'the DNS endpoint is stored rather than an address that changes on every restart');

assertEqual(typeof (await registerFormalAiWithRouter({ router: { token: 't' }, sidecar: { dnsBaseUrl: 'http://x:8080' }, log: async () => {}, attach: async () => ({ attached: false, error: 'network not found' }) })), 'string', 'a router that cannot reach Formal AI fails the launch');
assertEqual((await registerFormalAiWithRouter({ router: { token: 't' }, sidecar: { dnsBaseUrl: 'http://x:8080' }, log: async () => {}, attach: async () => ({ attached: true }), register: async () => ({ registered: false, error: 'store is read-only' }) }))?.includes('store is read-only'), true, 'and so does a provider the router refuses to store, rather than running unmediated');
assertEqual(await registerFormalAiWithRouter({ router: { token: 't', external: true }, sidecar: { dnsBaseUrl: 'http://x:8080' }, attach: async () => ({ attached: false, error: 'should not be called' }) }), null, "an external router is somebody else's to configure");
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
