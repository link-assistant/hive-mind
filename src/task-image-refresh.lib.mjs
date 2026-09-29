#!/usr/bin/env node

/**
 * Keep the task image current, and say which one ran.
 *
 * Issue #2247 (H1). All three 2026-09-13 `solve --model formal-ai` tasks printed
 * `🚀 solve v2.22.0` on line 6 of their logs. v2.28.1 had been released at
 * 16:59Z; the first task started at 18:50Z. Everything merged in between was
 * inactive, including the fixes those very tasks needed.
 *
 * The drift has one cause and one aggravating factor:
 *
 *   - `resolveDockerIsolationImageTag` defaults to `latest`
 *     (`hive-mind-image.lib.mjs`), and start-command's Docker backend runs
 *     `docker run` with Docker's default `missing` pull policy. A `latest`
 *     pulled a week ago is "present", so it is reused forever. Reuse is what
 *     issue #1879 asked for and it stays: this module refreshes a *mutable*
 *     reference before the container is created, which is a manifest check
 *     against the registry, not a re-download, when the local copy is current.
 *   - Nothing recorded which image ran, so the drift was invisible. Every
 *     refresh resolves the digest, and the digest travels into the task through
 *     {@link TASK_IMAGE_ENV} so the session comment can state it.
 *
 * A pinned reference - an immutable release tag or an explicit `@sha256:` - is
 * never pulled: it cannot drift, and in the Docker-in-Docker deployment the
 * nested daemon's copy was seeded from the host on purpose (#1879).
 *
 * Refreshing never fails a task. A registry that cannot be reached leaves the
 * local image in place; the digest is still read and reported, so the comment
 * names the image that actually ran rather than the one that should have.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2247
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** How the launcher tells the task which image it is running inside. */
export const TASK_IMAGE_ENV = Object.freeze({ image: 'HIVE_MIND_TASK_IMAGE', digest: 'HIVE_MIND_TASK_IMAGE_DIGEST' });

/** Operator override: `auto` (default), `always`, or `never`. */
export const TASK_IMAGE_PULL_POLICY_ENV = 'HIVE_MIND_DOCKER_ISOLATION_PULL';

/** Tags whose contents change under the same name. */
export const MUTABLE_IMAGE_TAGS = Object.freeze(['latest', 'main', 'master', 'edge', 'nightly', 'dev']);

/** A `docker pull` of a current image is a manifest check; give it a minute. */
export const TASK_IMAGE_PULL_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Split `repo[:tag][@sha256:…]` into its parts.
 *
 * The registry host may carry a port (`ghcr.io:443/x/y`), so the tag separator
 * is looked for after the last `/`.
 *
 * @param {string} reference
 * @returns {{name: string, tag: string|null, digest: string|null}}
 */
export const parseImageReference = reference => {
  const text = String(reference || '').trim();
  if (!text) return { name: '', tag: null, digest: null };
  const [withoutDigest, digest = null] = text.split('@');
  const lastSlash = withoutDigest.lastIndexOf('/');
  const colon = withoutDigest.indexOf(':', lastSlash + 1);
  if (colon === -1) return { name: withoutDigest, tag: null, digest };
  return { name: withoutDigest.slice(0, colon), tag: withoutDigest.slice(colon + 1) || null, digest };
};

/**
 * @param {string} reference
 * @returns {boolean} whether the same reference can point at different bits tomorrow
 */
export const isMutableImageReference = reference => {
  const { name, tag, digest } = parseImageReference(reference);
  if (!name) return false;
  if (digest) return false;
  // An untagged reference is `:latest` by Docker's own default.
  if (!tag) return true;
  return MUTABLE_IMAGE_TAGS.includes(tag.toLowerCase());
};

/** @returns {'auto'|'always'|'never'} */
export const resolveTaskImagePullPolicy = (env = process.env) => {
  const raw = String(env?.[TASK_IMAGE_PULL_POLICY_ENV] || '')
    .trim()
    .toLowerCase();
  if (raw === 'always' || raw === 'never') return raw;
  return 'auto';
};

/**
 * @param {Object} params
 * @param {string} params.image
 * @param {Object} [params.env]
 * @returns {{pull: boolean, reason: string}}
 */
export const shouldPullTaskImage = ({ image, env = process.env } = {}) => {
  const policy = resolveTaskImagePullPolicy(env);
  if (policy === 'never') return { pull: false, reason: `${TASK_IMAGE_PULL_POLICY_ENV}=never` };
  if (policy === 'always') return { pull: true, reason: `${TASK_IMAGE_PULL_POLICY_ENV}=always` };
  if (!image) return { pull: false, reason: 'no image to refresh' };
  if (isMutableImageReference(image)) return { pull: true, reason: 'the tag is mutable and can drift from the registry' };
  return { pull: false, reason: 'the reference is pinned and cannot drift' };
};

/** One line naming the image a task ran inside. */
export const describeTaskImage = ({ image, digest } = {}) => {
  if (!image) return digest ? String(digest) : 'unknown';
  return digest && !String(image).includes('@') ? `${image}@${digest}` : String(image);
};

/**
 * Default `run`: a bounded, non-throwing `docker …`.
 *
 * @param {string[]} args
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
const runDocker = async (args, { timeoutMs = TASK_IMAGE_PULL_TIMEOUT_MS } = {}) => {
  try {
    const result = await execFileAsync('docker', args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
    return { code: 0, stdout: result?.stdout ?? '', stderr: result?.stderr ?? '' };
  } catch (error) {
    return { code: typeof error?.code === 'number' ? error.code : 1, stdout: error?.stdout ?? '', stderr: error?.stderr ?? error?.message ?? String(error) };
  }
};

/**
 * Read the digest that identifies the local copy of an image.
 *
 * A published image has a repository digest, which is the reference an operator
 * can pull again. A locally built one has none; its image ID is the only stable
 * identity it has, and saying so is better than reporting nothing.
 *
 * @returns {Promise<{digest: string|null, source: 'repository'|'image-id'|null}>}
 */
export const readTaskImageDigest = async ({ image, run = runDocker, timeoutMs = 60_000 } = {}) => {
  const result = await run(['image', 'inspect', '--format', '{{.Id}}\t{{join .RepoDigests ","}}', image], { timeoutMs });
  if (result?.code !== 0) return { digest: null, source: null };
  const [id = '', repoDigests = ''] = String(result.stdout?.toString() || '')
    .trim()
    .split('\t');
  const published = repoDigests
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
  if (published.length) {
    const [first] = published;
    const at = first.lastIndexOf('@');
    return { digest: at === -1 ? first : first.slice(at + 1), source: 'repository' };
  }
  return id ? { digest: id.trim(), source: 'image-id' } : { digest: null, source: null };
};

/** Refreshes already done in this process, keyed by image reference. */
const refreshed = new Map();

/** Test seam: forget what this process has already refreshed. */
export const resetTaskImageRefreshCache = () => refreshed.clear();

/**
 * Bring the task image up to date and resolve its digest.
 *
 * Once per process per reference: a `hive` loop launches many tasks, and the
 * registry check belongs at the start of the run, not in front of every task.
 *
 * @param {Object} params
 * @param {string} params.image
 * @param {Object} [params.env]
 * @param {Function} [params.run] - `(args, {timeoutMs}) => {code, stdout, stderr}`
 * @param {Function} [params.log] - `(message) => void`
 * @param {number} [params.timeoutMs]
 * @param {boolean} [params.force] - ignore the per-process cache
 * @returns {Promise<{image: string, digest: string|null, digestSource: string|null, pulled: boolean, reason: string, error: string|null}>}
 */
export const refreshTaskImage = async ({ image, env = process.env, run = runDocker, log = null, timeoutMs = TASK_IMAGE_PULL_TIMEOUT_MS, force = false } = {}) => {
  if (!image) return { image: '', digest: null, digestSource: null, pulled: false, reason: 'no image to refresh', error: null };
  if (!force && refreshed.has(image)) return refreshed.get(image);

  const say = async message => {
    if (typeof log === 'function') await log(message);
  };

  const decision = shouldPullTaskImage({ image, env });
  let error = null;
  let pulled = false;
  if (decision.pull) {
    await say(`🐳 Refreshing task image ${image} (${decision.reason})`);
    const result = await run(['pull', image], { timeoutMs });
    if (result?.code === 0) pulled = true;
    else {
      error =
        String(result?.stderr?.toString() || '')
          .trim()
          .split('\n')
          .filter(Boolean)
          .slice(-1)[0] || `docker pull exited with code ${result?.code}`;
      // Not fatal: the task runs on the local copy, and the digest below says
      // which one that is.
      await say(`⚠️ Could not refresh task image ${image}: ${error}`);
    }
  } else {
    await say(`🐳 Task image ${image} is not refreshed (${decision.reason})`);
  }

  const { digest, source } = await readTaskImageDigest({ image, run });
  const outcome = { image, digest, digestSource: source, pulled, reason: decision.reason, error };
  if (digest) await say(`🐳 Task image ${describeTaskImage({ image, digest })}${pulled ? ' (refreshed)' : ''}`);
  refreshed.set(image, outcome);
  return outcome;
};

/**
 * The environment entries that tell the task which image it is running inside.
 *
 * @param {{image: string, digest: string|null}|null} provenance
 * @returns {Object}
 */
export const buildTaskImageProvenanceEnv = (provenance = null) => {
  if (!provenance?.image) return {};
  const entries = { [TASK_IMAGE_ENV.image]: provenance.image, [TASK_IMAGE_ENV.digest]: provenance.digest || null };
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value));
};

/**
 * Read back what the launcher published, from inside the task.
 *
 * @param {Object} [env]
 * @returns {{image: string|null, digest: string|null}|null}
 */
export const readTaskImageProvenance = (env = process.env) => {
  const image = String(env?.[TASK_IMAGE_ENV.image] || '').trim() || null;
  const digest = String(env?.[TASK_IMAGE_ENV.digest] || '').trim() || null;
  if (!image && !digest) return null;
  return { image, digest };
};

export default {
  buildTaskImageProvenanceEnv,
  describeTaskImage,
  isMutableImageReference,
  MUTABLE_IMAGE_TAGS,
  parseImageReference,
  readTaskImageDigest,
  readTaskImageProvenance,
  refreshTaskImage,
  resetTaskImageRefreshCache,
  resolveTaskImagePullPolicy,
  shouldPullTaskImage,
  TASK_IMAGE_ENV,
  TASK_IMAGE_PULL_POLICY_ENV,
  TASK_IMAGE_PULL_TIMEOUT_MS,
};
