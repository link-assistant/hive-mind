#!/usr/bin/env node

/**
 * Issue #2839: tell the AI when a failing CI check also fails without the pull
 * request - and that it still has to make it pass.
 *
 * In the 2026-10-09 stylist-svelte run (`solve --tool codex --think xhigh`,
 * fork mode) the only CI job, `pipeline-check`, failed in "Initialize public
 * sandbox submodules" while cloning a private repository (404). It had failed
 * on every push to `main` since 2026-10-07 and on the solver's own placeholder
 * commit `73b6c7d`, which adds nothing but `.gitkeep`. Each restarted session
 * only reported "CI remains blocked: ... returns 404" and changed nothing.
 *
 * A pre-existing failure is not a reason to give up on the pull request: it
 * cannot be merged or released while its CI fails. So the restart prompt says
 * that every failing check must be fixed, including pre-existing ones, and how
 * to handle a failure that needs a human (a missing secret, access to a private
 * repository): make the pull request's CI pass without that action, and make CI
 * on the default branch fail with an explicit message saying what a human has
 * to do, so the job can be re-run once it is done. The run-away loop itself is
 * stopped by the no-progress breaker (`session-progress.lib.mjs`), not here.
 *
 * A failing check is "pre-existing" when the same check (matched by name) also
 * failed on a commit that does not contain the pull request's work:
 *
 *   1. the current head of the base branch - checked first, because when the
 *      base branch is green again the pull request only needs to merge it, so
 *      the failure is not reported as pre-existing; then
 *   2. the solver's placeholder commit (`Initial commit with task details`,
 *      only `.gitkeep` / `CLAUDE.md`), whose CI result is the base branch's.
 *
 * The first of those commits on which the check reached a conclusion decides.
 * A check that never completed on either commit is treated as new. The result
 * only adds evidence to the prompt, so the AI does not spend a session finding
 * out that the failure is not its own.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2839
 */

/** Message prefix of the commit `solve.auto-pr.lib.mjs` creates to open the pull request. */
export const PLACEHOLDER_COMMIT_PATTERN = /^Initial commit with task details/i;

/** Conclusions that mean "this check ran and failed" on a reference commit. */
const FAILED_CONCLUSIONS = new Set(['failure', 'error', 'timed_out', 'startup_failure']);

const noopLog = async () => {};

const parseJson = text => {
  try {
    return JSON.parse(String(text ?? '').trim() || 'null');
  } catch {
    return null;
  }
};

/** stdout of a successful command, or null - a failed lookup is "no evidence". */
const stdoutOf = async promise => {
  try {
    const result = await promise;
    return result?.code === 0 ? result.stdout?.toString() || '' : null;
  } catch {
    return null;
  }
};

/**
 * Reduce check runs and commit statuses to `name -> conclusion` (null while
 * nothing of that name has completed). When a name ran more than once (a
 * re-run), any completed non-failure wins: a check only counts as failed on a
 * reference commit when it never passed there.
 *
 * @param {Object} params
 * @param {Array} [params.checkRuns] - `check_runs` entries of the GitHub API
 * @param {Array} [params.statuses] - `statuses` entries of the combined status API
 * @returns {Map<string, string|null>}
 */
export const summarizeCommitChecks = ({ checkRuns = [], statuses = [] } = {}) => {
  const conclusions = new Map();
  const add = (name, conclusion) => {
    if (!name) return;
    if (!conclusions.has(name)) conclusions.set(name, []);
    if (conclusion) conclusions.get(name).push(conclusion);
  };
  for (const check of checkRuns || []) add(check?.name, check?.status === 'completed' ? check?.conclusion : null);
  for (const status of statuses || []) add(status?.context, status?.state === 'pending' ? null : status?.state);
  const summary = new Map();
  for (const [name, list] of conclusions) summary.set(name, list.find(conclusion => !FAILED_CONCLUSIONS.has(conclusion)) || list[0] || null);
  return summary;
};

/**
 * Pure classification of the pull request's failing checks against reference
 * commits that do not contain its work.
 *
 * @param {Object} params
 * @param {string[]} params.failingChecks - names of the checks failing on the PR head
 * @param {Array<{label: string, sha: string, url?: string, checks: Map<string, string|null>}>} params.references - in priority order
 * @returns {{allPreExisting: boolean, preExisting: Array<{name: string, reference: Object, conclusion: string}>, newFailures: string[]}}
 */
export const classifyPreExistingCiFailures = ({ failingChecks = [], references = [] } = {}) => {
  const names = [...new Set((failingChecks || []).filter(Boolean))];
  const preExisting = [];
  const newFailures = [];
  for (const name of names) {
    const decided = (references || []).find(reference => reference?.checks instanceof Map && reference.checks.get(name));
    const conclusion = decided ? decided.checks.get(name) : null;
    if (decided && FAILED_CONCLUSIONS.has(conclusion)) preExisting.push({ name, reference: decided, conclusion });
    else newFailures.push(name);
  }
  return { allPreExisting: names.length > 0 && newFailures.length === 0, preExisting, newFailures };
};

const fetchCommitChecks = async ({ command, owner, repo, sha }) => {
  const checksText = await stdoutOf(command`gh api repos/${owner}/${repo}/commits/${sha}/check-runs --paginate --slurp`);
  const statusText = await stdoutOf(command`gh api repos/${owner}/${repo}/commits/${sha}/status --jq .statuses`);
  if (checksText === null && statusText === null) return null;
  const pages = parseJson(checksText);
  const statuses = parseJson(statusText);
  return summarizeCommitChecks({ checkRuns: Array.isArray(pages) ? pages.flatMap(page => page?.check_runs || []) : [], statuses: Array.isArray(statuses) ? statuses : [] });
};

/**
 * Find the solver's placeholder commit among the pull request's commits.
 *
 * @param {Array<{sha: string, commit?: {message?: string}}>} commits - `pulls/N/commits`, oldest first
 * @returns {string|null}
 */
export const findPlaceholderCommitSha = commits => {
  const first = Array.isArray(commits) ? commits.find(entry => PLACEHOLDER_COMMIT_PATTERN.test(String(entry?.commit?.message || ''))) : null;
  return first?.sha || null;
};

/**
 * Look up the base branch head and the placeholder commit and classify the
 * failing checks against them. Never throws: without evidence the result says
 * nothing is pre-existing, and the prompt simply carries no evidence.
 *
 * @param {Object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number|string} params.prNumber
 * @param {string[]} params.failingChecks
 * @param {Function} params.$ - command-stream tagged template (rate-limit wrapped by the caller)
 * @param {Function} [params.log]
 * @returns {Promise<Object|null>} the classification plus `baseBranch`, or null when nothing could be checked
 */
export const detectPreExistingCiFailures = async ({ owner, repo, prNumber, failingChecks = [], $: command, log = noopLog }) => {
  if (!owner || !repo || !prNumber || typeof command !== 'function' || !failingChecks?.length) return null;
  try {
    const baseBranch = String((await stdoutOf(command`gh api repos/${owner}/${repo}/pulls/${prNumber} --jq .base.ref`)) || '').trim() || null;
    const references = [];
    if (baseBranch) {
      const baseSha = String((await stdoutOf(command`gh api repos/${owner}/${repo}/git/ref/heads/${baseBranch} --jq .object.sha`)) || '').trim();
      const checks = baseSha ? await fetchCommitChecks({ command, owner, repo, sha: baseSha }) : null;
      if (checks) references.push({ label: `the head of the base branch \`${baseBranch}\``, sha: baseSha, checks });
    }
    const commits = parseJson(await stdoutOf(command`gh api repos/${owner}/${repo}/pulls/${prNumber}/commits --paginate --slurp`));
    const placeholderSha = findPlaceholderCommitSha(Array.isArray(commits) ? commits.flat() : []);
    if (placeholderSha) {
      const checks = await fetchCommitChecks({ command, owner, repo, sha: placeholderSha });
      if (checks) references.push({ label: 'the placeholder commit that only adds the task file', sha: placeholderSha, checks });
    }
    if (references.length === 0) return null;
    const classification = classifyPreExistingCiFailures({ failingChecks, references });
    for (const entry of classification.preExisting) {
      await log(`   ℹ️  CI check "${entry.name}" also fails (${entry.conclusion}) on ${entry.reference.label} (${entry.reference.sha.slice(0, 7)})`);
    }
    return { ...classification, baseBranch, owner, repo };
  } catch (error) {
    await log(`⚠️  Pre-existing CI failure check skipped: ${error.message}`, { verbose: true });
    return null;
  }
};

const describeEvidence = (entry, owner, repo) => `\`${entry.name}\` also fails (\`${entry.conclusion}\`) on ${entry.reference.label}: https://github.com/${owner}/${repo}/commit/${entry.reference.sha}`;

/**
 * What the next session is asked to do about failing CI, whatever its cause.
 *
 * @returns {string[]}
 */
export const buildCiFailureGuidance = () => ['Fix every failing check, including failures that also happen on the default branch: this pull request cannot be merged or released while its CI fails, whatever the cause.', 'If a check can only pass after a human action you cannot do yourself (for example adding a secret, or granting access to a private repository or submodule), change the CI/CD configuration so that:', '  - CI on this pull request passes without that action (for example, skip only the step that needs the missing secret or access, and print why it was skipped);', '  - CI on the default branch fails with an explicit message that says exactly what a human has to do, so the job can be re-run and pass once that is done.', 'Describe that manual action in the pull request description.'];

/**
 * Evidence lines appended to the CI section of the next session's feedback.
 *
 * @param {Object|null} detection - from `detectPreExistingCiFailures`
 * @returns {string[]}
 */
export const buildPreExistingCiFeedback = detection => {
  if (!detection?.allPreExisting) return [];
  return ['', "⚠️ These CI failures are pre-existing - they also fail without this pull request's changes:", ...detection.preExisting.map(entry => `  - ${describeEvidence(entry, detection.owner, detection.repo)}`), 'That does not make them optional: they still block this pull request, so fix them here as described above.'];
};

export default { PLACEHOLDER_COMMIT_PATTERN, buildCiFailureGuidance, buildPreExistingCiFeedback, classifyPreExistingCiFailures, detectPreExistingCiFailures, findPlaceholderCommitSha, summarizeCommitChecks };
