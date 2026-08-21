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

import { buildRouterTaskEnv, describeRouterCoverageGaps, getInternalRouterBaseUrl, getRouterSuppressedCredentialPaths, isRouterEnabled, normalizeRouterBaseUrl, resolveRouterBaseUrl, resolveRouterGhHost } from '../src/router-isolation.lib.mjs';
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

const HOME = '/home/box';
const hostPaths = new Set([`${HOME}/.config/gh`, `${HOME}/.gitconfig`, `${HOME}/.config/git`, `${HOME}/.codex`, `${HOME}/.agents`, `${HOME}/.claude`, `${HOME}/.claude.json`]);
const existsAll = candidate => hostPaths.has(candidate);
const mountPairs = mounts => mounts.map(mount => `${mount.source}:${mount.target}`);
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

console.log('\n--- gh routing only engages behind HTTPS (upstream link-assistant/router#263) ---');

assertEqual(resolveRouterGhHost({ env: {} }), null, 'gh routing is off unless explicitly configured');
assertEqual(resolveRouterGhHost({ env: { HIVE_MIND_ROUTER_GH_HOST: 'gh.example.com' } }), 'gh.example.com', 'a bare host is accepted and assumed HTTPS');
assertEqual(resolveRouterGhHost({ env: { HIVE_MIND_ROUTER_GH_HOST: 'http://gh.example.com' } }), null, 'plaintext is refused here, where the reason can be explained');

console.log('\n--- Routed tasks are pointed at the router, per tool surface ---');

assertDeepEqual(buildRouterTaskEnv({ tool: 'claude', baseUrl: 'http://router:8080', token: 'la_sk_x' }), { HIVE_MIND_USE_ROUTER: '1', HIVE_MIND_ROUTER_URL: 'http://router:8080', HIVE_MIND_ROUTER_TOKEN: 'la_sk_x', ANTHROPIC_BASE_URL: 'http://router:8080', ANTHROPIC_AUTH_TOKEN: 'la_sk_x', ANTHROPIC_API_KEY: 'la_sk_x' }, 'claude is redirected via ANTHROPIC_BASE_URL, with the token offered in both accepted forms');
assertDeepEqual(buildRouterTaskEnv({ tool: 'codex', baseUrl: 'http://router:8080', token: 'la_sk_x' }), { HIVE_MIND_USE_ROUTER: '1', HIVE_MIND_ROUTER_URL: 'http://router:8080', HIVE_MIND_ROUTER_TOKEN: 'la_sk_x', OPENAI_BASE_URL: 'http://router:8080/v1', OPENAI_API_KEY: 'la_sk_x' }, 'codex is redirected via the OpenAI-compatible surface under /v1');
assertEqual(buildRouterTaskEnv({ tool: 'claude', baseUrl: 'http://router:8080', token: 'la_sk_x', ghHost: 'gh.example.com' }).GH_ENTERPRISE_TOKEN, 'la_sk_x', 'gh authenticates to the router with the same scoped token');
assertDeepEqual(buildRouterTaskEnv({ tool: 'claude', baseUrl: 'http://router:8080' }), {}, 'no token means no redirect: a task is never pointed at a router it cannot authenticate to');

console.log('\n--- Vendor credentials are withheld from routed tasks (R2, R9) ---');

assertDeepEqual(getRouterSuppressedCredentialPaths({ tool: 'claude' }), ['.claude', '.claude.json'], 'a routed claude task loses both Claude credential paths');
assertDeepEqual(getRouterSuppressedCredentialPaths({ tool: 'codex' }), ['.codex', '.agents'], 'a routed codex task loses both Codex credential paths');
assertDeepEqual(getRouterSuppressedCredentialPaths({ tool: 'claude', ghRouted: true }), ['.claude', '.claude.json', '.config/gh'], 'the gh credential is withheld only once gh has somewhere else to go');

const defaultClaudeMounts = mountPairs(getDockerIsolationAuthMounts({ tool: 'claude', homeDir: HOME, env: {}, existsSync: existsAll }));
assertDeepEqual(defaultClaudeMounts, [`${HOME}/.config/gh:${HOME}/.config/gh`, `${HOME}/.gitconfig:${HOME}/.gitconfig`, `${HOME}/.config/git:${HOME}/.config/git`, `${HOME}/.claude:${HOME}/.claude`, `${HOME}/.claude.json:${HOME}/.claude.json`], 'default behaviour is unchanged: claude tasks still receive the real subscription (R9)');

const routedClaudeMounts = mountPairs(getDockerIsolationAuthMounts({ tool: 'claude', homeDir: HOME, env: {}, existsSync: existsAll, useRouter: true }));
assertDeepEqual(routedClaudeMounts, [`${HOME}/.config/gh:${HOME}/.config/gh`, `${HOME}/.gitconfig:${HOME}/.gitconfig`, `${HOME}/.config/git:${HOME}/.config/git`], 'a routed claude task receives no Claude credential mount at all');
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

const launchOptions = { sessionId: 'sess-2164', tool: 'claude', env: {}, homeDir: HOME, existsSync: existsAll };
const defaultArgs = buildDockerIsolationStartArgs('solve', ['https://github.com/o/r/issues/1'], launchOptions);
const routedArgs = buildDockerIsolationStartArgs('solve', ['https://github.com/o/r/issues/1'], { ...launchOptions, useRouter: true, routerToken: 'la_sk_task' });

assertDeepEqual(envValues(defaultArgs, 'ANTHROPIC_BASE_URL'), [], 'a default launch injects no router endpoint');
assertDeepEqual(envValues(routedArgs, 'ANTHROPIC_BASE_URL'), [getInternalRouterBaseUrl()], 'a routed launch points Claude Code at the sidecar');
assertDeepEqual(envValues(routedArgs, 'HIVE_MIND_ROUTER_TOKEN'), ['la_sk_task'], "the task's own token is passed in, not the operator's credential");
assertEqual(
  routedArgs.some(value => value.includes('.claude')),
  false,
  'no Claude credential mount appears anywhere in a routed launch command'
);
assertDeepEqual(buildDockerIsolationStartArgs('solve', ['https://github.com/o/r/issues/1'], { ...launchOptions, useRouter: true }), defaultArgs, 'without an issued token the launch falls back to the default mounts rather than stranding the agent with no model access');

console.log('\n--- An experimental run states its own limits (R10, R16) ---');

const gaps = describeRouterCoverageGaps({});
assertEqual(
  gaps.some(gap => gap.includes('router#263')),
  true,
  'an unrouted-gh run says so and cites the upstream issue'
);
assertEqual(
  describeRouterCoverageGaps({ ghRouted: true }).some(gap => gap.includes('router#263')),
  false,
  'the gh warning disappears once gh is actually routed'
);
assertEqual(
  describeRouterCoverageGaps({ model: 'formal-ai' }).some(gap => gap.includes('router#260')),
  true,
  '--model formal-ai warns that its traffic bypasses the router (R11)'
);
assertEqual(
  gaps.some(gap => gap.includes('router#261')),
  true,
  'every routed run warns that git-transport deletions remain a branch-protection concern (R13)'
);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
