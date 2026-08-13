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

/**
 * Pick the Docker image used for `--isolation docker`.
 *
 * start-command defaults its Docker backend to a base OS image. Hive Mind needs
 * an image with the same CLI/tooling baseline as the parent process instead.
 *
 * `HIVE_MIND_DOCKER_ISOLATION_IMAGE` is a full override (repo:tag). Otherwise
 * the repo is chosen by image variant and the tag by
 * `resolveDockerIsolationImageTag()`.
 */
export function getDockerIsolationImage({ env = process.env } = {}) {
  if (env.HIVE_MIND_DOCKER_ISOLATION_IMAGE) return env.HIVE_MIND_DOCKER_ISOLATION_IMAGE;
  const repo = String(env.HIVE_MIND_IMAGE_VARIANT || '').toLowerCase() === 'dind' ? HIVE_MIND_DIND_IMAGE_REPO : HIVE_MIND_IMAGE_REPO;
  return `${repo}:${resolveDockerIsolationImageTag({ env })}`;
}

export default {
  DEFAULT_HIVE_MIND_IMAGE_TAG,
  HIVE_MIND_DIND_IMAGE_REPO,
  HIVE_MIND_IMAGE_REPO,
  getDockerIsolationImage,
  resolveDockerIsolationImageTag,
};
