/**
 * Decide, before a single image is built, whether this run can publish what it
 * is about to produce -- and report *every* answer, not the first bad one.
 *
 * Why this exists (issue #2221): a push to `main` exists to produce a release.
 * If a credential it needs is missing or expired, that is the answer to the
 * run, and everything after it is spend. link-foundation/box#117 is the
 * worked example: run 33972074755 published 2.5.0 and 2.6.0 to npm and GitHub
 * Releases, and delivered no images at all, because `docker/login-action` had
 * `continue-on-error: true` and the mirror steps were guarded on its outcome
 * -- a skipped step is not a failed step, so the pipeline reported success.
 *
 * The shape of this check follows from three properties of the situation:
 *
 *   - A *login* proves nothing (see registry-probe.lib.mjs). The probe writes.
 *   - Reporting must be exhaustive. Failing on the first bad credential turns
 *     one broken run into a queue of broken runs, one credential at a time.
 *     So every target is probed, and the exit code is decided at the end.
 *   - `unknown` is not `broken`. A registry that times out has not told us the
 *     credential is bad, and refusing to release on that basis would invent a
 *     new way for a release to fail. Unknowns are warnings, and a run in which
 *     *nothing* could be verified says so rather than reading as a pass.
 *
 * Two modes, because a pull request and a push to main are asking different
 * questions:
 *
 *   report   (pull requests) - probe, annotate, always exit 0. A PR exists to
 *            test code; a missing secret is a warning, and fork PRs have no
 *            secrets at all, so failing here would only block contributors.
 *   release  (push to main / workflow_dispatch) - probe, annotate, exit 1 on
 *            any definite failure, before the build spends anything.
 *
 * Uses only Node built-ins: this runs before `npm install`.
 */

import { probeRegistryWrite, probeAnonymousPull, probeOidcToken, parseImageReference } from './registry-probe.lib.mjs';

/** Registry write states that are proof of a broken credential. */
const DEFINITE_WRITE_FAILURES = new Set(['missing-credentials', 'invalid-credentials', 'insufficient-scope']);

/** Images this repository publishes. Overridable so the templates can reuse the script. */
export const DEFAULT_PUSH_TARGETS = ['docker.io/konard/hive-mind', 'docker.io/konard/hive-mind-dind'];

/**
 * `release` blocks the run on a definite failure; `report` never does.
 *
 * An explicit `--mode` wins. Otherwise a push to the default branch (or a
 * manual dispatch, which also publishes) is a release and everything else --
 * pull requests above all -- is a report.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.argv]
 * @param {Record<string, string|undefined>} [opts.env]
 * @returns {'release'|'report'}
 */
export function resolveMode({ argv = [], env = process.env } = {}) {
  const flagIndex = argv.indexOf('--mode');
  const explicit = flagIndex !== -1 ? argv[flagIndex + 1] : argv.find(arg => arg.startsWith('--mode='))?.split('=')[1];
  if (explicit) {
    if (explicit !== 'release' && explicit !== 'report') throw new Error(`unknown --mode '${explicit}' (expected 'release' or 'report')`);
    return explicit;
  }

  const eventName = env.GITHUB_EVENT_NAME || '';
  const ref = env.GITHUB_REF || '';
  const defaultBranch = env.GITHUB_DEFAULT_BRANCH || 'main';
  if (eventName === 'push' && ref === `refs/heads/${defaultBranch}`) return 'release';
  if (eventName === 'workflow_dispatch') return 'release';
  return 'report';
}

/** Split a comma/newline separated env list, or fall back to a default. */
function envList(value, fallback) {
  if (value === undefined) return fallback;
  const items = String(value)
    .split(/[\s,]+/)
    .map(item => item.trim())
    .filter(Boolean);
  return items;
}

/**
 * The credential pair a registry is reached with, read from the environment
 * the workflow hands the job.
 * @param {string} registry
 * @param {Record<string, string|undefined>} env
 */
function credentialsFor(registry, env) {
  if (registry === 'ghcr.io') return { username: env.GITHUB_ACTOR || 'github-actions', secret: env.GHCR_TOKEN || env.GITHUB_TOKEN, source: 'GITHUB_TOKEN' };
  return { username: env.DOCKERHUB_USERNAME, secret: env.DOCKERHUB_TOKEN, source: 'DOCKERHUB_USERNAME / DOCKERHUB_TOKEN' };
}

/**
 * What this run must be able to do, derived from the environment so the same
 * script serves this repository and the language templates.
 *
 * @param {object} [opts]
 * @param {Record<string, string|undefined>} [opts.env]
 * @returns {Array<object>} target descriptors
 */
export function buildTargets({ env = process.env } = {}) {
  const targets = [];

  for (const reference of envList(env.PREFLIGHT_PUSH_TARGETS, DEFAULT_PUSH_TARGETS)) {
    const { registry, repository } = parseImageReference(reference);
    const { username, secret, source } = credentialsFor(registry, env);
    targets.push({ kind: 'push', id: `push:${registry}/${repository}`, label: `push ${registry}/${repository}`, registry, repository, username, secret, credentialSource: source });
  }

  // Reachability, not just writability: an image the publisher can see and a
  // consumer cannot is a release that delivered nothing. Never blocking -- the
  // first release of a new image legitimately has nothing to pull yet.
  for (const reference of envList(env.PREFLIGHT_PULL_TARGETS, [])) {
    targets.push({ kind: 'pull', id: `pull:${reference}`, label: `anonymous pull ${reference}`, reference });
  }

  if (env.PREFLIGHT_NPM_OIDC !== 'false') {
    targets.push({ kind: 'oidc', id: 'oidc:npm', label: 'npm trusted publishing (OIDC)', audience: env.PREFLIGHT_NPM_OIDC_AUDIENCE || 'npm:registry.npmjs.org' });
  }

  return targets;
}

/**
 * How a probe result reads in a given mode.
 *
 * `report` downgrades every failure to a warning: a pull request must not be
 * blocked by a secret it was never given.
 *
 * @param {object} row
 * @param {'release'|'report'} mode
 * @returns {'ok'|'warning'|'error'}
 */
export function severityOf({ kind, state }, mode) {
  const isFailure =
    (kind === 'push' && DEFINITE_WRITE_FAILURES.has(state)) ||
    // A missing OIDC token means npm trusted publishing cannot work at all;
    // an unknown means the endpoint did not answer, which is not proof.
    (kind === 'oidc' && (state === 'missing-permission' || state === 'invalid-credentials'));

  if (isFailure) return mode === 'release' ? 'error' : 'warning';
  if (state === 'ok' || state === 'published') return 'ok';
  // 'unknown', and every non-blocking reachability state, is a warning: it
  // reports what was not established without claiming a failure.
  return 'warning';
}

/**
 * Probe every target and decide the run.
 *
 * Every target is probed even after one fails, so a broken pipeline is fixed
 * in one pass rather than one credential per run.
 *
 * @param {object} opts
 * @param {'release'|'report'} opts.mode
 * @param {Array<object>} opts.targets
 * @param {object} [opts.probes] injected probes (tests pass fakes)
 * @param {Record<string, string|undefined>} [opts.env]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{mode: string, rows: object[], failures: number, warnings: number, verified: number, ok: boolean}>}
 */
export async function runPreflight({ mode, targets, probes = {}, env = process.env, fetchImpl = fetch }) {
  const write = probes.probeRegistryWrite || probeRegistryWrite;
  const pull = probes.probeAnonymousPull || probeAnonymousPull;
  const oidc = probes.probeOidcToken || probeOidcToken;

  const rows = [];
  for (const target of targets) {
    let result;
    if (target.kind === 'push') result = await write({ registry: target.registry, repository: target.repository, username: target.username, secret: target.secret, fetchImpl });
    else if (target.kind === 'pull') result = await pull({ reference: target.reference, fetchImpl });
    else result = await oidc({ env, audience: target.audience, fetchImpl });

    const row = { ...target, state: result.state, detail: result.detail };
    row.severity = severityOf(row, mode);
    rows.push(row);
  }

  const failures = rows.filter(row => row.severity === 'error').length;
  const warnings = rows.filter(row => row.severity === 'warning').length;
  // What was actually established, as opposed to what merely did not fail.
  const verified = rows.filter(row => row.severity === 'ok').length;

  return { mode, rows, failures, warnings, verified, ok: failures === 0 };
}

/**
 * Workflow-command annotations, one per row that is not ok, so the answer is
 * on the run's summary page instead of somewhere in a build log.
 * @param {{rows: object[]}} result
 * @returns {string[]}
 */
export function renderAnnotations({ rows }) {
  return rows
    .filter(row => row.severity !== 'ok')
    .map(row => {
      const command = row.severity === 'error' ? 'error' : 'warning';
      return `::${command} title=Release preflight: ${row.label}::${row.state} - ${row.detail}`;
    });
}

/**
 * A markdown table for `$GITHUB_STEP_SUMMARY`.
 *
 * States "nothing was verified" out loud when that is what happened: a run in
 * which every probe came back `unknown` has zero failures, and reading that as
 * a pass is the mistake this whole check exists to stop.
 *
 * @param {{mode: string, rows: object[], failures: number, warnings: number, verified: number}} result
 * @returns {string}
 */
export function renderSummary({ mode, rows, failures, warnings, verified }) {
  const icon = { ok: '✅', warning: '⚠️', error: '❌' };
  const lines = ['## Release preflight', '', `Mode: \`${mode}\` — ${mode === 'release' ? 'a definite failure stops the run before it builds anything' : 'findings are reported; the run is never blocked'}.`, '', '| Target | State | Detail |', '| --- | --- | --- |', ...rows.map(row => `| ${icon[row.severity]} ${row.label} | \`${row.state}\` | ${row.detail.replaceAll('|', '\\|')} |`), '', `**${verified} verified, ${warnings} warning(s), ${failures} failure(s).**`];

  if (verified === 0) {
    lines.push('', '> Nothing was verified. This is not a pass: no probe established that this run can publish.');
  }

  return lines.join('\n');
}
