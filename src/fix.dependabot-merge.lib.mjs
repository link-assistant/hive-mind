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
 * Issue #4061: in link-foundation/links-notation#408 two Dependabot pull
 * requests stayed open although `main` already had every update they carried:
 * #407 (`dotnet-sdk` 11.0.100 in `csharp/global.json`) was mergeable but
 * behind `main`, and a repository ruleset that requires up-to-date,
 * same-commit CI (and that nobody may bypass) rejected even `--admin`; #396
 * conflicted. Every pull request is therefore compared with its base branch
 * first, conflicting or not, and closed when it is superseded. A pull request
 * that a branch rule keeps out because it is behind its base is rebased by
 * Dependabot (`@dependabot rebase`) and merged once its required checks pass,
 * within a bounded wait; the rules that blocked a merge are named in the
 * issue.
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

/**
 * The comment that asks Dependabot to rebase a pull request that is behind its
 * base branch (issue #4061). Dependabot only obeys users with push access, so
 * it must come from the same account that merges.
 */
export const DEPENDABOT_REBASE_COMMAND = '@dependabot rebase';

/**
 * Upper bound on the whole wait for rebased or recreated pull requests and
 * their required checks (issue #4061). A branch rule that demands up-to-date,
 * passing checks cannot be bypassed by `--admin` when it has no bypass actors,
 * so such a pull request is only mergeable once its CI/CD has run again
 * (about 24 minutes in links-notation). `--dependabot-wait-timeout` changes it.
 */
export const DEPENDABOT_WAIT_TIMEOUT_MS = 30 * 60 * 1000;

/** How often the wait looks again once every pull request is only waiting for checks. */
export const DEPENDABOT_CHECKS_POLL_MS = 60000;

/** How many times one pull request is rebased in a run before it is left open. */
export const DEPENDABOT_REBASE_LIMIT = 3;

/** Fields `gh pr list --json` must return for one Dependabot pull request. */
export const DEPENDABOT_PR_FIELDS = Object.freeze(['number', 'title', 'url', 'author', 'baseRefName', 'headRefName', 'headRefOid', 'isDraft', 'mergeable', 'mergeStateStatus', 'statusCheckRollup']);

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

/**
 * Every non-empty line of a `gh` error on one line. "Repository rule
 * violations found" alone does not say which rule (issue #4061); the lines
 * after it do.
 */
export function compactError(text) {
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join(' — ');
}

function outputOf(result) {
  return `${result?.stderr?.toString() || ''}${result?.stdout?.toString() || ''}`.trim();
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
      mergeStateStatus: pullRequest.mergeStateStatus || 'UNKNOWN',
      checks: summarizeChecks(pullRequest.statusCheckRollup),
    }))
    .sort((a, b) => a.number - b.number);
}

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Re-read the state of one pull request; null when `gh` fails. */
export async function readPullRequestState(repository, number, run) {
  try {
    const output = await commandOutput(run, 'gh', ['pr', 'view', String(number), '--repo', repository.fullName, '--json', 'state,mergeable,mergeStateStatus,headRefOid,statusCheckRollup']);
    return output ? JSON.parse(output) : null;
  } catch {
    return null;
  }
}

/** Copy a fresh `readPullRequestState` answer onto a pull request entry. */
function applyState(entry, state) {
  if (!state) return;
  if (state.mergeable) entry.mergeable = state.mergeable;
  if (state.mergeStateStatus) entry.mergeStateStatus = state.mergeStateStatus;
  if (Array.isArray(state.statusCheckRollup)) entry.checks = summarizeChecks(state.statusCheckRollup);
}

/**
 * Describe the branch rules that apply to `branch` (pure), from
 * `GET repos/{repo}/rules/branches/{branch}` and the rulesets it names
 * (`GET repos/{repo}/rulesets/{id}`), e.g. "ruleset “Main requires CI”
 * requires the branch to be up to date and the status checks A, B to pass;
 * it has no bypass actors, so `--admin` cannot bypass it". Null when no rule
 * would block a merge.
 */
export function describeBranchRules(rules = [], rulesets = []) {
  if (!Array.isArray(rules) || rules.length === 0) return null;
  const parts = [];
  const checks = rules.find(rule => rule.type === 'required_status_checks');
  if (checks) {
    const parameters = checks.parameters || {};
    const names = (parameters.required_status_checks || []).map(check => check.context).filter(Boolean);
    parts.push(`requires ${parameters.strict_required_status_checks_policy ? 'the branch to be up to date and ' : ''}${names.length > 0 ? `the status check(s) ${names.join(', ')}` : 'its status checks'} to pass`);
  }
  const reviews = rules.find(rule => rule.type === 'pull_request')?.parameters?.required_approving_review_count;
  if (reviews > 0) parts.push(`requires ${reviews} approving review(s)`);
  if (rules.some(rule => rule.type === 'merge_queue')) parts.push('requires a merge queue');
  if (parts.length === 0) return null;
  const known = (Array.isArray(rulesets) ? rulesets : []).filter(Boolean);
  const names = known.map(ruleset => `“${ruleset.name}”`).join(', ');
  const bypass = known.length > 0 && known.every(ruleset => ruleset.current_user_can_bypass === 'never') ? `; ${known.length === 1 ? 'it' : 'they'} cannot be bypassed by the current user${known.every(ruleset => Array.isArray(ruleset.bypass_actors) && ruleset.bypass_actors.length === 0) ? ' (no bypass actors)' : ''}, so \`--admin\` does not help` : '';
  return `${names ? `ruleset ${names}` : 'a repository ruleset'} ${parts.join(' and ')}${bypass}`;
}

/** Read and describe the branch rules of `branch` through `gh`; null when they cannot be read. */
export async function readBranchRules({ repository, branch, run }) {
  try {
    const output = await commandOutput(run, 'gh', ['api', `repos/${repository.fullName}/rules/branches/${encodeURIComponent(branch)}`]);
    const rules = output ? JSON.parse(output) : [];
    if (!Array.isArray(rules) || rules.length === 0) return null;
    const rulesets = [];
    for (const id of [...new Set(rules.map(rule => rule.ruleset_id).filter(Boolean))]) {
      try {
        const ruleset = await commandOutput(run, 'gh', ['api', `repos/${repository.fullName}/rulesets/${id}`]);
        if (ruleset) rulesets.push(JSON.parse(ruleset));
      } catch {
        // The ruleset itself may need admin access; the rules alone still explain the block.
      }
    }
    return describeBranchRules(rules, rulesets);
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
    applyState(pullRequest, state);
    if (state?.headRefOid) pullRequest.headRefOid = state.headRefOid;
    if (verbose) say(`   [VERBOSE] #${pullRequest.number} mergeability (read ${attempt}/${MERGEABILITY_REFRESH_ATTEMPTS}): ${pullRequest.mergeable}${state?.mergeStateStatus ? ` (${state.mergeStateStatus})` : ''}`);
  }
}

/** `gh pr merge`, retried once with `--admin` when a branch rule blocks it. Returns `{ error, admin }`. */
async function mergeOnce({ repository, pullRequest, method, run, say, verbose }) {
  let attempt = await run('gh', buildMergeArgs({ repository, pullRequest, method }));
  let error = attempt.code === 0 ? null : outputOf(attempt) || `gh exited with code ${attempt.code}`;
  if (verbose && error) say(`   [VERBOSE] gh pr merge #${pullRequest.number} failed: ${error}`);
  if (!error || !shouldRetryWithAdmin(error)) return { error: error && compactError(error), admin: false };
  attempt = await run('gh', buildMergeArgs({ repository, pullRequest, method, admin: true }));
  if (attempt.code === 0) return { error: null, admin: true };
  const adminError = outputOf(attempt);
  if (verbose) say(`   [VERBOSE] gh pr merge #${pullRequest.number} --admin failed: ${adminError}`);
  return { error: compactError(adminError) || compactError(error), admin: false };
}

/** The comment left on a Dependabot pull request that is closed as superseded. */
export function buildSupersededComment({ pullRequest, reason }) {
  const conflicting = pullRequest.mergeable === 'CONFLICTING';
  return [`Closing as superseded: \`${pullRequest.baseRefName || 'the base branch'}\` already has every update this pull request carries (${reason}), so ${conflicting ? 'it can no longer be merged cleanly and ' : ''}it is no longer needed.`, '', 'Closed automatically by `/fix --update-all-dependencies` before it created its dependency-update issue (link-assistant/hive-mind#3863, link-assistant/hive-mind#4061). Dependabot opens a new pull request when a newer version is released.'].join('\n');
}

/**
 * Compare a pull request with its base branch and close it when the base
 * already has every update it carries (issues #3863 and #4061). Returns true
 * when it was closed (or, with `dryRun`, would be).
 */
async function closeIfSuperseded({ repository, entry, run, dryRun, say, verbose }) {
  const verdict = await checkSupersededByBase({ repository, pullRequest: entry, run });
  entry.supersession = verdict;
  if (verbose) say(`   [VERBOSE] #${entry.number} supersession check: ${verdict.superseded ? 'superseded' : 'not superseded'} — ${verdict.reason}`);
  if (!verdict.superseded) return false;
  const conflict = entry.mergeable === 'CONFLICTING' ? `conflicts with ${entry.baseRefName || 'the base branch'} and ` : '';
  if (dryRun) {
    entry.outcome = 'planned-close';
    say(`   🔎 #${entry.number} ${conflict}is superseded by ${entry.baseRefName || 'the base branch'}; it would be closed (${verdict.reason})`);
    return true;
  }
  const closed = await run('gh', ['pr', 'close', String(entry.number), '--repo', repository.fullName, '--comment', buildSupersededComment({ pullRequest: entry, reason: verdict.reason })]);
  if (closed.code === 0) {
    entry.outcome = 'closed';
    entry.error = null;
    say(`   🗑️  #${entry.number} closed as superseded by ${entry.baseRefName || 'the base branch'}: ${verdict.reason}`);
    return true;
  }
  entry.closeError = compactError(outputOf(closed)) || `gh exited with code ${closed.code}`;
  say(`   ⚠️  #${entry.number} is superseded but could not be closed: ${entry.closeError}`);
  return false;
}

/**
 * Post a Dependabot command (`@dependabot recreate` / `@dependabot rebase`) and
 * remember which head it was asked about, so the wait can tell when it is done.
 */
async function askDependabot({ repository, entry, run, command, now }) {
  // Only the two fixed Dependabot commands are ever posted.
  const DEPENDABOT_COMMAND = command === DEPENDABOT_REBASE_COMMAND ? DEPENDABOT_REBASE_COMMAND : DEPENDABOT_RECREATE_COMMAND;
  const commented = await run('gh', ['pr', 'comment', String(entry.number), '--repo', repository.fullName, '--body', DEPENDABOT_COMMAND]);
  if (commented.code !== 0) return compactError(outputOf(commented)) || `gh exited with code ${commented.code}`;
  entry.requestedHead = entry.headRefOid;
  entry.requestedAt = now();
  entry.requestedCommand = DEPENDABOT_COMMAND;
  return null;
}

/** A pull request conflicts with its base branch and is not superseded: ask Dependabot to recreate it. */
async function requestRecreate({ repository, entry, run, dryRun, say, now }) {
  const reason = entry.supersession?.reason || 'not compared with the base branch';
  if (dryRun) {
    entry.outcome = 'planned-recreate';
    say(`   🔎 #${entry.number} conflicts with ${entry.baseRefName || 'the base branch'}; Dependabot would be asked to recreate it (${reason})`);
    return;
  }
  const error = await askDependabot({ repository, entry, run, command: DEPENDABOT_RECREATE_COMMAND, now });
  if (!error) {
    entry.outcome = 'recreate-requested';
    say(`   🔁 #${entry.number} conflicts with ${entry.baseRefName || 'the base branch'}; asked Dependabot to recreate it (${reason})`);
  } else {
    entry.outcome = 'skipped';
    entry.error = `merge conflict with the base branch; asking Dependabot to recreate it failed: ${error}`;
    say(`   ⚠️  #${entry.number} ${entry.error}`);
  }
}

/**
 * A merge failed for a reason other than a conflict, even with `--admin`
 * (issue #4061). Look at the pull request again and name the branch rules:
 * when it is behind its base, ask Dependabot to rebase it; when its checks
 * are still running, wait for them; otherwise it failed.
 */
async function handleBlockedMerge({ repository, entry, error, run, say, verbose, now, rulesFor }) {
  const state = await readPullRequestState(repository, entry.number, run);
  applyState(entry, state);
  if (state?.headRefOid) entry.headRefOid = state.headRefOid;
  entry.rules = await rulesFor(entry.baseRefName);
  entry.error = error;
  if (verbose) say(`   [VERBOSE] #${entry.number} after the failed merge: ${entry.mergeable}, ${entry.mergeStateStatus}, ${entry.checks.pending.length} check(s) pending${entry.rules ? `; ${entry.rules}` : ''}`);
  if (entry.mergeStateStatus === 'BEHIND') {
    if ((entry.rebases || 0) >= DEPENDABOT_REBASE_LIMIT) {
      entry.outcome = 'failed';
      entry.error = `still behind the base branch after ${entry.rebases} Dependabot rebase(s): ${error}`;
      say(`   ⚠️  #${entry.number} ${entry.error}`);
      return;
    }
    const commentError = await askDependabot({ repository, entry, run, command: DEPENDABOT_REBASE_COMMAND, now });
    if (commentError) {
      entry.outcome = 'failed';
      entry.error = `${error}; it is behind the base branch and asking Dependabot to rebase it failed: ${commentError}`;
      say(`   ⚠️  #${entry.number} ${entry.error}`);
      return;
    }
    entry.rebases = (entry.rebases || 0) + 1;
    entry.outcome = 'rebase-requested';
    say(`   🔁 #${entry.number} is behind ${entry.baseRefName || 'the base branch'} and a branch rule blocks the merge${entry.rules ? ` (${entry.rules})` : ''}; asked Dependabot to rebase it`);
    return;
  }
  // Right after Dependabot pushed a new head GitHub may not list its checks
  // yet, so a rebased or recreated pull request without a failing check waits.
  const checksExpected = (entry.rebased || entry.recreated) && entry.checks.failing.length === 0;
  if (entry.checks.pending.length > 0 || checksExpected) {
    entry.outcome = 'waiting-for-checks';
    entry.attemptedWith = checkSignature(entry);
    say(`   ⏳ #${entry.number} cannot be merged before its checks finish (${entry.checks.pending.length > 0 ? `${entry.checks.pending.length} still running` : 'not reported yet'}): ${error}`);
    return;
  }
  entry.outcome = 'failed';
  say(`   ⚠️  #${entry.number} could not be merged: ${error}${entry.rules ? ` (${entry.rules})` : ''}`);
}

const WAITING_OUTCOMES = new Set(['recreate-requested', 'rebase-requested', 'waiting-for-checks']);

/** What a merge attempt saw; the next one is only worth making once it changes. */
function checkSignature(entry) {
  return `${entry.mergeStateStatus}:${entry.checks.total}:${entry.checks.pending.length}:${entry.checks.failing.length}`;
}

/**
 * Wait (bounded) for the pull requests Dependabot was asked to recreate or
 * rebase, and for the required checks of the ones a branch rule keeps out,
 * then merge each one as soon as it can be merged. Dependabot may instead
 * close a pull request whose update is no longer needed. A pull request whose
 * head Dependabot has not replaced within `recreateTimeoutMs` of the request
 * is given up; everything else is given up after `timeoutMs`.
 */
async function awaitPendingPullRequests({ repository, entries, method, run, sleep, now, timeoutMs, recreateTimeoutMs, pollMs, checksPollMs, say, verbose, rulesFor }) {
  const waiting = new Set(entries);
  const deadline = now() + timeoutMs;
  const awaitingHead = entry => (entry.outcome === 'recreate-requested' || entry.outcome === 'rebase-requested') && entry.headRefOid === entry.requestedHead;
  if (waiting.size > 0) say(`⏳ Waiting up to ${Math.round(timeoutMs / 1000)}s for ${waiting.size} Dependabot pull request(s) to be recreated, rebased or checked...`);
  while (waiting.size > 0 && now() < deadline) {
    const interval = [...waiting].some(awaitingHead) ? pollMs : Math.max(pollMs, checksPollMs);
    await sleep(Math.min(interval, Math.max(0, deadline - now())));
    for (const entry of [...waiting]) {
      const state = await readPullRequestState(repository, entry.number, run);
      if (verbose) say(`   [VERBOSE] #${entry.number} while waiting (${entry.outcome}): ${state ? `${state.state}, ${state.mergeable}, ${state.mergeStateStatus || 'UNKNOWN'}, head ${String(state.headRefOid || '').slice(0, 7)}` : 'state unavailable'}`);
      if (!state) continue;
      if (state.state === 'MERGED' || state.state === 'CLOSED') {
        entry.outcome = state.state === 'MERGED' ? 'merged' : 'closed-by-dependabot';
        entry.error = null;
        waiting.delete(entry);
        say(`   ${state.state === 'MERGED' ? '✅' : '🗑️ '} #${entry.number} ${state.state === 'MERGED' ? 'was merged' : 'was closed by Dependabot'} while waiting`);
        continue;
      }
      applyState(entry, state);
      if (state.headRefOid && state.headRefOid !== entry.headRefOid) {
        if (entry.outcome === 'recreate-requested') entry.recreated = true;
        if (entry.outcome === 'rebase-requested') entry.rebased = true;
        entry.headRefOid = state.headRefOid;
        entry.outcome = 'waiting-for-checks';
        entry.attemptedWith = null;
      }
      if (awaitingHead(entry)) {
        if (now() - entry.requestedAt >= recreateTimeoutMs) {
          waiting.delete(entry);
          say(`   ⏳ #${entry.number} was not ${entry.outcome === 'recreate-requested' ? 'recreated' : 'rebased'} by Dependabot within ${Math.round(recreateTimeoutMs / 1000)}s; it stays open and is listed in the issue`);
        }
        continue;
      }
      if (state.mergeable === 'UNKNOWN') continue;
      if (state.mergeable === 'CONFLICTING') {
        entry.outcome = 'failed';
        entry.error = `conflicts with the base branch after Dependabot ${entry.recreated ? 'recreated' : 'rebased'} it`;
        waiting.delete(entry);
        say(`   ⚠️  #${entry.number} ${entry.error}`);
        continue;
      }
      // Try again only once the checks or the merge state changed since the last try.
      if (entry.attemptedWith && entry.attemptedWith === checkSignature(entry)) continue;
      const { error, admin } = await mergeOnce({ repository, pullRequest: entry, method, run, say, verbose });
      if (!error) {
        entry.admin = admin;
        entry.outcome = 'merged';
        entry.error = null;
        waiting.delete(entry);
        say(`   ✅ #${entry.number} ${entry.recreated ? 'recreated' : entry.rebased ? 'rebased' : 'checked'} and merged${admin ? ' (--admin)' : ''}: ${entry.title}`);
        continue;
      }
      if (isMergeConflictError(error)) {
        entry.outcome = 'failed';
        entry.error = error;
        waiting.delete(entry);
        say(`   ⚠️  #${entry.number} could not be merged: ${error}`);
        continue;
      }
      await handleBlockedMerge({ repository, entry, error, run, say, verbose, now, rulesFor });
      if (!WAITING_OUTCOMES.has(entry.outcome)) waiting.delete(entry);
    }
  }
  for (const entry of waiting) say(`   ⏳ #${entry.number} could not be merged within ${Math.round(timeoutMs / 1000)}s (${entry.outcome}); it stays open and is listed in the issue`);
}

/**
 * Merge every open Dependabot pull request of `repository` without waiting for
 * its CI/CD (issue #3413).
 *
 * Pull requests are handled oldest first. Each one is first compared with its
 * base branch and closed when the base already has all of its updates (issues
 * #3863 and #4061). The rest are merged; a merge that a branch rule blocks is
 * retried once with `--admin`. A pull request that conflicts with its base
 * branch is recreated by Dependabot; one that a rule still keeps out because
 * it is behind its base is rebased by Dependabot (issue #4061), and one whose
 * required checks are still running waits for them. Those are merged when
 * they can be within `waitTimeoutMs` (Dependabot has `recreateTimeoutMs` to
 * push the new head). Anything that still fails is recorded with its error
 * and left open, so the generated issue can ask for that update to be applied
 * by hand. With `dryRun` nothing is merged, closed or commented, and every
 * candidate is reported as `planned`, `planned-close` or `planned-recreate`.
 *
 * Never throws: the issue must still be created when the listing or a merge
 * fails. Returns `{ enabled, dryRun, method, listingError, pullRequests }`
 * where each pull request carries `outcome` (`merged` | `closed` |
 * `closed-by-dependabot` | `recreate-requested` | `rebase-requested` |
 * `waiting-for-checks` | `failed` | `skipped` | `planned` | `planned-close` |
 * `planned-recreate`), `admin`, `error`, `rules` (the branch rules that
 * blocked a merge) and `supersession`.
 */
export async function mergeDependabotPullRequests({ repository, run = runCommand, warn = message => console.warn(message), log = null, dryRun = false, verbose = false, sleep = defaultSleep, now = Date.now, recreateTimeoutMs = DEPENDABOT_RECREATE_TIMEOUT_MS, recreatePollMs = DEPENDABOT_RECREATE_POLL_MS, waitTimeoutMs = DEPENDABOT_WAIT_TIMEOUT_MS, checksPollMs = DEPENDABOT_CHECKS_POLL_MS } = {}) {
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

  const rulesCache = new Map();
  const rulesFor = branch => {
    const key = branch || '';
    if (!rulesCache.has(key)) rulesCache.set(key, branch ? readBranchRules({ repository, branch, run }) : Promise.resolve(null));
    return rulesCache.get(key);
  };

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
    if (verbose) say(`   [VERBOSE] #${entry.number} ${entry.title}: ${entry.mergeable}, ${entry.mergeStateStatus}, head ${String(entry.headRefOid || '').slice(0, 7)}, ${ciNote}`);
    // Issue #4061: a pull request that is mergeable but behind its base can be
    // superseded too, so every one is compared with its base branch first.
    if (await closeIfSuperseded({ repository, entry, run, dryRun, say, verbose })) continue;
    if (entry.mergeable === 'CONFLICTING') {
      await requestRecreate({ repository, entry, run, dryRun, say, now });
      continue;
    }
    if (dryRun) {
      say(`   🔎 #${entry.number} would be merged (${ciNote}${entry.mergeStateStatus === 'BEHIND' ? `; behind ${entry.baseRefName || 'the base branch'}` : ''}): ${entry.title}`);
      continue;
    }

    const { error, admin } = await mergeOnce({ repository, pullRequest: entry, method: result.method, run, say, verbose });
    entry.admin = admin;
    if (error && isMergeConflictError(error)) {
      // An earlier merge of this run, or a stale UNKNOWN, hid the conflict.
      entry.mergeable = 'CONFLICTING';
      await requestRecreate({ repository, entry, run, dryRun, say, now });
    } else if (error) {
      await handleBlockedMerge({ repository, entry, error, run, say, verbose, now, rulesFor });
    } else {
      entry.outcome = 'merged';
      say(`   ✅ #${entry.number} merged${admin ? ' (--admin)' : ''} (${ciNote}): ${entry.title}`);
    }
  }

  // A zero `recreateTimeoutMs` means Dependabot is not waited for at all.
  const pending = result.pullRequests.filter(entry => WAITING_OUTCOMES.has(entry.outcome) && (entry.outcome === 'waiting-for-checks' || recreateTimeoutMs > 0));
  if (!dryRun && pending.length > 0 && waitTimeoutMs > 0) {
    await awaitPendingPullRequests({ repository, entries: pending, method: result.method, run, sleep, now, timeoutMs: waitTimeoutMs, recreateTimeoutMs, pollMs: recreatePollMs, checksPollMs, say, verbose, rulesFor });
  }

  if (!dryRun) {
    const count = outcome => result.pullRequests.filter(entry => entry.outcome === outcome).length;
    const closed = count('closed') + count('closed-by-dependabot');
    const stillWaiting = count('recreate-requested') + count('rebase-requested') + count('waiting-for-checks');
    say(`ℹ️  Merged ${count('merged')} of ${result.pullRequests.length} open Dependabot pull request(s)${closed > 0 ? `; closed ${closed} as superseded` : ''}${stillWaiting > 0 ? `; ${stillWaiting} still waiting for Dependabot or their checks` : ''}.`);
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
  const leftOpen = pullRequests.filter(entry => ['failed', 'skipped', 'recreate-requested', 'rebase-requested', 'waiting-for-checks', 'planned-recreate'].includes(entry.outcome));
  const link = entry => `[#${entry.number}](${entry.url}) ${entry.title}${entry.baseRefName ? ` → \`${entry.baseRefName}\`` : ''}`;
  const item = entry => `- ${link(entry)} — ${describeChecks(entry.checks)}${entry.recreated ? ' — recreated by Dependabot on top of the base branch first' : ''}${entry.rebased ? ' — rebased by Dependabot on top of the base branch first' : ''}${entry.admin ? ' — merged with `--admin`, bypassing branch rules' : ''}`;
  const rules = entry => (entry.rules ? ` (${entry.rules})` : '');
  const leftOpenReason = entry => {
    if (entry.outcome === 'recreate-requested') return `conflicts with the base branch; Dependabot was asked to recreate it (\`${DEPENDABOT_RECREATE_COMMAND}\`) but had not finished when this issue was created`;
    if (entry.outcome === 'rebase-requested') return `behind the base branch, and a branch rule blocks merging it${rules(entry)}; Dependabot was asked to rebase it (\`${DEPENDABOT_REBASE_COMMAND}\`) but had not finished when this issue was created`;
    if (entry.outcome === 'waiting-for-checks') return `${entry.rebased ? 'rebased by Dependabot, but its' : entry.recreated ? 'recreated by Dependabot, but its' : 'its'} checks had not finished when this issue was created, and a branch rule blocks merging it before they pass${rules(entry)}${entry.error ? `: ${entry.error}` : ''}`;
    if (entry.outcome === 'planned-recreate') return `conflicts with the base branch; Dependabot would be asked to recreate it (\`${DEPENDABOT_RECREATE_COMMAND}\`)`;
    return `${entry.outcome === 'skipped' ? 'skipped' : 'merge failed'}: ${entry.error || 'unknown reason'}${rules(entry)}`;
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
    lines.push(dependabot.dryRun ? 'The base branch already has every update these Dependabot pull requests carry, so they would be closed as superseded:' : 'The base branch already had every update these Dependabot pull requests carried, so they were closed as superseded:', '');
    for (const entry of superseded) lines.push(`- ${link(entry)} — ${entry.outcome === 'closed-by-dependabot' ? `closed by Dependabot after it was asked to ${entry.requestedCommand === DEPENDABOT_REBASE_COMMAND ? 'rebase' : 'recreate'} it` : entry.supersession?.reason || 'superseded'}`);
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
  const leftOpen = count('failed', 'skipped', 'recreate-requested', 'rebase-requested', 'waiting-for-checks');
  return `Dependabot:     ${count('merged')} of ${pullRequests.length} open pull request(s) merged without waiting for CI/CD${closed > 0 ? `, ${closed} closed as superseded` : ''}${leftOpen > 0 ? `, ${leftOpen} left open` : ''}`;
}
