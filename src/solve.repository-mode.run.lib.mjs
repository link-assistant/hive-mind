#!/usr/bin/env node

/**
 * GitHub-backed orchestration for `/solve <github-repository-url>` — repository
 * mode (issue #2212).
 *
 * Flow, mirroring how `/fix --ci-cd` turns a repository into a solvable issue:
 *   1. list every open issue of the repository (oldest first, pull requests
 *      excluded),
 *   2. create one combined issue that lists them,
 *   3. attach each of them as a GitHub native sub-issue of the combined issue
 *      (at most 100 — GitHub's per-parent limit),
 *   4. assign the current user to the combined issue and every sub-issue so it
 *      is visible on GitHub that they are in progress (issue #2284),
 *   5. hand the combined issue back to `/solve`, which then runs its normal
 *      single-issue flow with `--deep-analysis` and
 *      `--ensure-all-sub-issues-addressed` enabled.
 *
 * The pure helpers live in `solve.repository-mode.lib.mjs`.
 */

import { spawn } from 'child_process';
import { describeChildExit } from './child-exit.lib.mjs';
import { parseGitHubUrl } from './github-url-parser.lib.mjs';
import { createTaskIssue } from './task.issue-creation.lib.mjs';
import { GITHUB_SUB_ISSUES_API_VERSION, buildAddSubIssueApiArgs } from './task.split.lib.mjs';
import { MAX_SUB_ISSUES_PER_PARENT, buildAddAssigneeApiArgs, buildAssignableCheckApiArgs, buildCombinedIssueBody, buildCombinedIssueTitle, buildCurrentUserLoginApiArgs, buildGetParentIssueApiArgs, buildOpenIssuesApiArgs, buildRepositoryModeSummaryLines, isAlreadyHasParentError, responseListsAssignee, selectOldestOpenIssues } from './solve.repository-mode.lib.mjs';
import { isRateLimitError } from './github-rate-limit.lib.mjs';

/** Labels applied best-effort to the generated combined issue. */
export const REPOSITORY_MODE_ISSUE_LABELS = Object.freeze(['enhancement']);

/**
 * Pause between two sub-issue POSTs.
 *
 * GitHub's own documentation warns that "creating content too quickly using
 * this endpoint may result in secondary rate limiting"
 * (https://docs.github.com/en/rest/issues/sub-issues), and its best-practice
 * guide asks for at least one second between mutative requests. Attaching 100
 * sub-issues therefore costs about a minute — negligible next to a solve run,
 * and much cheaper than being throttled halfway through.
 */
export const SUB_ISSUE_ATTACH_DELAY_MS = 1000;

/** Attempts per sub-issue when GitHub answers with a rate-limit error. */
export const SUB_ISSUE_ATTACH_MAX_ATTEMPTS = 3;

/**
 * Backoff before retrying a rate-limited sub-issue attachment.
 *
 * GitHub's best-practice guide asks to "wait for at least one minute before
 * retrying" a secondary rate-limit error, then "an exponentially increasing
 * amount of time between retries"
 * (https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#handle-rate-limit-errors-appropriately).
 */
export const SUB_ISSUE_ATTACH_BACKOFF_MS = Object.freeze([60000, 120000]);

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function runCommand(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => {
      stdout += data.toString();
    });
    child.stderr.on('data', data => {
      stderr += data.toString();
    });
    child.on('error', error => {
      resolve({ code: 1, stdout, stderr: stderr || error.message });
    });
    child.on('close', (code, signal) => {
      resolve({ code, stdout, stderr, signal });
    });
  });
}

async function commandOutput(run, command, args) {
  const result = await run(command, args);
  if (result.code !== 0) {
    const output = `${result.stderr?.toString() || ''}${result.stdout?.toString() || ''}`.trim();
    // Issue #2135: `describeChildExit` names a signal instead of "code null".
    throw new Error(output || describeChildExit({ command, code: result.code, signal: result.signal }));
  }
  return result.stdout.trim();
}

const firstLine = error => (error?.message ? String(error.message).split('\n')[0] : String(error));

/**
 * Run one mutative GitHub request, retrying only on rate-limit errors with the
 * bounded {@link SUB_ISSUE_ATTACH_BACKOFF_MS} backoff. Other errors ("already
 * has a parent" and the like) would fail identically however long we wait.
 *
 * @returns {Promise<Error|null>} the last error, or null on success
 */
async function withRateLimitRetry({ action, describe, maxAttempts = SUB_ISSUE_ATTACH_MAX_ATTEMPTS, sleep = defaultSleep, log = null }) {
  const attempts = Math.max(1, maxAttempts);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await action();
      return null;
    } catch (error) {
      if (attempt >= attempts || !isRateLimitError(error)) return error;
      const waitMs = SUB_ISSUE_ATTACH_BACKOFF_MS[Math.min(attempt - 1, SUB_ISSUE_ATTACH_BACKOFF_MS.length - 1)];
      await log?.(`   ⏳ Rate limited while ${describe}; retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${attempts})...`);
      await sleep(waitMs);
    }
  }
  return null;
}

/**
 * Parse a repository URL into the `{owner, repo, fullName, url}` shape the rest
 * of this module (and `createTaskIssue`) expects.
 *
 * @param {string} url
 * @returns {{owner: string, repo: string, fullName: string, url: string}|null}
 */
export function parseRepositoryModeUrl(url) {
  const parsed = parseGitHubUrl(url);
  if (!parsed.valid || parsed.type !== 'repo') return null;
  return {
    owner: parsed.owner,
    repo: parsed.repo,
    fullName: `${parsed.owner}/${parsed.repo}`,
    url: parsed.normalized || `https://github.com/${parsed.owner}/${parsed.repo}`,
  };
}

/**
 * Fetch every open issue of a repository (pull requests included — the caller
 * filters them out via `selectOldestOpenIssues`).
 *
 * @param {object} params
 * @param {{owner: string, repo: string}} params.repository
 * @param {Function} [params.run]
 * @returns {Promise<Array<object>>}
 */
export async function fetchOpenIssues({ repository, run = runCommand }) {
  const output = await commandOutput(run, 'gh', buildOpenIssuesApiArgs({ owner: repository.owner, repo: repository.repo }));
  const parsed = JSON.parse(output || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Collect the data for the combined issue without creating anything.
 *
 * @param {object} params
 * @param {{owner: string, repo: string, fullName: string, url: string}} params.repository
 * @param {number} [params.limit=MAX_SUB_ISSUES_PER_PARENT]
 * @param {Function} [params.run]
 * @returns {Promise<{repository, selected, totalOpen, skipped, title, body}>}
 */
export async function prepareRepositoryModeIssue({ repository, limit = MAX_SUB_ISSUES_PER_PARENT, run = runCommand }) {
  const entries = await fetchOpenIssues({ repository, run });
  const { selected, totalOpen, skipped } = selectOldestOpenIssues(entries, { limit });

  return {
    repository,
    selected,
    totalOpen,
    skipped,
    limit,
    title: buildCombinedIssueTitle({ owner: repository.owner, repo: repository.repo, count: selected.length, totalOpen }),
    body: buildCombinedIssueBody({ repository, issues: selected, totalOpen, limit }),
  };
}

/**
 * Look up the current parent of `issue` and return it only when it is closed,
 * i.e. when nobody is tracking work through it any more. Throws otherwise, so
 * the caller reports the issue as not attached.
 *
 * @returns {Promise<{number: number, label: string}>}
 */
async function reclaimableParent({ repository, issue, run }) {
  let parent;
  try {
    parent = JSON.parse(await commandOutput(run, 'gh', buildGetParentIssueApiArgs({ owner: repository.owner, repo: repository.repo, number: issue.number, apiVersion: GITHUB_SUB_ISSUES_API_VERSION })));
  } catch (error) {
    throw new Error(`#${issue.number} already has a parent issue that could not be inspected: ${firstLine(error)}`, { cause: error });
  }
  const label = parent?.html_url || `#${parent?.number}`;
  if (parent?.state !== 'closed') {
    throw new Error(`#${issue.number} already belongs to the open parent issue ${label}; leaving it there`);
  }
  return { number: parent.number, label };
}

/**
 * Attach the selected issues to the combined issue as GitHub native sub-issues.
 *
 * Failures are non-fatal and reported: an issue that already has a different
 * *open* parent is left where it is, and losing the whole run over one such
 * issue would be worse than solving the rest (the issue is still listed in the
 * combined issue body either way).
 *
 * An issue whose current parent is *closed* — typically the combined issue of
 * an earlier repository-mode run that did not finish it — is moved to the new
 * combined issue with `replace_parent`. Without that every leftover issue was
 * rejected with HTTP 422 "Sub issue may only have one parent", so the new
 * combined issue tracked none of the work in progress (issue #2284).
 *
 * A rate-limited attachment is retried with a bounded backoff, and the requests
 * are spaced out, because this endpoint is explicitly documented as prone to
 * secondary rate limiting when content is created quickly.
 *
 * @param {object} params
 * @param {{owner: string, repo: string, number: number}} params.parentIssue
 * @param {Array<{number: number, id: number}>} params.issues
 * @param {Function} [params.run]
 * @param {Function} [params.log]
 * @param {number} [params.delayMs] - pause between requests (0 disables it)
 * @param {number} [params.maxAttempts] - attempts per sub-issue on rate limits
 * @param {Function} [params.sleep] - test override for the waiting
 * @returns {Promise<{attached: Array<object>, failed: Array<{issue: object, error: string}>, moved: Array<{issue: object, previousParent: string}>}>}
 */
export async function attachSubIssues({ parentIssue, issues, run = runCommand, log = null, delayMs = SUB_ISSUE_ATTACH_DELAY_MS, maxAttempts = SUB_ISSUE_ATTACH_MAX_ATTEMPTS, sleep = defaultSleep }) {
  const attached = [];
  const failed = [];
  const moved = [];
  const list = Array.isArray(issues) ? issues : [];

  for (let index = 0; index < list.length; index++) {
    const issue = list[index];
    if (index > 0 && delayMs > 0) await sleep(delayMs);

    const lastError = await withRateLimitRetry({
      action: async () => {
        if (!Number.isInteger(issue.id) || issue.id <= 0) {
          throw new Error(`missing REST id for issue #${issue.number}`);
        }
        try {
          await commandOutput(run, 'gh', buildAddSubIssueApiArgs({ parentIssue, subIssueId: issue.id }));
        } catch (error) {
          if (!isAlreadyHasParentError(error)) throw error;
          const previous = await reclaimableParent({ repository: parentIssue, issue, run });
          await log?.(`   ↪️  Moving #${issue.number} from closed parent ${previous.label} to #${parentIssue.number}...`);
          await commandOutput(run, 'gh', buildAddSubIssueApiArgs({ parentIssue, subIssueId: issue.id, replaceParent: true }));
          moved.push({ issue, previousParent: previous.label });
        }
      },
      describe: `attaching #${issue.number}`,
      maxAttempts,
      sleep,
      log,
    });

    if (lastError) {
      const message = firstLine(lastError);
      failed.push({ issue, error: message });
      await log?.(`   ⚠️  Could not attach #${issue.number} as a sub-issue: ${message}`);
    } else {
      attached.push(issue);
    }
  }

  return { attached, failed, moved };
}

/**
 * Assign the authenticated user to every given issue (issue #2284).
 *
 * Repository mode works on all of these issues at once; without an assignee
 * nothing on GitHub shows that they are already in progress, so another
 * contributor (or another hive-mind run) could pick them up in parallel.
 *
 * Best effort, like {@link attachSubIssues}: the run continues when the user
 * cannot be determined, is not assignable in the repository (for example a
 * contributor without push access working through a fork), or an individual
 * issue refuses the assignee. Existing assignees are kept — the endpoint only
 * adds. Requests are spaced out and rate limits retried for the same reason as
 * the sub-issue attachment.
 *
 * @param {object} params
 * @param {{owner: string, repo: string}} params.repository
 * @param {Array<{number: number}>} params.issues
 * @param {Function} [params.run]
 * @param {Function} [params.log]
 * @param {number} [params.delayMs]
 * @param {number} [params.maxAttempts]
 * @param {Function} [params.sleep]
 * @returns {Promise<{login: string|null, skippedReason: string|null, assigned: Array<object>, failed: Array<{issue: object, error: string}>}>}
 */
export async function assignIssuesToCurrentUser({ repository, issues, run = runCommand, log = null, delayMs = SUB_ISSUE_ATTACH_DELAY_MS, maxAttempts = SUB_ISSUE_ATTACH_MAX_ATTEMPTS, sleep = defaultSleep }) {
  const list = Array.isArray(issues) ? issues : [];
  const result = { login: null, skippedReason: null, assigned: [], failed: [] };
  if (list.length === 0) return result;

  try {
    result.login = (await commandOutput(run, 'gh', buildCurrentUserLoginApiArgs())) || null;
  } catch (error) {
    result.skippedReason = `could not determine the current GitHub user: ${firstLine(error)}`;
  }
  if (!result.login) {
    result.skippedReason ||= 'could not determine the current GitHub user';
    await log?.(`   ⚠️  Skipping issue assignment: ${result.skippedReason}`);
    return result;
  }

  try {
    await commandOutput(run, 'gh', buildAssignableCheckApiArgs({ owner: repository.owner, repo: repository.repo, login: result.login }));
  } catch (error) {
    result.skippedReason = `${result.login} cannot be assigned to issues in ${repository.owner}/${repository.repo}: ${firstLine(error)}`;
    await log?.(`   ⚠️  Skipping issue assignment: ${result.skippedReason}`);
    return result;
  }

  for (let index = 0; index < list.length; index++) {
    const issue = list[index];
    if (index > 0 && delayMs > 0) await sleep(delayMs);

    const lastError = await withRateLimitRetry({
      action: async () => {
        const output = await commandOutput(run, 'gh', buildAddAssigneeApiArgs({ owner: repository.owner, repo: repository.repo, number: issue.number, login: result.login }));
        if (!responseListsAssignee(output, result.login)) {
          throw new Error(`GitHub did not add ${result.login} (the issue may already have the maximum of 10 assignees)`);
        }
      },
      describe: `assigning #${issue.number}`,
      maxAttempts,
      sleep,
      log,
    });

    if (lastError) {
      const message = firstLine(lastError);
      result.failed.push({ issue, error: message });
      await log?.(`   ⚠️  Could not assign ${result.login} to #${issue.number}: ${message}`);
    } else {
      result.assigned.push(issue);
    }
  }

  return result;
}

/**
 * Create the combined issue and attach the sub-issues.
 *
 * @param {object} params
 * @returns {Promise<{owner, repo, number, url, prepared, attached, failed, moved, assignment}>}
 */
export async function createRepositoryModeIssue({ repository, prepared, run = runCommand, log = null, attachOptions = {} }) {
  const issue = await createTaskIssue({
    repository,
    title: prepared.title,
    body: prepared.body,
    labels: [...REPOSITORY_MODE_ISSUE_LABELS],
    run,
    log,
  });

  const { attached, failed, moved } = await attachSubIssues({
    parentIssue: { owner: issue.owner, repo: issue.repo, number: issue.number },
    issues: prepared.selected,
    run,
    log,
    ...attachOptions,
  });

  // Issue #2284: mark the combined issue and every issue it covers as taken.
  const assignment = await assignIssuesToCurrentUser({
    repository,
    issues: [{ number: issue.number }, ...prepared.selected],
    run,
    log,
    ...attachOptions,
  });

  return { ...issue, prepared, attached, failed, moved, assignment };
}

/**
 * Entry point used by solve.mjs.
 *
 * Returns `{ handled: false }` when the URL is not a repository URL so the
 * caller can continue with its normal issue/pull-request validation.
 *
 * @param {object} params
 * @param {string} params.url
 * @param {Function} [params.log]
 * @param {Function} [params.run]
 * @param {number} [params.limit]
 * @param {boolean} [params.dryRun] - prepare only; do not create anything
 * @param {object} [params.attachOptions] - forwarded to {@link attachSubIssues}
 * @returns {Promise<{handled: boolean, issueUrl?: string, issue?: object, prepared?: object, argvOverrides?: object, noWork?: boolean, message?: string, error?: string}>}
 */
export async function resolveRepositoryModeTarget({ url, log = null, run = runCommand, limit = MAX_SUB_ISSUES_PER_PARENT, dryRun = false, attachOptions = {} }) {
  const repository = parseRepositoryModeUrl(url);
  if (!repository) return { handled: false };

  const emit = async message => {
    if (typeof log === 'function') await log(message);
  };

  await emit('');
  await emit(`📦 REPOSITORY MODE: ${repository.url}`);
  await emit('   Collecting all open issues to combine them into a single issue...');

  let prepared;
  try {
    prepared = await prepareRepositoryModeIssue({ repository, limit, run });
  } catch (error) {
    return { handled: true, error: `Could not list open issues of ${repository.fullName}: ${error.message}` };
  }

  for (const line of buildRepositoryModeSummaryLines({ totalOpen: prepared.totalOpen, selectedCount: prepared.selected.length, skipped: prepared.skipped, limit })) {
    await emit(line);
  }

  if (prepared.selected.length === 0) {
    const message = `${repository.fullName} has no open issues. Nothing to do.`;
    await emit(`ℹ️  ${message}`);
    return { handled: true, noWork: true, message, prepared };
  }

  if (dryRun) {
    return { handled: true, dryRun: true, prepared };
  }

  await emit('');
  await emit('📝 Creating the combined issue...');
  await emit(`   Then attaching ${prepared.selected.length} issue(s) as sub-issues, one request per second to stay clear of GitHub's secondary rate limit...`);

  let issue;
  try {
    issue = await createRepositoryModeIssue({ repository, prepared, run, log: emit, attachOptions });
  } catch (error) {
    return { handled: true, error: `Could not create the combined issue in ${repository.fullName}: ${error.message}` };
  }

  await emit(`✅ Created combined issue: ${issue.url}`);
  const attachNotes = [issue.moved.length > 0 ? `${issue.moved.length} moved from a closed parent` : '', issue.failed.length > 0 ? `${issue.failed.length} could not be attached` : ''].filter(Boolean);
  await emit(`   Sub-issues attached: ${issue.attached.length}/${prepared.selected.length}${attachNotes.length > 0 ? ` (${attachNotes.join(', ')})` : ''}`);
  const { assignment } = issue;
  if (assignment.skippedReason) {
    await emit(`   Issues assigned: none (${assignment.skippedReason})`);
  } else {
    const total = assignment.assigned.length + assignment.failed.length;
    await emit(`   Issues assigned to ${assignment.login}: ${assignment.assigned.length}/${total}${assignment.failed.length > 0 ? ` (${assignment.failed.length} could not be assigned)` : ''}`);
  }
  await emit('   Continuing with the normal /solve flow for that issue.');
  await emit('');

  return {
    handled: true,
    issueUrl: issue.url,
    issue,
    prepared,
    // Repository mode always asks for deep analysis (like /fix) and always
    // double checks that the pull request description lists every issue.
    argvOverrides: {
      'deep-analysis': true,
      deepAnalysis: true,
      'ensure-all-sub-issues-addressed': true,
      ensureAllSubIssuesAddressed: true,
    },
  };
}

export default {
  REPOSITORY_MODE_ISSUE_LABELS,
  SUB_ISSUE_ATTACH_DELAY_MS,
  parseRepositoryModeUrl,
  fetchOpenIssues,
  prepareRepositoryModeIssue,
  attachSubIssues,
  assignIssuesToCurrentUser,
  createRepositoryModeIssue,
  resolveRepositoryModeTarget,
};
