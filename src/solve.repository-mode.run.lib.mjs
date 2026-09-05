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
 *   4. hand the combined issue back to `/solve`, which then runs its normal
 *      single-issue flow with `--deep-analysis` and
 *      `--ensure-all-sub-issues-addressed` enabled.
 *
 * The pure helpers live in `solve.repository-mode.lib.mjs`.
 */

import { spawn } from 'child_process';
import { describeChildExit } from './child-exit.lib.mjs';
import { parseGitHubUrl } from './github-url-parser.lib.mjs';
import { createTaskIssue } from './task.issue-creation.lib.mjs';
import { buildAddSubIssueApiArgs } from './task.split.lib.mjs';
import { MAX_SUB_ISSUES_PER_PARENT, buildCombinedIssueBody, buildCombinedIssueTitle, buildOpenIssuesApiArgs, buildRepositoryModeSummaryLines, selectOldestOpenIssues } from './solve.repository-mode.lib.mjs';

/** Labels applied best-effort to the generated combined issue. */
export const REPOSITORY_MODE_ISSUE_LABELS = Object.freeze(['enhancement']);

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
    const output = `${result.stderr || ''}${result.stdout || ''}`.trim();
    // Issue #2135: `describeChildExit` names a signal instead of "code null".
    throw new Error(output || describeChildExit({ command, code: result.code, signal: result.signal }));
  }
  return result.stdout.trim();
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
 * Attach the selected issues to the combined issue as GitHub native sub-issues.
 *
 * Failures are non-fatal and reported: an issue that already has a different
 * parent is rejected by the API, and losing the whole run over one such issue
 * would be worse than solving the rest (the issue is still listed in the
 * combined issue body either way).
 *
 * @param {object} params
 * @param {{owner: string, repo: string, number: number}} params.parentIssue
 * @param {Array<{number: number, id: number}>} params.issues
 * @param {Function} [params.run]
 * @param {Function} [params.log]
 * @returns {Promise<{attached: Array<object>, failed: Array<{issue: object, error: string}>}>}
 */
export async function attachSubIssues({ parentIssue, issues, run = runCommand, log = null }) {
  const attached = [];
  const failed = [];

  for (const issue of Array.isArray(issues) ? issues : []) {
    try {
      if (!Number.isInteger(issue.id) || issue.id <= 0) {
        throw new Error(`missing REST id for issue #${issue.number}`);
      }
      await commandOutput(run, 'gh', buildAddSubIssueApiArgs({ parentIssue, subIssueId: issue.id }));
      attached.push(issue);
    } catch (error) {
      const message = error?.message ? String(error.message).split('\n')[0] : String(error);
      failed.push({ issue, error: message });
      await log?.(`   ⚠️  Could not attach #${issue.number} as a sub-issue: ${message}`);
    }
  }

  return { attached, failed };
}

/**
 * Create the combined issue and attach the sub-issues.
 *
 * @param {object} params
 * @returns {Promise<{owner, repo, number, url, prepared, attached, failed}>}
 */
export async function createRepositoryModeIssue({ repository, prepared, run = runCommand, log = null }) {
  const issue = await createTaskIssue({
    repository,
    title: prepared.title,
    body: prepared.body,
    labels: [...REPOSITORY_MODE_ISSUE_LABELS],
    run,
    log,
  });

  const { attached, failed } = await attachSubIssues({
    parentIssue: { owner: issue.owner, repo: issue.repo, number: issue.number },
    issues: prepared.selected,
    run,
    log,
  });

  return { ...issue, prepared, attached, failed };
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
 * @returns {Promise<{handled: boolean, issueUrl?: string, issue?: object, prepared?: object, argvOverrides?: object, error?: string}>}
 */
export async function resolveRepositoryModeTarget({ url, log = null, run = runCommand, limit = MAX_SUB_ISSUES_PER_PARENT, dryRun = false }) {
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
    return { handled: true, error: `${repository.fullName} has no open issues to solve.` };
  }

  if (dryRun) {
    return { handled: true, dryRun: true, prepared };
  }

  await emit('');
  await emit('📝 Creating the combined issue...');

  let issue;
  try {
    issue = await createRepositoryModeIssue({ repository, prepared, run, log: emit });
  } catch (error) {
    return { handled: true, error: `Could not create the combined issue in ${repository.fullName}: ${error.message}` };
  }

  await emit(`✅ Created combined issue: ${issue.url}`);
  await emit(`   Sub-issues attached: ${issue.attached.length}/${prepared.selected.length}${issue.failed.length > 0 ? ` (${issue.failed.length} could not be attached)` : ''}`);
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
  parseRepositoryModeUrl,
  fetchOpenIssues,
  prepareRepositoryModeIssue,
  attachSubIssues,
  createRepositoryModeIssue,
  resolveRepositoryModeTarget,
};
