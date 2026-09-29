/**
 * Formal AI images on the local Docker host: find them, compare them with the
 * registry, and remove the ones nobody needs any more (issue #2305).
 *
 * Every published Formal AI image is ~24 GB. Before issue #2305 each release
 * replaced `:latest` and left the previous build behind as a dangling image,
 * so a host that followed releases for a few weeks ran out of disk. The
 * helpers here are the Docker half of the fix; the decisions of *when* to use
 * them live in the updater and in the idle unload.
 *
 * Invariants:
 *
 *   1. **Only Formal AI images are ever removed.** An image qualifies when it
 *      is tagged or pinned under `ghcr.io/link-assistant/formal-ai`, or carries
 *      the `org.opencontainers.image.source` label the Formal AI release sets.
 *   2. **Anything also known under another name is left alone.** An image
 *      that carries a tag outside the Formal AI repository was put there by
 *      someone else, and the fallback task image and an operator pin are
 *      never removed (an operator pin may be a local build that cannot be
 *      pulled again).
 *   3. **Removal is by tag, never forced.** `docker rmi` without `--force`
 *      refuses an image a container still uses, which is exactly the refusal
 *      we want; it is reported and retried on a later tick.
 *   4. **Volumes are never touched here.** In particular the persisted memory
 *      volume `hive-mind-formal-ai-memory` survives every removal.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2305
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { dockerErrorMessage } from './docker-sidecar.lib.mjs';
import { FORMAL_AI_IMAGE_REPOSITORY, resolveFormalAiFallbackImage } from './formal-ai-image.lib.mjs';

const execFileAsync = promisify(execFile);

const DEFAULT_DOCKER_TIMEOUT_MS = 120_000;

/** The source label every Formal AI release image carries. */
export const FORMAL_AI_IMAGE_SOURCE_LABEL = 'org.opencontainers.image.source=https://github.com/link-assistant/formal-ai';

const dockerText = async (run, args, { timeoutMs = DEFAULT_DOCKER_TIMEOUT_MS } = {}) => {
  const result = await run('docker', args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  return String(result?.stdout ?? '').trim();
};

const lines = text =>
  String(text ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

const parseJsonArray = raw => {
  try {
    const value = JSON.parse(String(raw ?? '').trim() || 'null');
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
};

/** `repo:tag` → `repo`, `repo@sha256:…` → `repo` (a registry port is not a tag). */
export const dockerReferenceRepository = reference => {
  const raw = String(reference ?? '').trim();
  const at = raw.indexOf('@');
  const named = at >= 0 ? raw.slice(0, at) : raw;
  const colon = named.lastIndexOf(':');
  return colon > named.lastIndexOf('/') ? named.slice(0, colon) : named;
};

/** `repo@sha256:…` → `sha256:…`. */
const repoDigestDigest = repoDigest => {
  const raw = String(repoDigest ?? '');
  const at = raw.indexOf('@');
  return at >= 0 ? raw.slice(at + 1) : null;
};

const isFormalAiReference = reference => dockerReferenceRepository(reference) === FORMAL_AI_IMAGE_REPOSITORY;

/**
 * Parse the sizes `docker system df` prints (`24.29GB`, `512.3MB`, `0B`).
 *
 * Docker renders them with decimal (SI) units.
 *
 * @returns {number|null} Bytes, or null when the text is not a size.
 */
export const parseDockerSize = text => {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([kKmMgGtTpP]?)i?B\s*$/.exec(String(text ?? ''));
  if (!match) return null;
  const power = { '': 0, k: 1, m: 2, g: 3, t: 4, p: 5 }[match[2].toLowerCase()];
  return Math.round(Number(match[1]) * 1000 ** power);
};

/** Render bytes the way `docker system df` does. */
export const formatDockerSize = bytes => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0B';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(2)}${units[unit]}`;
};

/**
 * Read the facts about one local image the removal rules need.
 *
 * @returns {Promise<{id: string, repoTags: string[], repoDigests: string[], size: number|null}|null>} Null when the image is not on the host.
 */
export const inspectDockerImage = async (image, { run = execFileAsync, timeoutMs } = {}) => {
  let raw;
  try {
    raw = await dockerText(run, ['image', 'inspect', '--format', '{{.Id}}|{{json .RepoTags}}|{{json .RepoDigests}}|{{.Size}}', image], { timeoutMs });
  } catch {
    return null;
  }
  const [id, repoTags, repoDigests, size] = (lines(raw)[0] ?? '').split('|');
  if (!id) return null;
  const bytes = Number(size);
  return { id, repoTags: parseJsonArray(repoTags), repoDigests: parseJsonArray(repoDigests), size: Number.isFinite(bytes) ? bytes : null };
};

/** Registry digests (`sha256:…`) a local image is known by — the `@` half of its RepoDigests. */
export const readLocalImageRepoDigests = async (image, { run = execFileAsync, timeoutMs } = {}) => {
  const inspected = await inspectDockerImage(image, { run, timeoutMs });
  return inspected ? inspected.repoDigests.map(repoDigestDigest).filter(Boolean) : [];
};

/** The pullable `ghcr.io/link-assistant/formal-ai@sha256:…` reference of a local image, if it has one. */
export const readFormalAiRepoDigest = async (image, { run = execFileAsync, timeoutMs } = {}) => {
  const inspected = await inspectDockerImage(image, { run, timeoutMs });
  return inspected?.repoDigests.find(isFormalAiReference) ?? null;
};

const collectDigests = (value, into) => {
  if (!value || typeof value !== 'object') return into;
  if (Array.isArray(value)) {
    for (const entry of value) collectDigests(entry, into);
    return into;
  }
  if (typeof value.digest === 'string' && value.digest.startsWith('sha256:')) into.add(value.digest);
  if (typeof value.Descriptor?.digest === 'string') into.add(value.Descriptor.digest);
  return into;
};

/**
 * Ask the registry which manifest a reference currently points at, *without*
 * pulling it.
 *
 * `docker buildx imagetools inspect` reports the top-level manifest (or index)
 * digest, which is what `docker pull` records in RepoDigests. `docker manifest
 * inspect --verbose` is the fallback for hosts without buildx. Neither needs
 * the layers, so this costs one registry round-trip instead of a 24 GB
 * download.
 *
 * @returns {Promise<{digests: string[], via: string}|null>} Null when neither command could answer — the caller then falls back to a pull.
 */
export const resolveRemoteImageDigests = async (image, { run = execFileAsync, timeoutMs, log = null, verbose = false } = {}) => {
  const attempts = [
    { via: 'buildx imagetools', args: ['buildx', 'imagetools', 'inspect', image, '--format', '{{json .Manifest}}'] },
    { via: 'manifest inspect', args: ['manifest', 'inspect', '--verbose', image] },
  ];
  for (const { via, args } of attempts) {
    try {
      const digests = [...collectDigests(JSON.parse(await dockerText(run, args, { timeoutMs })), new Set())];
      if (digests.length > 0) return { digests, via };
    } catch (error) {
      if (verbose && log) await log(`[VERBOSE] formal-ai-image-store: ${via} could not resolve ${image}: ${dockerErrorMessage(error)}`);
    }
  }
  return null;
};

/**
 * Images and references that must never be removed, whatever they look like.
 */
export const resolveProtectedFormalAiImages = (env = process.env) => [resolveFormalAiFallbackImage(env), String(env.HIVE_MIND_FORMAL_AI_IMAGE || '').trim()].filter(Boolean);

/**
 * Every Formal AI image on the host: current, previous and dangling builds.
 *
 * @returns {Promise<Array<{id: string, repoTags: string[], repoDigests: string[], size: number|null, removable: boolean, reason: string|null}>>}
 */
export const listFormalAiImages = async ({ env = process.env, run = execFileAsync, timeoutMs } = {}) => {
  const ids = new Set();
  for (const args of [
    ['image', 'ls', '--no-trunc', '--quiet', FORMAL_AI_IMAGE_REPOSITORY],
    ['image', 'ls', '--no-trunc', '--quiet', '--filter', `label=${FORMAL_AI_IMAGE_SOURCE_LABEL}`],
  ]) {
    try {
      for (const id of lines(await dockerText(run, args, { timeoutMs }))) ids.add(id);
    } catch {
      // A failed listing only means fewer images are found; nothing is removed by mistake.
    }
  }

  const protectedIds = new Set();
  const protectedRefs = resolveProtectedFormalAiImages(env);
  for (const reference of protectedRefs) {
    const inspected = await inspectDockerImage(reference, { run, timeoutMs });
    if (inspected) protectedIds.add(inspected.id);
  }

  const images = [];
  for (const id of ids) {
    const inspected = await inspectDockerImage(id, { run, timeoutMs });
    if (!inspected) continue;
    const foreignTags = inspected.repoTags.filter(tag => !isFormalAiReference(tag));
    let reason = null;
    if (protectedIds.has(inspected.id)) reason = 'protected (fallback image or operator pin)';
    else if (foreignTags.length > 0) reason = `also tagged ${foreignTags.join(', ')}`;
    images.push({ ...inspected, removable: reason === null, reason });
  }
  return images;
};

/**
 * Total size of the host's images, as `docker system df` reports it.
 *
 * Summing per-image sizes would double-count the layers Formal AI builds
 * share, so the before/after delta of this figure is what "bytes freed" means.
 *
 * @returns {Promise<number|null>}
 */
export const readDockerImagesDiskUsage = async ({ run = execFileAsync, timeoutMs } = {}) => {
  try {
    for (const line of lines(await dockerText(run, ['system', 'df', '--format', '{{.Type}}|{{.Size}}'], { timeoutMs }))) {
      const [type, size] = line.split('|');
      if (type === 'Images') return parseDockerSize(size);
    }
  } catch {
    // Fall through: the caller estimates from the removed images instead.
  }
  return null;
};

/**
 * Remove one Formal AI image the way invariant 3 prescribes: untag each Formal
 * AI tag (the last one deletes the image), or delete a dangling image by ID.
 *
 * @returns {Promise<{removed: boolean, error: string|null}>}
 */
export const removeFormalAiImage = async (image, { run = execFileAsync, timeoutMs } = {}) => {
  const targets = image.repoTags.length > 0 ? image.repoTags : [image.id];
  try {
    for (const target of targets) await dockerText(run, ['rmi', target], { timeoutMs });
  } catch (error) {
    return { removed: false, error: dockerErrorMessage(error) };
  }
  // A tag removal "succeeds" even when the image is kept for its digest
  // reference; only a vanished image counts as removed.
  const still = await inspectDockerImage(image.id, { run, timeoutMs });
  if (!still) return { removed: true, error: null };
  try {
    await dockerText(run, ['rmi', image.id], { timeoutMs });
    return { removed: true, error: null };
  } catch (error) {
    return { removed: false, error: dockerErrorMessage(error) };
  }
};

/**
 * Remove a set of Formal AI images and report what was freed.
 *
 * @param {object} options
 * @param {(image: object) => boolean} [options.select] - Which listed images to remove (default: all removable ones).
 * @returns {Promise<{removed: object[], kept: object[], failed: object[], bytesFreed: number}>}
 */
export const removeFormalAiImages = async ({ env = process.env, run = execFileAsync, timeoutMs, select = () => true, log = null, verbose = false } = {}) => {
  const images = await listFormalAiImages({ env, run, timeoutMs });
  const chosen = images.filter(image => select(image));
  const kept = chosen.filter(image => !image.removable);
  const removable = chosen.filter(image => image.removable);
  if (removable.length === 0) return { removed: [], kept, failed: [], bytesFreed: 0 };

  const before = await readDockerImagesDiskUsage({ run, timeoutMs });
  const removed = [];
  const failed = [];
  for (const image of removable) {
    const result = await removeFormalAiImage(image, { run, timeoutMs });
    if (result.removed) removed.push(image);
    else failed.push({ ...image, error: result.error });
    if (verbose && log) await log(`[VERBOSE] formal-ai-image-store: ${result.removed ? 'removed' : 'could not remove'} ${image.repoTags[0] ?? image.id}${result.error ? `: ${result.error}` : ''}`);
  }
  const after = removed.length > 0 ? await readDockerImagesDiskUsage({ run, timeoutMs }) : before;
  const estimated = removed.reduce((sum, image) => sum + (image.size ?? 0), 0);
  const bytesFreed = before !== null && after !== null ? Math.max(0, before - after) : estimated;
  for (const image of kept) if (verbose && log) await log(`[VERBOSE] formal-ai-image-store: keeping ${image.repoTags[0] ?? image.id}: ${image.reason}`);
  return { removed, kept, failed, bytesFreed };
};

export default {
  FORMAL_AI_IMAGE_SOURCE_LABEL,
  dockerReferenceRepository,
  formatDockerSize,
  inspectDockerImage,
  listFormalAiImages,
  parseDockerSize,
  readDockerImagesDiskUsage,
  readFormalAiRepoDigest,
  readLocalImageRepoDigests,
  removeFormalAiImage,
  removeFormalAiImages,
  resolveProtectedFormalAiImages,
  resolveRemoteImageDigests,
};
