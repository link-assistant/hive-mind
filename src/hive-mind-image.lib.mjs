/**
 * Resolve the Hive Mind container image references shared by the Docker
 * isolation runner and the Formal AI sidecar.
 *
 * Extracted from `isolation-runner.lib.mjs` for issue #2154: the Formal AI
 * sidecar needs the very same reference to fall back to the locally present
 * Hive Mind image (which bakes `/usr/local/bin/formal-ai`) when the published
 * Formal AI image cannot be pulled, and importing the isolation runner from the
 * sidecar would create an import cycle.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2154
 */

export const HIVE_MIND_IMAGE_REPO = 'konard/hive-mind';
export const HIVE_MIND_DIND_IMAGE_REPO = 'konard/hive-mind-dind';
export const DEFAULT_HIVE_MIND_IMAGE_TAG = 'latest';

/**
 * Resolve the tag used for the Docker isolation image.
 *
 * Release Docker images bake this env var from `HIVE_MIND_VERSION`, so a parent
 * container started via `:latest` still launches child isolation containers from
 * the same immutable release tag. Local/PR builds fall back to `latest`, and
 * operators can override the tag explicitly when using custom images. Pinning
 * matters for Docker-in-Docker deployments: the nested daemon starts with an
 * empty image store, so a `:latest` digest drift from the host copy forces a
 * fresh multi-gigabyte pull. See issue #1879.
 */
export function resolveDockerIsolationImageTag({ env = process.env } = {}) {
  const explicit = String(env.HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG || '').trim();
  return explicit || DEFAULT_HIVE_MIND_IMAGE_TAG;
}

/** Docker's tag grammar: a word character, then up to 127 word characters, dots or dashes. */
const DOCKER_IMAGE_TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

/** Whether `value` is a Docker image tag rather than a full image reference. */
export function isDockerImageTag(value) {
  return DOCKER_IMAGE_TAG_PATTERN.test(String(value ?? ''));
}

/**
 * Pick the Docker image used for `--isolation docker`.
 *
 * start-command defaults its Docker backend to a base OS image. Hive Mind needs
 * an image with the same CLI/tooling baseline as the parent process instead.
 *
 * `HIVE_MIND_DOCKER_ISOLATION_IMAGE` is a full override (repo:tag). Otherwise
 * the repo is chosen by image variant and the tag by
 * `resolveDockerIsolationImageTag()`.
 *
 * hive-manager releases before issue #4144 passed the full deployment image
 * reference (`konard/hive-mind-dind:2.49.0`) in the tag variable of DinD and
 * socket deployments. Prefixing it with a repository can only produce an invalid
 * reference, so a value that is not a tag is used as the full reference instead.
 */
export function getDockerIsolationImage({ env = process.env } = {}) {
  const override = String(env.HIVE_MIND_DOCKER_ISOLATION_IMAGE || '').trim();
  if (override) return override;
  const tag = resolveDockerIsolationImageTag({ env });
  if (!isDockerImageTag(tag)) return tag;
  const repo = String(env.HIVE_MIND_IMAGE_VARIANT || '').toLowerCase() === 'dind' ? HIVE_MIND_DIND_IMAGE_REPO : HIVE_MIND_IMAGE_REPO;
  return `${repo}:${tag}`;
}

export default {
  DEFAULT_HIVE_MIND_IMAGE_TAG,
  HIVE_MIND_DIND_IMAGE_REPO,
  HIVE_MIND_IMAGE_REPO,
  getDockerIsolationImage,
  isDockerImageTag,
  resolveDockerIsolationImageTag,
};
