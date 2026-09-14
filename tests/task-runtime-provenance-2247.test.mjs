#!/usr/bin/env node

/**
 * Issue #2247 (H1): run the current code, and say which code ran.
 *
 * Line 6 of all three 2026-09-13 logs reads `🚀 solve v2.22.0`. v2.28.1 was
 * published at 16:59Z and the first task started at 18:50Z, so every fix merged
 * in between - including the ones those tasks needed - was inactive, and
 * nothing in the three pull requests said so.
 *
 * Three things are asserted here, one per part of the issue's fix:
 *
 *   1. a mutable task image is refreshed before the container is created, a
 *      pinned one is left alone (#1879's reuse survives), and the digest of
 *      whatever actually ran travels into the task;
 *   2. the *AI Work Session Started* comment states solve version, tool, model,
 *      task image digest and Formal AI backend version;
 *   3. a backend that requires a newer Hive Mind than the running one is
 *      refused instead of silently served.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2247
 */

import assert from 'node:assert/strict';

import { assertSupportedFormalAiBackend } from '../src/formal-ai-runtime.lib.mjs';
import { assertSupportedHiveMindVersion, HIVE_MIND_MIN_VERSION_ENV, isHiveMindVersionAtLeast, readRequiredHiveMindVersion } from '../src/formal-ai-version.lib.mjs';
import { buildDockerIsolationStartArgs } from '../src/isolation-runner.lib.mjs';
import { formatSessionRuntimeLine, resolveSessionRuntime } from '../src/session-runtime-provenance.lib.mjs';
import { buildTaskImageProvenanceEnv, describeTaskImage, isMutableImageReference, parseImageReference, readTaskImageDigest, readTaskImageProvenance, refreshTaskImage, resetTaskImageRefreshCache, shouldPullTaskImage, TASK_IMAGE_ENV, TASK_IMAGE_PULL_POLICY_ENV } from '../src/task-image-refresh.lib.mjs';

const DIGEST = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';

/** A `docker` stub that records its calls and answers `image inspect`. */
const dockerStub = ({ pullCode = 0, repoDigests = `konard/hive-mind@${DIGEST}`, imageId = 'sha256:abc', inspectCode = 0 } = {}) => {
  const calls = [];
  const run = async args => {
    calls.push(args);
    if (args[0] === 'pull') return { code: pullCode, stdout: '', stderr: pullCode === 0 ? '' : 'Error response from daemon: unauthorized' };
    return { code: inspectCode, stdout: `${imageId}\t${repoDigests}`, stderr: '' };
  };
  return { calls, run };
};

// ---------------------------------------------------------------------------
// 1. Image references: what can drift, and what must not be touched.
// ---------------------------------------------------------------------------

assert.deepEqual(parseImageReference('konard/hive-mind:latest'), { name: 'konard/hive-mind', tag: 'latest', digest: null });
assert.deepEqual(parseImageReference('konard/hive-mind'), { name: 'konard/hive-mind', tag: null, digest: null });
// A registry port is not a tag separator.
assert.deepEqual(parseImageReference('registry.local:5000/team/hive-mind:2.28.1'), { name: 'registry.local:5000/team/hive-mind', tag: '2.28.1', digest: null });
assert.deepEqual(parseImageReference(`konard/hive-mind:latest@${DIGEST}`), { name: 'konard/hive-mind', tag: 'latest', digest: DIGEST });
assert.deepEqual(parseImageReference(''), { name: '', tag: null, digest: null });

assert.equal(isMutableImageReference('konard/hive-mind:latest'), true, 'the default tag is the one that drifted in #2247');
assert.equal(isMutableImageReference('konard/hive-mind'), true, 'an untagged reference is :latest');
assert.equal(isMutableImageReference('ghcr.io/link-foundation/box:main'), true);
assert.equal(isMutableImageReference('konard/hive-mind:2.28.1'), false, 'a release tag cannot drift');
assert.equal(isMutableImageReference(`konard/hive-mind@${DIGEST}`), false, 'a digest is the image');
assert.equal(isMutableImageReference(''), false);

assert.equal(shouldPullTaskImage({ image: 'konard/hive-mind:latest', env: {} }).pull, true);
assert.equal(shouldPullTaskImage({ image: 'konard/hive-mind:2.28.1', env: {} }).pull, false);
assert.equal(shouldPullTaskImage({ image: 'konard/hive-mind:latest', env: { [TASK_IMAGE_PULL_POLICY_ENV]: 'never' } }).pull, false, 'an operator can switch the refresh off');
assert.equal(shouldPullTaskImage({ image: 'konard/hive-mind:2.28.1', env: { [TASK_IMAGE_PULL_POLICY_ENV]: 'always' } }).pull, true);

// ---------------------------------------------------------------------------
// 2. Refreshing: mutable pulled, pinned reused, failure never fatal.
// ---------------------------------------------------------------------------

resetTaskImageRefreshCache();
const mutable = dockerStub();
const refreshedMutable = await refreshTaskImage({ image: 'konard/hive-mind:latest', env: {}, run: mutable.run });
assert.equal(refreshedMutable.pulled, true, 'a `latest` task image is refreshed before the container starts');
assert.deepEqual(mutable.calls[0], ['pull', 'konard/hive-mind:latest']);
assert.equal(refreshedMutable.digest, DIGEST, 'the digest of the image that will run is resolved');
assert.equal(refreshedMutable.digestSource, 'repository');
assert.equal(refreshedMutable.error, null);

resetTaskImageRefreshCache();
const pinned = dockerStub();
const refreshedPinned = await refreshTaskImage({ image: 'konard/hive-mind:2.28.1', env: {}, run: pinned.run });
assert.equal(refreshedPinned.pulled, false);
assert.equal(
  pinned.calls.some(call => call[0] === 'pull'),
  false,
  'issue #1879: a pinned image present locally is reused, never re-pulled'
);
assert.equal(refreshedPinned.digest, DIGEST, 'a reused image still reports which one it is');

resetTaskImageRefreshCache();
const offline = dockerStub({ pullCode: 1 });
const logged = [];
const refreshedOffline = await refreshTaskImage({ image: 'konard/hive-mind:latest', env: {}, run: offline.run, log: message => logged.push(message) });
assert.equal(refreshedOffline.pulled, false);
assert.match(refreshedOffline.error, /unauthorized/, 'the registry failure is reported');
assert.equal(refreshedOffline.digest, DIGEST, 'the local copy still runs, and is still named');
assert.ok(
  logged.some(message => message.includes('Could not refresh')),
  'the operator sees why the refresh did not happen'
);

// A locally built image has no repository digest; its ID is still an identity.
resetTaskImageRefreshCache();
const localOnly = dockerStub({ repoDigests: '', imageId: 'sha256:deadbeef' });
const refreshedLocal = await refreshTaskImage({ image: 'hive-mind:dev', env: {}, run: localOnly.run });
assert.equal(refreshedLocal.digest, 'sha256:deadbeef');
assert.equal(refreshedLocal.digestSource, 'image-id');

// The registry check belongs at the start of a run, not in front of every task.
resetTaskImageRefreshCache();
const cached = dockerStub();
await refreshTaskImage({ image: 'konard/hive-mind:latest', env: {}, run: cached.run });
await refreshTaskImage({ image: 'konard/hive-mind:latest', env: {}, run: cached.run });
assert.equal(cached.calls.filter(call => call[0] === 'pull').length, 1, 'one refresh per image per process');

// An image Docker does not know about yields no digest rather than throwing.
const missing = await readTaskImageDigest({ image: 'nope:latest', run: async () => ({ code: 1, stdout: '', stderr: 'No such image' }) });
assert.deepEqual(missing, { digest: null, source: null });

assert.equal(describeTaskImage({ image: 'konard/hive-mind:latest', digest: DIGEST }), `konard/hive-mind:latest@${DIGEST}`);
assert.equal(describeTaskImage({ image: `konard/hive-mind@${DIGEST}`, digest: DIGEST }), `konard/hive-mind@${DIGEST}`, 'the digest is not appended twice');
assert.equal(describeTaskImage({}), 'unknown');

// ---------------------------------------------------------------------------
// 3. The digest is only knowable on the host, so it is published into the task.
// ---------------------------------------------------------------------------

assert.deepEqual(buildTaskImageProvenanceEnv({ image: 'konard/hive-mind:latest', digest: DIGEST }), { [TASK_IMAGE_ENV.image]: 'konard/hive-mind:latest', [TASK_IMAGE_ENV.digest]: DIGEST });
assert.deepEqual(buildTaskImageProvenanceEnv({ image: 'konard/hive-mind:latest', digest: null }), { [TASK_IMAGE_ENV.image]: 'konard/hive-mind:latest' });
assert.deepEqual(buildTaskImageProvenanceEnv(null), {});
assert.equal(readTaskImageProvenance({}), null);
assert.deepEqual(readTaskImageProvenance({ [TASK_IMAGE_ENV.image]: 'i', [TASK_IMAGE_ENV.digest]: DIGEST }), { image: 'i', digest: DIGEST });

const startArgs = buildDockerIsolationStartArgs('solve', ['https://example.test/issues/2247'], {
  sessionId: 's-2247',
  tool: 'claude',
  env: { HIVE_MIND_DOCKER_ISOLATION_IMAGE: 'konard/hive-mind:latest' },
  homeDir: '/home/box',
  existsSync: () => false,
  installGuard: () => null,
  imageProvenance: { image: 'konard/hive-mind:latest', digest: DIGEST },
});
const envFlags = startArgs.filter((value, index) => startArgs[index - 1] === '-e');
assert.ok(envFlags.includes(`${TASK_IMAGE_ENV.image}=konard/hive-mind:latest`), 'the task is told which image it runs inside');
assert.ok(envFlags.includes(`${TASK_IMAGE_ENV.digest}=${DIGEST}`), 'and which digest');
assert.equal(startArgs.includes('--pull'), false, 'issue #1879 stands: the refresh is a host-side `docker pull`, not a start-command flag');

const startArgsWithout = buildDockerIsolationStartArgs('solve', ['x'], { sessionId: 's', tool: 'claude', env: { HIVE_MIND_DOCKER_ISOLATION_IMAGE: 'konard/hive-mind:latest' }, homeDir: '/home/box', existsSync: () => false, installGuard: () => null });
assert.ok(
  startArgsWithout.filter((value, index) => startArgsWithout[index - 1] === '-e').some(entry => entry.startsWith(`${TASK_IMAGE_ENV.image}=`)),
  'even without a resolved digest the image name is published'
);

// ---------------------------------------------------------------------------
// 4. The session comment states the runtime.
// ---------------------------------------------------------------------------

assert.equal(formatSessionRuntimeLine({ solveVersion: '2.28.1', tool: 'claude', model: 'formal-ai', taskImage: { image: 'konard/hive-mind:latest', digest: DIGEST }, formalAiVersion: '0.349.2' }), `_Runtime: solve \`v2.28.1\` · tool \`claude\` · model \`formal-ai\` · task image \`konard/hive-mind:latest@${DIGEST}\` · Formal AI \`0.349.2\`_`);
assert.equal(formatSessionRuntimeLine({ solveVersion: 'v2.28.1' }), '_Runtime: solve `v2.28.1`_', 'the version is not printed as `vv2.28.1`');
assert.equal(formatSessionRuntimeLine({}), '', 'nothing known means no line, not an empty stub');

const formalAiRuntime = await resolveSessionRuntime({
  env: { HIVE_MIND_FORMAL_AI_BASE_URL: 'http://formal-ai.internal:8080', [TASK_IMAGE_ENV.image]: 'konard/hive-mind:latest', [TASK_IMAGE_ENV.digest]: DIGEST },
  model: 'formal-ai',
  tool: 'codex',
  versionImpl: async () => '2.28.1.7ace68d4',
  probeImpl: async () => '0.349.2',
});
assert.equal(formalAiRuntime.solveVersion, '2.28.1.7ace68d4');
assert.equal(formalAiRuntime.formalAiVersion, '0.349.2');
assert.match(formalAiRuntime.line, /solve `v2\.28\.1\.7ace68d4`/);
assert.match(formalAiRuntime.line, /tool `codex`/);
assert.match(formalAiRuntime.line, new RegExp(`task image \`konard/hive-mind:latest@${DIGEST}\``));
assert.match(formalAiRuntime.line, /Formal AI `0\.349\.2`/);

// A non-Formal-AI model never probes a backend.
let probed = 0;
const claudeRuntime = await resolveSessionRuntime({
  env: { HIVE_MIND_FORMAL_AI_BASE_URL: 'http://formal-ai.internal:8080' },
  model: 'sonnet',
  tool: 'claude',
  versionImpl: async () => '2.28.1',
  probeImpl: async () => {
    probed += 1;
    return '0.349.2';
  },
});
assert.equal(probed, 0, 'only a formal-ai session asks a Formal AI backend for its version');
assert.equal(claudeRuntime.formalAiVersion, null);
assert.equal(claudeRuntime.line, '_Runtime: solve `v2.28.1` · tool `claude` · model `sonnet`_');

// Nothing here may fail a session.
const brokenRuntime = await resolveSessionRuntime({
  env: { HIVE_MIND_FORMAL_AI_BASE_URL: 'http://formal-ai.internal:8080' },
  model: 'formal-ai',
  tool: 'agent',
  versionImpl: async () => {
    throw new Error('package.json unreadable');
  },
  probeImpl: async () => {
    throw new Error('connection refused');
  },
});
assert.equal(brokenRuntime.solveVersion, null);
assert.equal(brokenRuntime.formalAiVersion, null);
assert.equal(brokenRuntime.line, '_Runtime: tool `agent` · model `formal-ai`_');

const unknownRuntime = await resolveSessionRuntime({ env: {}, model: null, tool: null, versionImpl: async () => 'unknown' });
assert.equal(unknownRuntime.line, '', "an unreadable version is not published as the string 'unknown'");

// ---------------------------------------------------------------------------
// 5. Refuse to start when solve is older than the backend requires.
// ---------------------------------------------------------------------------

assert.equal(readRequiredHiveMindVersion({ version: '0.349.2' }, {}), null, 'no floor is declared by any backend shipping today');
assert.equal(readRequiredHiveMindVersion({ minimum_hive_mind_version: '2.28.0' }, {}), '2.28.0');
assert.equal(readRequiredHiveMindVersion({ requires: { hive_mind_min_version: '2.28.0' } }, {}), '2.28.0');
assert.equal(readRequiredHiveMindVersion({ hive_mind: { min_version: '2.28.0' } }, {}), '2.28.0');
assert.equal(readRequiredHiveMindVersion(null, { [HIVE_MIND_MIN_VERSION_ENV]: '2.30.0' }), '2.30.0', 'an operator can set the floor before a backend publishes one');
assert.equal(readRequiredHiveMindVersion({ minimum_hive_mind_version: '2.28.0' }, { [HIVE_MIND_MIN_VERSION_ENV]: '2.30.0' }), '2.30.0', 'the override wins');

// `getVersion()` returns `2.28.1.7ace68d4` in a checkout, so only the numeric core counts.
assert.equal(isHiveMindVersionAtLeast('2.28.1.7ace68d4', '2.28.1'), true);
assert.equal(isHiveMindVersionAtLeast('2.28.1', '2.28.1'), true);
assert.equal(isHiveMindVersionAtLeast('2.22.0', '2.28.0'), false, 'the version the three failing tasks ran');
assert.equal(isHiveMindVersionAtLeast('3.0.0', '2.28.0'), true);
assert.equal(isHiveMindVersionAtLeast('2.9.0', '2.28.0'), false, 'components compare numerically, not as text');
assert.equal(isHiveMindVersionAtLeast('v2.28.1', '2.28.0'), true);

assert.equal(assertSupportedHiveMindVersion({ version: '2.22.0', required: null }), null, 'no floor, no refusal');
assert.equal(assertSupportedHiveMindVersion({ version: '2.28.1.7ace68d4', required: '2.28.0' }), '2.28.0');
assert.throws(() => assertSupportedHiveMindVersion({ version: '2.22.0', required: '2.28.0', where: 'the Formal AI endpoint http://x' }), /requires Hive Mind >= 2\.28\.0, but this task is running 2\.22\.0/);
assert.throws(() => assertSupportedHiveMindVersion({ version: 'unknown', required: '2.28.0' }), /cannot determine its own version/, 'fail closed, as everywhere else in the Formal AI checks (#2146)');
assert.throws(() => assertSupportedHiveMindVersion({ version: '2.28.1', required: 'newest' }), /not a version Hive Mind can compare/);

const healthyProbe = health => ({ ok: true, kind: 'ok', status: 200, version: '0.349.2', memory: null, health, error: null });

assert.deepEqual(assertSupportedFormalAiBackend(healthyProbe({ version: '0.349.2' }), { baseUrl: 'http://formal-ai.invalid', hiveMindVersion: '2.22.0', env: {} }), { version: '0.349.2', memory: null, requiredHiveMindVersion: null }, 'a backend without a floor serves any Hive Mind, as today');

assert.equal(assertSupportedFormalAiBackend(healthyProbe({ version: '0.349.2', minimum_hive_mind_version: '2.28.0' }), { baseUrl: 'http://formal-ai.invalid', hiveMindVersion: '2.28.1.7ace68d4', env: {} }).requiredHiveMindVersion, '2.28.0');

assert.throws(() => assertSupportedFormalAiBackend(healthyProbe({ version: '0.349.2', minimum_hive_mind_version: '2.28.0' }), { baseUrl: 'http://formal-ai.invalid', hiveMindVersion: '2.22.0', env: {} }), /http:\/\/formal-ai\.invalid requires Hive Mind >= 2\.28\.0, but this task is running 2\.22\.0/, 'the 2026-09-13 combination - v2.22.0 against a backend published after it - is now a refusal');

console.log('PASS: issue #2247 (H1) task image refresh, session runtime provenance, and the Hive Mind version floor');
