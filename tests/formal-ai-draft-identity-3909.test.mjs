#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #3909: issue-created Formal AI drafts ran the stale backend baked into
 * Hive Mind's image.
 *
 * The attempt now resolves both sources once, at admission, into an identity
 * that the binary, the image and the serving process are all checked against
 * before solve starts. Covered here, with every lookup mocked:
 *
 *   - drift: advancing Formal AI main gives a new identity and a new binary;
 *     a release of the same version built from another commit is not reused;
 *   - retries keep one identity, and an edited identity is refused;
 *   - a missing artefact (binary, receipt, image, digest, probe) is deferred,
 *     a wrong one is a mismatch, and neither falls back to another image or
 *     to `latest`;
 *   - live-current, published-release and historical-replay stay apart, and a
 *     replay is never labelled as current-source evidence;
 *   - the preflight verifies source, binary, image and serving process in
 *     that order and stops before anything else on the first failure;
 *   - solve's own check of the process that serves it (src/);
 *   - the health check counts a deferred attempt as infrastructure, not as a
 *     model failure;
 *   - the workflow wires select → binary → draft.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { ATTEMPT_ENV, ATTEMPT_MODE_LABELS, ATTEMPT_MODES, ATTEMPT_OUTCOME_ANNOTATION_TITLES, ATTEMPT_OUTCOMES, AttemptIdentityError, BINARY_SOURCES, buildAttemptEnv, buildAttemptIdentity, buildNativeReceipt, buildOutcomeRecord, checkHiveImageBinding, describeAttempt, formatIdentityOutputs, isVersionOnlyPatch, parseAttemptIdentity, parseAttemptMode, readCargoPackageVersion, verifyAttemptBinary, verifyServingIdentity } from '../scripts/formal-ai-draft-identity.lib.mjs';
import { DraftImageUnavailableError, pullDraftImage } from '../scripts/formal-ai-draft-image.lib.mjs';
import { pinnedImageReference, verifyAttemptPreflight } from '../scripts/formal-ai-draft-preflight.lib.mjs';
import { createGitHubSelectDeps, selectAttempt } from '../scripts/formal-ai-draft-select.lib.mjs';
import { findRepeatedFailure, isExecutedAttempt, runOutcomeFromAnnotations } from '../scripts/formal-ai-draft-health.lib.mjs';
import { readFormalAiAttemptExpectation, verifyFormalAiServingBinding, verifyFormalAiWrapperBinding } from '../src/formal-ai-attempt-identity.lib.mjs';

const sha1 = c => c.repeat(40);
const sha256 = c => c.repeat(64);
const OLD_MAIN = sha1('a');
const NEW_MAIN = sha1('b');
const HIVE = sha1('c');
const HIVE_IMAGE_REVISION = sha1('d');
const REPOSITORY = 'link-assistant/hive-mind';
const hive = { repository: REPOSITORY, sourceSha: HIVE, version: '2.39.11', image: 'konard/hive-mind:2.39.11' };

/** Formal AI as GitHub would answer: a main head, a version per commit, releases with receipts. */
const formalAiDeps = ({ main = OLD_MAIN, versions = { [OLD_MAIN]: '0.355.29', [NEW_MAIN]: '0.355.29' }, releases = { 'v0.355.29': OLD_MAIN }, latest = 'v0.355.29', merged = [OLD_MAIN, NEW_MAIN] } = {}) => ({
  resolveCommit: async ref => (ref === 'main' ? main : /^[0-9a-f]{40}$/.test(ref) ? ref : (releases[ref] ?? 'unknown')),
  readVersion: async sha => versions[sha] ?? null,
  releaseForVersion: async version => (releases[`v${version}`] !== undefined ? { tag: `v${version}`, version, sourceSha: releases[`v${version}`] } : null),
  release: async tag => {
    const name = tag || latest;
    return releases[name] !== undefined ? { tag: name, version: name.slice(1), sourceSha: releases[name] } : null;
  },
  onDefaultBranch: async sha => merged.includes(sha),
  hashFile: async () => sha256('e'),
  binaryVersion: async () => 'formal-ai 0.355.29',
});

const select = (options = {}, deps = formalAiDeps()) => selectAttempt({ mode: ATTEMPT_MODES.liveCurrent, repository: REPOSITORY, issue: 3909, hive, selected: { at: '2026-11-02T00:00:00Z', runId: '1' }, deps, ...options });

const rejects = async (promiseOrFn, outcome, pattern) => {
  await assert.rejects(promiseOrFn, error => {
    assert.ok(error instanceof AttemptIdentityError, `expected an AttemptIdentityError, got ${error}`);
    assert.equal(error.outcome, outcome, error.message);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
};
const throwsOutcome = (fn, outcome, pattern) =>
  assert.throws(fn, error => {
    assert.ok(error instanceof AttemptIdentityError, `expected an AttemptIdentityError, got ${error}`);
    assert.equal(error.outcome, outcome, error.message);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });

// --- Drift: the source is resolved at admission, and a new one is a new attempt ---

test('advancing Formal AI main gives the next attempt the new source and a new identity', async () => {
  const before = await select({}, formalAiDeps({ main: OLD_MAIN }));
  assert.equal(before.formalAi.sourceSha, OLD_MAIN);
  assert.equal(before.formalAi.binarySource, BINARY_SOURCES.release, 'the release built from this exact commit is reused');
  assert.equal(before.formalAi.release.tag, 'v0.355.29');

  const after = await select({}, formalAiDeps({ main: NEW_MAIN }));
  assert.equal(after.formalAi.sourceSha, NEW_MAIN, 'the new main head, not what any image or release carries');
  assert.notEqual(after.id, before.id, 'a new source is a new identity');
  assert.equal(after.currentSource, true);
});

test('version equality is not enough: a same-version release of another commit is not reused', async () => {
  const identity = await select({}, formalAiDeps({ main: NEW_MAIN }));
  assert.equal(identity.formalAi.version, '0.355.29');
  assert.equal(identity.formalAi.binarySource, BINARY_SOURCES.build, 'the selected commit is built instead');
  assert.equal(identity.formalAi.release, null);
  assert.deepEqual(identity.formalAi.releaseCandidate, { tag: 'v0.355.29', sourceSha: OLD_MAIN }, 'the rejected candidate is recorded as evidence');

  // …and the release's own binary is refused for it, by its receipt.
  const receipt = buildNativeReceipt({ sourceSha: OLD_MAIN, target: 'x86_64-unknown-linux-musl', executableBytes: 10, executableSha256: sha256('1'), version: '0.355.29' });
  throwsOutcome(() => verifyAttemptBinary({ identity, receipt, actualSha256: sha256('1'), actualBytes: 10, reportedVersion: 'formal-ai 0.355.29' }), ATTEMPT_OUTCOMES.mismatch, new RegExp(`built from ${OLD_MAIN}, but this attempt selected ${NEW_MAIN}`));
});

test('a retry keeps the identity; an identity edited between jobs is refused', async () => {
  const first = await select({ selected: { at: '2026-11-02T00:00:00Z', runId: '1', runAttempt: '1' } });
  const retry = await select({ selected: { at: '2026-11-02T01:00:00Z', runId: '1', runAttempt: '2' } });
  assert.equal(retry.id, first.id, 'when and where admission ran is recorded beside the selection, not in it');
  assert.equal(parseAttemptIdentity(JSON.stringify(first)).id, first.id);

  const tampered = JSON.parse(JSON.stringify(first));
  tampered.formalAi.sourceSha = NEW_MAIN;
  throwsOutcome(() => parseAttemptIdentity(JSON.stringify(tampered)), ATTEMPT_OUTCOMES.mismatch, /changed after admission/);
  throwsOutcome(() => parseAttemptIdentity('not json'), ATTEMPT_OUTCOMES.mismatch);

  const replayed = await select({ replayIdentity: JSON.stringify(first), mode: ATTEMPT_MODES.publishedRelease }, formalAiDeps({ main: NEW_MAIN }));
  assert.deepEqual(replayed, first, 'a recorded identity is run unchanged, whatever main is now');
  await assert.rejects(select({ replayIdentity: JSON.stringify(first), issue: 1 }), /not link-assistant\/hive-mind#1/);
});

test('the outputs a later job reads carry the identity on one line', async () => {
  const identity = await select();
  const outputs = formatIdentityOutputs(identity);
  assert.match(outputs, new RegExp(`^attempt_id=${identity.id}$`, 'm'));
  assert.match(outputs, new RegExp(`^formal_ai_sha=${OLD_MAIN}$`, 'm'));
  assert.match(outputs, new RegExp(`^hive_sha=${HIVE}$`, 'm'));
  const json = /^identity_json=(.*)$/m.exec(outputs)[1];
  assert.equal(parseAttemptIdentity(json).id, identity.id);
});

// --- Modes stay apart ------------------------------------------------------

test('live-current, published-release and historical-replay are separate and labelled', async () => {
  assert.equal(parseAttemptMode(''), ATTEMPT_MODES.liveCurrent);
  assert.throws(() => parseAttemptMode('latest'), /mode/);

  await assert.rejects(select({ ref: 'v0.355.29' }), /pin "v0.355.29" as a historical-replay/, 'a live attempt cannot be pinned');

  const release = await select({ mode: ATTEMPT_MODES.publishedRelease }, formalAiDeps({ main: NEW_MAIN }));
  assert.equal(release.formalAi.sourceSha, OLD_MAIN, 'the release receipt names its source');
  assert.equal(release.formalAi.binarySource, BINARY_SOURCES.release);
  assert.equal(release.currentSource, false);
  assert.match(describeAttempt(release), /^published-release qualification/);
  assert.equal(ATTEMPT_MODE_LABELS[release.mode], 'formal-ai-release-qualification');

  const replay = await select({ mode: ATTEMPT_MODES.historicalReplay });
  assert.equal(replay.formalAi.binarySource, BINARY_SOURCES.imageBaked);
  assert.equal(replay.currentSource, false);
  assert.match(describeAttempt(replay), /HISTORICAL REPLAY \(not current-source evidence\)/);
  assert.equal(ATTEMPT_MODE_LABELS[replay.mode], 'formal-ai-historical-replay');

  const pinned = await select({ mode: ATTEMPT_MODES.historicalReplay, ref: NEW_MAIN });
  assert.equal(pinned.formalAi.sourceSha, NEW_MAIN);
  assert.equal(pinned.currentSource, false, 'a pinned commit is a replay even when it is the current head');

  const live = await select();
  assert.equal(live.currentSource, true);
  assert.equal(ATTEMPT_MODE_LABELS[live.mode], undefined, 'a live attempt carries only the ordinary draft label');
  assert.equal(new Set([live.id, release.id, replay.id, pinned.id]).size, 4);
});

test('a historical replay only builds merged history: a fork or unmerged commit is refused', async () => {
  const forkCommit = sha1('f');
  await assert.rejects(select({ mode: ATTEMPT_MODES.historicalReplay, ref: forkCommit }, formalAiDeps({ versions: { [forkCommit]: '0.355.29' } })), error => error instanceof AttemptIdentityError && error.outcome === ATTEMPT_OUTCOMES.mismatch && /not on main/.test(error.message) && error.evidence.sourceSha === forkCommit);
});

test('only a historical replay may run the binary baked into the image, and never :latest', () => {
  const formalAi = { ref: 'image-baked', sourceSha: null, binarySource: BINARY_SOURCES.imageBaked };
  assert.throws(() => buildAttemptIdentity({ mode: ATTEMPT_MODES.liveCurrent, repository: REPOSITORY, issue: 1, formalAi, hive }), /may only run as historical-replay/);
  assert.throws(() => buildAttemptIdentity({ mode: ATTEMPT_MODES.historicalReplay, repository: REPOSITORY, issue: 1, formalAi, hive: { ...hive, image: 'konard/hive-mind:latest' } }), /never runs :latest/);
});

test('a missing release is deferred, not replaced by another', async () => {
  await rejects(select({ mode: ATTEMPT_MODES.publishedRelease, ref: 'v9.9.9' }), ATTEMPT_OUTCOMES.deferred, /no Formal AI release v9\.9\.9/);
  await rejects(select({ mode: ATTEMPT_MODES.publishedRelease }, formalAiDeps({ releases: { 'v0.355.29': null } })), ATTEMPT_OUTCOMES.deferred, /no native receipt/);
  await rejects(select({}, formalAiDeps({ versions: {} })), ATTEMPT_OUTCOMES.deferred, /could not read the Formal AI version/);
});

test("a caller's binary is bound by its digest and the source it names", async () => {
  const identity = await select({ callerBinary: '/tmp/formal-ai', callerSourceSha: NEW_MAIN });
  assert.equal(identity.formalAi.binarySource, BINARY_SOURCES.caller);
  assert.equal(identity.formalAi.callerBinarySha256, sha256('e'));
  assert.equal(identity.formalAi.sourceSha, NEW_MAIN);
  assert.equal(identity.currentSource, true);
  const unbound = await select({ callerBinary: '/tmp/formal-ai' });
  assert.equal(unbound.currentSource, false, 'without a source commit the binary is bound by digest only');

  assert.deepEqual(verifyAttemptBinary({ identity, actualSha256: sha256('e'), reportedVersion: '0.355.29' }).sha256, sha256('e'));
  throwsOutcome(() => verifyAttemptBinary({ identity, actualSha256: sha256('f'), reportedVersion: '0.355.29' }), ATTEMPT_OUTCOMES.mismatch);
});

// --- The binary -------------------------------------------------------------

test('the binary must exist, carry a receipt for the selected source, and answer the selected version', async () => {
  const identity = await select({}, formalAiDeps({ main: NEW_MAIN }));
  const receipt = buildNativeReceipt({ sourceSha: NEW_MAIN, target: 'x86_64-unknown-linux-gnu', executableBytes: 10, executableSha256: sha256('1'), version: '0.355.29' });
  const ok = verifyAttemptBinary({ identity, receipt, actualSha256: sha256('1'), actualBytes: 10, reportedVersion: 'formal-ai 0.355.29' });
  assert.deepEqual(ok, { sha256: sha256('1'), bytes: 10, target: 'x86_64-unknown-linux-gnu', version: '0.355.29', source: BINARY_SOURCES.build });

  throwsOutcome(() => verifyAttemptBinary({ identity, receipt, actualSha256: null }), ATTEMPT_OUTCOMES.deferred, /deferred rather than run on another backend/);
  throwsOutcome(() => verifyAttemptBinary({ identity, receipt: null, actualSha256: sha256('1') }), ATTEMPT_OUTCOMES.deferred, /has no receipt/);
  throwsOutcome(() => verifyAttemptBinary({ identity, receipt, actualSha256: sha256('2'), actualBytes: 10 }), ATTEMPT_OUTCOMES.mismatch, /receipt records/);
  throwsOutcome(() => verifyAttemptBinary({ identity, receipt, actualSha256: sha256('1'), actualBytes: 11 }), ATTEMPT_OUTCOMES.mismatch, /bytes/);
  throwsOutcome(() => verifyAttemptBinary({ identity, receipt, actualSha256: sha256('1'), actualBytes: 10, reportedVersion: 'formal-ai 0.355.28' }), ATTEMPT_OUTCOMES.mismatch, /--version reports 0\.355\.28/);
  throwsOutcome(() => verifyAttemptBinary({ identity, receipt: { ...receipt, version: 2 }, actualSha256: sha256('1') }), ATTEMPT_OUTCOMES.mismatch, /receipt has version 2/);
});

test('the version is read from the selected commit itself', () => {
  assert.equal(readCargoPackageVersion('[workspace]\n[package]\nname = "formal-ai"\nversion = "0.355.29"\n'), '0.355.29');
});

// --- The image ----------------------------------------------------------------

const labels = (revision = HIVE, version = '2.39.11') => ({ 'org.opencontainers.image.revision': revision, 'org.opencontainers.image.version': version });
const DIGEST = `konard/hive-mind@sha256:${sha256('9')}`;

test('the image is bound to the selected Hive Mind source by its labels and pinned by digest', async () => {
  const identity = await select();
  assert.deepEqual(checkHiveImageBinding({ identity, labels: labels(), repoDigest: DIGEST }), { digest: sha256('9'), revision: HIVE, version: '2.39.11', runtimeDrift: [] });
  assert.equal(pinnedImageReference('konard/hive-mind:2.39.11', sha256('9')), `konard/hive-mind@sha256:${sha256('9')}`);
  assert.equal(pinnedImageReference('ghcr.io:443/o/hive-mind:2.39.11', sha256('9')), `ghcr.io:443/o/hive-mind@sha256:${sha256('9')}`);

  const docsOnly = { status: 'ahead', files: [{ filename: 'docs/FORMAL-AI-DRAFTS.md' }, { filename: 'scripts/formal-ai-draft.mjs' }, { filename: 'package.json', patch: '@@ -1 +1 @@\n-  "version": "2.39.10",\n+  "version": "2.39.11",' }] };
  assert.equal(isVersionOnlyPatch(docsOnly.files[2].patch), true);
  assert.equal(checkHiveImageBinding({ identity, labels: labels(HIVE_IMAGE_REVISION), repoDigest: DIGEST, compare: docsOnly }).revision, HIVE_IMAGE_REVISION, 'changes outside the runtime leave the image valid');

  throwsOutcome(() => checkHiveImageBinding({ identity, labels: labels(), repoDigest: null }), ATTEMPT_OUTCOMES.deferred, /no registry digest/);
  throwsOutcome(() => checkHiveImageBinding({ identity, labels: labels(HIVE, '2.39.10'), repoDigest: DIGEST }), ATTEMPT_OUTCOMES.mismatch, /labelled version 2\.39\.10/);
  throwsOutcome(() => checkHiveImageBinding({ identity, labels: { 'org.opencontainers.image.version': '2.39.11' }, repoDigest: DIGEST }), ATTEMPT_OUTCOMES.mismatch, /no source revision/);
  throwsOutcome(() => checkHiveImageBinding({ identity, labels: labels(HIVE_IMAGE_REVISION), repoDigest: DIGEST, compare: { status: 'ahead', files: [{ filename: 'src/solve.mjs' }] } }), ATTEMPT_OUTCOMES.deferred, /not published yet/);
  throwsOutcome(() => checkHiveImageBinding({ identity, labels: labels(HIVE_IMAGE_REVISION), repoDigest: DIGEST, compare: { status: 'diverged', files: [] } }), ATTEMPT_OUTCOMES.mismatch, /diverged/);
  throwsOutcome(() => checkHiveImageBinding({ identity, labels: labels(HIVE_IMAGE_REVISION), repoDigest: DIGEST, compare: null }), ATTEMPT_OUTCOMES.deferred, /could not compare/);
});

test('a missing image is deferred; nothing pulls an older tag or :latest', async () => {
  const pulled = [];
  const run = async args => {
    pulled.push(args.at(-1));
    return { code: 1, output: `Error response from daemon: manifest for ${args.at(-1)} not found: manifest unknown: manifest unknown` };
  };
  await assert.rejects(pullDraftImage({ image: 'konard/hive-mind:2.39.11', run, sleep: async () => {}, delays: [0], log: () => {} }), DraftImageUnavailableError);
  assert.ok(pulled.length > 0 && pulled.every(image => image === 'konard/hive-mind:2.39.11'), `only the exact image is ever pulled: ${pulled}`);
});

// --- The serving process ------------------------------------------------------

const probe = (overrides = {}) => ({ ok: true, probedAt: 'now', binary: { path: '/usr/local/bin/formal-ai', sha256: sha256('1'), version: '0.355.29' }, hive: { version: '2.39.11' }, agent: { version: '0.1.0' }, server: { ok: true, pid: 7, healthVersion: '0.355.29', exeSha256: sha256('1') }, ...overrides });

test('the process that answers /health must run the selected executable', async () => {
  const identity = await select();
  assert.equal(verifyServingIdentity({ identity, expectedSha256: sha256('1'), probe: probe() }).servingExeSha256, sha256('1'));
  throwsOutcome(() => verifyServingIdentity({ identity, expectedSha256: sha256('1'), probe: { ok: false, error: 'formal-ai serve exited' } }), ATTEMPT_OUTCOMES.deferred, /did not complete/);
  throwsOutcome(() => verifyServingIdentity({ identity, expectedSha256: sha256('1'), probe: probe({ binary: { sha256: sha256('2'), version: '0.355.29' } }) }), ATTEMPT_OUTCOMES.mismatch, /resolves formal-ai/);
  throwsOutcome(() => verifyServingIdentity({ identity, expectedSha256: sha256('1'), probe: probe({ server: { ok: true, healthVersion: '0.355.29', exeSha256: sha256('2') } }) }), ATTEMPT_OUTCOMES.mismatch, /serving \/health runs an executable/);
  throwsOutcome(() => verifyServingIdentity({ identity, expectedSha256: sha256('1'), probe: probe({ binary: { sha256: sha256('1'), version: '0.355.28' }, server: { ok: true, healthVersion: '0.355.28', exeSha256: sha256('1') } }) }), ATTEMPT_OUTCOMES.mismatch, /selected 0\.355\.29/);
  throwsOutcome(() => verifyServingIdentity({ identity, expectedSha256: sha256('1'), probe: probe({ hive: { version: '2.39.10' } }) }), ATTEMPT_OUTCOMES.mismatch, /Hive Mind 2\.39\.10/);
});

// --- The preflight: in order, and nothing after the first failure -------------

const preflightDeps = (calls, overrides = {}) => ({
  inspectBinary: async () => (calls.push('binary'), { sha256: sha256('1'), bytes: 10 }),
  binaryVersion: async () => 'formal-ai 0.355.29',
  pullImage: async image => (calls.push(`pull ${image}`), image),
  inspectImage: async () => (calls.push('inspect'), { labels: labels(), repoDigest: DIGEST }),
  compare: async () => (calls.push('compare'), { status: 'identical', files: [] }),
  probe: async ({ image, binaryPath }) => (calls.push(`probe ${image} ${binaryPath}`), probe()),
  ...overrides,
});

test('the preflight verifies binary, image and serving process before solve, in that order', async () => {
  const identity = await select({}, formalAiDeps({ main: NEW_MAIN }));
  const receipt = buildNativeReceipt({ sourceSha: NEW_MAIN, target: 'x86_64-unknown-linux-gnu', executableBytes: 10, executableSha256: sha256('1'), version: '0.355.29' });
  const calls = [];
  const record = await verifyAttemptPreflight({ identity, binaryPath: '/tmp/a/formal-ai', receipt, deps: preflightDeps(calls), now: () => 'now' });
  const pinned = `konard/hive-mind@sha256:${sha256('9')}`;
  assert.deepEqual(calls, ['binary', 'pull konard/hive-mind:2.39.11', 'inspect', `probe ${pinned} /tmp/a/formal-ai`]);
  assert.equal(record.image.reference, pinned, 'the probe and solve run the digest, so a moved tag cannot change the attempt');
  assert.equal(record.attemptId, identity.id);
  assert.deepEqual(record.attemptEnv, { [ATTEMPT_ENV.id]: identity.id, [ATTEMPT_ENV.mode]: 'live-current', [ATTEMPT_ENV.expectedSha256]: sha256('1'), [ATTEMPT_ENV.expectedVersion]: '0.355.29', [ATTEMPT_ENV.expectedSource]: NEW_MAIN });

  const missing = [];
  await rejects(verifyAttemptPreflight({ identity, binaryPath: null, receipt, deps: preflightDeps(missing) }), ATTEMPT_OUTCOMES.deferred);
  assert.deepEqual(missing, [], 'a missing binary is deferred before any image is pulled');

  const noImage = [];
  const unpublished = async () => {
    throw new DraftImageUnavailableError('konard/hive-mind:2.39.11 is not published', { missing: true });
  };
  await rejects(verifyAttemptPreflight({ identity, binaryPath: '/tmp/a/formal-ai', receipt, deps: preflightDeps(noImage, { pullImage: unpublished }) }), ATTEMPT_OUTCOMES.deferred, /not published/);
  assert.deepEqual(noImage, ['binary'], 'no probe and no solve without the exact image');

  const wrongServer = [];
  await rejects(verifyAttemptPreflight({ identity, binaryPath: '/tmp/a/formal-ai', receipt, deps: preflightDeps(wrongServer, { probe: async () => probe({ server: { ok: true, healthVersion: '0.355.29', exeSha256: sha256('2') } }) }) }), ATTEMPT_OUTCOMES.mismatch);
});

test('a replay of the image-baked binary is pinned to what the probe saw serving', async () => {
  const identity = await select({ mode: ATTEMPT_MODES.historicalReplay });
  const calls = [];
  const record = await verifyAttemptPreflight({ identity, deps: preflightDeps(calls) });
  assert.equal(record.binary, null);
  assert.ok(calls.at(-1).endsWith(' null'), 'nothing is mounted over the image');
  assert.equal(record.attemptEnv[ATTEMPT_ENV.expectedSha256], sha256('1'));
  assert.equal(record.currentSource, false);
});

test('an attempt that ends before solve records its outcome and earns no credit', async () => {
  const identity = await select();
  const record = buildOutcomeRecord({ identity, error: new AttemptIdentityError(ATTEMPT_OUTCOMES.deferred, 'no binary', { source: 'build' }), at: 'now' });
  assert.deepEqual(record, { schema: 'hive-mind/formal-ai-draft-attempt-outcome/v1', attemptId: identity.id, mode: 'live-current', outcome: 'deferred-infrastructure', message: 'no binary', evidence: { source: 'build' }, capabilityCredit: 0, at: 'now' });
  assert.notEqual(ATTEMPT_OUTCOME_ANNOTATION_TITLES[ATTEMPT_OUTCOMES.deferred], 'Formal AI draft failed', 'a deferral is never read as a model failure');
  assert.deepEqual(buildAttemptEnv({ identity, binarySha256: null }), { [ATTEMPT_ENV.id]: identity.id, [ATTEMPT_ENV.mode]: 'live-current', [ATTEMPT_ENV.expectedVersion]: '0.355.29', [ATTEMPT_ENV.expectedSource]: OLD_MAIN });
});

// --- solve's own check of the server it starts (src/) -------------------------

test('solve refuses a wrapper or a server that is not the selected binary', async () => {
  assert.equal(readFormalAiAttemptExpectation({}), null, 'an ordinary run carries no expectation');
  const expectation = readFormalAiAttemptExpectation({ [ATTEMPT_ENV.id]: 'id1', [ATTEMPT_ENV.mode]: 'live-current', [ATTEMPT_ENV.expectedSha256]: `sha256:${sha256('1')}`, [ATTEMPT_ENV.expectedVersion]: '0.355.29' });
  assert.equal(expectation.sha256, sha256('1'));
  assert.throws(() => readFormalAiAttemptExpectation({ [ATTEMPT_ENV.expectedSha256]: 'nope' }), /not a sha256/);

  const deps = hash => ({ resolveExecutableImpl: async () => '/usr/local/bin/formal-ai', hashImpl: async () => hash });
  assert.deepEqual(await verifyFormalAiWrapperBinding({ expectation, formalAiPath: 'formal-ai', deps: deps(sha256('1')) }), { path: '/usr/local/bin/formal-ai', sha256: sha256('1') });
  await assert.rejects(verifyFormalAiWrapperBinding({ expectation, formalAiPath: 'formal-ai', deps: deps(sha256('2')) }), /Refusing to run a different backend/);

  assert.equal((await verifyFormalAiServingBinding({ expectation, serverPid: 7, servingVersion: '0.355.29', deps: deps(sha256('1')) })).servingExeSha256, sha256('1'));
  await assert.rejects(verifyFormalAiServingBinding({ expectation, serverPid: 7, servingVersion: '0.355.28', deps: deps(sha256('1')) }), /reports Formal AI 0\.355\.28/);
  await assert.rejects(verifyFormalAiServingBinding({ expectation, serverPid: 7, servingVersion: '0.355.29', deps: deps(sha256('2')) }), /runs an executable hashing/);
  await assert.rejects(verifyFormalAiServingBinding({ expectation, serverPid: null, servingVersion: '0.355.29', deps: deps(sha256('1')) }), /external endpoint/);
});

// --- GitHub lookups -----------------------------------------------------------

test('admission reads the release receipt, and a missing release is null rather than an error', async () => {
  const calls = [];
  const gh = async args => {
    calls.push(args.join(' '));
    const [, endpoint] = args;
    if (endpoint.endsWith('/releases/tags/v0.355.29')) return JSON.stringify({ tag_name: 'v0.355.29', assets: [{ id: 5, name: 'formal-ai-native-x86_64-unknown-linux-musl-0.355.29.json', digest: `sha256:${sha256('7')}` }] });
    if (endpoint.endsWith('/releases/assets/5')) return JSON.stringify({ version: 1, identity: { source_commit: OLD_MAIN.toUpperCase() } });
    if (endpoint.includes('/commits/main')) return `${NEW_MAIN}\n`;
    if (endpoint.endsWith(`/compare/${OLD_MAIN}...main`)) return 'ahead\n';
    if (endpoint.endsWith(`/compare/${HIVE}...main`)) return 'diverged\n';
    if (endpoint.includes('/contents/rust/Cargo.toml')) return '[package]\nversion = "0.355.29"\n';
    const error = new Error('gh: Not Found (HTTP 404)');
    error.stderr = 'gh: Not Found (HTTP 404)';
    throw error;
  };
  const deps = createGitHubSelectDeps({ gh, hashFile: async () => '', binaryVersion: async () => '' });
  assert.deepEqual(await deps.releaseForVersion('0.355.29'), { tag: 'v0.355.29', version: '0.355.29', sourceSha: OLD_MAIN, receiptDigest: `sha256:${sha256('7')}` });
  assert.equal(await deps.releaseForVersion('9.9.9'), null);
  assert.equal(await deps.resolveCommit('main'), `${NEW_MAIN}`);
  assert.equal(await deps.readVersion(NEW_MAIN), '0.355.29');
  assert.equal(await deps.onDefaultBranch(OLD_MAIN), true);
  assert.equal(await deps.onDefaultBranch(HIVE), false, 'a diverged commit is not on the default branch');
  const identity = await select({}, deps);
  assert.equal(identity.formalAi.binarySource, BINARY_SOURCES.build, 'end to end: same version, other commit → build');
  assert.ok(
    calls.some(call => call.includes('Accept: application/octet-stream')),
    'the receipt asset itself is read'
  );
});

// --- Health: a deferral is infrastructure, not a model failure ----------------

test('the health check reads deferred and mismatch outcomes as infrastructure', () => {
  const run = (n, title, message) => ({
    run: { html_url: `https://x/${n}`, created_at: `2026-11-0${n}T00:00:00Z`, status: 'completed', conclusion: 'failure', event: 'issues' },
    annotations: [
      { title: 'Formal AI draft decision', message: 'run' },
      { title, message },
    ],
  });
  const deferred = [1, 2, 3, 4, 5].map(n => run(n, ATTEMPT_OUTCOME_ANNOTATION_TITLES[ATTEMPT_OUTCOMES.deferred], `attempt ${String(n).repeat(4)}abcdef0123456789abcdef0123: konard/hive-mind:2.39.11 is not published`));
  const outcomes = deferred.map(({ run: r, annotations }) => runOutcomeFromAnnotations(r, annotations));
  assert.equal(outcomes[0].attemptOutcome, ATTEMPT_OUTCOMES.deferred);
  assert.equal(outcomes[0].firstError, null);
  const jobs = [{ steps: [{ name: 'Open the Formal AI draft', started_at: 'x', conclusion: 'failure' }] }];
  assert.equal(isExecutedAttempt(deferred[0].run, jobs, outcomes[0]), false, 'no model ran');
  assert.equal(isExecutedAttempt(deferred[0].run, jobs, runOutcomeFromAnnotations(deferred[0].run, [])), true);
  const streak = findRepeatedFailure(outcomes);
  assert.ok(streak?.key.startsWith('deferred-infrastructure: '), `a repeating deferral is still flagged, as infrastructure: ${streak?.key}`);
});

// --- The workflow -------------------------------------------------------------

test('the workflow selects once, obtains the binary, then verifies before the draft', () => {
  const workflow = readFileSync('.github/workflows/formal-ai-draft.yml', 'utf8');
  const job = name => workflow.split(/^ {2}(?=[A-Za-z0-9_-]+:$)/m).find(block => block.startsWith(`${name}:`));
  const select = job('select');
  assert.match(select, /node scripts\/formal-ai-draft\.mjs --decide/);
  assert.match(select, /node scripts\/formal-ai-draft-select\.mjs/);
  for (const output of ['attempt_id', 'formal_ai_sha', 'formal_ai_binary_source', 'hive_sha', 'identity_json']) assert.match(select, new RegExp(`^ {6}${output}: \\$\\{\\{ steps\\.select\\.outputs\\.${output} \\}\\}$`, 'm'));

  const binary = job('binary');
  assert.match(binary, /needs: select/);
  assert.match(binary, /ref: \$\{\{ needs\.select\.outputs\.hive_sha \}\}/);
  assert.match(binary, /ref: \$\{\{ needs\.select\.outputs\.formal_ai_sha \}\}/, 'the build is of the selected commit, not a branch');
  assert.match(binary, /cargo build --manifest-path rust\/Cargo\.toml --target-dir target --release --locked --bin formal-ai/);
  assert.match(binary, /formal-ai-draft-binary\.mjs verify/);
  assert.doesNotMatch(workflow, /actions\/cache/, 'no attempt trusts a build cached by another run (CodeQL actions/cache-poisoning)');

  const draft = job('draft');
  assert.match(draft, /needs: \[select, binary\]/);
  assert.match(draft, /ref: \$\{\{ needs\.select\.outputs\.hive_sha \}\}/, 'the draft runs the Hive Mind commit admission selected');
  assert.match(draft, /FORMAL_AI_DRAFT_ATTEMPT_IDENTITY: \$\{\{ needs\.select\.outputs\.identity_json \}\}/);
  assert.match(draft, /FORMAL_AI_DRAFT_BINARY_JOB_RESULT: \$\{\{ needs\.binary\.result \}\}/);
  assert.match(draft, /name: formal-ai-binary-\$\{\{ needs\.select\.outputs\.attempt_id \}\}/);
  assert.doesNotMatch(workflow, /:latest\b/);

  const on = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\npermissions:'));
  for (const input of ['mode', 'formal_ai_ref', 'attempt_identity', 'preflight_only', 'formal_ai_source_sha']) assert.match(on, new RegExp(`^ {6}${input}:$`, 'm'), `input ${input}`);
});
