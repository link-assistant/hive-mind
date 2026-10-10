#!/usr/bin/env node

/**
 * Issue #2839: do not keep restarting the AI for a CI failure the pull request
 * did not cause.
 *
 * In the 2026-10-09 stylist-svelte run (`solve --tool codex --think xhigh`,
 * fork mode) the only CI job, `pipeline-check`, failed in "Initialize public
 * sandbox submodules" while cloning a private repository (404). It had failed
 * on every push to `main` since 2026-10-07 and on the solver's own placeholder
 * commit `73b6c7d`, which adds nothing but `.gitkeep`. No change to the pull
 * request could make it pass, yet `--auto-restart-until-mergeable` restarted
 * the AI for "CI failures detected" until all 5/5 iterations were spent - about
 * $2.2 and 33 minutes for nothing.
 *
 * A failing check is "pre-existing" when the same check (matched by name) also
 * failed on a commit that does not contain the pull request's work:
 *
 *   1. the current head of the base branch - checked first, because when the
 *      base branch is green again the pull request only needs to merge it, which
 *      the AI can do, so the failure is not reported as pre-existing; then
 *   2. the solver's placeholder commit (`Initial commit with task details`,
 *      only `.gitkeep` / `CLAUDE.md`), whose CI result is the base branch's.
 *
 * The first of those commits on which the check reached a conclusion decides.
 * A check that never completed on either commit is treated as new, so this can
 * only make the loop stop earlier when there is evidence, never on a guess.
 *
 * Policy (see `decidePreExistingCiAction`): when every failing check is
 * pre-existing and CI is the only reason to restart, the next session is told
 * so once - an issue may well ask to fix exactly that CI - and when the same
 * pre-existing failures are still the only blocker afterwards, the loop stops
 * and posts one "needs human: CI fails on the base branch too" comment instead
 * of buying another session.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2839
 */

import { reportAutomationStop } from './automation-stop-reporting.lib.mjs';

/** Stop reason published through the #2144 automation-stop registry. */
export const CI_FAILS_ON_BASE_BRANCH_STOP_REASON = 'ci_fails_on_base_branch';

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
 * nothing is pre-existing, and the loop behaves exactly as before #2839.
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
 * Lines appended to the CI section of the next session's feedback.
 *
 * @param {Object|null} detection - from `detectPreExistingCiFailures`
 * @returns {string[]}
 */
export const buildPreExistingCiFeedback = detection => {
  if (!detection?.allPreExisting) return [];
  return ['', '⚠️ These CI failures are NOT caused by this pull request - they fail the same way without its changes:', ...detection.preExisting.map(entry => `  - ${describeEvidence(entry, detection.owner, detection.repo)}`), 'Fix them only if that is within the scope of the issue (for example, the issue asks to fix this CI). Otherwise do not try to work around them: say in the pull request that the failure exists on the base branch too and needs a maintainer. If they are still the only failure after this session, the automation will stop and ask a human.'];
};

/**
 * Decide what the auto-restart-until-mergeable loop does with a CI failure.
 *
 * @param {Object} params
 * @param {Object|null} params.detection - from `detectPreExistingCiFailures`
 * @param {boolean} params.ciIsOnlyReason - no comment, conflict, uncommitted change, ... also asks for a restart
 * @param {Set<string>|string[]} [params.alreadyReported] - pre-existing checks a previous session was already told about
 * @returns {'stop'|'restart_with_note'|'none'}
 */
export const decidePreExistingCiAction = ({ detection = null, ciIsOnlyReason = false, alreadyReported = [] } = {}) => {
  if (!detection?.allPreExisting) return 'none';
  const reported = new Set(alreadyReported || []);
  if (ciIsOnlyReason && detection.preExisting.every(entry => reported.has(entry.name))) return 'stop';
  return 'restart_with_note';
};

/**
 * Publish the stop through the shared #2144 reporter (one comment per run).
 *
 * @param {Object} params
 * @param {Function} params.$
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number|string} params.prNumber
 * @param {Object} params.detection - from `detectPreExistingCiFailures`
 * @param {boolean} [params.verbose]
 * @param {Function} [params.log]
 * @returns {Promise<Object>} the reporter's result
 */
export const reportPreExistingCiStop = async ({ $: command, owner, repo, prNumber, detection, verbose = false, log = noopLog }) =>
  reportAutomationStop({
    $: command,
    owner,
    repo,
    targetNumber: prNumber,
    reason: CI_FAILS_ON_BASE_BRANCH_STOP_REASON,
    mode: 'auto-restart-until-mergeable',
    message: `Every failing CI check also fails without this pull request's changes${detection?.baseBranch ? ` (base branch \`${detection.baseBranch}\`)` : ''}, and the previous AI session was already told so. Another restart cannot make it pass.`,
    details: (detection?.preExisting || []).map(entry => describeEvidence(entry, owner, repo)),
    verbose,
    log,
  });

/**
 * The auto-restart-until-mergeable step: decide, remember what the next session
 * is told, and publish the stop when another restart cannot help.
 *
 * @param {Object} params
 * @param {Object|null} params.detection - from `detectPreExistingCiFailures`
 * @param {boolean} params.ciIsOnlyReason
 * @param {Set<string>} params.alreadyReported - mutated: names the next session is told about
 * @param {Function} params.$
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number|string} params.prNumber
 * @param {boolean} [params.verbose]
 * @param {Function} [params.log]
 * @param {Function} [params.formatAligned]
 * @returns {Promise<{reason: string}|null>} the stop, or null to restart as usual
 */
export const stopWhenCiFailsOnBaseBranch = async ({ detection, ciIsOnlyReason, alreadyReported, $: command, owner, repo, prNumber, verbose = false, log = noopLog, formatAligned = (icon, label, value) => `${icon} ${label}: ${value}` }) => {
  const action = decidePreExistingCiAction({ detection, ciIsOnlyReason, alreadyReported });
  if (action === 'restart_with_note') for (const entry of detection.preExisting) alreadyReported.add(entry.name);
  if (action !== 'stop') return null;
  await log(formatAligned('🛑', 'CI FAILS ON BASE BRANCH TOO', 'Needs a human; not restarting the AI'));
  await reportPreExistingCiStop({ $: command, owner, repo, prNumber, detection, verbose, log });
  return { reason: CI_FAILS_ON_BASE_BRANCH_STOP_REASON };
};

export default { CI_FAILS_ON_BASE_BRANCH_STOP_REASON, PLACEHOLDER_COMMIT_PATTERN, buildPreExistingCiFeedback, classifyPreExistingCiFailures, decidePreExistingCiAction, detectPreExistingCiFailures, findPlaceholderCommitSha, reportPreExistingCiStop, stopWhenCiFailsOnBaseBranch, summarizeCommitChecks };
