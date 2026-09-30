/**
 * The Hello World end-to-end matrix (issue #2319).
 *
 * The 2026-09-27 runs (#2320) produced three Hello World pull requests with
 * `--model formal-ai`, one per tool, and every one of them ended in draft, with
 * stray files, a stale body or a `🛑 Automation stopped` comment. None of that
 * was visible to a unit test, because each defect lived in the seam between
 * solve, the tool and GitHub. This matrix is the check that exercises the seam:
 * it runs the same command every operator runs, then asserts on the pull
 * request that came out of it, for every model the same way.
 *
 * Every decision lives here as a pure function; `scripts/e2e-hello-world.mjs`
 * only wires Docker and `gh` into it, and
 * `tests/e2e-hello-world-matrix-2319.test.mjs` pins each assertion against the
 * pull requests of the 2026-09-27 runs.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2319
 * @see docs/MODEL-SPECIFIC-BEHAVIOURS.md
 */

import { selectDraftPullRequest } from './formal-ai-draft.lib.mjs';

/** The exact line the task asks the program to print. */
export const HELLO_WORLD_OUTPUT = 'Hello, World!';

/** The comment marker solve writes when it gives up (`src/tool-comments.lib.mjs`). */
export const AUTOMATION_STOPPED_MARKER = 'Automation stopped';

/** Written by `formatChangesSection()` in `src/pull-request-changes.lib.mjs` (#2318). */
export const CHANGES_SECTION_START = '<!-- hive-mind:changes:start -->';

/**
 * One row per run. `formal-ai` goes through every tool; the LLM row is the
 * control — the same command with a model that is not special in any way. A
 * difference between the two is, by construction, a model-specific path.
 */
export const E2E_MATRIX = Object.freeze([Object.freeze({ tool: 'claude', model: 'formal-ai' }), Object.freeze({ tool: 'agent', model: 'formal-ai' }), Object.freeze({ tool: 'codex', model: 'formal-ai' }), Object.freeze({ tool: 'agent', model: 'nemotron-3-super-free' })]);

/**
 * The flags of the #2320 command, minus the operator-only ones.
 *
 * `--auto-restart-until-mergeable` is left at its default (on): the umbrella's
 * acceptance is that a run ends ready for review with a green workflow, and
 * restarting until the checks pass is how solve gets there.
 */
export const E2E_SOLVE_FLAGS = Object.freeze(['--attach-logs', '--verbose', '--no-tool-check', '--disable-report-issue', '--language', 'en']);

const ISSUE_URL_PATTERN = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+/g;

/**
 * The issue URL `create-test-repo.mjs` printed. It prints the URL twice (once
 * as `🎯 Issue:`, once inside the `./solve.mjs "…"` hint); both are the same.
 *
 * @param {string} output
 * @returns {string|null}
 */
export function parseIssueUrl(output) {
  const matches = String(output ?? '').match(ISSUE_URL_PATTERN);
  return matches ? matches[matches.length - 1] : null;
}

/**
 * @param {string} issueUrl
 * @returns {{owner: string, repo: string, repository: string, number: number}}
 */
export function parseIssue(issueUrl) {
  const match = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)$/.exec(String(issueUrl ?? ''));
  if (!match) throw new Error(`expected a github.com issue URL, received ${JSON.stringify(issueUrl)}`);
  return { owner: match[1], repo: match[2], repository: `${match[1]}/${match[2]}`, number: Number(match[3]) };
}

/**
 * The `solve` arguments for one matrix row. Identical for every model: the
 * only thing a row may change is `--tool` and `--model`.
 */
export function buildE2eSolveArgv({ issueUrl, tool, model, logDir, baseBranch, defaultToken = false } = {}) {
  parseIssue(issueUrl);
  if (!tool || !model) throw new Error('buildE2eSolveArgv needs a tool and a model');
  const argv = [issueUrl, '--tool', tool, '--model', model, ...E2E_SOLVE_FLAGS];
  if (logDir) argv.push('--log-dir', logDir);
  if (baseBranch) argv.push('--base-branch', baseBranch);
  if (defaultToken) argv.push('--no-auto-restart-until-mergeable');
  return argv;
}

/** The pull request solve opened for the issue: its branch is `issue-<n>-…`. */
export const selectPullRequest = selectDraftPullRequest;

const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/;

/**
 * Files that are never part of a Hello World answer. The first group is what
 * solve itself commits as a task placeholder (solve reverts it before the
 * session ends); the second is what a compiler leaves behind — the stray
 * `Main.class`/`Main.jar` of the 2026-09-27 Kotlin run.
 */
const PLACEHOLDER_FILES = new Set(['CLAUDE.md', 'AGENTS.md', '.gitkeep', 'HANDOFF.md']);
const ARTEFACT_FILE = /(^|\/)(target|build|bin|obj|out|node_modules|__pycache__)\/|\.(class|jar|o|obj|exe|out|pyc|so|dll|dylib)$/i;

/**
 * The shape of the diff: one workflow, at least one program file, and nothing
 * that is a placeholder or a build artefact. A README edit is allowed — the
 * task's own definition of done recommends a CI badge.
 *
 * @param {string[]} files paths changed by the pull request
 * @returns {{ok: boolean, reason: string}}
 */
export function checkDiffShape(files) {
  const paths = (Array.isArray(files) ? files : []).map(String);
  const workflows = paths.filter(path => WORKFLOW_FILE.test(path));
  const placeholders = paths.filter(path => PLACEHOLDER_FILES.has(path.split('/').pop()));
  const artefacts = paths.filter(path => ARTEFACT_FILE.test(path));
  const program = paths.filter(path => !WORKFLOW_FILE.test(path) && !placeholders.includes(path) && !artefacts.includes(path) && !/^readme(\.[a-z]+)?$/i.test(path));

  if (placeholders.length > 0) return { ok: false, reason: `placeholder files left in the diff: ${placeholders.join(', ')}` };
  if (artefacts.length > 0) return { ok: false, reason: `build artefacts committed: ${artefacts.join(', ')}` };
  if (workflows.length !== 1) return { ok: false, reason: `expected exactly one workflow under .github/workflows, found ${workflows.length}` };
  if (program.length === 0) return { ok: false, reason: 'no program file in the diff' };
  if (program.length > 2) return { ok: false, reason: `expected the program and at most one test script, found ${program.length} files: ${program.join(', ')}` };
  return { ok: true, reason: `${paths.length} files: ${paths.join(', ')}` };
}

/**
 * Whether a workflow run log shows the program printing exactly `Hello, World!`.
 *
 * `gh run view --log` prefixes each line with `<job>\t<step>\t<ISO timestamp> `.
 * The line must be the output and nothing else: `echo "Expected: Hello, World!"`
 * or an `if [ "$out" = "Hello, World!" ]` does not count.
 *
 * @param {string} logText
 * @returns {boolean}
 */
export function logPrintsHelloWorld(logText) {
  return String(logText ?? '')
    .split(/\r?\n/)
    .map(line => line.split('\t').pop())
    .map(line => line.replace(/^\uFEFF?\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/, ''))
    .map(line => line.replace(/^\[[^\]]+\]\s+(?:[^\s|]+\s+)*\| ?/, ''))
    .some(line => line === HELLO_WORLD_OUTPUT);
}

/**
 * Summarise `gh pr view --json statusCheckRollup`. Both shapes GitHub returns
 * are handled: check runs (`status`/`conclusion`) and commit statuses (`state`).
 *
 * @param {Array<object>} rollup
 * @returns {{total: number, pending: number, failed: string[], green: boolean}}
 */
export function summariseChecks(rollup) {
  const checks = Array.isArray(rollup) ? rollup : [];
  let pending = 0;
  const failed = [];
  for (const check of checks) {
    const name = check?.name || check?.context || 'check';
    if (check?.__typename === 'StatusContext' || (check?.state && !check?.status)) {
      if (check.state === 'PENDING' || check.state === 'EXPECTED') pending += 1;
      else if (check.state !== 'SUCCESS') failed.push(name);
      continue;
    }
    if (check?.status !== 'COMPLETED') pending += 1;
    else if (!['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(check?.conclusion)) failed.push(name);
  }
  return { total: checks.length, pending, failed, green: checks.length > 0 && pending === 0 && failed.length === 0 };
}

/**
 * Whether the body is the one solve regenerated from the final diff (#2318):
 * the marked Changes section is present and names every changed file.
 */
export function checkBodyRegenerated(body, files) {
  const text = String(body ?? '');
  if (!text.includes(CHANGES_SECTION_START)) return { ok: false, reason: 'the body has no solve-generated Changes section' };
  const missing = (Array.isArray(files) ? files : []).filter(path => !text.includes(path));
  if (missing.length > 0) return { ok: false, reason: `the Changes section does not list: ${missing.join(', ')}` };
  return { ok: true, reason: 'the Changes section matches the diff' };
}

/**
 * Every assertion #2319 names, evaluated against the evidence one run left.
 *
 * @param {object} evidence
 * @param {object|null} evidence.pullRequest `{number, state, isDraft, title, body}`
 * @param {string[]} evidence.files
 * @param {Array<object>} evidence.checks the status-check rollup
 * @param {string} evidence.workflowLog the head commit's workflow run log
 * @param {string[]} evidence.comments issue-comment bodies on the pull request
 * @returns {{passed: boolean, results: Array<{name: string, ok: boolean, reason: string}>}}
 */
export function evaluateE2eRun({ pullRequest = null, files = [], checks = [], workflowLog = '', comments = [] } = {}) {
  if (!pullRequest) return { passed: false, results: [{ name: 'pull request opened', ok: false, reason: 'solve opened no pull request for the issue' }] };

  const diff = checkDiffShape(files);
  const checkSummary = summariseChecks(checks);
  const body = checkBodyRegenerated(pullRequest.body, files);
  const stopped = (Array.isArray(comments) ? comments : []).filter(comment => String(comment ?? '').includes(AUTOMATION_STOPPED_MARKER));
  const title = String(pullRequest.title ?? '');

  const results = [
    { name: 'ready for review', ok: pullRequest.state === 'OPEN' && pullRequest.isDraft === false, reason: `state ${pullRequest.state}, ${pullRequest.isDraft ? 'draft' : 'ready'}` },
    { name: 'diff is the program, the workflow and a test script', ...diff },
    { name: 'program prints exactly "Hello, World!"', ok: logPrintsHelloWorld(workflowLog), reason: workflowLog ? 'searched the workflow run log for the exact line' : 'no workflow run log was available' },
    { name: 'workflow green', ok: checkSummary.green, reason: checkSummary.total === 0 ? 'no checks reported' : `${checkSummary.total} checks, ${checkSummary.pending} pending, failed: ${checkSummary.failed.join(', ') || 'none'}` },
    { name: 'body regenerated', ...body },
    { name: 'title is final', ok: !/^\[WIP\]/i.test(title) && !/^(['"]).*\1$/.test(title), reason: JSON.stringify(title) },
    { name: 'no "🛑 Automation stopped" comment', ok: stopped.length === 0, reason: `${stopped.length} stop comments` },
  ];
  return { passed: results.every(result => result.ok), results };
}

/** One markdown table cell: backslashes first, then pipes, and no line breaks. */
export const escapeTableCell = value =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');

/** A GitHub step-summary table of one run's results. */
export function formatE2eReport({ tool, model, issueUrl, pullRequestUrl = null, evaluation }) {
  const lines = [`### ${evaluation.passed ? '✅' : '❌'} \`--tool ${tool} --model ${model}\``, '', `Issue: ${issueUrl}`, `Pull request: ${pullRequestUrl ?? 'none'}`, '', '| Assertion | Result | Detail |', '|---|---|---|'];
  for (const result of evaluation.results) lines.push(`| ${result.name} | ${result.ok ? '✅' : '❌'} | ${escapeTableCell(result.reason)} |`);
  return `${lines.join('\n')}\n`;
}
