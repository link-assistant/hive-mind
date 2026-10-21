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
 * A repository with exactly one open issue skips steps 2–4: that issue is
 * handed back to `/solve` as is, with no combined issue (issue #3108).
 *
 * Every step is done only when it was not done yet (issue #3684): an open
 * combined issue of an earlier run is reused instead of creating another one
 * (its scope is updated when new issues were opened since), and only the issues
 * that are not attached yet are attached as sub-issues. A rerun or a kill
 * recovery therefore lands on the same combined issue, and `--auto-continue`
 * then continues its pull request.
 *
 * The pure helpers live in `solve.repository-mode.lib.mjs`.
 */

// Issue #3552: the shared runner retries every gh call through the one GitHub retry loop.
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { commandOutput, runCommand } from './fix.github.lib.mjs';
import { parseGitHubUrl } from './github-url-parser.lib.mjs';
import { createTaskIssue } from './task.issue-creation.lib.mjs';
import { buildAddSubIssueApiArgs, buildListSubIssuesApiArgs, buildParentIssueApiArgs } from './task.split.lib.mjs';
import { MAX_SUB_ISSUES_PER_PARENT, buildCombinedIssueBody, buildCombinedIssueTitle, buildOpenIssuesApiArgs, buildRepositoryModeSummaryLines, findRepositoryModeIssues, isRepositoryModeIssueBody, selectOldestOpenIssues, selectReusableRepositoryModeIssue, selectSingleIssueTarget } from './solve.repository-mode.lib.mjs';
import { isRateLimitError } from './github-rate-limit.lib.mjs';
import { sanitizeForPublication, writeSanitizedPublicationFile } from './token-sanitization.lib.mjs';

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

/**
 * Repository mode always asks for deep analysis (like /fix) and always double
 * checks that the pull request description lists every issue.
 */
const REPOSITORY_MODE_ARGV_OVERRIDES = Object.freeze({
  'deep-analysis': true,
  deepAnalysis: true,
  'ensure-all-sub-issues-addressed': true,
  ensureAllSubIssuesAddressed: true,
});

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
 * @param {{skipLabels?: string[], includeBotIssues?: boolean}} [params.selection] - which open issues are not work (issue #3176)
 * @returns {Promise<{repository, selected, allIssues, excluded, singleIssue, reuse, totalOpen, skipped, title, body}>}
 */
export async function prepareRepositoryModeIssue({ repository, limit = MAX_SUB_ISSUES_PER_PARENT, run = runCommand, selection = {} }) {
  const entries = await fetchOpenIssues({ repository, run });
  const { selected, totalOpen: eligibleOpen, skipped, excluded } = selectOldestOpenIssues(entries, { ...selection, limit });
  // GitHub caps native attachments, not the requested scope of the single PR.
  const allIssues = selectOldestOpenIssues(entries, { ...selection, limit: Number.MAX_SAFE_INTEGER }).selected;
  // Issue #3176: status pages and other skipped issues are still open issues of
  // the repository, so they are counted, but they are never requested.
  const totalOpen = eligibleOpen + excluded.length;
  // Issue #3684: the open combined issue of an earlier run, if any, is reused.
  const reuse = selectReusableRepositoryModeIssue({ candidates: findRepositoryModeIssues(entries), issues: allIssues });
  // The reused combined issue does not list itself as an issue left out.
  const excludedIssues = reuse ? excluded.filter(issue => issue.number !== reuse.issue.number) : excluded;

  return {
    repository,
    selected,
    allIssues,
    excluded,
    totalOpen,
    skipped: 0,
    unattachedCount: skipped,
    limit,
    // Issue #3108: set when the repository has exactly one open issue to work
    // on — unless a combined issue already requires it (issue #3684).
    singleIssue: reuse ? null : selectSingleIssueTarget({ repository, issues: allIssues }),
    reuse,
    title: buildCombinedIssueTitle({ owner: repository.owner, repo: repository.repo, count: allIssues.length, totalOpen: eligibleOpen }),
    body: buildCombinedIssueBody({ repository, issues: allIssues, totalOpen: totalOpen - (excluded.length - excludedIssues.length), limit, attachmentCount: selected.length, excludedIssues }),
  };
}

/**
 * Whether GitHub rejected a sub-issue because it already has a parent
 * ("Sub issue may only have one parent", HTTP 422).
 *
 * @param {Error|string} error
 * @returns {boolean}
 */
export function isAlreadyHasParentError(error) {
  const message = String(error?.message || error || '');
  return /may only have one parent|already has a parent/i.test(message);
}

/**
 * Decide whether an issue may be moved away from its current parent.
 *
 * Issue #2306: every earlier `/solve <repository-url>` run leaves its combined
 * issue as the parent of the issues it listed. When the pull request did not
 * close them, the next run could not attach them again. A closed parent, or a
 * combined issue generated by repository mode, is a leftover of such a run and
 * is replaced. An open parent written by a person is kept: moving the issue
 * would silently rewrite that person's issue hierarchy.
 *
 * @param {{state?: string, body?: string}|null} parent
 * @returns {boolean}
 */
export function shouldReplaceSubIssueParent(parent) {
  if (!parent || typeof parent !== 'object') return false;
  return String(parent.state || '').toLowerCase() === 'closed' || isRepositoryModeIssueBody(parent.body);
}

/**
 * Read the current parent of an issue.
 *
 * @returns {Promise<{number: number, state: string, body: string, html_url: string}|null>}
 */
async function fetchParentIssue({ issue, run }) {
  const output = await commandOutput(run, 'gh', buildParentIssueApiArgs(issue));
  const parsed = JSON.parse(output || 'null');
  return parsed && typeof parsed === 'object' ? parsed : null;
}

/**
 * Attach the selected issues to the combined issue as GitHub native sub-issues.
 *
 * An issue that already has a parent is moved to the combined issue when that
 * parent is a leftover of an earlier run (see {@link shouldReplaceSubIssueParent}).
 * Every other failure is non-fatal and reported: losing the whole run over one
 * issue would be worse than solving the rest. The issue is still listed in the
 * combined issue body either way, and the body's required closing references
 * are checked before an automatic merge (issue #2306).
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
 * @returns {Promise<{attached: Array<object>, failed: Array<{issue: object, error: string, currentParent?: object}>, moved: Array<{issue: object, previousParent: object}>}>}
 */
export async function attachSubIssues({ parentIssue, issues, run = runCommand, log = null, delayMs = SUB_ISSUE_ATTACH_DELAY_MS, maxAttempts = SUB_ISSUE_ATTACH_MAX_ATTEMPTS, sleep = defaultSleep }) {
  const attached = [];
  const failed = [];
  const moved = [];
  const list = Array.isArray(issues) ? issues : [];

  for (let index = 0; index < list.length; index++) {
    const issue = list[index];
    if (index > 0 && delayMs > 0) await sleep(delayMs);

    let lastError = null;
    let replaceParent = false;
    let currentParent = null;
    let alreadyAttached = false;
    // The parent replacement gets one extra attempt on top of the rate-limit budget.
    for (let attempt = 1; attempt <= Math.max(1, maxAttempts) + (replaceParent ? 1 : 0); attempt++) {
      try {
        if (!Number.isInteger(issue.id) || issue.id <= 0) {
          throw new Error(`missing REST id for issue #${issue.number}`);
        }
        await commandOutput(run, 'gh', buildAddSubIssueApiArgs({ parentIssue, subIssueId: issue.id, replaceParent }));
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        // Issue #2306: "Sub issue may only have one parent". Waiting does not
        // help, but moving the issue away from a stale parent does — once.
        if (!replaceParent && isAlreadyHasParentError(error)) {
          try {
            currentParent = await fetchParentIssue({ issue: { owner: parentIssue.owner, repo: parentIssue.repo, number: issue.number }, run });
          } catch (parentError) {
            await log?.(`   ⚠️  Could not read the current parent of #${issue.number}: ${String(parentError?.message || parentError).split('\n')[0]}`);
          }
          // Issue #3684: already attached to this very parent — nothing to do.
          if (currentParent && Number(currentParent.number) === Number(parentIssue.number)) {
            lastError = null;
            alreadyAttached = true;
            break;
          }
          if (shouldReplaceSubIssueParent(currentParent)) {
            replaceParent = true;
            await log?.(`   🔀 #${issue.number} is still a sub-issue of #${currentParent.number} (${currentParent.state}, left over from an earlier run); moving it to #${parentIssue.number}...`);
            continue;
          }
          break;
        }
        // Only rate limits are worth retrying: other errors would fail
        // identically however long we wait.
        if (attempt >= Math.max(1, maxAttempts) || !isRateLimitError(error)) break;
        const waitMs = SUB_ISSUE_ATTACH_BACKOFF_MS[Math.min(attempt - 1, SUB_ISSUE_ATTACH_BACKOFF_MS.length - 1)];
        await log?.(`   ⏳ Rate limited while attaching #${issue.number}; retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts})...`);
        await sleep(waitMs);
      }
    }

    if (lastError) {
      const message = lastError?.message ? String(lastError.message).split('\n')[0] : String(lastError);
      failed.push({ issue, error: message, ...(currentParent ? { currentParent: { number: currentParent.number, state: currentParent.state, url: currentParent.html_url } } : {}) });
      await log?.(`   ⚠️  Could not attach #${issue.number} as a sub-issue: ${message}`);
      if (currentParent && !replaceParent) {
        await log?.(`      #${issue.number} stays a sub-issue of open issue #${currentParent.number}; it is still required through the closing references listed in the combined issue.`);
      }
    } else {
      attached.push(issue);
      if (alreadyAttached) await log?.(`   ✔️  #${issue.number} is already a sub-issue of #${parentIssue.number}`);
      if (replaceParent) moved.push({ issue, previousParent: { number: currentParent.number, state: currentParent.state, url: currentParent.html_url } });
    }
  }

  return { attached, failed, moved };
}

/**
 * Create the combined issue and attach the sub-issues.
 *
 * @param {object} params
 * @returns {Promise<{owner, repo, number, url, prepared, attached, failed}>}
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

  return { ...issue, prepared, attached, failed, moved };
}

/**
 * Numbers of the issues already attached to `parentIssue` as sub-issues.
 *
 * Returns null when they cannot be read: the caller then attaches every issue,
 * and {@link attachSubIssues} still recognizes the ones already attached.
 *
 * @returns {Promise<Set<number>|null>}
 */
export async function fetchSubIssueNumbers({ parentIssue, run = runCommand }) {
  const output = await commandOutput(run, 'gh', buildListSubIssuesApiArgs(parentIssue));
  const pages = JSON.parse(output || '[]');
  if (!Array.isArray(pages)) return null;
  const entries = pages.flatMap(page => (Array.isArray(page) ? page : [page]));
  return new Set(entries.map(entry => Number(entry?.number)).filter(number => Number.isInteger(number) && number > 0));
}

/**
 * Update the title and body of a reused combined issue to the current scope.
 *
 * @returns {Promise<void>}
 */
async function updateCombinedIssue({ repository, number, title, body, run }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mind-repository-mode-'));
  const bodyFile = path.join(tempDir, 'body.md');
  try {
    await writeSanitizedPublicationFile(bodyFile, body);
    const safeTitle = await sanitizeForPublication(title);
    await commandOutput(run, 'gh', ['issue', 'edit', String(number), '--repo', repository.fullName, '--title', safeTitle, '--body-file', bodyFile]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Reuse the open combined issue of an earlier run (issue #3684).
 *
 * Nothing is done twice: the issue is edited only when issues were opened
 * after it was written, and only the issues that are not its sub-issues yet are
 * attached.
 *
 * @param {object} params
 * @returns {Promise<{owner, repo, number, url, prepared, reused: true, updated: boolean, attached, failed, moved, alreadyAttached: number}>}
 */
export async function reuseRepositoryModeIssue({ repository, prepared, run = runCommand, log = null, attachOptions = {} }) {
  const { issue: existing, covers, missing } = prepared.reuse;
  const parentIssue = { owner: repository.owner, repo: repository.repo, number: existing.number };

  let updated = false;
  if (!covers) {
    await log?.(`   🔄 #${existing.number} does not require ${missing.map(number => `#${number}`).join(', ')} yet; updating its scope instead of creating another combined issue...`);
    await updateCombinedIssue({ repository, number: existing.number, title: prepared.title, body: prepared.body, run });
    updated = true;
  }

  let attachedNumbers = null;
  try {
    attachedNumbers = await fetchSubIssueNumbers({ parentIssue, run });
  } catch (error) {
    await log?.(`   ⚠️  Could not list the sub-issues of #${existing.number}: ${String(error?.message || error).split('\n')[0]}`);
  }
  const toAttach = attachedNumbers ? prepared.selected.filter(issue => !attachedNumbers.has(issue.number)) : prepared.selected;
  const alreadyAttached = prepared.selected.length - toAttach.length;
  if (toAttach.length > 0) {
    await log?.(`   Attaching ${toAttach.length} issue(s) that are not sub-issues of #${existing.number} yet (${alreadyAttached} already are)...`);
  }
  const { attached, failed, moved } = await attachSubIssues({ parentIssue, issues: toAttach, run, log, ...attachOptions });

  return { owner: repository.owner, repo: repository.repo, number: existing.number, url: existing.url || `${repository.url}/issues/${existing.number}`, prepared, reused: true, updated, attached, failed, moved, alreadyAttached };
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
 * @param {{skipLabels?: string[], includeBotIssues?: boolean}} [params.selection] - forwarded to {@link prepareRepositoryModeIssue}
 * @returns {Promise<{handled: boolean, issueUrl?: string, issue?: object, prepared?: object, argvOverrides?: object, noWork?: boolean, singleIssue?: boolean, reused?: boolean, message?: string, error?: string}>}
 */
export async function resolveRepositoryModeTarget({ url, log = null, run = runCommand, limit = MAX_SUB_ISSUES_PER_PARENT, dryRun = false, attachOptions = {}, selection = {} }) {
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
    prepared = await prepareRepositoryModeIssue({ repository, limit, run, selection });
  } catch (error) {
    return { handled: true, error: `Could not list open issues of ${repository.fullName}: ${error.message}` };
  }

  // Issue #3176: say which open issues are not work and why, before anything
  // is created, so the scope stays reviewable in the log.
  if (prepared.excluded.length > 0) {
    await emit(`   Skipping ${prepared.excluded.length} open issue(s) that are not work (use --include-bot-issues or --skip-issue-labels to change this):`);
    for (const issue of prepared.excluded) await emit(`     #${issue.number} ${issue.title} — ${issue.reason}`);
  }

  // Issue #3108: a combined issue around a single issue would only duplicate
  // it (one parent, one sub-issue). Solve that issue directly instead — the
  // same as if its URL had been given — and create nothing.
  if (prepared.singleIssue) {
    await emit(`🎯 Only one open issue: #${prepared.singleIssue.number}. Solving it directly, without creating a combined issue.`);
    await emit(`   Issue URL: ${prepared.singleIssue.url}`);
    await emit('');
    return { handled: true, singleIssue: true, issueUrl: prepared.singleIssue.url, prepared, argvOverrides: {} };
  }

  for (const line of buildRepositoryModeSummaryLines({ totalOpen: prepared.totalOpen, requestedCount: prepared.allIssues.length, selectedCount: prepared.selected.length, skipped: prepared.skipped, limit, excludedCount: prepared.excluded.length })) {
    await emit(line);
  }

  if (prepared.selected.length === 0) {
    const message = prepared.excluded.length > 0 ? `${repository.fullName} has no open issues to work on (skipped as not work: ${prepared.excluded.map(issue => `#${issue.number}`).join(', ')}). Nothing to do.` : `${repository.fullName} has no open issues. Nothing to do.`;
    await emit(`ℹ️  ${message}`);
    return { handled: true, noWork: true, message, prepared };
  }

  if (dryRun) {
    return { handled: true, dryRun: true, prepared };
  }

  if (prepared.reuse) {
    // Issue #3684: a rerun or a kill recovery replays the repository URL; it
    // must land on the combined issue the first run created, not on a new one.
    const { issue: existing, covers } = prepared.reuse;
    await emit('');
    await emit(`♻️  Reusing the open combined issue #${existing.number} of an earlier run${covers ? ': it already requires every open issue' : ''}. No new combined issue is created.`);
    let issue;
    try {
      issue = await reuseRepositoryModeIssue({ repository, prepared, run, log: emit, attachOptions });
    } catch (error) {
      return { handled: true, error: `Could not update the combined issue #${existing.number} in ${repository.fullName}: ${error.message}` };
    }
    await emit(`✅ Reused combined issue: ${issue.url}${issue.updated ? ' (scope updated)' : ''}`);
    await emit(`   Sub-issues: ${issue.alreadyAttached} already attached, ${issue.attached.length} attached now${issue.failed.length > 0 ? `, ${issue.failed.length} could not be attached` : ''}`);
    if (issue.failed.length > 0) {
      await emit(`   Not attached, still required by the closing references in the issue body: ${issue.failed.map(entry => `#${entry.issue.number}`).join(', ')}`);
    }
    await emit('   Continuing with the normal /solve flow for that issue (an existing pull request is continued).');
    await emit('');
    return { handled: true, reused: true, issueUrl: issue.url, issue, prepared, argvOverrides: { ...REPOSITORY_MODE_ARGV_OVERRIDES } };
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
  await emit(`   Sub-issues attached: ${issue.attached.length}/${prepared.selected.length}${issue.moved?.length > 0 ? ` (${issue.moved.length} moved from an earlier parent)` : ''}${issue.failed.length > 0 ? ` (${issue.failed.length} could not be attached)` : ''}`);
  if (issue.failed.length > 0) {
    // Issue #2306: these issues are not native sub-issues, but they are still
    // listed in the combined issue body and are still required to be closed.
    await emit(`   Not attached, still required by the closing references in the issue body: ${issue.failed.map(entry => `#${entry.issue.number}`).join(', ')}`);
  }
  await emit('   Continuing with the normal /solve flow for that issue.');
  await emit('');

  return {
    handled: true,
    issueUrl: issue.url,
    issue,
    prepared,
    argvOverrides: { ...REPOSITORY_MODE_ARGV_OVERRIDES },
  };
}

export default {
  REPOSITORY_MODE_ISSUE_LABELS,
  SUB_ISSUE_ATTACH_DELAY_MS,
  isAlreadyHasParentError,
  shouldReplaceSubIssueParent,
  parseRepositoryModeUrl,
  fetchOpenIssues,
  prepareRepositoryModeIssue,
  attachSubIssues,
  createRepositoryModeIssue,
  fetchSubIssueNumbers,
  reuseRepositoryModeIssue,
  resolveRepositoryModeTarget,
};
