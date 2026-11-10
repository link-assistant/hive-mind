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
 * Issue #3863: in konard/medical-neural-network-ml#25 all five open Dependabot
 * pull requests (#13–#17) failed with "the merge commit cannot be cleanly
 * created": each conflicted with `main`, which already had the same or newer
 * versions, and Dependabot no longer covered their file, so nothing ever
 * closed them. A conflicting pull request is now compared with its base
 * branch: when the base already has every update it carries, it is closed as
 * superseded; otherwise Dependabot is asked to recreate it on top of the base
 * branch, and it is merged as soon as the recreated head is mergeable (within
 * a bounded wait). Mergeability that GitHub has not computed yet (`UNKNOWN`)
 * is refreshed before merging.
 *
 * `gh` is reached only through the injected `run`, so everything here can be
 * tested with a fake runner; the rendering helpers are pure.
 */

import { commandOutput, runCommand } from './fix.github.lib.mjs';
import { checkSupersededByBase } from './fix.dependabot-superseded.lib.mjs';

/** `gh pr list --author` value that matches pull requests opened by Dependabot. */
export const DEPENDABOT_AUTHOR = 'app/dependabot';

/** Logins Dependabot appears under, depending on the API that reports it. */
export const DEPENDABOT_LOGINS = Object.freeze(['app/dependabot', 'dependabot[bot]', 'dependabot']);

/** Upper bound on the pull requests looked at in one run. */
export const DEPENDABOT_PR_LIMIT = 100;

/** How many times an `UNKNOWN` mergeability is re-read, and how long to wait between reads. */
export const MERGEABILITY_REFRESH_ATTEMPTS = 3;
export const MERGEABILITY_REFRESH_DELAY_MS = 2000;

/**
 * How long to wait for Dependabot to recreate conflicting pull requests before
 * the issue is created, and how often to look. Recreating usually takes one to
 * a few minutes; whatever is not done in time stays listed in the issue.
 */
export const DEPENDABOT_RECREATE_TIMEOUT_MS = 180000;
export const DEPENDABOT_RECREATE_POLL_MS = 15000;

/** The comment that asks Dependabot to rebuild its update on top of the base branch. */
export const DEPENDABOT_RECREATE_COMMAND = '@dependabot recreate';

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
  if (isMergeConflictError(message)) return false;
  if (/not found|could not resolve|HTTP 404|already merged|is closed/i.test(message)) return false;
  return true;
}

/**
 * Does a `gh pr merge` error mean the pull request conflicts with its base?
 * GitHub words it "the merge commit cannot be cleanly created" (issue #3863),
 * which never mentions "conflict".
 */
export function isMergeConflictError(errorMessage) {
  return /conflict|cannot be cleanly created|mergeStateStatus.?DIRTY/i.test(String(errorMessage || ''));
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

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Re-read the state of one pull request; null when `gh` fails. */
export async function readPullRequestState(repository, number, run) {
  try {
    const output = await commandOutput(run, 'gh', ['pr', 'view', String(number), '--repo', repository.fullName, '--json', 'state,mergeable,mergeStateStatus,headRefOid']);
    return output ? JSON.parse(output) : null;
  } catch {
    return null;
  }
}

/**
 * GitHub computes mergeability lazily, so a listing often reports `UNKNOWN`
 * (in issue #3863 none of #13–#17 was listed as `CONFLICTING`, so every merge
 * was attempted and failed). Re-read it a few times so a conflict is
 * recognized before a merge is attempted.
 */
async function refreshMergeability({ repository, pullRequest, run, sleep, say, verbose }) {
  for (let attempt = 1; attempt <= MERGEABILITY_REFRESH_ATTEMPTS && pullRequest.mergeable === 'UNKNOWN'; attempt += 1) {
    await sleep(MERGEABILITY_REFRESH_DELAY_MS);
    const state = await readPullRequestState(repository, pullRequest.number, run);
    if (state?.mergeable) pullRequest.mergeable = state.mergeable;
    if (state?.headRefOid) pullRequest.headRefOid = state.headRefOid;
    if (verbose) say(`   [VERBOSE] #${pullRequest.number} mergeability (read ${attempt}/${MERGEABILITY_REFRESH_ATTEMPTS}): ${pullRequest.mergeable}${state?.mergeStateStatus ? ` (${state.mergeStateStatus})` : ''}`);
  }
}

/** `gh pr merge`, retried once with `--admin` when a branch rule blocks it. Returns `{ error, admin }`. */
async function mergeOnce({ repository, pullRequest, method, run, say, verbose }) {
  let attempt = await run('gh', buildMergeArgs({ repository, pullRequest, method }));
  let error = attempt.code === 0 ? null : `${attempt.stderr?.toString() || ''}${attempt.stdout?.toString() || ''}`.trim() || `gh exited with code ${attempt.code}`;
  if (verbose && error) say(`   [VERBOSE] gh pr merge #${pullRequest.number} failed: ${error}`);
  if (!error || !shouldRetryWithAdmin(error)) return { error, admin: false };
  attempt = await run('gh', buildMergeArgs({ repository, pullRequest, method, admin: true }));
  if (attempt.code === 0) return { error: null, admin: true };
  const adminError = `${attempt.stderr?.toString() || ''}${attempt.stdout?.toString() || ''}`.trim();
  if (verbose) say(`   [VERBOSE] gh pr merge #${pullRequest.number} --admin failed: ${adminError}`);
  return { error: firstLine(adminError) || firstLine(error), admin: false };
}

/** The comment left on a Dependabot pull request that is closed as superseded. */
export function buildSupersededComment({ pullRequest, reason }) {
  return [`Closing as superseded: \`${pullRequest.baseRefName || 'the base branch'}\` already has every update this pull request carries (${reason}), so it can no longer be merged cleanly and is no longer needed.`, '', 'Closed automatically by `/fix --update-all-dependencies` before it created its dependency-update issue (link-assistant/hive-mind#3863). Dependabot opens a new pull request when a newer version is released.'].join('\n');
}

/**
 * A pull request conflicts with its base branch: close it when the base
 * already has all of its updates, otherwise ask Dependabot to recreate it.
 */
async function resolveConflict({ repository, entry, run, dryRun, say, verbose }) {
  const verdict = await checkSupersededByBase({ repository, pullRequest: entry, run });
  entry.supersession = verdict;
  if (verbose) say(`   [VERBOSE] #${entry.number} supersession check: ${verdict.superseded ? 'superseded' : 'not superseded'} — ${verdict.reason}`);
  if (verdict.superseded) {
    if (dryRun) {
      entry.outcome = 'planned-close';
      say(`   🔎 #${entry.number} conflicts with ${entry.baseRefName || 'the base branch'} and is superseded; it would be closed (${verdict.reason})`);
      return;
    }
    const closed = await run('gh', ['pr', 'close', String(entry.number), '--repo', repository.fullName, '--comment', buildSupersededComment({ pullRequest: entry, reason: verdict.reason })]);
    if (closed.code === 0) {
      entry.outcome = 'closed';
      entry.error = null;
      say(`   🗑️  #${entry.number} closed as superseded by ${entry.baseRefName || 'the base branch'}: ${verdict.reason}`);
      return;
    }
    entry.closeError = firstLine(`${closed.stderr?.toString() || ''}${closed.stdout?.toString() || ''}`) || `gh exited with code ${closed.code}`;
    say(`   ⚠️  #${entry.number} is superseded but could not be closed: ${entry.closeError}`);
  }
  if (dryRun) {
    entry.outcome = 'planned-recreate';
    say(`   🔎 #${entry.number} conflicts with ${entry.baseRefName || 'the base branch'}; Dependabot would be asked to recreate it (${verdict.reason})`);
    return;
  }
  const commented = await run('gh', ['pr', 'comment', String(entry.number), '--repo', repository.fullName, '--body', DEPENDABOT_RECREATE_COMMAND]);
  if (commented.code === 0) {
    entry.outcome = 'recreate-requested';
    say(`   🔁 #${entry.number} conflicts with ${entry.baseRefName || 'the base branch'}; asked Dependabot to recreate it (${verdict.reason})`);
  } else {
    entry.outcome = 'skipped';
    entry.error = `merge conflict with the base branch; asking Dependabot to recreate it failed: ${firstLine(`${commented.stderr?.toString() || ''}${commented.stdout?.toString() || ''}`) || `gh exited with code ${commented.code}`}`;
    say(`   ⚠️  #${entry.number} ${entry.error}`);
  }
}

/**
 * Wait (bounded) for Dependabot to recreate the pull requests it was asked to,
 * and merge each one whose new head is mergeable. Dependabot may instead close
 * a pull request whose update is no longer needed.
 */
async function awaitRecreatedPullRequests({ repository, entries, method, run, sleep, now, timeoutMs, pollMs, say, verbose }) {
  const waiting = new Set(entries);
  const deadline = now() + timeoutMs;
  if (waiting.size > 0) say(`⏳ Waiting up to ${Math.round(timeoutMs / 1000)}s for Dependabot to recreate ${waiting.size} pull request(s)...`);
  while (waiting.size > 0 && now() < deadline) {
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
    for (const entry of [...waiting]) {
      const state = await readPullRequestState(repository, entry.number, run);
      if (verbose) say(`   [VERBOSE] #${entry.number} after recreate request: ${state ? `${state.state}, ${state.mergeable}, head ${String(state.headRefOid || '').slice(0, 7)}` : 'state unavailable'}`);
      if (!state) continue;
      if (state.state === 'MERGED' || state.state === 'CLOSED') {
        entry.outcome = state.state === 'MERGED' ? 'merged' : 'closed-by-dependabot';
        waiting.delete(entry);
        say(`   ${state.state === 'MERGED' ? '✅' : '🗑️ '} #${entry.number} ${state.state === 'MERGED' ? 'was merged' : 'was closed by Dependabot'} after the recreate request`);
        continue;
      }
      if (!state.headRefOid || state.headRefOid === entry.headRefOid || state.mergeable === 'UNKNOWN') continue;
      waiting.delete(entry);
      entry.recreated = true;
      entry.headRefOid = state.headRefOid;
      if (state.mergeable === 'CONFLICTING') {
        entry.outcome = 'failed';
        entry.error = 'still conflicts with the base branch after Dependabot recreated it';
        say(`   ⚠️  #${entry.number} ${entry.error}`);
        continue;
      }
      const { error, admin } = await mergeOnce({ repository, pullRequest: entry, method, run, say, verbose });
      entry.admin = admin;
      entry.outcome = error ? 'failed' : 'merged';
      entry.error = error ? firstLine(error) : null;
      say(error ? `   ⚠️  #${entry.number} was recreated but could not be merged: ${entry.error}` : `   ✅ #${entry.number} recreated by Dependabot and merged${admin ? ' (--admin)' : ''}: ${entry.title}`);
    }
  }
  for (const entry of waiting) say(`   ⏳ #${entry.number} was not recreated within ${Math.round(timeoutMs / 1000)}s; it stays open and is listed in the issue`);
}

/**
 * Merge every open Dependabot pull request of `repository` without waiting for
 * its CI/CD (issue #3413).
 *
 * Pull requests are merged oldest first. A merge that a branch rule blocks is
 * retried once with `--admin`. A pull request that conflicts with its base
 * branch (issue #3863) is closed when the base already has all of its updates,
 * and otherwise Dependabot is asked to recreate it; recreated pull requests
 * are merged when they turn mergeable within `recreateTimeoutMs`. Anything
 * that still fails is recorded with its error and left open, so the generated
 * issue can ask for that update to be applied by hand. With `dryRun` nothing
 * is merged, closed or commented, and every candidate is reported as
 * `planned`, `planned-close` or `planned-recreate`.
 *
 * Never throws: the issue must still be created when the listing or a merge
 * fails. Returns `{ enabled, dryRun, method, listingError, pullRequests }`
 * where each pull request carries `outcome` (`merged` | `closed` |
 * `closed-by-dependabot` | `recreate-requested` | `failed` | `skipped` |
 * `planned` | `planned-close` | `planned-recreate`), `admin`, `error` and,
 * for conflicts, `supersession`.
 */
export async function mergeDependabotPullRequests({ repository, run = runCommand, warn = message => console.warn(message), log = null, dryRun = false, verbose = false, sleep = defaultSleep, now = Date.now, recreateTimeoutMs = DEPENDABOT_RECREATE_TIMEOUT_MS, recreatePollMs = DEPENDABOT_RECREATE_POLL_MS } = {}) {
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

    if (entry.isDraft) {
      entry.outcome = 'skipped';
      entry.error = 'draft pull request';
      say(`   ⏭️  #${entry.number} skipped: draft pull request`);
      continue;
    }
    await refreshMergeability({ repository, pullRequest: entry, run, sleep, say, verbose });
    if (entry.mergeable === 'CONFLICTING') {
      await resolveConflict({ repository, entry, run, dryRun, say, verbose });
      continue;
    }
    if (dryRun) {
      say(`   🔎 #${entry.number} would be merged (${ciNote}): ${entry.title}`);
      continue;
    }

    const { error, admin } = await mergeOnce({ repository, pullRequest: entry, method: result.method, run, say, verbose });
    entry.admin = admin;
    if (error && isMergeConflictError(error)) {
      // An earlier merge of this run, or a stale UNKNOWN, hid the conflict.
      entry.mergeable = 'CONFLICTING';
      await resolveConflict({ repository, entry, run, dryRun, say, verbose });
    } else if (error) {
      entry.outcome = 'failed';
      entry.error = firstLine(error);
      say(`   ⚠️  #${entry.number} could not be merged: ${entry.error}`);
    } else {
      entry.outcome = 'merged';
      say(`   ✅ #${entry.number} merged${admin ? ' (--admin)' : ''} (${ciNote}): ${entry.title}`);
    }
  }

  const recreating = result.pullRequests.filter(entry => entry.outcome === 'recreate-requested');
  if (!dryRun && recreating.length > 0 && recreateTimeoutMs > 0) {
    await awaitRecreatedPullRequests({ repository, entries: recreating, method: result.method, run, sleep, now, timeoutMs: recreateTimeoutMs, pollMs: recreatePollMs, say, verbose });
  }

  if (!dryRun) {
    const count = outcome => result.pullRequests.filter(entry => entry.outcome === outcome).length;
    const closed = count('closed') + count('closed-by-dependabot');
    say(`ℹ️  Merged ${count('merged')} of ${result.pullRequests.length} open Dependabot pull request(s)${closed > 0 ? `; closed ${closed} as superseded` : ''}${count('recreate-requested') > 0 ? `; ${count('recreate-requested')} still being recreated by Dependabot` : ''}.`);
  }
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
 * requests (issues #3413 and #3863). Empty when merging was disabled or there
 * was nothing to merge.
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
  const superseded = pullRequests.filter(entry => entry.outcome === 'closed' || entry.outcome === 'closed-by-dependabot' || entry.outcome === 'planned-close');
  const leftOpen = pullRequests.filter(entry => entry.outcome === 'failed' || entry.outcome === 'skipped' || entry.outcome === 'recreate-requested' || entry.outcome === 'planned-recreate');
  const link = entry => `[#${entry.number}](${entry.url}) ${entry.title}${entry.baseRefName ? ` → \`${entry.baseRefName}\`` : ''}`;
  const item = entry => `- ${link(entry)} — ${describeChecks(entry.checks)}${entry.recreated ? ' — recreated by Dependabot on top of the base branch first' : ''}${entry.admin ? ' — merged with `--admin`, bypassing branch rules' : ''}`;
  const leftOpenReason = entry => {
    if (entry.outcome === 'recreate-requested') return `conflicts with the base branch; Dependabot was asked to recreate it (\`${DEPENDABOT_RECREATE_COMMAND}\`) but had not finished when this issue was created`;
    if (entry.outcome === 'planned-recreate') return `conflicts with the base branch; Dependabot would be asked to recreate it (\`${DEPENDABOT_RECREATE_COMMAND}\`)`;
    return `${entry.outcome === 'skipped' ? 'skipped' : 'merge failed'}: ${entry.error || 'unknown reason'}`;
  };

  lines.push(dependabot.dryRun ? '### Open Dependabot pull requests to handle before this issue is created (dry run)' : '### Open Dependabot pull requests handled before this issue was created', '');

  if (landed.length > 0) {
    lines.push(`${dependabot.dryRun ? 'These open Dependabot pull requests will be merged' : 'These open Dependabot pull requests were merged'} automatically, **without waiting for CI/CD**, so this work starts from the versions Dependabot had already proposed:`, '');
    for (const entry of landed) lines.push(item(entry));
    lines.push('');
    const notGreen = landed.some(entry => entry.checks.failing.length > 0 || entry.checks.pending.length > 0);
    lines.push(`**Fix every error these merges introduced.** Their CI/CD was not waited for${notGreen ? ', and the checks listed above were not passing at merge time' : ''}. Look at the CI/CD runs of the default branch after these merges, reproduce each failing build, test, lint, type-check, security or deprecation error they caused, and fix all of them as part of this issue. Do not revert a merged update to make a check pass — adapt the code, the configuration or the workflow instead. The work is not done until CI/CD of the default branch is green again.`);
  }

  if (superseded.length > 0) {
    if (lines.length > 2) lines.push('');
    lines.push(dependabot.dryRun ? 'These Dependabot pull requests conflict with the base branch, which already has every update they carry, so they would be closed as superseded:' : 'These Dependabot pull requests conflicted with the base branch, which already had every update they carried, so they were closed as superseded:', '');
    for (const entry of superseded) lines.push(`- ${link(entry)} — ${entry.outcome === 'closed-by-dependabot' ? 'closed by Dependabot after it was asked to recreate it' : entry.supersession?.reason || 'superseded'}`);
  }

  if (leftOpen.length > 0) {
    if (lines.length > 2) lines.push('');
    lines.push(dependabot.dryRun ? 'These Dependabot pull requests could not be merged automatically:' : 'These Dependabot pull requests could not be merged automatically and are still open:', '');
    for (const entry of leftOpen) lines.push(`${item(entry)} — ${leftOpenReason(entry)}`);
    lines.push('');
    lines.push('Apply each of these updates in this issue’s pull request, at the same or a newer version, and fix the errors that made it unmergeable — a failing check, a conflict, or a repository setting such as a disabled auto-merge. List each of them in the pull request description as superseded by it. Do not rely on Dependabot to close them once your pull request is merged: it does not when its configuration no longer covers the changed file (link-assistant/hive-mind#3863); the next `--update-all-dependencies` run closes every one the default branch has superseded.');
  }

  return lines.join('\n');
}

/** Short console summary of a merge result. */
export function summarizeDependabotPullRequests(dependabot) {
  if (!dependabot || !dependabot.enabled) return 'Dependabot:     merging disabled (--no-merge-dependabot-prs)';
  if (dependabot.listingError) return `Dependabot:     could not list pull requests (${dependabot.listingError})`;
  const pullRequests = dependabot.pullRequests || [];
  if (pullRequests.length === 0) return 'Dependabot:     no open pull requests';
  const count = (...outcomes) => pullRequests.filter(entry => outcomes.includes(entry.outcome)).length;
  if (dependabot.dryRun) {
    const extra = [count('planned-close') > 0 ? `${count('planned-close')} would be closed as superseded` : '', count('planned-recreate') > 0 ? `${count('planned-recreate')} would be recreated by Dependabot` : ''].filter(Boolean);
    return `Dependabot:     ${count('planned')} of ${pullRequests.length} open pull request(s) would be merged${extra.length > 0 ? `, ${extra.join(', ')}` : ''}`;
  }
  const closed = count('closed', 'closed-by-dependabot');
  const leftOpen = count('failed', 'skipped', 'recreate-requested');
  return `Dependabot:     ${count('merged')} of ${pullRequests.length} open pull request(s) merged without waiting for CI/CD${closed > 0 ? `, ${closed} closed as superseded` : ''}${leftOpen > 0 ? `, ${leftOpen} left open` : ''}`;
}
