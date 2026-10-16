/**
 * The merged-PR sweeper (issue #3356).
 *
 * Merges done in the GitHub UI, with a person's `gh pr merge`, by GitHub
 * auto-merge or a merge queue run no Hive Mind code, so the issues they close
 * stay open after a merge into a non-default branch or a GitHub miss. The
 * Telegram bot and `hive` therefore check, every 5 minutes, the pull requests
 * merged in the last 24 h where they work, and close what each one intends to
 * close (the same {@link closeIntendedIssuesAfterMerge} as the merge paths).
 *
 * A state file keeps the time the sweeper was first enabled and the pull
 * requests already checked: nothing is checked twice, and a pull request
 * merged before the feature was enabled is never touched unless a backfill is
 * requested with `since`. Pull requests merged in the last 5 minutes wait for
 * the next run, so the merge path's own check (and GitHub) goes first.
 *
 * A pull request whose check keeps failing (an issue the token may not close)
 * is given up after {@link MAX_SWEEP_ATTEMPTS} runs instead of every 5 minutes
 * for a day. In report mode a pull request with issues left open is not marked
 * checked, so turning closing on later still closes them. The bot and `hive`
 * on one host share the state file, so a sweep holds a lock next to it.
 */
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ghJson, runLinkGh } from './issue-link-verification.lib.mjs';
import { closeIntendedIssuesAfterMerge, fetchMergedPullRequestSnapshot, formatIssueClosingReport, issueClosingOptions } from './post-merge-issue-closing.lib.mjs';
import { withStateLock } from './state-lock.lib.mjs';

export const SWEEP_INTERVAL_MS = 5 * 60_000;
export const SWEEP_WINDOW_MS = 24 * 60 * 60_000;
export const SWEEP_GRACE_MS = 5 * 60_000;
const MAX_SEARCH_PAGES = 10;
export const MAX_SWEEP_ATTEMPTS = 6;

export const defaultSweeperStatePath = (env = process.env) => env.HIVE_MIND_MERGED_PR_SWEEPER_STATE || join(homedir(), '.hive-mind', 'merged-pr-sweeper.json');

/** The search qualifier for where a process works: `repo:o/r`, `user:o` (users and organizations) or `author:@me`. */
export function sweepScope({ owner = null, repo = null, author = null } = {}) {
  if (owner && repo) return `repo:${owner}/${repo}`;
  if (owner) return `user:${owner}`;
  if (author) return `author:${author}`;
  throw new Error('A sweep scope needs an owner, a repository or an author');
}

/** Pull requests merged at or after `since` (ISO), as [{ owner, repo, number, mergedAt, url }]. */
export async function searchMergedPullRequests({ scope, since, run = runLinkGh }) {
  const found = [];
  for (let page = 1; page <= MAX_SEARCH_PAGES; page++) {
    const response = await ghJson(run, ['api', '-X', 'GET', 'search/issues', '-f', `q=is:pr is:merged ${scope} merged:>=${since}`, '-f', 'per_page=100', '-f', `page=${page}`]);
    const items = Array.isArray(response?.items) ? response.items : null;
    if (!items) throw new Error(`Cannot search the pull requests merged since ${since} (${scope})`);
    for (const item of items) {
      const match = String(item.repository_url || '').match(/\/repos\/([^/]+)\/([^/]+)$/);
      if (match && item.pull_request?.merged_at) found.push({ owner: match[1], repo: match[2], number: Number(item.number), mergedAt: item.pull_request.merged_at, url: item.pull_request.html_url || item.html_url || null });
    }
    if (items.length < 100 || found.length >= Number(response.total_count || 0)) break;
  }
  return found;
}

/**
 * The sweeper state: { enabledAt, checked: { "owner/repo#N": mergedAt },
 * reported: { key: mergedAt }, attempts: { key: count } }. A missing file
 * means "enabled now".
 */
export async function loadSweeperState(path, now = Date.now()) {
  try {
    const state = JSON.parse(await fs.readFile(path, 'utf8'));
    if (state && typeof state.enabledAt === 'string' && state.checked && typeof state.checked === 'object') return { ...state, reported: state.reported || {}, attempts: state.attempts || {} };
  } catch {
    // A missing or unreadable file starts a fresh state.
  }
  return { enabledAt: new Date(now).toISOString(), checked: {}, reported: {}, attempts: {} };
}

export async function saveSweeperState(path, state) {
  await fs.mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
  await fs.rename(temporary, path);
}

/**
 * One sweep over `scopes`. Each newly merged pull request is checked once;
 * one with a failed read or close is retried on the next run (within the
 * window). Mutates and returns `state`, with `results: [{ key, result }]`
 * and `errors: [{ scope|key, error }]`. Never throws.
 */
export async function sweepMergedPullRequests({ scopes, state, since = null, now = Date.now(), windowMs = SWEEP_WINDOW_MS, graceMs = SWEEP_GRACE_MS, options = {}, run = runLinkGh, logger = async () => {} }) {
  const { autoCloseLinkedIssues, allowCrossRepositoryClosing, closeCompletedParents } = issueClosingOptions(options);
  const floor = since ? Date.parse(since) : Math.max(now - windowMs, Date.parse(state.enabledAt));
  const mode = autoCloseLinkedIssues ? 'close' : 'report';
  state.reported ||= {};
  state.attempts ||= {};
  const results = [];
  const errors = [];
  const seen = new Set();
  // One more failed check; at the limit the pull request is marked checked, so it is not retried all day.
  const failedAttempt = async (key, mergedAt) => {
    state.attempts[key] = (state.attempts[key] || 0) + 1;
    if (state.attempts[key] < MAX_SWEEP_ATTEMPTS) return;
    state.checked[key] = mergedAt;
    delete state.attempts[key];
    await logger(`Merged-PR sweeper: giving up on ${key} after ${MAX_SWEEP_ATTEMPTS} failed checks; run close-linked-issues --pr for it once the cause is fixed`, { level: 'warning' });
  };
  for (const scope of scopes) {
    let merged;
    try {
      merged = await searchMergedPullRequests({ scope, since: new Date(floor).toISOString(), run });
    } catch (error) {
      errors.push({ scope, error: error.message });
      await logger(`Merged-PR sweeper: ${error.message}`, { level: 'warning' });
      continue;
    }
    for (const pr of merged) {
      const key = `${pr.owner}/${pr.repo}#${pr.number}`.toLowerCase();
      const mergedAt = Date.parse(pr.mergedAt);
      if (seen.has(key) || state.checked[key] || (mode === 'report' && state.reported[key]) || !(mergedAt >= floor) || mergedAt > now - graceMs) continue;
      seen.add(key);
      try {
        const snapshot = await fetchMergedPullRequestSnapshot({ owner: pr.owner, repo: pr.repo, prNumber: pr.number, run, allowCrossRepositoryClosing });
        const result = await closeIntendedIssuesAfterMerge(snapshot, { mode, run, logger, wait: false, closeParents: closeCompletedParents });
        results.push({ key, result });
        for (const line of formatIssueClosingReport(result)) if (result.closed.length || result.failed.length || result.stillOpen.length || result.parents?.closed?.length) await logger(`Merged-PR sweeper, ${key}: ${line}`);
        if (result.failed.length || result.parents?.failed?.length) await failedAttempt(key, pr.mergedAt);
        else if (result.stillOpen.length) state.reported[key] = pr.mergedAt;
        else {
          state.checked[key] = pr.mergedAt;
          delete state.reported[key];
          delete state.attempts[key];
        }
      } catch (error) {
        errors.push({ key, error: error.message });
        await logger(`Merged-PR sweeper: cannot check ${key}: ${error.message}`, { level: 'warning' });
        await failedAttempt(key, pr.mergedAt);
      }
    }
  }
  // Forget what left the window, so the state file stays small.
  for (const entries of [state.checked, state.reported]) for (const [key, mergedAt] of Object.entries(entries)) if (Date.parse(mergedAt) < now - windowMs - 60 * 60_000) delete entries[key];
  for (const key of Object.keys(state.attempts)) if (!seen.has(key)) delete state.attempts[key];
  return Object.assign(state, { results, errors });
}

/**
 * Run {@link sweepMergedPullRequests} now and every `intervalMs`, with the
 * state in `statePath`. The timer never keeps the process alive and sweeps do
 * not overlap. Returns { stop, runOnce }.
 */
export function startMergedPullRequestSweeper({ scopes, options = {}, intervalMs = SWEEP_INTERVAL_MS, statePath = defaultSweeperStatePath(), run = runLinkGh, logger = async () => {}, setTimer = setInterval, clearTimer = clearInterval, lockTimeoutMs = 2 * 60_000 } = {}) {
  let running = null;
  const runOnce = async () => {
    if (running) return running;
    running = (async () => {
      try {
        return await withStateLock(
          'merged-pr-sweeper',
          async () => {
            const state = await loadSweeperState(statePath);
            const swept = await sweepMergedPullRequests({ scopes, state, options, run, logger });
            const { results: _results, errors: _errors, ...persisted } = swept;
            await saveSweeperState(statePath, persisted);
            return swept;
          },
          { lockPath: `${statePath}.lock`, timeoutMs: lockTimeoutMs }
        );
      } catch (error) {
        await logger(`Merged-PR sweeper failed: ${error.message}`, { level: 'warning' });
        return null;
      } finally {
        running = null;
      }
    })();
    return running;
  };
  const timer = setTimer(runOnce, intervalMs);
  timer?.unref?.();
  runOnce();
  return { stop: () => clearTimer(timer), runOnce };
}
