#!/usr/bin/env node
/**
 * Regression test for issue #2202 — `--use-router` must speak both router route
 * dialects.
 *
 * Router 1.0.0 replaced every public route with `/api/health`,
 * `/api/management/*` and `/api/services/*` and removed the legacy aliases
 * (upstream router#391). Probing `0.119.0` and `1.2.0` side by side shows the
 * two surfaces are disjoint — every path answering on one is a 404 on the other
 * (`docs/case-studies/issue-2202/data/measurements/router-route-comparison-2026-09-04.md`,
 * reproducible with `experiments/issue-2202/compare-router-routes.sh`).
 *
 * Before this fix Hive Mind emitted the legacy shapes unconditionally, so
 * pointing `HIVE_MIND_ROUTER_IMAGE` at a 1.x build produced a task whose every
 * request 404s. This suite pins the URL each dialect must produce, against the
 * measured status codes, so the next pin bump fails here rather than in a task.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2202
 */

import { buildRouterCatalogueEndpoints, buildRouterGitUrlPrefix, buildRouterHealthUrl, buildRouterRouteUrl, buildRouterServiceUrl, buildRouterToolServiceUrl, parseRouterImageMajor, resolveRouterRouteDialect, ROUTER_ROUTE_DIALECTS, ROUTER_TOOL_SERVICE } from '../src/router-routes.lib.mjs';
import { buildRouterCodexConfig, buildRouterGitConfigEntries, buildRouterTaskEnv, buildRouterTaskWiringScript, describeRouterCoverageGaps, resolveRouterDialect, resolveRouterSidecarImage, ROUTER_SIDECAR_IMAGE } from '../src/router-isolation.lib.mjs';
import { buildRouterSidecarRunArgs, checkRouterSidecarHealth, waitForRouterSidecarHealth } from '../src/router-sidecar.lib.mjs';

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

const ORIGIN = 'https://link-assistant-router';
const TASK_TOKEN = 'la_sk_x';
const legacy = ROUTER_ROUTE_DIALECTS.legacy;
const canonical = ROUTER_ROUTE_DIALECTS.canonical;

console.log('\n--- The image tag decides the dialect ---');

assertEqual(parseRouterImageMajor('ghcr.io/link-assistant/router:0.119.0'), 0, 'a 0.x tag parses as major 0');
assertEqual(parseRouterImageMajor('ghcr.io/link-assistant/router:1.2.0'), 1, 'a 1.x tag parses as major 1');
assertEqual(parseRouterImageMajor('ghcr.io/link-assistant/router:v2.0.0-rc.1'), 2, 'a v-prefixed prerelease tag parses');
assertEqual(parseRouterImageMajor('registry.local:5000/router:1.4.2'), 1, 'a registry port is not mistaken for the tag');
assertEqual(parseRouterImageMajor('ghcr.io/link-assistant/router:latest'), null, 'a moving tag carries no version');
assertEqual(parseRouterImageMajor('ghcr.io/link-assistant/router@sha256:abc'), null, 'a digest pin carries no version');
assertEqual(parseRouterImageMajor(''), null, 'an empty reference carries no version');

assertEqual(resolveRouterRouteDialect({ image: 'ghcr.io/link-assistant/router:0.119.0', env: {} }).dialect.id, 'legacy', 'the pinned 0.119.0 image speaks the legacy dialect');
assertEqual(resolveRouterRouteDialect({ image: 'ghcr.io/link-assistant/router:1.2.0', env: {} }).dialect.id, 'canonical', '1.2.0 speaks the canonical dialect');
assertEqual(resolveRouterRouteDialect({ image: 'ghcr.io/link-assistant/router:latest', env: {} }).dialect.id, 'canonical', 'an unversioned reference assumes the current dialect');
assertEqual(resolveRouterRouteDialect({ image: 'ghcr.io/link-assistant/router:latest', env: {} }).source, 'default', 'and says it guessed');

console.log('\n--- HIVE_MIND_ROUTER_ROUTES overrides the tag, and refuses nonsense ---');

assertEqual(resolveRouterRouteDialect({ image: 'ghcr.io/link-assistant/router:0.119.0', env: { HIVE_MIND_ROUTER_ROUTES: 'canonical' } }).dialect.id, 'canonical', 'an operator can declare the dialect of a fork or a digest pin');
assertEqual(resolveRouterRouteDialect({ image: 'ghcr.io/link-assistant/router:1.2.0', env: { HIVE_MIND_ROUTER_ROUTES: 'LEGACY' } }).dialect.id, 'legacy', 'the value is case-insensitive');
const bogus = resolveRouterRouteDialect({ image: 'ghcr.io/link-assistant/router:1.2.0', env: { HIVE_MIND_ROUTER_ROUTES: 'nope' } });
assertEqual(bogus.dialect.id, 'canonical', 'an unknown value falls back rather than throwing');
assertEqual(typeof bogus.error === 'string' && bogus.error.includes('nope'), true, 'and explains itself');

console.log('\n--- Each dialect produces exactly the paths measured against a running container ---');

// Left column of data/measurements/router-route-comparison-2026-09-04.md: the
// paths that answered on 0.119.0. Anything else was a 404 there.
assertEqual(buildRouterHealthUrl({ baseUrl: ORIGIN, dialect: legacy }), `${ORIGIN}/health`, 'legacy health is /health');
assertEqual(buildRouterServiceUrl({ baseUrl: ORIGIN, dialect: legacy, service: 'anthropic' }), ORIGIN, 'legacy Anthropic is the origin, so Claude Code reaches /v1/messages');
assertEqual(buildRouterServiceUrl({ baseUrl: ORIGIN, dialect: legacy, service: 'codex' }), `${ORIGIN}/v1`, 'legacy Codex is /v1');
assertEqual(buildRouterServiceUrl({ baseUrl: ORIGIN, dialect: legacy, service: 'gemini' }), null, 'legacy never served Gemini');
assertEqual(buildRouterGitUrlPrefix({ baseUrl: ORIGIN, dialect: legacy }), `${ORIGIN}/git/`, 'legacy git is /git/');
assertEqual(buildRouterRouteUrl(ORIGIN, legacy.github.rest), `${ORIGIN}/api/v3`, 'legacy gh REST is /api/v3');

// Right column: the paths that answered on 1.2.0.
assertEqual(buildRouterHealthUrl({ baseUrl: ORIGIN, dialect: canonical }), `${ORIGIN}/api/health`, 'canonical health is /api/health');
assertEqual(buildRouterServiceUrl({ baseUrl: ORIGIN, dialect: canonical, service: 'anthropic' }), `${ORIGIN}/api/services/anthropic`, 'canonical Anthropic is /api/services/anthropic');
assertEqual(buildRouterServiceUrl({ baseUrl: ORIGIN, dialect: canonical, service: 'codex' }), `${ORIGIN}/api/services/codex/v1`, 'canonical Codex is /api/services/codex/v1');
assertEqual(buildRouterServiceUrl({ baseUrl: ORIGIN, dialect: canonical, service: 'gemini' }), `${ORIGIN}/api/services/gemini`, 'canonical Gemini is /api/services/gemini');
assertEqual(buildRouterGitUrlPrefix({ baseUrl: ORIGIN, dialect: canonical }), `${ORIGIN}/api/services/github/git/`, 'canonical git is /api/services/github/git/');
assertEqual(buildRouterRouteUrl(ORIGIN, canonical.github.rest), `${ORIGIN}/api/services/github/api/v3`, 'canonical gh REST is /api/services/github/api/v3');

// The dialects are disjoint: this is the property the measurement established,
// and the reason neither shape may be hard-coded.
const legacyPaths = [legacy.health, legacy.services.codex, legacy.github.rest, legacy.github.git];
const canonicalPaths = [canonical.health, canonical.services.codex, canonical.github.rest, canonical.github.git];
assertEqual(
  legacyPaths.some(path => canonicalPaths.includes(path)),
  false,
  'no path is shared between the dialects, exactly as measured'
);

console.log('\n--- Every tool maps to a service, and each catalogue endpoint is declared with its shape ---');

assertDeepEqual(Object.keys(ROUTER_TOOL_SERVICE).sort(), ['agent', 'claude', 'codex', 'gemini', 'opencode', 'qwen'], 'every routed tool has a service');
assertEqual(buildRouterToolServiceUrl({ baseUrl: ORIGIN, dialect: canonical, tool: 'claude' }), `${ORIGIN}/api/services/anthropic`, 'claude resolves to the Anthropic service');
assertEqual(buildRouterToolServiceUrl({ baseUrl: ORIGIN, dialect: canonical, tool: 'opencode' }), `${ORIGIN}/api/services/openai/v1`, 'opencode resolves to plain OpenAI, not Codex');
assertEqual(buildRouterToolServiceUrl({ baseUrl: ORIGIN, dialect: canonical, tool: 'unknown-tool' }), null, 'an unknown tool resolves to nothing rather than to a wrong service');

assertDeepEqual(
  buildRouterCatalogueEndpoints({ baseUrl: ORIGIN, dialect: canonical }).map(entry => entry.url),
  [`${ORIGIN}/api/services/anthropic/v1/models`, `${ORIGIN}/api/services/openai/v1/models`, `${ORIGIN}/api/services/codex/v1/models`, `${ORIGIN}/api/services/qwen/v1/models`, `${ORIGIN}/api/services/gemini/v1beta/models`],
  'the five canonical catalogue routes are the five that answered 401 on 1.2.0'
);
assertDeepEqual(
  buildRouterCatalogueEndpoints({ baseUrl: ORIGIN, dialect: legacy }).map(entry => entry.url),
  [`${ORIGIN}/v1/models`],
  'the legacy dialect has one merged catalogue instead'
);
assertDeepEqual(
  buildRouterCatalogueEndpoints({ baseUrl: ORIGIN, dialect: canonical }).map(entry => entry.shape),
  ['anthropic', 'openai', 'openai', 'openai', 'gemini'],
  'each endpoint declares its response shape, so a consumer never has to sniff'
);

console.log('\n--- The task environment follows the dialect (this is what regressed on 1.x) ---');

const claudeLegacy = buildRouterTaskEnv({ tool: 'claude', baseUrl: ORIGIN, token: TASK_TOKEN, dialect: legacy });
const claudeCanonical = buildRouterTaskEnv({ tool: 'claude', baseUrl: ORIGIN, token: TASK_TOKEN, dialect: canonical });
assertEqual(claudeLegacy.ANTHROPIC_BASE_URL, ORIGIN, 'claude keeps the origin on the legacy dialect (issue #2164 behaviour is preserved)');
assertEqual(claudeCanonical.ANTHROPIC_BASE_URL, `${ORIGIN}/api/services/anthropic`, 'claude moves to the Anthropic service on the canonical dialect');

const codexLegacy = buildRouterTaskEnv({ tool: 'codex', baseUrl: ORIGIN, token: TASK_TOKEN, dialect: legacy });
const codexCanonical = buildRouterTaskEnv({ tool: 'codex', baseUrl: ORIGIN, token: TASK_TOKEN, dialect: canonical });
assertEqual(codexLegacy.OPENAI_BASE_URL, `${ORIGIN}/v1`, 'codex keeps /v1 on the legacy dialect');
assertEqual(codexCanonical.OPENAI_BASE_URL, `${ORIGIN}/api/services/codex/v1`, 'codex moves to its own service on the canonical dialect');
assertEqual(buildRouterCodexConfig({ baseUrl: ORIGIN, dialect: canonical }).includes(`base_url = "${ORIGIN}/api/services/codex/v1"`), true, 'and the generated config.toml agrees, because codex ignores OPENAI_BASE_URL');

const qwenCanonical = buildRouterTaskEnv({ tool: 'qwen', baseUrl: ORIGIN, token: TASK_TOKEN, dialect: canonical });
assertEqual(qwenCanonical.OPENAI_BASE_URL, `${ORIGIN}/api/services/qwen/v1`, 'qwen gets its own service rather than sharing codex');

// Gemini reads neither ANTHROPIC_BASE_URL nor OPENAI_BASE_URL; it was silently
// unrouted before this change, which is a hole in the isolation, not a detail.
const geminiCanonical = buildRouterTaskEnv({ tool: 'gemini', baseUrl: ORIGIN, token: TASK_TOKEN, dialect: canonical });
assertEqual(geminiCanonical.GOOGLE_GEMINI_BASE_URL, `${ORIGIN}/api/services/gemini`, 'gemini is wired through the variable its CLI actually reads');
assertEqual(geminiCanonical.GEMINI_API_KEY, TASK_TOKEN, 'and authenticates with the task token');
const geminiLegacy = buildRouterTaskEnv({ tool: 'gemini', baseUrl: ORIGIN, token: TASK_TOKEN, dialect: legacy });
assertEqual('GOOGLE_GEMINI_BASE_URL' in geminiLegacy, false, 'a dialect that does not serve Gemini wires nothing rather than a 404');

console.log('\n--- Git rewriting follows the dialect too ---');

const gitKeys = dialect => buildRouterGitConfigEntries({ baseUrl: ORIGIN, token: TASK_TOKEN, dialect }).map(([key]) => key);
assertDeepEqual(gitKeys(legacy), ['credential.helper', `url.${ORIGIN}/git/.insteadOf`, `http.${ORIGIN}/.sslCAInfo`, `http.${ORIGIN}/.extraHeader`], 'the legacy git prefix is unchanged');
assertDeepEqual(gitKeys(canonical), ['credential.helper', `url.${ORIGIN}/api/services/github/git/.insteadOf`, `http.${ORIGIN}/.sslCAInfo`, `http.${ORIGIN}/.extraHeader`], 'only the insteadOf prefix moves: sslCAInfo and extraHeader stay scoped to the origin so they cover every path under it');

console.log('\n--- The wiring script writes the same URLs the environment declares ---');

assertEqual(buildRouterTaskWiringScript({ tool: 'codex', baseUrl: ORIGIN, dialect: canonical }).includes(`${ORIGIN}/api/services/codex/v1`), true, "the container's config.toml is written with the canonical Codex base URL");
assertEqual(buildRouterTaskWiringScript({ tool: 'codex', baseUrl: ORIGIN, dialect: legacy }).includes(`base_url = "${ORIGIN}/v1"`), true, 'and with the legacy one when that is the pin');

console.log('\n--- The gh trade-off is reported, not discovered at runtime ---');

const ghGap = gaps => gaps.some(gap => gap.includes('gh'));
assertEqual(legacy.ghReachable, true, 'gh reaches the REST proxy on the legacy dialect, which is why the default pin stays there');
assertEqual(canonical.ghReachable, false, 'and cannot on the canonical one, because gh has no path-prefix setting');
assertEqual(ghGap(describeRouterCoverageGaps({ dialect: canonical, githubMode: 'transparent' })), true, 'a canonical-dialect run says so up front');
assertEqual(
  describeRouterCoverageGaps({ dialect: canonical, githubMode: 'transparent' }).some(gap => gap.includes('/api/services/github/api/v3')),
  true,
  'and names the prefix gh would have to reach'
);
assertEqual(
  describeRouterCoverageGaps({ dialect: legacy, githubMode: 'transparent' }).some(gap => gap.includes('has no path-prefix')),
  false,
  'a legacy-dialect run does not warn about a limitation it does not have'
);

console.log('\n--- The health probe follows the dialect, or the acquire loop stalls ---');

// /health is a 200 on 0.119.0 and a 404 on 1.2.0; /api/health is the reverse.
// A probe on the wrong path reads as "unhealthy", so a 1.x sidecar would be
// torn down as broken after every attempt while serving normally.
const probeFor = async options => {
  const calls = [];
  const run = async (_bin, args) => {
    calls.push(args);
    return { stdout: '', stderr: '' };
  };
  await checkRouterSidecarHealth({ run, ...options });
  return calls[0].join(' ');
};

assertEqual((await probeFor({ dialect: legacy })).includes('https://127.0.0.1:443/health"'), true, 'the legacy dialect probes /health');
assertEqual((await probeFor({ dialect: canonical })).includes('https://127.0.0.1:443/api/health"'), true, 'and the canonical one probes /api/health');
assertEqual((await probeFor({ env: {} })).includes('https://127.0.0.1:443/health"'), true, 'with no dialect passed the probe is derived from the image the sidecar would run');
assertEqual((await probeFor({ env: { HIVE_MIND_ROUTER_IMAGE: 'ghcr.io/link-assistant/router:1.2.0' } })).includes('https://127.0.0.1:443/api/health"'), true, 'so an overridden image moves the probe with it');

{
  // The wait loop resolved nothing and called the probe with defaults, which
  // meant a 1.x sidecar failed every attempt no matter what the caller passed.
  const paths = [];
  const run = async (_bin, args) => {
    paths.push(args[args.length - 1]);
    return { stdout: '', stderr: '' };
  };
  const health = await waitForRouterSidecarHealth({ run, attempts: 2, sleepImpl: async () => {}, env: { HIVE_MIND_ROUTER_IMAGE: 'ghcr.io/link-assistant/router:1.2.0' } });
  assertEqual(health.healthy, true, 'the wait loop reports healthy when the probe succeeds');
  assertEqual(
    paths.every(probe => probe.includes('/api/health')),
    true,
    'and every attempt it makes uses the dialect it was given, not the default'
  );
}

console.log('\n--- The shipped default is the one that keeps every issue #2164 capability ---');

assertEqual(ROUTER_SIDECAR_IMAGE, 'ghcr.io/link-assistant/router:0.125.4', 'the default pin is the highest 0.x release, so it keeps the legacy dialect and with it the gh mediation #2164 shipped');
{
  // R1 through the router: below 0.120.0 the router sends no `version` header to
  // the ChatGPT backend, which then answers `Model not found` for its newer
  // models. A pin that slipped back under that is a silent loss of models.
  const [major, minor] = (ROUTER_SIDECAR_IMAGE.split(':').pop() || '').split('.').map(Number);
  assertEqual(major > 0 || minor >= 120, true, 'and it is at or above 0.120.0, where the router started sending the Codex client `version` header new models are gated behind');
}
assertEqual(resolveRouterDialect({ env: {} }).dialect.id, 'legacy', 'and a default run therefore speaks the legacy dialect');
assertEqual(resolveRouterDialect({ env: { HIVE_MIND_ROUTER_IMAGE: 'ghcr.io/link-assistant/router:1.2.0' } }).dialect.id, 'canonical', 'pointing HIVE_MIND_ROUTER_IMAGE at 1.x switches every URL in one step');
assertEqual(resolveRouterSidecarImage({ HIVE_MIND_ROUTER_IMAGE: 'local/router:dev' }), 'local/router:dev', 'the image override itself still works');

console.log('\n--- The Codex client version reaches the sidecar when an operator sets one ---');

{
  const argsFor = env => buildRouterSidecarRunArgs({ image: ROUTER_SIDECAR_IMAGE, tokenSecret: 'secret', env }).join(' ');
  assertEqual(argsFor({}).includes('CODEX_CLIENT_VERSION'), false, "by default the router's own bundled version stands, so an older local codex cannot re-gate the new models");
  assertEqual(argsFor({ CODEX_CLIENT_VERSION: '0.150.0' }).includes('--env CODEX_CLIENT_VERSION=0.150.0'), true, 'and an explicit CODEX_CLIENT_VERSION is passed straight through');
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
