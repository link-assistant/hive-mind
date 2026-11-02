/**
 * One immutable identity per Formal AI draft attempt (issue #3909).
 *
 * Why this exists
 * ---------------
 * On 2026-10-30 an issue-created draft ran Formal AI 0.355.15, the backend
 * baked into the Hive Mind image, while 0.355.23 had been published twelve
 * hours earlier. The serving-version probe reported it faithfully; nothing
 * *selected* the intended backend. A one-time bump of `FORMAL_AI_VERSION` only
 * postpones the same defect, so the fix is selection and custody:
 *
 *   1. at admission, resolve the Formal AI and Hive Mind sources once and
 *      record them (`buildAttemptIdentity`);
 *   2. obtain a binary for exactly that Formal AI source, carrying the same v1
 *      native receipt Formal AI's own release pipeline publishes
 *      (`buildNativeReceipt`, `verifyNativeReceipt`) — no second provenance
 *      protocol;
 *   3. bind the source, the binary digest, the image digest and the process
 *      that actually serves the task (`checkHiveImageBinding`,
 *      `verifyServingIdentity`) before any task effect;
 *   4. refuse to run anything else: a missing or mismatched artefact is a
 *      typed `deferred` outcome, never an older image or `:latest`.
 *
 * Everything here is a pure function over plain data, so drift, mismatch,
 * missing-artefact and mode-labelling cases are tested without GitHub, Docker,
 * Cargo or a model (`tests/formal-ai-draft-identity-3909.test.mjs`).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3909
 * @see https://github.com/link-assistant/formal-ai/issues/1484
 * @module formal-ai-draft-identity
 */

import { createHash } from 'node:crypto';

export const ATTEMPT_IDENTITY_SCHEMA = 'hive-mind/formal-ai-draft-attempt-identity/v1';

/** Where Formal AI's source lives; a live attempt follows its default branch. */
export const FORMAL_AI_REPOSITORY = 'link-assistant/formal-ai';
export const FORMAL_AI_DEFAULT_BRANCH = 'main';

/**
 * The three ways an attempt may select what it runs. They are kept apart in
 * the identity, the outputs, the annotations and the pull request label so a
 * replay can never be read as current-source evidence.
 */
export const ATTEMPT_MODES = Object.freeze({
  /** Formal AI default-branch head and the checked-out Hive Mind, resolved at admission. */
  liveCurrent: 'live-current',
  /** A published Formal AI release (latest unless named), with its release receipt. */
  publishedRelease: 'published-release',
  /** An explicitly pinned historical source; never reported as current-source success. */
  historicalReplay: 'historical-replay',
});

/** Pull request label per mode; live attempts carry only the ordinary draft label. */
export const ATTEMPT_MODE_LABELS = Object.freeze({
  [ATTEMPT_MODES.publishedRelease]: 'formal-ai-release-qualification',
  [ATTEMPT_MODES.historicalReplay]: 'formal-ai-historical-replay',
});

/** How the binary for the selected source is obtained. */
export const BINARY_SOURCES = Object.freeze({
  /** The release asset whose published receipt names the selected source commit. */
  release: 'release',
  /**
   * `cargo build --locked` of the selected commit in this workflow. A cached
   * build of the same commit is reused and re-verified against its receipt;
   * whether the cache hit is evidence, not part of the selection, so a retry
   * keeps its identity either way.
   */
  build: 'build',
  /** A caller (`workflow_call`, Formal AI's own issue workflow) mounted its own build. */
  caller: 'caller',
  /** The binary baked into the image. Historical replay only. */
  imageBaked: 'image-baked',
});

/** Typed outcomes the attempt can end with besides an ordinary solve exit. */
export const ATTEMPT_OUTCOMES = Object.freeze({
  /** An artefact for the exact selection is unavailable: infrastructure, retry later, zero capability credit. */
  deferred: 'deferred-infrastructure',
  /** An artefact exists but is not the selected one: refused before any task effect. */
  mismatch: 'identity-mismatch',
});

/**
 * Annotation titles. The scheduled health check reads them back: a deferred or
 * mismatched attempt is an infrastructure outcome, never a model failure, and
 * earns no capability credit.
 */
export const ATTEMPT_ANNOTATION_TITLE = 'Formal AI draft attempt';
export const ATTEMPT_OUTCOME_ANNOTATION_TITLES = Object.freeze({
  [ATTEMPT_OUTCOMES.deferred]: 'Formal AI draft deferred',
  [ATTEMPT_OUTCOMES.mismatch]: 'Formal AI draft identity mismatch',
});

/** The target a build in this workflow produces: glibc, which the Ubuntu 24.04 image and runner share. */
export const BUILD_TARGET = 'x86_64-unknown-linux-gnu';

/** The release asset and receipt a published Formal AI release carries for Linux x64. */
export const RELEASE_CLI_ASSET = 'formal-ai-cli-x86_64-unknown-linux-musl.tar.gz';
export const RELEASE_CLI_BINARY_PATH = 'formal-ai-cli-x86_64-unknown-linux-musl/formal-ai';
export const releaseReceiptAsset = version => `formal-ai-native-x86_64-unknown-linux-musl-${version}.json`;

/** The native receipt version Formal AI's release pipeline writes (`formal-ai-native-*.json`). */
export const NATIVE_RECEIPT_VERSION = 1;

/** The attempt's binary and receipt, as one directory, in the cache, the artifact and the mount. */
export const BINARY_FILE = 'formal-ai';
export const RECEIPT_FILE = 'formal-ai-receipt.json';
export const IDENTITY_FILE = 'attempt-identity.json';
export const OUTCOME_FILE = 'attempt-outcome.json';

/** Environment the solve container reads to verify the process that serves it. */
export const ATTEMPT_ENV = Object.freeze({
  id: 'HIVE_MIND_ATTEMPT_ID',
  mode: 'HIVE_MIND_ATTEMPT_MODE',
  expectedSha256: 'HIVE_MIND_FORMAL_AI_EXPECTED_SHA256',
  expectedVersion: 'HIVE_MIND_FORMAL_AI_EXPECTED_VERSION',
  expectedSource: 'HIVE_MIND_FORMAL_AI_EXPECTED_SOURCE',
});

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** A typed failure: `outcome` is one of {@link ATTEMPT_OUTCOMES}. */
export class AttemptIdentityError extends Error {
  constructor(outcome, message, evidence = {}) {
    super(message);
    this.name = 'AttemptIdentityError';
    this.outcome = outcome;
    this.evidence = evidence;
  }
}

const deferred = (message, evidence) => new AttemptIdentityError(ATTEMPT_OUTCOMES.deferred, message, evidence);
const mismatch = (message, evidence) => new AttemptIdentityError(ATTEMPT_OUTCOMES.mismatch, message, evidence);

/** `sha256:<hex>` or `<hex>` to bare lower-case hex, or null. */
export const normalizeSha256 = value => {
  const hex = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, '');
  return SHA256.test(hex) ? hex : null;
};

/** Stable JSON: keys sorted at every level, so equal selections hash equal. */
export const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter(key => value[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
};

/**
 * Parse a mode, defaulting to live. An unknown mode is an error rather than a
 * silent live attempt: a mistyped `historical` must not produce a run that
 * looks like current-source evidence.
 */
export const parseAttemptMode = value => {
  const mode = String(value || '').trim() || ATTEMPT_MODES.liveCurrent;
  if (!Object.values(ATTEMPT_MODES).includes(mode)) throw new Error(`unknown Formal AI draft mode ${JSON.stringify(mode)}; expected one of ${Object.values(ATTEMPT_MODES).join(', ')}`);
  return mode;
};

/**
 * The part of an identity that names *what was selected*. Its hash is the
 * attempt id: a retry of the same selection keeps it, a new Formal AI or Hive
 * Mind source yields a new one. When and where the selection happened is
 * recorded beside it, not inside it.
 */
const selectionOf = identity => ({
  schema: identity.schema,
  mode: identity.mode,
  repository: identity.repository,
  issue: identity.issue,
  formalAi: { repository: identity.formalAi.repository, sourceSha: identity.formalAi.sourceSha, ref: identity.formalAi.ref, version: identity.formalAi.version, binarySource: identity.formalAi.binarySource, releaseTag: identity.formalAi.release?.tag ?? null, callerBinarySha256: identity.formalAi.callerBinarySha256 ?? null },
  hive: { repository: identity.hive.repository, sourceSha: identity.hive.sourceSha, version: identity.hive.version, image: identity.hive.image },
});

export const attemptIdentityId = identity =>
  createHash('sha256')
    .update(canonicalJson(selectionOf(identity)))
    .digest('hex')
    .slice(0, 32);

/**
 * Build the identity at admission. Every field the attempt is later checked
 * against is fixed here; nothing downstream re-resolves a branch.
 *
 * @param {object} params
 * @param {string} params.mode one of {@link ATTEMPT_MODES}
 * @param {string} params.repository the repository the issue belongs to
 * @param {number|string} params.issue
 * @param {{repository?: string, ref: string, sourceSha: string|null, version?: string|null, binarySource: string, release?: object|null, callerBinarySha256?: string|null}} params.formalAi
 * @param {{repository: string, sourceSha: string, version: string, image: string}} params.hive
 * @param {{at: string, runId?: string, runAttempt?: string, runUrl?: string}} params.selected
 */
export function buildAttemptIdentity({ mode, repository, issue, formalAi, hive, selected }) {
  const resolvedMode = parseAttemptMode(mode);
  const binarySource = formalAi?.binarySource;
  if (!Object.values(BINARY_SOURCES).includes(binarySource)) throw new Error(`unknown Formal AI binary source ${JSON.stringify(binarySource)}`);
  if (binarySource === BINARY_SOURCES.imageBaked && resolvedMode !== ATTEMPT_MODES.historicalReplay) {
    throw new Error(`the image-baked Formal AI binary may only run as ${ATTEMPT_MODES.historicalReplay}; a ${resolvedMode} attempt must select its Formal AI source (issue #3909)`);
  }
  const sourceSha = formalAi.sourceSha ? String(formalAi.sourceSha).toLowerCase() : null;
  if (sourceSha && !SHA1.test(sourceSha)) throw new Error(`Formal AI source must be a full commit SHA, received ${JSON.stringify(formalAi.sourceSha)}`);
  if (!sourceSha && ![BINARY_SOURCES.caller, BINARY_SOURCES.imageBaked].includes(binarySource)) throw new Error('a Formal AI source commit is required to obtain a binary for it');
  if (!SHA1.test(String(hive?.sourceSha || ''))) throw new Error(`Hive Mind source must be a full commit SHA, received ${JSON.stringify(hive?.sourceSha)}`);
  if (!SEMVER.test(String(hive?.version || ''))) throw new Error(`Hive Mind version must be a release version, received ${JSON.stringify(hive?.version)}`);
  if (!String(hive?.image || '').trim()) throw new Error('a Hive Mind image is required');
  if (/:latest$/.test(hive.image)) throw new Error(`${hive.image} is not an exact image; an attempt never runs :latest (issue #3909)`);

  const identity = {
    schema: ATTEMPT_IDENTITY_SCHEMA,
    id: null,
    mode: resolvedMode,
    // Current-source evidence needs a live attempt *and* a known source: a
    // caller's binary without a source commit is bound by digest only.
    currentSource: resolvedMode === ATTEMPT_MODES.liveCurrent && Boolean(sourceSha),
    repository,
    issue: Number(issue),
    formalAi: {
      repository: formalAi.repository || FORMAL_AI_REPOSITORY,
      ref: formalAi.ref || null,
      sourceSha,
      version: formalAi.version || null,
      binarySource,
      release: formalAi.release || null,
      callerBinarySha256: normalizeSha256(formalAi.callerBinarySha256),
    },
    hive: { repository: hive.repository, sourceSha: hive.sourceSha.toLowerCase(), version: hive.version, image: hive.image.trim() },
    selected: { at: selected?.at || null, runId: selected?.runId || null, runAttempt: selected?.runAttempt || null, runUrl: selected?.runUrl || null },
  };
  identity.id = attemptIdentityId(identity);
  return identity;
}

/**
 * Re-read an identity handed from one job to the next and check it was not
 * edited on the way: the id must still be the hash of the selection.
 */
export function parseAttemptIdentity(text) {
  let identity;
  try {
    identity = typeof text === 'string' ? JSON.parse(text) : text;
  } catch (error) {
    throw mismatch(`the attempt identity is not JSON: ${error.message}`);
  }
  if (identity?.schema !== ATTEMPT_IDENTITY_SCHEMA) throw mismatch(`the attempt identity has schema ${JSON.stringify(identity?.schema)}, expected ${ATTEMPT_IDENTITY_SCHEMA}`);
  const expected = attemptIdentityId(identity);
  if (identity.id !== expected) throw mismatch(`the attempt identity ${identity.id} does not match its own selection (${expected}); it was changed after admission`, { recorded: identity.id, recomputed: expected });
  return identity;
}

/**
 * The v1 native receipt for a binary this workflow built, in the shape Formal
 * AI's release pipeline publishes (`formal-ai-native-<target>-<version>.json`),
 * so one verifier reads both.
 */
export function buildNativeReceipt({ sourceSha, sourceTree, cargoLockSha256, target, compiler, compilerRelease, compilerCommit, producerRun, producerJob, producerAttempt, executableBytes, executableSha256, version }) {
  return {
    version: NATIVE_RECEIPT_VERSION,
    identity: {
      source_commit: sourceSha,
      source_tree: sourceTree || null,
      cargo_lock_sha256: cargoLockSha256 || null,
      target,
      profile: 'release',
      requested_features: 'default',
      compiler_release: compilerRelease || null,
      compiler_commit: compilerCommit || null,
      producer_run: producerRun ? String(producerRun) : null,
      producer_repository: 'link-assistant/hive-mind',
      package_version: version || null,
    },
    producer: { job: producerJob || null, attempt: producerAttempt ? String(producerAttempt) : null, compiler: compiler || null },
    executable: { name: BINARY_FILE, bytes: executableBytes, sha256: executableSha256 },
  };
}

/**
 * Accept a binary only when its receipt names the selected source and its
 * bytes are the receipt's bytes. Used for a cache hit, a release asset and a
 * fresh build alike; a failure is a mismatch, never a reason to fall back.
 *
 * @param {object} params
 * @param {object} params.receipt parsed v1 native receipt
 * @param {string} params.actualSha256 digest of the file that will be mounted
 * @param {number} [params.actualBytes]
 * @param {object} params.identity the attempt identity
 * @returns {{sha256: string, bytes: number|null, target: string|null}}
 */
export function verifyNativeReceipt({ receipt, actualSha256, actualBytes = null, identity }) {
  if (!receipt || receipt.version !== NATIVE_RECEIPT_VERSION) throw mismatch(`the Formal AI receipt has version ${JSON.stringify(receipt?.version)}, expected ${NATIVE_RECEIPT_VERSION}`);
  const recordedSha = normalizeSha256(receipt.executable?.sha256);
  const actual = normalizeSha256(actualSha256);
  if (!recordedSha) throw mismatch('the Formal AI receipt records no executable sha256');
  if (!actual) throw deferred('the Formal AI binary could not be hashed');
  if (recordedSha !== actual) throw mismatch(`the Formal AI binary hashes to ${actual}, but its receipt records ${recordedSha}`, { recordedSha, actual });
  if (actualBytes !== null && receipt.executable?.bytes !== undefined && Number(receipt.executable.bytes) !== Number(actualBytes)) throw mismatch(`the Formal AI binary is ${actualBytes} bytes, but its receipt records ${receipt.executable.bytes}`);
  const selected = identity?.formalAi?.sourceSha;
  const recordedSource = String(receipt.identity?.source_commit || '').toLowerCase();
  if (selected && recordedSource !== selected) throw mismatch(`the Formal AI receipt was built from ${recordedSource || 'an unrecorded source'}, but this attempt selected ${selected}`, { selected, recordedSource });
  return { sha256: actual, bytes: actualBytes ?? receipt.executable?.bytes ?? null, target: receipt.identity?.target || null };
}

/**
 * Accept the binary an attempt will mount, before any container starts.
 *
 * A release or build binary must carry a receipt naming the selected source
 * and its own bytes; a caller's binary must be the one hashed at admission.
 * Either way `formal-ai --version` must answer the selected version. A missing
 * binary is deferred (an artefact to produce), a different one is a mismatch.
 *
 * @param {object} params
 * @param {object} params.identity
 * @param {object|null} [params.receipt]
 * @param {string|null} params.actualSha256 null when there is no file
 * @param {number|null} [params.actualBytes]
 * @param {string|null} [params.reportedVersion] `formal-ai --version` output
 * @returns {{sha256: string, bytes: number|null, target: string|null, version: string|null, source: string}|null} null for the image-baked binary
 */
export function verifyAttemptBinary({ identity, receipt = null, actualSha256, actualBytes = null, reportedVersion = null }) {
  const source = identity.formalAi.binarySource;
  if (source === BINARY_SOURCES.imageBaked) return null;
  const actual = normalizeSha256(actualSha256);
  if (!actual) throw deferred(`no Formal AI binary is available for attempt ${identity.id} (${source}); the attempt is deferred rather than run on another backend`, { source });
  let verified;
  if (source === BINARY_SOURCES.caller) {
    const expected = identity.formalAi.callerBinarySha256;
    if (expected && actual !== expected) throw mismatch(`the caller's Formal AI binary hashes to ${actual}, but the attempt was admitted with ${expected}`, { expected, actual });
    verified = receipt ? verifyNativeReceipt({ receipt, actualSha256: actual, actualBytes, identity }) : { sha256: actual, bytes: actualBytes, target: null };
  } else {
    if (!receipt) throw deferred(`the ${source} Formal AI binary for attempt ${identity.id} has no receipt, so it cannot be bound to ${identity.formalAi.sourceSha}`, { source });
    verified = verifyNativeReceipt({ receipt, actualSha256: actual, actualBytes, identity });
  }
  const version = versionOf(reportedVersion);
  if (identity.formalAi.version && version !== identity.formalAi.version) throw mismatch(`formal-ai --version reports ${version ?? 'nothing'}, but this attempt selected Formal AI ${identity.formalAi.version}`, { version });
  return { ...verified, version, source };
}

/** The GitHub compare statuses under which the image's revision is the checked-out source or an ancestor of it. */
const ANCESTRY = new Set(['identical', 'ahead']);

/**
 * Paths that change what runs inside a Hive Mind image. The image installs the
 * published npm package (`files`: `src`, `locales`, `*.md`) on top of the
 * Dockerfile, so a change elsewhere — docs, tests, workflows, the draft
 * scripts that run on the runner — leaves the image's runtime as it was.
 * `package.json` counts unless only its `"version"` moved.
 */
const RUNTIME_PATH = /^(?:src\/|locales\/|Dockerfile$|\.dockerignore$|package\.json$)/;
const VERSION_ONLY_LINE = /^[+-]\s*"version":\s*"[^"]*",?\s*$/;

/** True when a unified diff of `package.json`/`package-lock.json` only moves `"version"` lines. */
export const isVersionOnlyPatch = patch =>
  typeof patch === 'string' &&
  patch
    .split('\n')
    .filter(line => /^[+-]/.test(line) && !/^(?:\+\+\+|---)/.test(line))
    .every(line => VERSION_ONLY_LINE.test(line));

/**
 * Bind the pulled image to the selected Hive Mind source.
 *
 * The release workflow labels an image with the merge commit it built
 * (`org.opencontainers.image.revision`) and its version
 * (`org.opencontainers.image.version`); the version bump lands one commit
 * later. So the image matches the selected source when its version is the
 * checked-out version, its revision is the selected commit or an ancestor of
 * it, and nothing between them changes what runs inside the image.
 *
 * @param {object} params
 * @param {object} params.identity
 * @param {Record<string,string>} params.labels the pulled image's labels
 * @param {string|null} params.repoDigest `repo@sha256:…` of the pulled image
 * @param {{status: string, files?: Array<{filename: string, patch?: string}>}|null} params.compare GitHub compare of revision...selected source; null when the revision is the selected source
 * @returns {{digest: string, revision: string, version: string, runtimeDrift: string[]}}
 */
export function checkHiveImageBinding({ identity, labels = {}, repoDigest = null, compare = null }) {
  const digest = normalizeSha256(String(repoDigest || '').split('@')[1]);
  if (!digest) throw deferred(`${identity.hive.image} has no registry digest; only a published, digest-addressed image can be bound to an attempt`);
  const version = labels['org.opencontainers.image.version'] || null;
  const revision = String(labels['org.opencontainers.image.revision'] || '').toLowerCase() || null;
  if (version !== identity.hive.version) throw mismatch(`${identity.hive.image} is labelled version ${version ?? 'none'}, but this attempt selected Hive Mind ${identity.hive.version}`, { version });
  if (!revision || !SHA1.test(revision)) throw mismatch(`${identity.hive.image} carries no source revision label, so it cannot be bound to Hive Mind ${identity.hive.sourceSha}`);
  if (revision === identity.hive.sourceSha) return { digest, revision, version, runtimeDrift: [] };
  if (!compare) throw deferred(`could not compare the image revision ${revision} with the selected Hive Mind source ${identity.hive.sourceSha}`);
  if (!ANCESTRY.has(compare.status)) throw mismatch(`${identity.hive.image} was built from ${revision}, which is ${compare.status ?? 'unrelated'} relative to the selected Hive Mind source ${identity.hive.sourceSha}`, { revision, status: compare.status });
  const runtimeDrift = (compare.files || []).filter(file => RUNTIME_PATH.test(file.filename) && !(file.filename === 'package.json' && isVersionOnlyPatch(file.patch))).map(file => file.filename);
  if ((compare.files || []).length >= 300) throw deferred(`${identity.hive.image} (built from ${revision}) is ${compare.files.length}+ files behind the selected Hive Mind source; too many to verify the runtime is unchanged`, { revision });
  // The selected source is newer than every published image of its version: the
  // release that publishes it has not finished. That is a missing artefact, so
  // the attempt is deferred rather than run on the older image.
  if (runtimeDrift.length) throw deferred(`${identity.hive.image} (built from ${revision}) does not contain the selected Hive Mind source ${identity.hive.sourceSha}: ${runtimeDrift.slice(0, 10).join(', ')}${runtimeDrift.length > 10 ? ', …' : ''} changed since; its image is not published yet`, { revision, runtimeDrift });
  return { digest, revision, version, runtimeDrift };
}

/**
 * Compare what the serving probe observed inside the exact image with what was
 * selected. Version equality alone is not enough — two commits can share a
 * version — so the executable of the *running server process* must hash to
 * the selected binary.
 *
 * @param {object} params
 * @param {object} params.identity
 * @param {string} params.expectedSha256 the verified binary's digest
 * @param {object} params.probe output of `scripts/formal-ai-draft-serving-probe.mjs`
 * @returns {object} the serving identity to record
 */
export function verifyServingIdentity({ identity, expectedSha256, probe }) {
  if (!probe || probe.ok === false) throw deferred(`the serving probe did not complete: ${probe?.error || 'no result'}`, { probe });
  const expected = normalizeSha256(expectedSha256);
  const mounted = normalizeSha256(probe.binary?.sha256);
  const serving = normalizeSha256(probe.server?.exeSha256);
  if (expected && mounted !== expected) throw mismatch(`the image resolves formal-ai to a binary hashing ${mounted ?? 'unknown'}, not the selected ${expected}`, { mounted, expected });
  if (expected && serving !== expected) throw mismatch(`the process serving /health runs an executable hashing ${serving ?? 'unknown'}, not the selected ${expected}`, { serving, expected });
  const healthVersion = probe.server?.healthVersion || null;
  const cliVersion = probe.binary?.version || null;
  if (!healthVersion) throw mismatch('the serving backend did not report a version on /health');
  if (cliVersion && cliVersion !== healthVersion) throw mismatch(`formal-ai --version says ${cliVersion} but the serving backend reports ${healthVersion}`);
  if (identity.formalAi.version && healthVersion !== identity.formalAi.version) throw mismatch(`the serving backend reports Formal AI ${healthVersion}, but this attempt selected ${identity.formalAi.version}`);
  const hiveVersion = probe.hive?.version || null;
  if (hiveVersion && hiveVersion !== identity.hive.version) throw mismatch(`the image runs Hive Mind ${hiveVersion}, but this attempt selected ${identity.hive.version}`);
  return { formalAiVersion: healthVersion, binarySha256: mounted, servingExeSha256: serving, hiveVersion, agentVersion: probe.agent?.version || null, probedAt: probe.probedAt || null };
}

/** Environment for the solve container, so solve re-checks the process it actually talks to. */
export function buildAttemptEnv({ identity, binarySha256 }) {
  const env = { [ATTEMPT_ENV.id]: identity.id, [ATTEMPT_ENV.mode]: identity.mode };
  const sha = normalizeSha256(binarySha256);
  if (sha) env[ATTEMPT_ENV.expectedSha256] = sha;
  if (identity.formalAi.version) env[ATTEMPT_ENV.expectedVersion] = identity.formalAi.version;
  if (identity.formalAi.sourceSha) env[ATTEMPT_ENV.expectedSource] = identity.formalAi.sourceSha;
  return env;
}

/**
 * `$GITHUB_OUTPUT` lines for the selection, for the jobs that consume it.
 * Retries of failed jobs reuse these outputs, which is what keeps one identity
 * across retries.
 */
export function formatIdentityOutputs(identity) {
  return [`attempt_id=${identity.id}`, `mode=${identity.mode}`, `formal_ai_sha=${identity.formalAi.sourceSha || ''}`, `formal_ai_version=${identity.formalAi.version || ''}`, `formal_ai_binary_source=${identity.formalAi.binarySource}`, `formal_ai_release_tag=${identity.formalAi.release?.tag || ''}`, `hive_sha=${identity.hive.sourceSha}`, `hive_image=${identity.hive.image}`, `identity_json=${JSON.stringify(identity)}`, ''].join('\n');
}

/** One line describing the attempt, for logs, annotations and the step summary. */
export function describeAttempt(identity) {
  const formalAi = identity.formalAi.sourceSha ? `${identity.formalAi.repository}@${identity.formalAi.sourceSha.slice(0, 12)}${identity.formalAi.version ? ` (${identity.formalAi.version})` : ''}` : identity.formalAi.binarySource === BINARY_SOURCES.imageBaked ? 'the image-baked Formal AI' : 'a caller-supplied Formal AI binary';
  const label = identity.mode === ATTEMPT_MODES.liveCurrent ? 'live current-source attempt' : identity.mode === ATTEMPT_MODES.publishedRelease ? 'published-release qualification' : 'HISTORICAL REPLAY (not current-source evidence)';
  return `${label} ${identity.id}: ${formalAi} via ${identity.formalAi.binarySource}, Hive Mind ${identity.hive.version}@${identity.hive.sourceSha.slice(0, 12)} in ${identity.hive.image}`;
}

/** The record written next to the session log when an attempt ends without running solve. */
export function buildOutcomeRecord({ identity, error, at = new Date().toISOString() }) {
  return { schema: 'hive-mind/formal-ai-draft-attempt-outcome/v1', attemptId: identity?.id ?? null, mode: identity?.mode ?? null, outcome: error?.outcome || ATTEMPT_OUTCOMES.deferred, message: error?.message || String(error), evidence: error?.evidence || {}, capabilityCredit: 0, at };
}

/**
 * Pick the release whose published receipt was built from `sourceSha`, if any.
 * A live attempt may then reuse that trusted build instead of compiling.
 *
 * @param {Array<{tag: string, version: string, sourceSha: string}>} releases
 * @param {string} sourceSha
 */
export const findReleaseForSource = (releases, sourceSha) => (Array.isArray(releases) ? releases : []).find(release => String(release?.sourceSha || '').toLowerCase() === String(sourceSha || '').toLowerCase()) || null;

/** The first `x.y.z` in a `--version` answer (`formal-ai 0.355.29`). */
export const versionOf = text => /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(String(text || ''))?.[0] || null;

/** The Cargo package version declared by a `rust/Cargo.toml` text, or null. */
export const readCargoPackageVersion = text => {
  const packageBlock = /\[package\]([\s\S]*?)(?:\n\[|$)/.exec(String(text || ''));
  const match = packageBlock && /^\s*version\s*=\s*"([^"]+)"/m.exec(packageBlock[1]);
  return match ? match[1] : null;
};
