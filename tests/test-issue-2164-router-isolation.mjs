#!/usr/bin/env node
/**
 * Regression test for issue #2164 (`--use-router`, EXPERIMENTAL).
 *
 * The feature's whole value is a *negative* property: with router isolation on,
 * a task container must no longer see the operator's raw subscription files. A
 * negative is only trustworthy when asserted explicitly, so this suite checks
 * both directions — default runs keep every mount they had before, routed runs
 * lose exactly the vendor credentials and gain exactly the router endpoint.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2164
 */

import { buildRouterCodexConfig, buildRouterGitConfigEntries, buildRouterTaskEnv, buildRouterTaskWiringScript, describeRouterCoverageGaps, getInternalRouterBaseUrl, getRouterSuppressedCredentialPaths, isRouterEnabled, normalizeRouterBaseUrl, resolveRouterBaseUrl, resolveRouterGhHost, resolveRouterGitHubRouting, ROUTER_CA_BUNDLE_CONTAINER_PATH, ROUTER_CA_CONTAINER_PATH, ROUTER_GITHUB_API_HOST, ROUTER_SIDECAR_IMAGE, ROUTER_SIDECAR_PORT, ROUTER_TLS_DNS_NAMES } from '../src/router-isolation.lib.mjs';
import { buildDockerIsolationStartArgs, getDockerIsolationAuthMounts } from '../src/isolation-runner.lib.mjs';

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

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass(label);
  else fail(label, expected, actual);
}

// A failing assertion prints what it compared, and these assertions compare a
// task's credential. Anything holding a token is therefore compared *before* it
// reaches the printer, so a failure in CI leaks a label rather than a token
// (CodeQL js/clear-text-logging).
const matches = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const TASK_TOKEN = 'la_sk_x';

const HOME = '/home/box';
const hostPaths = new Set([`${HOME}/.config/gh`, `${HOME}/.gitconfig`, `${HOME}/.config/git`, `${HOME}/.codex`, `${HOME}/.agents`, `${HOME}/.claude`, `${HOME}/.claude.json`]);
const existsAll = candidate => hostPaths.has(candidate);
const mountPairs = mounts => mounts.map(mount => `${mount.source}:${mount.target}`);
// Matched as a whole hostname rather than with `includes`: a substring test on a
// URL-shaped value is what CodeQL flags as js/incomplete-url-substring-sanitization,
// and asserting the /etc/hosts line is the more precise check anyway.
const HOSTS_ENTRY = /^\s*\S+\s+api\.github\.com\s*$/m;
const envValues = (args, name) => args.filter((value, index) => args[index - 1] === '-e' && value.startsWith(`${name}=`)).map(value => value.slice(name.length + 1));

console.log('\n--- The flag is off by default and readable from the environment ---');

assertEqual(isRouterEnabled({ env: {} }), false, 'router isolation is off when nothing asks for it');
assertEqual(isRouterEnabled({ useRouter: true, env: {} }), true, '--use-router turns it on');
assertEqual(isRouterEnabled({ env: { HIVE_MIND_USE_ROUTER: 'true' } }), true, 'HIVE_MIND_USE_ROUTER=true is inherited by nested invocations');
assertEqual(isRouterEnabled({ env: { HIVE_MIND_USE_ROUTER: '0' } }), false, 'HIVE_MIND_USE_ROUTER=0 keeps it off');

console.log('\n--- Endpoint resolution rejects anything that is not a bare origin ---');

assertEqual(normalizeRouterBaseUrl('http://router:8080'), 'http://router:8080', 'a bare http origin is accepted');
assertEqual(normalizeRouterBaseUrl('https://router.example.com/'), 'https://router.example.com', 'a lone trailing slash is normalized away');
assertEqual(normalizeRouterBaseUrl('http://router:8080/v1'), null, 'a path is rejected rather than silently dropped');
assertEqual(normalizeRouterBaseUrl('http://user:pw@router:8080'), null, 'embedded credentials are rejected');
assertEqual(normalizeRouterBaseUrl('ftp://router'), null, 'a non-http scheme is rejected');
assertEqual(resolveRouterBaseUrl({ env: {} }).baseUrl, getInternalRouterBaseUrl(), 'without an override the task targets the sidecar alias');
assertEqual(resolveRouterBaseUrl({ env: {} }).external, false, 'the sidecar endpoint is not reported as external');
assertEqual(resolveRouterBaseUrl({ env: { HIVE_MIND_ROUTER_URL: 'https://router.example.com' } }).external, true, 'HIVE_MIND_ROUTER_URL marks the router as externally managed');
assertEqual(resolveRouterBaseUrl({ env: { HIVE_MIND_ROUTER_URL: 'not a url' } }).baseUrl, null, 'an unusable override yields no endpoint');
assertEqual(typeof resolveRouterBaseUrl({ env: { HIVE_MIND_ROUTER_URL: 'not a url' } }).error, 'string', 'an unusable override explains itself');

console.log('\n--- The sidecar is a pinned, TLS-terminating router on 443 ---');

assertEqual(ROUTER_SIDECAR_PORT, 443, 'the router listens on 443, the only port gh will build an endpoint for');
assertEqual(getInternalRouterBaseUrl(), 'https://link-assistant-router', 'so the internal endpoint is https with no port, matching the certificate authority name');
assertEqual(/:\d+\.\d+\.\d+$/.test(ROUTER_SIDECAR_IMAGE), true, 'the image is pinned to an exact version rather than :latest');
assertDeepEqual(ROUTER_TLS_DNS_NAMES.split(','), ['link-assistant-router', ROUTER_GITHUB_API_HOST], 'the certificate claims exactly the internal alias and api.github.com — the second is what lets an unmodified gh verify the interception, and the list is asserted whole so an extra SAN cannot slip in unnoticed');

console.log('\n--- GitHub routing: transparent for our own sidecar, declared for an external one ---');

assertEqual(resolveRouterGitHubRouting({ env: {} }).mode, 'transparent', 'our own sidecar intercepts api.github.com by name, with no gh reconfiguration');
assertEqual(resolveRouterGitHubRouting({ env: {}, external: true }).mode, 'off', 'an external router is on a network we cannot rewrite, so nothing is claimed');
assertEqual(resolveRouterGitHubRouting({ env: { HIVE_MIND_ROUTER_GH_HOST: 'gh.example.com' }, external: true }).mode, 'host', 'an operator-supplied HTTPS endpoint is wired through GH_HOST instead');
assertEqual(resolveRouterGitHubRouting({ env: { HIVE_MIND_ROUTER_GITHUB: '0' } }).mode, 'off', 'and an operator can turn GitHub routing off entirely');
assertEqual(resolveRouterGhHost({ env: {} }), null, 'no explicit gh host is needed for the default path');
assertEqual(resolveRouterGhHost({ env: { HIVE_MIND_ROUTER_GH_HOST: 'http://gh.example.com' } }), null, 'plaintext is refused here, where the reason can be explained');

console.log('\n--- Routed tasks are pointed at the router, per tool surface ---');

const ROUTER = getInternalRouterBaseUrl();
const claudeTaskEnv = buildRouterTaskEnv({ tool: 'claude', baseUrl: ROUTER, token: TASK_TOKEN });
assertEqual(claudeTaskEnv.ANTHROPIC_BASE_URL, ROUTER, 'claude is redirected via ANTHROPIC_BASE_URL');
assertEqual(matches([claudeTaskEnv.ANTHROPIC_AUTH_TOKEN, claudeTaskEnv.ANTHROPIC_API_KEY], [TASK_TOKEN, TASK_TOKEN]), true, "and the task's token is offered in both forms the router accepts");
assertEqual(matches(Object.keys(claudeTaskEnv).sort(), ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CURL_CA_BUNDLE', 'GH_TOKEN', 'GITHUB_TOKEN', 'GIT_TERMINAL_PROMPT', 'HIVE_MIND_ROUTER_TOKEN', 'HIVE_MIND_ROUTER_URL', 'HIVE_MIND_USE_ROUTER', 'NODE_EXTRA_CA_CERTS', 'REQUESTS_CA_BUNDLE', 'SSL_CERT_FILE']), true, 'and nothing else is injected');
assertEqual(claudeTaskEnv.GH_HOST, undefined, 'gh keeps its own host: the interception happens in DNS, so every gh command form is covered');
assertEqual(claudeTaskEnv.GH_TOKEN === TASK_TOKEN, true, 'gh authenticates to the router with the same scoped token, and holds no GitHub credential');

// The two CA variables are not interchangeable: NODE_EXTRA_CA_CERTS adds to the
// system store, SSL_CERT_FILE replaces it. Handing the bare router CA to the
// latter would leave the task unable to verify any other site on the internet.
assertEqual(claudeTaskEnv.NODE_EXTRA_CA_CERTS, ROUTER_CA_CONTAINER_PATH, 'Node-based clients are given the router CA as an addition to the system store');
assertEqual(claudeTaskEnv.SSL_CERT_FILE, ROUTER_CA_BUNDLE_CONTAINER_PATH, 'clients that replace the store are given a bundle that still contains the public roots');

const codexTaskEnv = buildRouterTaskEnv({ tool: 'codex', baseUrl: ROUTER, token: TASK_TOKEN, homeDir: HOME });
assertEqual(codexTaskEnv.OPENAI_BASE_URL, `${ROUTER}/v1`, 'codex is redirected via the OpenAI-compatible surface under /v1');
assertEqual(codexTaskEnv.CODEX_HOME, `${HOME}/.codex`, 'and gets a CODEX_HOME of its own, because codex ignores OPENAI_BASE_URL without a provider entry there');
assertEqual(buildRouterCodexConfig({ baseUrl: ROUTER }).includes('wire_api = "responses"'), true, 'the generated provider entry speaks the wire API the router serves');
assertEqual(buildRouterCodexConfig({ baseUrl: ROUTER }).includes(`base_url = "${ROUTER}/v1"`), true, 'and names the router as its base URL');

const hostModeEnv = buildRouterTaskEnv({ tool: 'claude', baseUrl: 'https://gh.example.com', token: TASK_TOKEN, githubMode: 'host', ghHost: 'gh.example.com' });
assertEqual(hostModeEnv.GH_HOST, 'gh.example.com', 'an external router is reached by pointing gh at its host');
assertEqual(hostModeEnv.GH_ENTERPRISE_TOKEN === TASK_TOKEN, true, 'with the task token as its enterprise credential');
assertEqual(buildRouterTaskEnv({ tool: 'claude', baseUrl: ROUTER, token: TASK_TOKEN, githubMode: 'off' }).GH_TOKEN, undefined, 'an unrouted-GitHub task is given no GitHub credential of ours at all');
assertEqual(matches(buildRouterTaskEnv({ tool: 'claude', baseUrl: ROUTER }), {}), true, 'no token means no redirect: a task is never pointed at a router it cannot authenticate to');

console.log('\n--- git is sent through the router, and cannot fall back to an inherited credential ---');

const gitEntries = buildRouterGitConfigEntries({ baseUrl: ROUTER, token: TASK_TOKEN });
const gitKeys = gitEntries.map(([key]) => key);
assertDeepEqual(gitKeys, ['credential.helper', `url.${ROUTER}/git/.insteadOf`, `http.${ROUTER}/.sslCAInfo`, `http.${ROUTER}/.extraHeader`], 'github.com is rewritten to the router git proxy, over a trusted CA');
assertEqual(gitEntries[0][1], '', 'and the operator’s inherited credential helper is cleared, so no real GitHub token can be presented');
assertEqual(gitEntries.find(([key]) => key.endsWith('.extraHeader'))[1] === `Authorization: Bearer ${TASK_TOKEN}`, true, 'the token rides in a scoped header rather than in a remote URL, where it would reach reflogs and error messages');
assertDeepEqual(buildRouterGitConfigEntries({ baseUrl: ROUTER, token: TASK_TOKEN, githubMode: 'off' }), [], 'nothing is rewritten when GitHub is not routed');

console.log('\n--- The task container is finished off from the host, inside the start gate ---');

const CA_PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
const wiring = buildRouterTaskWiringScript({ routerIp: '172.31.0.2', caCertificate: CA_PEM, homeDir: HOME, tool: 'claude' });
assertEqual(wiring.includes(CA_PEM), true, 'the CA is written into the task container');
assertEqual(wiring.includes("printf '%s %s\\n' '172.31.0.2' 'api.github.com'"), true, 'api.github.com is resolved to the router, which is what makes gh routing transparent');
assertEqual(wiring.includes("if ! grep -q ' api.github.com$' /etc/hosts"), true, 'and the entry is added only once, so a reused sidecar does not duplicate it');
assertEqual(wiring.includes('/etc/ssl/certs/ca-certificates.crt'), true, 'the replacement bundle starts from the system roots');
assertEqual(wiring.includes('config.toml'), false, 'a claude task gets no codex provider entry');
assertEqual(buildRouterTaskWiringScript({ routerIp: '172.31.0.2', caCertificate: CA_PEM, homeDir: HOME, tool: 'codex' }).includes(`${HOME}/.codex/config.toml`), true, 'a codex task does');
assertEqual(HOSTS_ENTRY.test(buildRouterTaskWiringScript({ routerIp: '172.31.0.2', caCertificate: CA_PEM, githubMode: 'host' })), false, 'an externally-hosted gh endpoint needs no hosts entry');

console.log('\n--- Vendor credentials are withheld from routed tasks (R2, R9) ---');

assertDeepEqual(getRouterSuppressedCredentialPaths({ tool: 'claude' }), ['.claude', '.claude.json'], 'a routed claude task loses both Claude credential paths');
assertDeepEqual(getRouterSuppressedCredentialPaths({ tool: 'codex' }), ['.codex', '.agents'], 'a routed codex task loses both Codex credential paths');
assertDeepEqual(getRouterSuppressedCredentialPaths({ tool: 'claude', ghRouted: true }), ['.claude', '.claude.json', '.config/gh'], 'the gh credential is withheld once GitHub is routed');

const defaultClaudeMounts = mountPairs(getDockerIsolationAuthMounts({ tool: 'claude', homeDir: HOME, env: {}, existsSync: existsAll }));
assertDeepEqual(defaultClaudeMounts, [`${HOME}/.config/gh:${HOME}/.config/gh`, `${HOME}/.gitconfig:${HOME}/.gitconfig`, `${HOME}/.config/git:${HOME}/.config/git`, `${HOME}/.claude:${HOME}/.claude`, `${HOME}/.claude.json:${HOME}/.claude.json`], 'default behaviour is unchanged: claude tasks still receive the real subscription (R9)');

const routedClaudeMounts = mountPairs(getDockerIsolationAuthMounts({ tool: 'claude', homeDir: HOME, env: {}, existsSync: existsAll, useRouter: true }));
assertEqual(
  routedClaudeMounts.some(pair => pair.includes('.claude')),
  false,
  'nothing named .claude survives into a routed container'
);

const routedCodexMounts = mountPairs(getDockerIsolationAuthMounts({ tool: 'codex', homeDir: HOME, env: {}, existsSync: existsAll, useRouter: true }));
assertEqual(
  routedCodexMounts.some(pair => pair.includes('.codex') || pair.includes('.agents')),
  false,
  'nothing named .codex or .agents survives into a routed container'
);
assertEqual(routedCodexMounts.includes(`${HOME}/.gitconfig:${HOME}/.gitconfig`), true, 'the git identity is still mounted: it is not a subscription credential (issue #1939)');

const ghRoutedMounts = mountPairs(getDockerIsolationAuthMounts({ tool: 'claude', homeDir: HOME, env: {}, existsSync: existsAll, useRouter: true, ghRouted: true }));
assertEqual(
  ghRoutedMounts.some(pair => pair.includes('.config/gh')),
  false,
  'once gh is routed, its host credential is withheld too (R12)'
);

console.log('\n--- The launcher wires it end to end ---');

// The guard installer writes the hook to the host, so it is stubbed here rather
// than let loose on the machine running the tests. Without this the suite passes
// only where `HOME` above happens to be creatable — on a Linux runner it is, on a
// developer's macOS box `/home/box` is not — and a silent install failure showed
// up as a confusing GIT_CONFIG_COUNT mismatch rather than as what it was. The
// real installer has its own coverage against a real directory in
// tests/test-issue-2164-git-push-guard.mjs.
const GUARD_DIR = '/host/hive-mind/git-hooks';
const installedGuard = () => ({ installed: true, dir: GUARD_DIR, hookPath: `${GUARD_DIR}/pre-push`, error: null });
const failedGuard = () => ({ installed: false, dir: GUARD_DIR, hookPath: `${GUARD_DIR}/pre-push`, error: 'EACCES' });

const launchOptions = { sessionId: 'sess-2164', tool: 'claude', env: {}, homeDir: HOME, existsSync: existsAll, installGuard: installedGuard };
const defaultArgs = buildDockerIsolationStartArgs('solve', ['https://github.com/o/r/issues/1'], launchOptions);
const routedArgs = buildDockerIsolationStartArgs('solve', ['https://github.com/o/r/issues/1'], { ...launchOptions, useRouter: true, routerToken: 'la_sk_task' });

assertDeepEqual(envValues(defaultArgs, 'ANTHROPIC_BASE_URL'), [], 'a default launch injects no router endpoint');
assertDeepEqual(envValues(routedArgs, 'ANTHROPIC_BASE_URL'), [ROUTER], 'a routed launch points Claude Code at the sidecar');
assertEqual(matches(envValues(routedArgs, 'HIVE_MIND_ROUTER_TOKEN'), ['la_sk_task']), true, "the task's own token is passed in, not the operator's credential");
assertDeepEqual(envValues(routedArgs, 'NODE_EXTRA_CA_CERTS'), [ROUTER_CA_CONTAINER_PATH], 'and at the CA it will be given while the start gate still holds it');
assertEqual(
  routedArgs.some(value => value.includes('.claude')),
  false,
  'no Claude credential mount appears anywhere in a routed launch command'
);
// git shares one counter across every GIT_CONFIG_KEY_n, so the hook path and the
// four router settings have to be emitted together — building them separately
// would leave only one of the two groups in effect.
assertDeepEqual(envValues(routedArgs, 'GIT_CONFIG_COUNT'), ['5'], 'the push guard and the router git settings share one GIT_CONFIG_COUNT');
assertEqual(envValues(routedArgs, 'GIT_CONFIG_KEY_0').includes('core.hooksPath'), true, 'with the push-guard hook first');
assertEqual(
  routedArgs.some(value => value.startsWith('GIT_CONFIG_KEY_') && value.endsWith('.insteadOf')),
  true,
  'and the github.com rewrite among them'
);
assertDeepEqual(buildDockerIsolationStartArgs('solve', ['https://github.com/o/r/issues/1'], { ...launchOptions, useRouter: true }), defaultArgs, 'without an issued token the launch falls back to the default mounts rather than stranding the agent with no model access');

// A guard that cannot be written to the host is not fatal — the remaining R13
// layers still apply — but it must drop cleanly out of the git config rather
// than leaving a hooksPath pointing at a mount that was never made.
const unguardedArgs = buildDockerIsolationStartArgs('solve', ['https://github.com/o/r/issues/1'], { ...launchOptions, useRouter: true, routerToken: 'la_sk_task', installGuard: failedGuard });
assertDeepEqual(envValues(unguardedArgs, 'GIT_CONFIG_COUNT'), ['4'], 'a guard that could not be installed leaves only the router git settings');
assertEqual(
  unguardedArgs.some(value => value.startsWith('GIT_CONFIG_VALUE_') && value.includes(GUARD_DIR)),
  false,
  'and no hooksPath is set for a hook the task was never given'
);
assertEqual(
  unguardedArgs.some(value => value.includes(GUARD_DIR)),
  false,
  'nor is the hook directory mounted'
);

console.log('\n--- An experimental run states its own limits (R10, R16) ---');

const gaps = describeRouterCoverageGaps({});
assertEqual(
  gaps.some(gap => gap.includes('router#329')),
  true,
  'every routed run names the destructive-API gap the router still forwards, and cites the upstream issue (R13)'
);
assertEqual(
  gaps.some(gap => gap.includes('router#272') || gap.toLowerCase().includes('force push is not')),
  false,
  'and no longer claims force pushes are unblocked — router#273 closed that from 0.110.0, and the pin is past it'
);
// A floor rather than an exact tag: what this test is about is that the pin
// carries router#273, not which release it happens to sit on. Issue #2202 moves
// it, and a bump that stays above the floor must not fail a #2164 assertion.
const pinnedRouterVersion = (ROUTER_SIDECAR_IMAGE.split(':').pop() || '').split('.').map(Number);
assertEqual(pinnedRouterVersion[0] === 0 && pinnedRouterVersion[1] >= 110, true, 'the pinned image is at or above 0.110.0, so it carries the compare-based force-push mediation the warning above stopped claiming was missing');
assertEqual(
  gaps.some(gap => gap.includes('GitHub traffic is NOT routed')),
  false,
  'the default path routes GitHub, so it claims no gap there'
);
assertEqual(
  describeRouterCoverageGaps({ githubMode: 'off' }).some(gap => gap.includes('GitHub traffic is NOT routed')),
  true,
  'a run without GitHub routing says so'
);
assertEqual(
  describeRouterCoverageGaps({ model: 'formal-ai' }).some(gap => gap.includes('formal-ai') || gap.includes('Formal AI')),
  true,
  '--model formal-ai explains how it reaches the router (R11)'
);
assertEqual(
  describeRouterCoverageGaps({ model: 'sonnet' }).some(gap => gap.includes('exact model ids')),
  true,
  'a model alias is called out, because the router resolves advertised ids only'
);
assertEqual(
  describeRouterCoverageGaps({ model: 'claude-sonnet-4-5-20250929' }).some(gap => gap.includes('exact model ids')),
  false,
  'a dated id is not'
);
assertEqual(
  describeRouterCoverageGaps({ tool: 'codex' }).some(gap => gap.includes("Routing for 'codex'")),
  true,
  'and a non-Claude tool is flagged as the less exercised path'
);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
