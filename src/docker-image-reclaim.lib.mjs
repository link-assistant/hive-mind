/**
 * Reclaim superseded Docker images (issue #2187, item D).
 *
 * `--auto-cleanup` reclaims a task's workspace, but nothing ever reclaimed
 * images: every deploy leaves the previous `konard/hive-mind` tag behind, plus
 * the dangling layers the rebuild orphaned, until `docker system df` reports
 * tens of gigabytes as reclaimable while the disk gate refuses to start work.
 *
 * The plan built here is deliberately narrower than `docker image prune -a`,
 * because the host must keep a usable Hive Mind image after the deploy:
 *
 *   - only the Hive Mind repositories are candidates at all;
 *   - the newest tag of every repository is always kept, as is `latest` and the
 *     tag the isolation runner resolves;
 *   - an image any container references is kept, running or not;
 *   - an image ID a protected tag also points at is kept, so untagging can
 *     never delete the layers a protected reference needs;
 *   - dangling (`<none>:<none>`) images are reclaimed only when no container
 *     references them.
 *
 * Everything is planned from `docker image ls` / `docker ps -a` output, so the
 * plan can be printed (or dry-run) before a single image is touched.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2187
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { formatBytes } from './cleanup.lib.mjs';
import { HIVE_MIND_DIND_IMAGE_REPO, HIVE_MIND_IMAGE_REPO, resolveDockerIsolationImageTag } from './hive-mind-image.lib.mjs';
import { parseDockerSystemDf, parseHumanBytes } from './system-cleanup-estimates.lib.mjs';

const execFileAsync = promisify(execFile);

/** Repositories this project builds, and therefore may prune older tags of. */
export const MANAGED_IMAGE_REPOSITORIES = [HIVE_MIND_IMAGE_REPO, HIVE_MIND_DIND_IMAGE_REPO];

/** Tags that always name "the image to use", so they are never reclaimed. */
export const PROTECTED_IMAGE_TAGS = ['latest'];

export const DOCKER_IMAGE_RECLAIM_MODES = ['superseded', 'dangling', 'none'];
export const DEFAULT_DOCKER_IMAGE_RECLAIM_MODE = 'superseded';

const DOCKER_COMMAND_TIMEOUT_MS = 120_000;

const RECLAIM_REASON_DESCRIPTIONS = {
  dangling: 'dangling image left behind by a rebuild',
  superseded_tag: 'superseded tag of an image this host rebuilt',
};

const KEEP_REASON_DESCRIPTIONS = {
  in_use_by_container: 'a container still references it',
  protected_tag: 'moving tag that names the image to use',
  protected_reference: 'the image reference this host is pinned to',
  newest_tag: 'newest tag of its repository',
  shared_with_protected_image: 'shares its image ID with a protected tag',
  unmanaged_repository: 'not built by this project',
  mode_dangling_only: 'reclaim mode only removes dangling images',
  mode_none: 'image reclaim is disabled',
};

export function describeDockerImageReclaimReason(reason) {
  return RECLAIM_REASON_DESCRIPTIONS[reason] || KEEP_REASON_DESCRIPTIONS[reason] || String(reason ?? '');
}

export function normalizeDockerImageReclaimMode(value, fallback = DEFAULT_DOCKER_IMAGE_RECLAIM_MODE) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true) return DEFAULT_DOCKER_IMAGE_RECLAIM_MODE;
  if (value === false) return 'none';
  const normalized = String(value).trim().toLowerCase();
  if (['none', 'off', 'false', 'no', 'disabled', '0'].includes(normalized)) return 'none';
  if (['true', 'yes', 'on', '1', 'auto'].includes(normalized)) return DEFAULT_DOCKER_IMAGE_RECLAIM_MODE;
  return DOCKER_IMAGE_RECLAIM_MODES.includes(normalized) ? normalized : fallback;
}

/**
 * Which reclaim mode a solve run should use.
 *
 * Unset follows `--auto-cleanup`: image reclaim happens on exactly the success
 * path that already reclaims the workspace, so nobody loses an image because a
 * default changed under them. An explicit `--docker-image-reclaim=<mode>` wins
 * either way.
 */
export function resolveDockerImageReclaimMode(argv = {}) {
  const requested = argv?.dockerImageReclaim ?? argv?.['docker-image-reclaim'];
  return normalizeDockerImageReclaimMode(requested, argv?.autoCleanup ? DEFAULT_DOCKER_IMAGE_RECLAIM_MODE : 'none');
}

/** Every parseable `--format '{{json .}}'` line; malformed lines are skipped. */
export function parseDockerJsonLines(output) {
  const records = [];
  for (const line of String(output ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') records.push(parsed);
    } catch {
      // `docker image ls` prefixes nothing, but a warning on stdout would be
      // fatal here otherwise.
    }
  }
  return records;
}

const parseDockerDate = value => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  // Docker prints "2026-08-30 10:00:00 +0000 UTC". Date.parse rejects both the
  // trailing zone name and the unpunctuated offset ("+0000"), and a null date
  // here would silently make an older tag look like the newest one, so the
  // parts are rebuilt into an ISO-8601 string instead of patched up.
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:\s*(Z|[+-]\d{2}:?\d{2}))?/);
  if (match) {
    const zone = match[3] === 'Z' || !match[3] ? 'Z' : match[3].length === 5 ? `${match[3].slice(0, 3)}:${match[3].slice(3)}` : match[3];
    const parsed = Date.parse(`${match[1]}T${match[2]}${zone}`);
    if (Number.isFinite(parsed)) return parsed;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Natural ordering for tags: `v2.17.0` is newer than `v2.9.0`, not older. */
const compareTagVersions = (a, b) => {
  const left = String(a ?? '').split(/([0-9]+)/);
  const right = String(b ?? '').split(/([0-9]+)/);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const one = left[index] ?? '';
    const two = right[index] ?? '';
    if (one === two) continue;
    const oneNumber = Number(one);
    const twoNumber = Number(two);
    if (/^[0-9]+$/.test(one) && /^[0-9]+$/.test(two) && oneNumber !== twoNumber) return oneNumber - twoNumber;
    return one < two ? -1 : 1;
  }
  return 0;
};

/** Normalized `docker image ls --format '{{json .}}'` records. */
export function parseDockerImageJsonLines(output) {
  const images = [];
  for (const data of parseDockerJsonLines(output)) {
    const id = String(data.ID || data.Id || data.id || '').trim();
    if (!id) continue;
    const repository = String(data.Repository || data.repository || '<none>').trim();
    const tag = String(data.Tag || data.tag || '<none>').trim();
    const dangling = repository === '<none>' || tag === '<none>';
    images.push({
      id,
      repository,
      tag,
      reference: dangling ? id : `${repository}:${tag}`,
      dangling,
      createdAt: parseDockerDate(data.CreatedAt || data.createdAt),
      createdSince: String(data.CreatedSince || data.createdSince || '').trim() || null,
      sizeBytes: parseHumanBytes(data.Size || data.size) ?? 0,
    });
  }
  return images;
}

/**
 * Everything a container pins: docker prints either the reference the container
 * was started from or, for an untagged image, its ID.
 */
export function collectContainerImageReferences(containers) {
  const references = new Set();
  for (const container of containers || []) {
    const image = String(container?.Image ?? container?.image ?? '').trim();
    if (image) references.add(image);
    const imageId = String(container?.ImageID ?? container?.imageID ?? container?.imageId ?? '').trim();
    if (imageId) references.add(imageId);
  }
  return references;
}

const isReferencedByContainer = (image, references) => {
  if (references.has(image.reference)) return true;
  if (references.has(image.id)) return true;
  const bare = image.id.replace(/^sha256:/, '');
  if (references.has(bare)) return true;
  // Containers may name a shorter prefix of the image ID than `docker image ls`
  // prints (or a longer one, when the digest is spelled out in full).
  for (const reference of references) {
    const candidate = reference.replace(/^sha256:/, '');
    if (candidate.length >= 8 && (bare.startsWith(candidate) || candidate.startsWith(bare))) return true;
  }
  return false;
};

/**
 * Split every known image into `keep` and `remove`, each carrying the reason it
 * landed there so the decision can be printed and reviewed.
 */
export function planDockerImageReclaim({ images = [], containers = [], mode = DEFAULT_DOCKER_IMAGE_RECLAIM_MODE, repositories = MANAGED_IMAGE_REPOSITORIES, protectedReferences = [], protectedTags = PROTECTED_IMAGE_TAGS } = {}) {
  const resolvedMode = normalizeDockerImageReclaimMode(mode);
  const managed = new Set(repositories);
  const pinned = new Set((protectedReferences || []).filter(Boolean).map(reference => String(reference).trim()));
  const moving = new Set((protectedTags || []).map(tag => String(tag).trim()));
  const referenced = collectContainerImageReferences(containers);

  // Newest tag per repository: by build date, falling back to tag ordering when
  // two tags were built in the same second (or the date is unavailable).
  const newestByRepository = new Map();
  for (const image of images) {
    if (image.dangling) continue;
    const current = newestByRepository.get(image.repository);
    if (!current) {
      newestByRepository.set(image.repository, image);
      continue;
    }
    const byDate = (image.createdAt ?? 0) - (current.createdAt ?? 0);
    if (byDate > 0 || (byDate === 0 && compareTagVersions(image.tag, current.tag) > 0)) newestByRepository.set(image.repository, image);
  }

  const keep = [];
  const candidates = [];
  for (const image of images) {
    const decide = reason => keep.push({ ...image, reason });

    if (isReferencedByContainer(image, referenced)) {
      decide('in_use_by_container');
      continue;
    }
    if (resolvedMode === 'none') {
      decide('mode_none');
      continue;
    }
    if (image.dangling) {
      candidates.push({ ...image, reason: 'dangling', supersededBy: null });
      continue;
    }
    if (!managed.has(image.repository)) {
      decide('unmanaged_repository');
      continue;
    }
    if (moving.has(image.tag)) {
      decide('protected_tag');
      continue;
    }
    if (pinned.has(image.reference)) {
      decide('protected_reference');
      continue;
    }
    const newest = newestByRepository.get(image.repository);
    if (newest && newest.reference === image.reference) {
      decide('newest_tag');
      continue;
    }
    if (resolvedMode === 'dangling') {
      decide('mode_dangling_only');
      continue;
    }
    candidates.push({ ...image, reason: 'superseded_tag', supersededBy: newest?.reference ?? null });
  }

  // Untagging an image that a protected tag also points at reclaims nothing and
  // risks removing layers something still needs — keep those instead.
  const protectedIds = new Set(keep.map(image => image.id));
  const remove = [];
  for (const candidate of candidates) {
    if (protectedIds.has(candidate.id)) {
      keep.push({ ...candidate, reason: 'shared_with_protected_image' });
      continue;
    }
    remove.push({
      ...candidate,
      // A dangling image has no reference to untag; a superseded tag is removed
      // by reference so any other tag of the same ID survives.
      command: `docker image rm ${candidate.dangling ? candidate.id : candidate.reference}`,
      target: candidate.dangling ? candidate.id : candidate.reference,
    });
  }

  remove.sort((a, b) => Number(b.dangling) - Number(a.dangling) || (a.createdAt ?? 0) - (b.createdAt ?? 0));

  return { mode: resolvedMode, keep, remove, reclaimableBytes: sumUniqueImageBytes(remove) };
}

/** Two tags of one image ID free its layers once, not twice. */
function sumUniqueImageBytes(images) {
  const seen = new Set();
  let bytes = 0;
  for (const image of images) {
    if (seen.has(image.id)) continue;
    seen.add(image.id);
    bytes += image.sizeBytes || 0;
  }
  return bytes;
}

export function formatDockerImageReclaimSummary(image) {
  const parts = [`${image.reference} (${formatBytes(image.sizeBytes || 0)})`];
  if (image.supersededBy) parts.push(`superseded by ${image.supersededBy}`);
  else parts.push(describeDockerImageReclaimReason(image.reason));
  return parts.join(' — ');
}

/** Run the plan. A refused removal is reported, never thrown. */
export async function reclaimDockerImages({ plan, exec = execFileAsync, dryRun = false, log = null } = {}) {
  const planned = plan?.remove || [];
  if (dryRun) return { dryRun: true, planned, removed: [], failed: [], reclaimedBytes: 0 };

  const removed = [];
  const failed = [];
  for (const image of planned) {
    try {
      await exec('docker', ['image', 'rm', image.target ?? image.reference], { timeout: DOCKER_COMMAND_TIMEOUT_MS });
      removed.push(image);
      if (log) await log(`   🧹 Removed image ${formatDockerImageReclaimSummary(image)}`);
    } catch (error) {
      // `conflict: unable to delete` is routine (a child image or a container we
      // could not see holds it) and must not fail a finished task.
      failed.push({ ...image, error: error?.message || String(error) });
    }
  }
  return { dryRun: false, planned, removed, failed, reclaimedBytes: sumUniqueImageBytes(removed) };
}

const runDocker = async (exec, args) => {
  try {
    const { stdout } = await exec('docker', args, { timeout: DOCKER_COMMAND_TIMEOUT_MS });
    return String(stdout ?? '');
  } catch {
    // No docker, no daemon, no permission — all "nothing to reclaim" here.
    return null;
  }
};

/**
 * Build the plan from the live daemon. Returns `null` when docker is
 * unavailable, so callers can stay silent instead of reporting an empty plan.
 */
export async function collectDockerImageReclaimPlan({ exec = execFileAsync, env = process.env, mode = DEFAULT_DOCKER_IMAGE_RECLAIM_MODE, protectedReferences = null } = {}) {
  if (normalizeDockerImageReclaimMode(mode) === 'none') return null;
  // Without `--all`, docker lists only the images tags point at plus dangling
  // ones — intermediate build layers are not ours to remove.
  const imagesOutput = await runDocker(exec, ['image', 'ls', '--format', '{{json .}}']);
  if (imagesOutput === null) return null;
  const containersOutput = await runDocker(exec, ['ps', '--all', '--format', '{{json .}}']);

  const isolationTag = resolveDockerIsolationImageTag({ env });
  const pinned = protectedReferences || MANAGED_IMAGE_REPOSITORIES.map(repository => `${repository}:${isolationTag}`);

  return planDockerImageReclaim({
    images: parseDockerImageJsonLines(imagesOutput),
    containers: parseDockerJsonLines(containersOutput ?? ''),
    mode,
    protectedReferences: pinned,
  });
}

/** `docker system df`'s own reclaimable figure, for the disk diagnostics. */
export async function measureDockerReclaimableBytes({ exec = execFileAsync } = {}) {
  const output = await runDocker(exec, ['system', 'df']);
  if (output === null) return null;
  const parsed = parseDockerSystemDf(output);
  return parsed.items.length > 0 ? parsed.totalReclaimableBytes : null;
}

export default {
  DEFAULT_DOCKER_IMAGE_RECLAIM_MODE,
  DOCKER_IMAGE_RECLAIM_MODES,
  MANAGED_IMAGE_REPOSITORIES,
  PROTECTED_IMAGE_TAGS,
  collectContainerImageReferences,
  collectDockerImageReclaimPlan,
  describeDockerImageReclaimReason,
  formatDockerImageReclaimSummary,
  measureDockerReclaimableBytes,
  normalizeDockerImageReclaimMode,
  parseDockerImageJsonLines,
  parseDockerJsonLines,
  planDockerImageReclaim,
  reclaimDockerImages,
  resolveDockerImageReclaimMode,
};
