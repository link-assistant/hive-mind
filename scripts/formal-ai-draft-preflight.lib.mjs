/**
 * The attempt preflight: binary, image and serving process are verified
 * before solve starts, so no task effect happens on an unverified backend
 * (issue #3909).
 *
 * Order matters and each step only narrows: the binary must be the selected
 * one; the image must be the published image of the selected Hive Mind
 * source, pinned by digest; and a real `formal-ai serve` started inside that
 * image digest must run the selected executable. Any failure is an
 * {@link AttemptIdentityError} — deferred when an artefact is missing,
 * mismatch when one is wrong — and nothing falls back.
 *
 * Docker, `gh` and the filesystem are injected so the cases are tested
 * without them.
 *
 * @module formal-ai-draft-preflight
 */

import { ATTEMPT_OUTCOMES, AttemptIdentityError, BINARY_SOURCES, buildAttemptEnv, checkHiveImageBinding, verifyAttemptBinary, verifyServingIdentity } from './formal-ai-draft-identity.lib.mjs';
import { DraftImageUnavailableError } from './formal-ai-draft-image.lib.mjs';

export const ATTEMPT_RECORD_SCHEMA = 'hive-mind/formal-ai-draft-attempt-record/v1';
export const RECORD_FILE = 'attempt-record.json';
export const PROBE_FILE = 'serving-probe.json';

/** The image reference the attempt runs: the digest it was bound to, so a moved tag cannot change it. */
export const pinnedImageReference = (image, digest) =>
  `${String(image)
    .replace(/@sha256:[0-9a-f]+$/, '')
    .replace(/:[^:/]+$/, '')}@sha256:${digest}`;

/**
 * @param {object} params
 * @param {object} params.identity the parsed attempt identity
 * @param {string|null} params.binaryPath the binary to mount (null for the image-baked one)
 * @param {object|null} params.receipt its parsed receipt, when it has one
 * @param {object} params.deps
 * @param {(path: string) => Promise<{sha256: string, bytes: number}|null>} params.deps.inspectBinary null when the file is missing
 * @param {(path: string) => Promise<string>} params.deps.binaryVersion
 * @param {(image: string) => Promise<string>} params.deps.pullImage throws DraftImageUnavailableError
 * @param {(image: string) => Promise<{labels: object, repoDigest: string|null}>} params.deps.inspectImage
 * @param {(base: string, head: string) => Promise<object>} params.deps.compare GitHub compare of the Hive Mind repository
 * @param {(params: {image: string, binaryPath: string|null}) => Promise<object>} params.deps.probe the serving probe's JSON
 * @param {(message: string) => void} [params.log]
 * @returns {Promise<object>} the attempt record; `attemptEnv` and `image.reference` are what solve runs with
 */
export async function verifyAttemptPreflight({ identity, binaryPath = null, receipt = null, deps, log = () => {}, now = () => new Date().toISOString() }) {
  // 1. The binary.
  let binary = null;
  if (identity.formalAi.binarySource !== BINARY_SOURCES.imageBaked) {
    const file = binaryPath ? await deps.inspectBinary(binaryPath) : null;
    binary = verifyAttemptBinary({ identity, receipt, actualSha256: file?.sha256 ?? null, actualBytes: file?.bytes ?? null, reportedVersion: file ? await deps.binaryVersion(binaryPath) : null });
    log(`binary: ${binary.sha256} (${binary.source}, Formal AI ${binary.version})`);
  }

  // 2. The image, exactly; then bound to the selected Hive Mind source.
  try {
    await deps.pullImage(identity.hive.image);
  } catch (error) {
    if (error instanceof DraftImageUnavailableError) throw new AttemptIdentityError(ATTEMPT_OUTCOMES.deferred, error.message, { image: identity.hive.image, missing: error.missing });
    throw error;
  }
  const { labels, repoDigest } = await deps.inspectImage(identity.hive.image);
  const revision = String(labels?.['org.opencontainers.image.revision'] || '').toLowerCase();
  let compare = null;
  if (revision && revision !== identity.hive.sourceSha) {
    try {
      compare = await deps.compare(revision, identity.hive.sourceSha);
    } catch (error) {
      log(`could not compare ${revision}...${identity.hive.sourceSha}: ${error.message}`);
    }
  }
  const image = checkHiveImageBinding({ identity, labels, repoDigest, compare });
  const reference = pinnedImageReference(identity.hive.image, image.digest);
  log(`image: ${reference} (revision ${image.revision}, version ${image.version})`);

  // 3. What would actually serve the task.
  const probe = await deps.probe({ image: reference, binaryPath: binary ? binaryPath : null });
  const serving = verifyServingIdentity({ identity, expectedSha256: binary?.sha256 ?? null, probe });
  log(`serving: Formal AI ${serving.formalAiVersion}, executable ${serving.servingExeSha256}, Hive Mind ${serving.hiveVersion}`);

  // solve re-checks its own server against this; the image-baked replay is
  // pinned to whatever the probe saw serving, so it cannot change mid-attempt.
  const attemptEnv = buildAttemptEnv({ identity, binarySha256: binary?.sha256 ?? serving.servingExeSha256 });
  return { schema: ATTEMPT_RECORD_SCHEMA, attemptId: identity.id, mode: identity.mode, currentSource: identity.currentSource, verifiedAt: now(), binary, image: { ...image, name: identity.hive.image, reference }, serving, probe, attemptEnv };
}
