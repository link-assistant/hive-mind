#!/usr/bin/env node

/**
 * Where a session's log can be found after the process that wrote it is gone.
 *
 * The Formal AI draft workflow runs `solve` in a `docker run --rm` container.
 * When the log upload failed there, the pull request was told the complete log
 * was at `/home/box/logs/solve-….log` "inside the docker container", which was
 * removed seconds later. The workflow had uploaded that log as an artifact of
 * its run, so the run is the place to link.
 *
 * The container has no `GITHUB_*` variables of its own, so the workflow passes
 * `HIVE_MIND_CI_RUN_URL` and `HIVE_MIND_EPHEMERAL_CONTAINER` in. A process that
 * runs directly in GitHub Actions derives the URL from the standard variables.
 */

const isHttpUrl = value => /^https?:\/\/[^\s]+$/i.test(value);

/**
 * URL of the CI run this process belongs to, or null.
 * @param {Object} [env=process.env]
 * @returns {string|null}
 */
export const resolveCiRunUrl = (env = process.env) => {
  const explicit = String(env?.HIVE_MIND_CI_RUN_URL || '').trim();
  if (explicit) return isHttpUrl(explicit) ? explicit : null;
  if (env?.GITHUB_ACTIONS !== 'true') return null;
  const repository = String(env.GITHUB_REPOSITORY || '').trim();
  const runId = String(env.GITHUB_RUN_ID || '').trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^\d+$/.test(runId)) return null;
  const server = String(env.GITHUB_SERVER_URL || 'https://github.com')
    .trim()
    .replace(/\/+$/, '');
  if (!isHttpUrl(server)) return null;
  return `${server}/${repository}/actions/runs/${runId}`;
};

/**
 * Whether this process runs in a container that is removed when it exits
 * (`docker run --rm`), so no file it writes outlives the session.
 * @param {Object} [env=process.env]
 * @returns {boolean}
 */
export const isEphemeralContainer = (env = process.env) => ['1', 'true'].includes(String(env?.HIVE_MIND_EPHEMERAL_CONTAINER || '').toLowerCase());
