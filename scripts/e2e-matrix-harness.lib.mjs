/**
 * Issue #3332: what kept the Hello World matrix from ever passing, as pure
 * functions next to the wiring in `scripts/e2e-matrix-schedule.mjs` and
 * `scripts/e2e-hello-world.mjs`.
 *
 * - The version under test is the one Hive Mind's images install (the
 *   bootstrap pin), not the GitHub Releases `latest`, which lagged crates.io
 *   (link-assistant/formal-ai#1203).
 * - The default `GITHUB_TOKEN` can never push `.github/workflows/*`: such a
 *   row asks for the workflow under `ci/`, and the harness copies it into
 *   place and runs it with act. A push GitHub still rejects is reported as a
 *   harness failure, never as a model failure.
 * - Harness and model verdicts are reported apart.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3332
 */

import { readFileSync } from 'node:fs';
import { FORMAL_AI_BOOTSTRAP_VERSION } from '../src/formal-ai-version.lib.mjs';

/** GitHub Releases `latest` lagging crates.io is a Formal AI release defect. */
export const FORMAL_AI_RELEASES_ISSUE = 'https://github.com/link-assistant/formal-ai/issues/1203';

/** Known Formal AI causes of a red Formal AI row; the row stays red until they are fixed. */
export const FORMAL_AI_KNOWN_ISSUES = Object.freeze([Object.freeze({ url: 'https://github.com/link-assistant/formal-ai/issues/1209', summary: 'the run ends in `planned_not_executed` and the diff is only `.gitkeep` and the dev log' }), Object.freeze({ url: 'https://github.com/link-assistant/formal-ai/issues/1154', summary: 'the model repeats the same tool call and the title stays `[WIP]`' })]);

/** The images that install Formal AI; each must agree with the bootstrap pin. */
export const SHIPPED_FORMAL_AI_DOCKERFILES = Object.freeze(['Dockerfile', 'Dockerfile.formal-ai']);

export const normalizeFormalAiVersion = version =>
  String(version ?? '')
    .trim()
    .replace(/^v/, '') || null;

const DOCKERFILE_FORMAL_AI_ARG = /^ARG FORMAL_AI_VERSION=(\S+)\s*$/m;

/**
 * The Formal AI version Hive Mind ships: the bootstrap pin, which every image
 * installs. A Dockerfile that installs something else makes it ambiguous.
 *
 * @param {object} [options]
 * @param {string} [options.pin] `FORMAL_AI_BOOTSTRAP_VERSION`
 * @param {Object<string, string>} [options.dockerfiles] name -> contents
 * @returns {string}
 */
export function resolveShippedFormalAiVersion({ pin = FORMAL_AI_BOOTSTRAP_VERSION, dockerfiles = {} } = {}) {
  const shipped = normalizeFormalAiVersion(pin);
  if (!/^\d+\.\d+\.\d+$/.test(shipped || '')) throw new Error(`Unexpected shipped Formal AI version: ${pin}`);
  const disagreements = Object.entries(dockerfiles)
    .map(([name, text]) => [name, DOCKERFILE_FORMAL_AI_ARG.exec(String(text ?? ''))?.[1] ?? null])
    .filter(([, arg]) => normalizeFormalAiVersion(arg) !== shipped)
    .map(([name, arg]) => `${name} ARG FORMAL_AI_VERSION=${arg ?? 'missing'}`);
  if (disagreements.length) throw new Error(`The shipped Formal AI version is ambiguous: src/formal-ai-version.lib.mjs pins ${shipped} but ${disagreements.join(', ')}. Align them before running the matrix.`);
  return shipped;
}

/** {@link resolveShippedFormalAiVersion} against this checkout. */
export const readShippedFormalAiVersion = ({ readFile = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8') } = {}) => resolveShippedFormalAiVersion({ dockerfiles: Object.fromEntries(SHIPPED_FORMAL_AI_DOCKERFILES.map(name => [name, readFile(name)])) });

/** The newest stable `formal-ai` on crates.io. */
export async function fetchLatestCrateVersion({ fetchImpl = globalThis.fetch, crate = 'formal-ai' } = {}) {
  const response = await fetchImpl(`https://crates.io/api/v1/crates/${crate}`, { headers: { 'User-Agent': 'link-assistant/hive-mind e2e-hello-world-matrix (https://github.com/link-assistant/hive-mind)' } });
  if (!response.ok) throw new Error(`crates.io answered ${response.status}`);
  const body = await response.json();
  return normalizeFormalAiVersion(body?.crate?.max_stable_version || body?.crate?.max_version);
}

/**
 * Compare where Formal AI is published. Only the shipped version is tested;
 * a GitHub release that disagrees with crates.io is flagged, not followed.
 *
 * @returns {{shipped: string, githubRelease: (string|null), crates: (string|null), warnings: Array<{title: string, message: string}>}}
 */
export function compareFormalAiSources({ shipped, githubRelease = null, crates = null }) {
  const release = normalizeFormalAiVersion(githubRelease);
  const crate = normalizeFormalAiVersion(crates);
  const warnings = [];
  if (release && crate && release !== crate) warnings.push({ title: 'Formal AI releases and crates disagree', message: `GitHub Releases latest is ${release} but crates.io has ${crate}. The matrix tests the shipped ${shipped}, not the GitHub release. See ${FORMAL_AI_RELEASES_ISSUE}` });
  return { shipped, githubRelease: release, crates: crate, warnings };
}

/** The prepare job's step summary: which Formal AI the run tests, and from where. */
export function formatFormalAiSourcesSummary(sources) {
  const lines = ['### Formal AI under test', '', '| Source | Version |', '|---|---|', `| Shipped by Hive Mind (tested) | ${sources.shipped} |`, `| GitHub Releases latest | ${sources.githubRelease ?? 'unavailable'} |`, `| crates.io latest | ${sources.crates ?? 'unavailable'} |`];
  for (const warning of sources.warnings) lines.push('', `> **${warning.title}.** ${warning.message}`);
  return `${lines.join('\n')}\n`;
}

/** The workflow directory a row's task asks for: the default token cannot push `.github/workflows`. */
export const STAGED_WORKFLOW_DIR = 'ci/';
export const workflowDirectoryForLayer = layer => (layer === 'default' ? STAGED_WORKFLOW_DIR : '.github/workflows/');
export const stagedWorkflowTarget = path => `.github/workflows/${String(path).split('/').pop()}`;

/** The execution record of staged workflows run by act. */
export const stagedWorkflowExecution = ({ code, stdout }, staged) => ({
  mode: 'act',
  approval: [],
  fallbackReason: `the default token cannot push workflows, so the task staged ${staged.join(', ')} and the harness ran it with act`,
  runs: [],
  workflowLog: stdout,
  checks: [{ name: 'Generated workflow (act)', status: 'COMPLETED', conclusion: code === 0 ? 'SUCCESS' : 'FAILURE' }],
});

/** The summary line a rejected workflow push is reported under. */
export const WORKFLOW_PUSH_REJECTED = 'harness: workflow push rejected (no workflows permission)';

const WORKFLOW_PUSH_REJECTION = /refusing to allow an? (GitHub App|OAuth App|Personal Access Token|integration) to create or update workflow `?([^`\s)]+)`? without `?workflows?`? (?:permission|scope)/i;

/**
 * GitHub's rejection of a push that touches `.github/workflows/*` without the
 * `workflows` permission (or `workflow` scope). It rejects the whole push.
 *
 * @param {string} logText solve.log
 * @returns {{workflow: string, credential: string}|null}
 */
export function detectWorkflowPushRejection(logText) {
  const match = WORKFLOW_PUSH_REJECTION.exec(String(logText ?? ''));
  return match ? { workflow: match[2], credential: match[1] } : null;
}

/** The harness result for a rejected workflow push, with what a maintainer must do. */
export function workflowPushRejectionResult(rejection, { layer = 'default' } = {}) {
  const fix = layer === 'default' ? 'The default GITHUB_TOKEN can never push .github/workflows; this row asks the task for ci/ instead. To test a real workflow push, a maintainer must set vars.AUTOMATION_APP_ID and secrets.AUTOMATION_APP_PRIVATE_KEY (a GitHub App with Workflows: read and write) or secrets.AUTOMATION_TOKEN (a token with the workflow scope).' : `The ${layer} credential has no workflows permission: a maintainer must grant the automation GitHub App "Workflows: read and write" or give secrets.AUTOMATION_TOKEN the workflow scope.`;
  return { name: 'workflow push accepted', ok: false, reason: `${WORKFLOW_PUSH_REJECTED}: ${rejection.workflow}. ${fix}` };
}

/**
 * Separate verdicts: a harness failure (rejected push, missing credential,
 * wrong image) means the model was not judged at all.
 */
export function splitE2eVerdict({ harness = [], evaluation }) {
  const harnessFailures = harness.filter(result => !result.ok);
  const modelResults = evaluation?.results ?? [];
  const modelFailures = modelResults.filter(result => !result.ok);
  const judged = harnessFailures.length === 0 && modelResults.length > 0;
  return { harness: { ok: harnessFailures.length === 0, failures: harnessFailures }, model: { judged, ok: judged && modelFailures.length === 0, failures: modelFailures }, passed: harnessFailures.length === 0 && judged && modelFailures.length === 0 };
}

export default { compareFormalAiSources, detectWorkflowPushRejection, fetchLatestCrateVersion, FORMAL_AI_KNOWN_ISSUES, FORMAL_AI_RELEASES_ISSUE, formatFormalAiSourcesSummary, normalizeFormalAiVersion, readShippedFormalAiVersion, resolveShippedFormalAiVersion, SHIPPED_FORMAL_AI_DOCKERFILES, splitE2eVerdict, STAGED_WORKFLOW_DIR, stagedWorkflowExecution, stagedWorkflowTarget, workflowDirectoryForLayer, WORKFLOW_PUSH_REJECTED, workflowPushRejectionResult };
