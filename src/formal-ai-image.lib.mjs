/**
 * Resolve — and prove available — the image the Formal AI sidecar boots from
 * (issue #2154).
 *
 * ## Why this module exists
 *
 * Before this module, `acquireFormalAiSidecar` handed
 * `ghcr.io/link-assistant/formal-ai:<version>` straight to `docker run` and
 * relied on Docker's implicit pull. The published package is private, so every
 * Formal AI task died with the raw daemon dump:
 *
 * ```text
 * Command failed: docker run --detach --name hive-mind-formal-ai …
 * Unable to find image 'ghcr.io/link-assistant/formal-ai:0.339.1' locally
 * docker: Error response from daemon: error from registry: unauthorized
 * ```
 *
 * Three separate defects made that fatal:
 *
 *  1. **No preflight.** The registry problem surfaced as a failed *container
 *     launch* rather than as a failed *image resolution*, so nothing could tell
 *     the operator what to do about it.
 *  2. **No diagnosis.** `unauthorized` from a registry has exactly three causes
 *     (private package, missing/insufficient credentials, wrong reference) and
 *     each has a different fix. The raw dump named none of them.
 *  3. **No alternative.** The Hive Mind images themselves bake
 *     `/usr/local/bin/formal-ai` at the same pinned version (`Dockerfile`,
 *     `Dockerfile.dind`: `cargo install formal-ai --version ${FORMAL_AI_VERSION}
 *     --locked`), and that image is already present on the host because every
 *     isolated task runs from it. A registry outage therefore never had to stop
 *     Formal AI work at all.
 *
 * ## Contract
 *
 * - `HIVE_MIND_FORMAL_AI_IMAGE` is an **exact** operator pin: it is the only
 *   candidate, and if it cannot be resolved the acquire fails. An operator who
 *   names an image means that image.
 * - Otherwise the image accepted by the last verified idle update wins, by its
 *   immutable digest (issue #2207). Before that rule the bootstrap version was
 *   re-selected on every cold start, so an accepted update was discarded by the
 *   next task and the sidecar returned to the release Hive Mind ships with.
 * - Otherwise the published bootstrap image is preferred, and the local Hive
 *   Mind image is the fallback. The fallback is only *used*; it is never pulled,
 *   because its whole point is that it is already on the host.
 * - Nothing here downgrades a Formal AI task to another model. Issue #2146's
 *   fail-closed rule still holds: when no candidate resolves, the task is
 *   refused with an actionable message.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2154
 * @see https://github.com/link-assistant/hive-mind/issues/2146
 * @see https://github.com/link-assistant/hive-mind/issues/2207
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { FORMAL_AI_BOOTSTRAP_VERSION } from './formal-ai-version.lib.mjs';
import { getDockerIsolationImage } from './hive-mind-image.lib.mjs';

const execFileAsync = promisify(execFile);

/** Image published by every Formal AI release (`:latest` plus the bare version). */
export const FORMAL_AI_IMAGE_REPOSITORY = 'ghcr.io/link-assistant/formal-ai';

const DEFAULT_DOCKER_TIMEOUT_MS = 600_000;

/** Where each candidate came from, so logs and errors can explain themselves. */
export const FORMAL_AI_IMAGE_SOURCES = Object.freeze({
  PINNED: 'operator-pin',
  ACCEPTED: 'accepted-update',
  PUBLISHED: 'published-image',
  HIVE_MIND: 'hive-mind-image',
});

const errorText = error => error?.stderr?.toString?.().trim() || error?.stdout?.toString?.().trim() || error?.message || String(error);

/**
 * Classify a `docker pull` failure into the operator action that fixes it.
 *
 * Registry errors are famously interchangeable-looking; the distinction that
 * matters in practice is that GHCR answers `unauthorized` for a package that
 * *exists but is private* and `denied` for one that does not exist or that the
 * presented token may not see.
 *
 * @param {string} message - Raw stderr from the failed pull.
 * @returns {{kind: string, reason: string, remediation: string[]}}
 */
export const classifyDockerRegistryError = message => {
  const text = String(message || '');
  if (/unauthorized|authentication required|requires authentication/i.test(text)) {
    return {
      kind: 'unauthorized',
      reason: 'the registry refused an anonymous or under-scoped pull',
      remediation: ['make the package public (GHCR packages published by GITHUB_TOKEN are private by default), or', 'authenticate the daemon with a token carrying the `read:packages` scope: `echo $TOKEN | docker login ghcr.io -u <user> --password-stdin`, or', 'point HIVE_MIND_FORMAL_AI_IMAGE at an image this host can already pull'],
    };
  }
  if (/denied|forbidden|insufficient_scope|permission_denied/i.test(text)) {
    return {
      kind: 'denied',
      reason: 'the registry denied access to that reference',
      remediation: ['check the repository name and tag exist', 'check the credentials in use carry the `read:packages` scope'],
    };
  }
  if (/manifest unknown|not found|no such (?:image|manifest)/i.test(text)) {
    return { kind: 'not-found', reason: 'the registry has no such tag', remediation: ['check the tag exists in the registry', 'pin a published tag with HIVE_MIND_FORMAL_AI_IMAGE'] };
  }
  if (/no space left on device/i.test(text)) {
    return { kind: 'disk-full', reason: 'the daemon ran out of disk while unpacking the image', remediation: ['free disk space on the Docker data root, then retry'] };
  }
  if (/timeout|timed out|temporary failure|dial tcp|i\/o timeout|connection refused|network is unreachable|EOF/i.test(text)) {
    return { kind: 'network', reason: 'the registry was unreachable', remediation: ['check network/proxy access to the registry, then retry'] };
  }
  return { kind: 'unknown', reason: 'the pull failed', remediation: ['inspect the daemon error above'] };
};

/**
 * Resolve the local Hive Mind image, which bakes `formal-ai` at the same pinned
 * version as the published sidecar image and is already present on any host
 * that runs Docker-isolated tasks.
 */
export const resolveFormalAiFallbackImage = (env = process.env) => String(env.HIVE_MIND_FORMAL_AI_FALLBACK_IMAGE || '').trim() || getDockerIsolationImage({ env });

/**
 * The last image an idle update actually accepted, read out of the durable
 * sidecar record (issue #2207).
 *
 * `state.image`/`state.imageDigest` are a *cache of what is running* — every
 * acquire overwrites them with the container it found — so they cannot answer
 * "which image did we verify?". `state.lastUpdate` can: it is written only by
 * `updateFormalAiSidecarWhenIdle` after the pull, the side-effect-free memory
 * preflight, the backed-up migration and the `/health` memory-compatibility
 * check have all succeeded, and it is left untouched by a rollback.
 *
 * @param {object|null} state - A `formal-ai-sidecar.json` record.
 * @returns {{image: string|null, digest: string|null, version: string|null, memorySchemaVersion: (number|string|null), updatedAt: string|null}|null}
 */
export const readAcceptedFormalAiImage = state => {
  const update = state?.lastUpdate;
  if (!update || typeof update !== 'object') return null;
  const image = String(update.image || '').trim() || null;
  const digest = String(update.digest || '').trim() || null;
  if (!image && !digest) return null;
  return { image, digest, version: update.version ?? null, memorySchemaVersion: update.memorySchemaVersion ?? null, updatedAt: update.updatedAt ?? null };
};

/**
 * Candidates that reproduce an accepted update, most trustworthy first.
 *
 * Two rules make this safe:
 *
 *  - **The digest wins.** `docker image inspect --format {{.Id}}` returns the
 *    local content address, which Docker also accepts as a run reference. Using
 *    it means a tag that moved after acceptance (`:latest` is the update tag)
 *    cannot smuggle an unverified image past the memory verification that
 *    earned the acceptance.
 *  - **The tag is only a recovery path.** If the accepted image ID has been
 *    pruned, the recorded reference may be pulled again, but the result is
 *    accepted only when its digest still matches; otherwise the candidate is
 *    refused rather than booted.
 *
 * @param {object|null} accepted - Output of {@link readAcceptedFormalAiImage}.
 * @returns {Array<object>}
 */
export const resolveAcceptedFormalAiImageCandidates = (accepted = null) => {
  if (!accepted) return [];
  const candidates = [];
  if (accepted.digest) candidates.push({ image: accepted.digest, reference: accepted.image || accepted.digest, source: FORMAL_AI_IMAGE_SOURCES.ACCEPTED, pullable: false, accepted: true });
  if (accepted.image && accepted.digest) candidates.push({ image: accepted.image, reference: accepted.image, source: FORMAL_AI_IMAGE_SOURCES.ACCEPTED, pullable: true, accepted: true, expectDigest: accepted.digest });
  // An acceptance recorded before digests were captured: the reference is all
  // there is, so it may be used but never re-pulled behind a moving tag.
  if (accepted.image && !accepted.digest) candidates.push({ image: accepted.image, reference: accepted.image, source: FORMAL_AI_IMAGE_SOURCES.ACCEPTED, pullable: false, accepted: true });
  return candidates;
};

/**
 * Ordered list of images to try, most preferred first.
 *
 * Precedence, and why:
 *
 *  1. `HIVE_MIND_FORMAL_AI_IMAGE` — an operator who names an image means that
 *     image; the pin is exact and exclusive.
 *  2. The last accepted, verified update (issue #2207). Also exclusive: once an
 *     image has been verified against the migrated persisted memory, quietly
 *     booting the older bootstrap release against that memory is exactly the
 *     silent downgrade the fail-closed rule forbids.
 *  3. The bootstrap release, then the local Hive Mind image — the cold-start
 *     path for a host that has never completed an update.
 *
 * @param {object} [env]
 * @param {object} [options]
 * @param {object|null} [options.accepted] - Output of {@link readAcceptedFormalAiImage}.
 * @returns {Array<{image: string, source: string, pullable: boolean}>}
 */
export const resolveFormalAiSidecarImageCandidates = (env = process.env, { accepted = null } = {}) => {
  const pinned = String(env.HIVE_MIND_FORMAL_AI_IMAGE || '').trim();
  if (pinned) return [{ image: pinned, source: FORMAL_AI_IMAGE_SOURCES.PINNED, pullable: true }];
  const acceptedCandidates = resolveAcceptedFormalAiImageCandidates(accepted);
  if (acceptedCandidates.length > 0) return acceptedCandidates;
  const candidates = [{ image: `${FORMAL_AI_IMAGE_REPOSITORY}:${FORMAL_AI_BOOTSTRAP_VERSION}`, source: FORMAL_AI_IMAGE_SOURCES.PUBLISHED, pullable: true }];
  const fallback = resolveFormalAiFallbackImage(env);
  // Never pulled: the fallback's value is that it is already on the host. A
  // deployment that has to pull it would be pulling the *bigger* image.
  if (fallback && fallback !== candidates[0].image) candidates.push({ image: fallback, source: FORMAL_AI_IMAGE_SOURCES.HIVE_MIND, pullable: false });
  return candidates;
};

/** The preferred image, kept for callers and logs that only need the headline reference. */
export const resolveFormalAiSidecarImage = (env = process.env, options = {}) => resolveFormalAiSidecarImageCandidates(env, options)[0].image;

const inspectLocalImage = async (image, { run, timeoutMs }) => {
  try {
    const result = await run('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], { encoding: 'utf8', timeout: timeoutMs });
    return String(result?.stdout ?? '').trim() || null;
  } catch {
    return null;
  }
};

/**
 * Render the aggregated failure so an operator reading the Telegram reply or the
 * bot log knows the cause and the fix without opening a shell.
 */
const describeFailure = attempts => {
  const accepted = attempts.some(attempt => attempt.source === FORMAL_AI_IMAGE_SOURCES.ACCEPTED);
  const lines = [accepted ? 'The Formal AI image accepted by the last verified update could not be resolved, so the sidecar was not started.' : 'No Formal AI image could be resolved, so the sidecar was not started.'];
  for (const attempt of attempts) {
    if (attempt.source === FORMAL_AI_IMAGE_SOURCES.HIVE_MIND && attempt.kind === 'absent') {
      lines.push(`• ${attempt.image} (local Hive Mind image, fallback): not present on this host — Docker-isolated tasks would have to pull it too.`);
      continue;
    }
    lines.push(`• ${attempt.image} (${attempt.source}): ${attempt.reason}${attempt.error ? ` — ${attempt.error}` : ''}`);
    for (const step of attempt.remediation ?? []) lines.push(`    → ${step}`);
  }
  if (accepted) {
    // Falling back to the bootstrap release here would run an *older* binary
    // against memory that the accepted release already migrated (issue #2207).
    lines.push('Hive Mind will not fall back to an older Formal AI release against memory an accepted update already migrated.');
    lines.push('    → restore the accepted image on this host (`docker pull` it, or copy it back), or');
    lines.push('    → set HIVE_MIND_FORMAL_AI_IMAGE to the image you want this host to run, which overrides the accepted update.');
  }
  lines.push('Formal AI tasks fail closed by design (issue #2146): Hive Mind will not silently run them on another model.');
  return lines.join('\n');
};

/**
 * Return the first candidate image that is usable on this host, pulling only the
 * pullable ones and never throwing for a candidate that simply is not there.
 *
 * @param {object} params
 * @param {object} [params.env]
 * @param {Function} [params.run] - `execFile`-shaped seam, so tests can drive a fake daemon.
 * @param {number} [params.timeoutMs]
 * @param {Function|null} [params.log]
 * @param {boolean} [params.verbose]
 * @param {boolean} [params.pull] - Set false to accept only images already on the host.
 * @param {object|null} [params.accepted] - Output of {@link readAcceptedFormalAiImage}, used to build the default candidates.
 * @returns {Promise<{image: string, reference: string, source: string, digest: string|null, pulled: boolean, attempts: object[]}>}
 * @throws {Error} When no candidate resolves; the message names every attempt and its fix.
 */
export const ensureFormalAiSidecarImage = async ({ env = process.env, run = execFileAsync, timeoutMs = DEFAULT_DOCKER_TIMEOUT_MS, log = null, verbose = false, pull = true, accepted = null, candidates = resolveFormalAiSidecarImageCandidates(env, { accepted }) } = {}) => {
  const attempts = [];
  const reference = candidate => candidate.reference || candidate.image;
  // A candidate that names an expected digest is a *recovery* path for an
  // accepted update whose image ID was pruned: the reference may be re-fetched,
  // but only the recorded content address is allowed to run (issue #2207).
  const mismatch = (candidate, digest) => ({ ...candidate, kind: 'digest-mismatch', reason: `resolved to ${digest ?? 'no digest'} instead of the accepted ${candidate.expectDigest}`, error: null, remediation: ['the tag moved after the update was accepted; restore the accepted image or repin with HIVE_MIND_FORMAL_AI_IMAGE'] });

  for (const candidate of candidates) {
    const localDigest = await inspectLocalImage(candidate.image, { run, timeoutMs });
    if (localDigest && candidate.expectDigest && localDigest !== candidate.expectDigest) {
      attempts.push(mismatch(candidate, localDigest));
      continue;
    }
    if (localDigest) {
      if (verbose && log) await log(`[VERBOSE] formal-ai-image: using '${candidate.image}' (${candidate.source}) already present locally, digest=${localDigest}`);
      return { image: candidate.image, reference: reference(candidate), source: candidate.source, digest: localDigest, pulled: false, attempts };
    }

    if (!candidate.pullable || !pull) {
      attempts.push({ ...candidate, kind: 'absent', reason: 'not present locally and not pulled', error: null, remediation: [] });
      continue;
    }

    if (log) await log(`⬇️ Pulling the Formal AI sidecar image ${candidate.image}`);
    try {
      await run('docker', ['pull', candidate.image], { encoding: 'utf8', timeout: timeoutMs });
    } catch (error) {
      const message = errorText(error);
      const diagnosis = classifyDockerRegistryError(message);
      attempts.push({ ...candidate, kind: diagnosis.kind, reason: diagnosis.reason, error: message, remediation: diagnosis.remediation });
      if (log) await log(`⚠️ Could not pull ${candidate.image}: ${diagnosis.reason} (${diagnosis.kind}). ${message}`);
      continue;
    }

    const digest = await inspectLocalImage(candidate.image, { run, timeoutMs });
    if (candidate.expectDigest && digest !== candidate.expectDigest) {
      attempts.push(mismatch(candidate, digest));
      if (log) await log(`⚠️ ${candidate.image} no longer resolves to the accepted digest ${candidate.expectDigest}; refusing to boot it.`);
      continue;
    }
    if (verbose && log) await log(`[VERBOSE] formal-ai-image: pulled '${candidate.image}' (${candidate.source}), digest=${digest ?? 'unknown'}`);
    return { image: candidate.image, reference: reference(candidate), source: candidate.source, digest, pulled: true, attempts };
  }

  const error = new Error(describeFailure(attempts));
  error.formalAiImageAttempts = attempts;
  throw error;
};

export default {
  FORMAL_AI_IMAGE_REPOSITORY,
  FORMAL_AI_IMAGE_SOURCES,
  classifyDockerRegistryError,
  ensureFormalAiSidecarImage,
  readAcceptedFormalAiImage,
  resolveAcceptedFormalAiImageCandidates,
  resolveFormalAiFallbackImage,
  resolveFormalAiSidecarImage,
  resolveFormalAiSidecarImageCandidates,
};
