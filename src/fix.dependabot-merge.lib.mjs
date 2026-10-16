/**
 * Merge every open Dependabot pull request before `/fix --update-all-dependencies`
 * (and `/task --update-all-dependencies`) creates its maintenance issue
 * (issue #3413).
 *
 * In link-foundation/links-notation#348 the generated issue was created while
 * four Dependabot pull requests (#343, #344, #346, #347) were still open. Their
 * own auto-merge workflow had failed ("Auto merge is not allowed for this
 * repository") and a repository-wide dependency-freshness check failed on every
 * single-package bump, so none of them could ever turn green on its own. The
 * AI then redid those bumps by hand in #349 and Dependabot closed the four as
 * "no longer needed".
 *
 * The fix is to land what Dependabot already prepared first, without waiting
 * for CI/CD, and to make the generated issue say so: it lists every pull
 * request that was merged with the checks that were not passing at merge time,
 * and asks the solver to fix every error those merges introduced. Pull
 * requests that could not be merged are listed too, so their updates are
 * applied by hand in the same pull request.
 *
 * `gh` is reached only through the injected `run`, so everything here can be
 * tested with a fake runner; the rendering helpers are pure.
 */

import { commandOutput, runCommand } from './fix.github.lib.mjs';

/** `gh pr list --author` value that matches pull requests opened by Dependabot. */
export const DEPENDABOT_AUTHOR = 'app/dependabot';

/** Logins Dependabot appears under, depending on the API that reports it. */
export const DEPENDABOT_LOGINS = Object.freeze(['app/dependabot', 'dependabot[bot]', 'dependabot']);

/** Upper bound on the pull requests looked at in one run. */
export const DEPENDABOT_PR_LIMIT = 100;

/** Fields `gh pr list --json` must return for one Dependabot pull request. */
export const DEPENDABOT_PR_FIELDS = Object.freeze(['number', 'title', 'url', 'author', 'baseRefName', 'headRefName', 'headRefOid', 'isDraft', 'mergeable', 'statusCheckRollup']);

/** Merge methods in order of preference; the first one the repository allows wins. */
export const DEPENDABOT_MERGE_METHODS = Object.freeze([
  { method: 'merge', setting: 'allow_merge_commit' },
  { method: 'squash', setting: 'allow_squash_merge' },
  { method: 'rebase', setting: 'allow_rebase_merge' },
]);

export function isDependabotAuthor(author) {
  const login = String((author && typeof author === 'object' ? author.login : author) || '').toLowerCase();
  return DEPENDABOT_LOGINS.includes(login);
}

/**
 * The first merge method the repository allows, in `DEPENDABOT_MERGE_METHODS`
 * order. Unknown settings (`null`/missing, e.g. no admin read access) count as
 * allowed, because GitHub's own default allows all three.
 */
export function chooseMergeMethod(settings = {}) {
  const allowed = DEPENDABOT_MERGE_METHODS.find(({ setting }) => settings?.[setting] !== false);
  return allowed ? allowed.method : 'merge';
}

const FAILING_CONCLUSIONS = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE']);
const PENDING_STATES = new Set(['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED']);

function checkName(check) {
  const name = check?.name || check?.context || 'check';
  return check?.workflowName ? `${check.workflowName} / ${name}` : name;
}

function checkTime(check) {
  return Date.parse(check?.completedAt || check?.startedAt || check?.createdAt || '') || 0;
}

/**
 * Summarize a `statusCheckRollup` into the checks that were not passing.
 *
 * A re-run leaves the earlier attempt in the rollup under the same name, so
 * only the latest entry per check name counts. Returns
 * `{ total, failing: [{ name, conclusion, url }], pending: [{ name, status }] }`.
 */
export function summarizeChecks(rollup = []) {
  const latest = new Map();
  for (const check of Array.isArray(rollup) ? rollup : []) {
    const name = checkName(check);
    const previous = latest.get(name);
    if (!previous || checkTime(check) >= checkTime(previous)) latest.set(name, check);
  }
  const failing = [];
  const pending = [];
  for (const [name, check] of latest) {
    const status = String(check.status || '').toUpperCase();
    const conclusion = String(check.conclusion || check.state || '').toUpperCase();
    if ((status && status !== 'COMPLETED') || PENDING_STATES.has(conclusion) || (!status && !conclusion)) {
      pending.push({ name, status: (status && status !== 'COMPLETED' ? status : conclusion || 'PENDING').toLowerCase() });
    } else if (FAILING_CONCLUSIONS.has(conclusion)) {
      failing.push({ name, conclusion: conclusion.toLowerCase(), url: check.detailsUrl || check.targetUrl || null });
    }
  }
  return { total: latest.size, failing, pending };
}

/**
 * Should a failed merge be retried with `--admin`?
 *
 * Required status checks, required reviews, "branch is out of date" (strict
 * mode) and repository rules are exactly what "without waiting for CI/CD"
 * means to bypass, and an administrator may do so. A merge conflict is the one
 * failure `--admin` cannot fix, so it is not retried.
 */
export function shouldRetryWithAdmin(errorMessage) {
  const message = String(errorMessage || '');
  if (/conflict/i.test(message)) return false;
  if (/not found|could not resolve|HTTP 404|already merged|is closed/i.test(message)) return false;
  return true;
}

/** Build the `gh pr merge` argv for one pull request. */
export function buildMergeArgs({ repository, pullRequest, method = 'merge', admin = false }) {
  const args = ['pr', 'merge', String(pullRequest.number), '--repo', repository.fullName, `--${method}`];
  // Merge exactly the commit whose checks were recorded, not one pushed since.
  if (pullRequest.headRefOid) args.push('--match-head-commit', pullRequest.headRefOid);
  if (admin) args.push('--admin');
  return args;
}

function firstLine(text) {
  return (
    String(text || '')
      .split('\n')
      .map(line => line.trim())
      .find(Boolean) || ''
  );
}

async function getMergeSettings(repository, run, warn) {
  try {
    const output = await commandOutput(run, 'gh', ['api', `repos/${repository.fullName}`, '--jq', '{allow_merge_commit, allow_squash_merge, allow_rebase_merge}']);
    return output ? JSON.parse(output) : {};
  } catch (error) {
    warn(`⚠️  Could not read the merge settings of ${repository.fullName}: ${firstLine(error.message)}`);
    return {};
  }
}

/** Open Dependabot pull requests of `repository`, oldest first. Throws when `gh` fails. */
export async function listOpenDependabotPullRequests(repository, run = runCommand) {
  const output = await commandOutput(run, 'gh', ['pr', 'list', '--repo', repository.fullName, '--author', DEPENDABOT_AUTHOR, '--state', 'open', '--limit', String(DEPENDABOT_PR_LIMIT), '--json', DEPENDABOT_PR_FIELDS.join(',')]);
  const list = output ? JSON.parse(output) : [];
  return (Array.isArray(list) ? list : [])
    .filter(pullRequest => !pullRequest.author || isDependabotAuthor(pullRequest.author))
    .map(pullRequest => ({
      number: pullRequest.number,
      title: pullRequest.title || '',
      url: pullRequest.url || `https://github.com/${repository.fullName}/pull/${pullRequest.number}`,
      baseRefName: pullRequest.baseRefName || null,
      headRefName: pullRequest.headRefName || null,
      headRefOid: pullRequest.headRefOid || null,
      isDraft: Boolean(pullRequest.isDraft),
      mergeable: pullRequest.mergeable || 'UNKNOWN',
      checks: summarizeChecks(pullRequest.statusCheckRollup),
    }))
    .sort((a, b) => a.number - b.number);
}

/**
 * Merge every open Dependabot pull request of `repository` without waiting for
 * its CI/CD (issue #3413).
 *
 * Pull requests are merged oldest first. A merge that a branch rule blocks is
 * retried once with `--admin`; anything that still fails is recorded with its
 * error and left open, so the generated issue can ask for that update to be
 * applied by hand. With `dryRun` nothing is merged and every candidate is
 * reported as `planned`.
 *
 * Never throws: the issue must still be created when the listing or a merge
 * fails. Returns `{ enabled, dryRun, method, listingError, pullRequests }`
 * where each pull request carries `outcome` (`merged` | `failed` | `skipped` |
 * `planned`), `admin` and `error`.
 */
export async function mergeDependabotPullRequests({ repository, run = runCommand, warn = message => console.warn(message), log = null, dryRun = false, verbose = false } = {}) {
  const say = typeof log === 'function' ? log : () => {};
  const result = { enabled: true, dryRun: Boolean(dryRun), method: null, listingError: null, pullRequests: [] };

  let pullRequests;
  try {
    pullRequests = await listOpenDependabotPullRequests(repository, run);
  } catch (error) {
    result.listingError = firstLine(error.message) || 'unknown error';
    warn(`⚠️  Could not list open Dependabot pull requests of ${repository.fullName}: ${result.listingError}`);
    return result;
  }

  if (pullRequests.length === 0) {
    say('ℹ️  No open Dependabot pull requests to merge.');
    return result;
  }

  result.method = chooseMergeMethod(await getMergeSettings(repository, run, warn));
  say(`🤖 ${dryRun ? 'Would merge' : 'Merging'} ${pullRequests.length} open Dependabot pull request(s) without waiting for CI/CD (--${result.method}; pass --no-merge-dependabot-prs to skip)...`);

  for (const pullRequest of pullRequests) {
    const entry = { ...pullRequest, outcome: 'planned', admin: false, error: null };
    result.pullRequests.push(entry);
    const ciNote = `${pullRequest.checks.failing.length} failing, ${pullRequest.checks.pending.length} pending of ${pullRequest.checks.total} check(s)`;

    if (pullRequest.isDraft) {
      entry.outcome = 'skipped';
      entry.error = 'draft pull request';
      say(`   ⏭️  #${pullRequest.number} skipped: draft pull request`);
      continue;
    }
    if (pullRequest.mergeable === 'CONFLICTING') {
      entry.outcome = 'skipped';
      entry.error = 'merge conflict with the base branch';
      say(`   ⏭️  #${pullRequest.number} skipped: merge conflict with ${pullRequest.baseRefName || 'the base branch'}`);
      continue;
    }
    if (dryRun) {
      say(`   🔎 #${pullRequest.number} would be merged (${ciNote}): ${pullRequest.title}`);
      continue;
    }

    let attempt = await run('gh', buildMergeArgs({ repository, pullRequest, method: result.method }));
    let error = attempt.code === 0 ? null : `${attempt.stderr?.toString() || ''}${attempt.stdout?.toString() || ''}`.trim() || `gh exited with code ${attempt.code}`;
    if (verbose && error) say(`   [VERBOSE] gh pr merge #${pullRequest.number} failed: ${error}`);
    if (error && shouldRetryWithAdmin(error)) {
      attempt = await run('gh', buildMergeArgs({ repository, pullRequest, method: result.method, admin: true }));
      if (attempt.code === 0) {
        entry.admin = true;
        error = null;
      } else {
        const adminError = `${attempt.stderr?.toString() || ''}${attempt.stdout?.toString() || ''}`.trim();
        if (verbose) say(`   [VERBOSE] gh pr merge #${pullRequest.number} --admin failed: ${adminError}`);
        error = firstLine(adminError) || firstLine(error);
      }
    }

    if (error) {
      entry.outcome = 'failed';
      entry.error = firstLine(error);
      say(`   ⚠️  #${pullRequest.number} could not be merged: ${entry.error}`);
    } else {
      entry.outcome = 'merged';
      say(`   ✅ #${pullRequest.number} merged${entry.admin ? ' (--admin)' : ''} (${ciNote}): ${pullRequest.title}`);
    }
  }

  const merged = result.pullRequests.filter(entry => entry.outcome === 'merged').length;
  if (!dryRun) say(`ℹ️  Merged ${merged} of ${result.pullRequests.length} open Dependabot pull request(s).`);
  return result;
}

/** One-line CI/CD summary of a pull request at merge time, for the issue body. */
export function describeChecks(checks = { total: 0, failing: [], pending: [] }) {
  if (!checks.total) return 'no CI/CD checks reported';
  const parts = [];
  if (checks.failing.length > 0) parts.push(`not passing: ${checks.failing.map(check => (check.url ? `[${check.name}](${check.url}) (${check.conclusion})` : `${check.name} (${check.conclusion})`)).join(', ')}`);
  if (checks.pending.length > 0) parts.push(`still running: ${checks.pending.map(check => check.name).join(', ')}`);
  return parts.length > 0 ? parts.join('; ') : `all ${checks.total} check(s) passing`;
}

/**
 * The issue-body section describing what happened to the open Dependabot pull
 * requests (issue #3413). Empty when merging was disabled or there was nothing
 * to merge.
 */
export function buildDependabotPullRequestsSection(dependabot) {
  if (!dependabot || !dependabot.enabled) return '';
  const lines = [];

  if (dependabot.listingError) {
    lines.push('### Open Dependabot pull requests', '');
    lines.push(`The open Dependabot pull requests could not be listed (${dependabot.listingError}), so none were merged before this issue was created. Check them by hand: merge every one that is still open, then fix whatever it breaks as part of this issue.`);
    return lines.join('\n');
  }

  const pullRequests = Array.isArray(dependabot.pullRequests) ? dependabot.pullRequests : [];
  if (pullRequests.length === 0) return '';

  const landed = pullRequests.filter(entry => entry.outcome === 'merged' || entry.outcome === 'planned');
  const leftOpen = pullRequests.filter(entry => entry.outcome === 'failed' || entry.outcome === 'skipped');
  const item = entry => `- [#${entry.number}](${entry.url}) ${entry.title}${entry.baseRefName ? ` → \`${entry.baseRefName}\`` : ''} — ${describeChecks(entry.checks)}${entry.admin ? ' — merged with `--admin`, bypassing branch rules' : ''}`;

  lines.push(dependabot.dryRun ? '### Dependabot pull requests to merge before this issue is created (dry run)' : '### Dependabot pull requests merged before this issue was created', '');

  if (landed.length > 0) {
    lines.push(`${dependabot.dryRun ? 'These open Dependabot pull requests will be merged' : 'These open Dependabot pull requests were merged'} automatically, **without waiting for CI/CD**, so this work starts from the versions Dependabot had already proposed:`, '');
    for (const entry of landed) lines.push(item(entry));
    lines.push('');
    const notGreen = landed.some(entry => entry.checks.failing.length > 0 || entry.checks.pending.length > 0);
    lines.push(`**Fix every error these merges introduced.** Their CI/CD was not waited for${notGreen ? ', and the checks listed above were not passing at merge time' : ''}. Look at the CI/CD runs of the default branch after these merges, reproduce each failing build, test, lint, type-check, security or deprecation error they caused, and fix all of them as part of this issue. Do not revert a merged update to make a check pass — adapt the code, the configuration or the workflow instead. The work is not done until CI/CD of the default branch is green again.`);
  }

  if (leftOpen.length > 0) {
    if (landed.length > 0) lines.push('');
    lines.push('These Dependabot pull requests could not be merged automatically and are still open:', '');
    for (const entry of leftOpen) lines.push(`${item(entry)} — ${entry.outcome === 'skipped' ? 'skipped' : 'merge failed'}: ${entry.error || 'unknown reason'}`);
    lines.push('');
    lines.push('Apply each of these updates in this issue’s pull request (Dependabot closes a pull request by itself once its update has landed), and fix the errors that made it unmergeable — a failing check, a conflict, or a repository setting such as a disabled auto-merge.');
  }

  return lines.join('\n');
}

/** Short console summary of a merge result. */
export function summarizeDependabotPullRequests(dependabot) {
  if (!dependabot || !dependabot.enabled) return 'Dependabot:     merging disabled (--no-merge-dependabot-prs)';
  if (dependabot.listingError) return `Dependabot:     could not list pull requests (${dependabot.listingError})`;
  const pullRequests = dependabot.pullRequests || [];
  if (pullRequests.length === 0) return 'Dependabot:     no open pull requests';
  const count = outcome => pullRequests.filter(entry => entry.outcome === outcome).length;
  if (dependabot.dryRun) return `Dependabot:     ${count('planned')} of ${pullRequests.length} open pull request(s) would be merged`;
  return `Dependabot:     ${count('merged')} of ${pullRequests.length} open pull request(s) merged without waiting for CI/CD${count('failed') + count('skipped') > 0 ? `, ${count('failed') + count('skipped')} left open` : ''}`;
}
