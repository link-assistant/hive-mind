/**
 * Custody and terminal finalization of real E2E task issues (issue #3630).
 *
 * Formal AI's three-client delivery ran the row runner with `--keep` on every
 * pull request push and never closed what it created: 78 open `e2e-task`
 * issues. The sweep that should have caught leaks closed every open
 * `e2e-task` issue older than a day, which is closing by label and age alone.
 *
 * Every task issue now carries a hidden custody marker naming the workflow,
 * run, attempt, source and task that own it. Only the owner, or a sweep that
 * has proved the owning run attempt is over, finalizes it: one outcome
 * comment with the run reference, then the issue and its pull request are
 * closed. Every step is idempotent, so an interrupted finalization is resumed
 * by running it again.
 */

export const CUSTODY_MARKER = 'hive-mind:e2e-custody';
export const FINALIZED_MARKER = 'hive-mind:e2e-finalized';
export const E2E_OUTCOMES = Object.freeze(['passed', 'failed', 'harness-failed', 'cancelled', 'interrupted']);
const ACTIVE_RUN_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);
// A legacy fixture base branch: e2e/<kind>/<runId>[-<attempt>]/<task>.
const FIXTURE_BASE = /^e2e\/(hello-world|integration)\/(\d+)(?:-(\d+))?\/([A-Za-z0-9._-]+)$/;

/** A marker value is JSON inside an HTML comment, so `<` and `>` are escaped. */
const encodeMarker = (marker, value) => `<!-- ${marker} ${JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')} -->`;

/**
 * The value of the first `marker` comment in `text`, or null.
 *
 * @param {string} text
 * @param {string} marker
 * @returns {object|null}
 */
export function parseMarker(text, marker) {
  const match = String(text ?? '').match(new RegExp(`<!-- ${escapeRegExp(marker)} (\\{.*?\\}) -->`));
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]);
    return value && typeof value === 'object' && value.v === 1 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Who owns a task: the workflow run attempt that creates it and the source it tests.
 *
 * @param {object} options
 * @param {string} options.repository where the task issue lives
 * @param {string} options.task matrix row, e.g. `codex-formal-ai`
 * @param {string} [options.baseBranch] the owned orphan base branch
 * @param {string} [options.kind]
 * @param {Record<string,string|undefined>} [options.env]
 */
export function buildCustody({ repository, task, baseBranch = null, kind = 'hello-world', env = process.env }) {
  return {
    v: 1,
    kind,
    repository,
    task,
    baseBranch,
    workflow: env.GITHUB_WORKFLOW_REF || env.GITHUB_WORKFLOW || null,
    serverUrl: env.GITHUB_SERVER_URL || 'https://github.com',
    sourceRepository: env.GITHUB_REPOSITORY || repository,
    runId: env.GITHUB_RUN_ID || null,
    runAttempt: String(env.GITHUB_RUN_ATTEMPT || '1'),
    sourceSha: env.E2E_SOURCE_SHA || env.GITHUB_SHA || null,
  };
}

export const formatCustodyMarker = custody => encodeMarker(CUSTODY_MARKER, custody);
export const parseCustody = body => parseMarker(body, CUSTODY_MARKER);
/** One task per run attempt and row; a second invocation reuses it. */
export const custodyKey = custody => `${custody.repository}/${custody.runId}/${custody.runAttempt}/${custody.task}`;

/** The run attempt page that owns a task. */
export function custodyRunUrl(custody) {
  if (!custody?.runId || !custody.sourceRepository) return null;
  const attempt = custody.runAttempt && custody.runAttempt !== '1' ? `/attempts/${custody.runAttempt}` : '';
  return `${custody.serverUrl || 'https://github.com'}/${custody.sourceRepository}/actions/runs/${custody.runId}${attempt}`;
}

/**
 * The terminal outcome of a row.
 *
 * `jobStatus` is `${{ job.status }}` of the finalize step: a later step that
 * failed (Formal AI's independent checker) turns a passing row into `failed`.
 *
 * @param {object} options
 * @param {object|null} options.evidence result.json of the row runner
 * @param {string} [options.jobStatus] success | failure | cancelled
 * @returns {string} one of E2E_OUTCOMES
 */
export function deriveOutcome({ evidence, jobStatus } = {}) {
  if (jobStatus === 'cancelled' || evidence?.cancelled) return 'cancelled';
  if (!evidence?.finishedAt) return 'interrupted';
  if (evidence.verdict?.harness === false) return 'harness-failed';
  if (!evidence.passed || jobStatus === 'failure') return 'failed';
  return 'passed';
}

const OUTCOME_TEXT = {
  passed: '✅ passed',
  failed: '❌ failed',
  'harness-failed': '⚠️ harness failed',
  cancelled: '🚫 cancelled',
  interrupted: '⏹️ interrupted',
};

/**
 * The outcome comment. It names the run attempt, the tested source and where
 * the evidence is, so a closed task always says why it was closed.
 */
export function formatFinalization({ custody, outcome, key, details = [], artifact = null, pullRequestNumber = null, finalizer = null }) {
  const runUrl = custodyRunUrl(custody);
  const lines = [encodeMarker(FINALIZED_MARKER, { v: 1, key, outcome, runId: custody?.runId ?? null, runAttempt: custody?.runAttempt ?? null }), `## Hive Mind E2E task finalized: ${OUTCOME_TEXT[outcome] || outcome}`, '', '| | |', '|---|---|', `| Outcome | \`${outcome}\` |`, `| Run | ${runUrl ? `[${custody.runId} attempt ${custody.runAttempt}](${runUrl})` : 'unknown'} |`, `| Source | ${custody?.sourceSha ? `\`${custody.sourceRepository}@${custody.sourceSha}\`` : 'unknown'} |`, `| Task | \`${custody?.task || 'unknown'}\` |`];
  if (pullRequestNumber) lines.push(`| Pull request | #${pullRequestNumber} |`);
  if (artifact) lines.push(`| Evidence | artifact \`${artifact}\` of the run |`);
  if (finalizer) lines.push(`| Finalized by | ${finalizer} |`);
  const shown = details.filter(Boolean).slice(0, 10);
  if (shown.length) lines.push('', ...shown.map(detail => `- ${String(detail).replace(/\s+/g, ' ')}`));
  lines.push('', 'This issue was created by an automated end-to-end test and is closed by its owner. It is not a feature request.');
  return lines.join('\n');
}

const isNotFound = error => /\b404\b|Not Found/i.test(String(error?.message));

/**
 * Find the pull request solve opened for an owned issue: its head is
 * `issue-<n>-…`, and its base is the owned orphan branch when there is one.
 */
export async function discoverTaskPullRequest({ repository, issueNumber, baseBranch, list }) {
  const query = baseBranch ? `&base=${encodeURIComponent(baseBranch)}` : '';
  const pulls = await list(`repos/${repository}/pulls?state=all&per_page=100${query}`);
  const prefix = `issue-${issueNumber}-`;
  const owned = pulls.filter(pr => String(pr?.head?.ref || '').startsWith(prefix) && (!baseBranch || pr?.base?.ref === baseBranch));
  return owned.reduce((newest, pr) => (!newest || pr.number > newest.number ? pr : newest), null);
}

/**
 * Comment once, close the pull request and the issue, then remove owned
 * branches unless they are kept. Safe to repeat: an existing outcome comment
 * for the same key is reused and closed resources are left alone.
 *
 * The issue is only closed after the outcome comment exists, so a closed task
 * always carries its run reference; a failure leaves it open for the sweep.
 *
 * @returns {Promise<{errors: string[], retainedBranches: string[], actions: string[], pullRequestNumber: number|null}>}
 */
export async function finalizeE2eTask({ resource, custody, outcome, details = [], artifact = null, keepBranches = false, finalizer = null, api, list, cleanup }) {
  if (!E2E_OUTCOMES.includes(outcome)) throw new Error(`Unknown E2E outcome: ${outcome}`);
  const errors = [];
  const actions = [];
  const root = `repos/${resource.repository}`;
  const key = custody ? custodyKey(custody) : `${resource.repository}#${resource.issueNumber}`;
  const branches = [...new Set(resource.branches || [])];
  // `null` means the caller already knows there is no open pull request left.
  let pullRequestNumber = resource.pullRequestNumber || null;
  if (resource.pullRequestNumber === undefined && resource.issueNumber) {
    try {
      const found = await discoverTaskPullRequest({ repository: resource.repository, issueNumber: resource.issueNumber, baseBranch: custody?.baseBranch || resource.baseBranch, list });
      if (found) {
        if (found.state !== 'closed') pullRequestNumber = found.number;
        if (found.head?.repo?.full_name === resource.repository || !found.head?.repo) branches.push(found.head.ref);
      }
    } catch (error) {
      errors.push(`discover pull request: ${error.message}`);
    }
  }
  let commented = false;
  if (resource.issueNumber) {
    try {
      const comments = await list(`${root}/issues/${resource.issueNumber}/comments?per_page=100`);
      if (comments.some(comment => parseMarker(comment?.body, FINALIZED_MARKER)?.key === key)) actions.push('outcome comment reused');
      else {
        await api(`${root}/issues/${resource.issueNumber}/comments`, { method: 'POST', body: { body: formatFinalization({ custody, outcome, key, details, artifact, pullRequestNumber, finalizer }) } });
        actions.push('outcome comment posted');
      }
      commented = true;
    } catch (error) {
      errors.push(`outcome comment on #${resource.issueNumber}: ${error.message}`);
    }
  }
  const closeIfOpen = async (kind, number, body) => {
    try {
      const current = await api(`${root}/${kind}/${number}`);
      if (current?.state === 'closed') return actions.push(`${kind} #${number} already closed`);
      await api(`${root}/${kind}/${number}`, { method: 'PATCH', body });
      actions.push(`${kind} #${number} closed`);
    } catch (error) {
      if (isNotFound(error)) return actions.push(`${kind} #${number} not found`);
      errors.push(`close ${kind} #${number}: ${error.message}`);
    }
  };
  if (pullRequestNumber) await closeIfOpen('pulls', pullRequestNumber, { state: 'closed' });
  if (resource.issueNumber) {
    if (commented) await closeIfOpen('issues', resource.issueNumber, { state: 'closed', state_reason: outcome === 'passed' ? 'completed' : 'not_planned' });
    else errors.push(`issue #${resource.issueNumber} left open: it is closed only with its outcome comment`);
  }
  let retainedBranches = [];
  if (!keepBranches && branches.length && cleanup) {
    const removed = await cleanup({ repository: resource.repository, branches });
    errors.push(...removed.errors);
    retainedBranches = removed.retainedBranches;
  }
  return { errors, retainedBranches, actions, pullRequestNumber };
}

/**
 * Prove a task issue's run attempt is over before anything else touches it.
 *
 * Three proofs name the owning run, strongest first:
 * - custody: the issue's marker (every task created since #3630);
 * - pull request: solve's pull request, head `issue-<n>-…`, targets an owned
 *   fixture base `e2e/<kind>/<runId>[-<attempt>]/<task>`;
 * - job log: a completed job of a run that created a fixture branch just
 *   before the issue prints the issue's URL (a task cancelled before solve
 *   opened a pull request).
 * The owning attempt must then be over. Anything else is unproven and kept:
 * the `e2e-task` label, a title or an age prove nothing.
 *
 * @returns {Promise<{state: 'finalize'|'active'|'unproven', reason: string, custody?: object, run?: object, jobs?: object[], outcome?: string, resource?: object}>}
 */
export async function proveTaskCustody({ repository, issue, pulls = [], fixtures = [], api, readJobLog = null }) {
  const custody = parseCustody(issue.body);
  const prefix = `issue-${issue.number}-`;
  const pullRequest = newest(pulls.filter(pr => String(pr?.head?.ref || '').startsWith(prefix) && (!custody?.baseBranch || pr.base?.ref === custody.baseBranch)));
  if (custody) {
    if (custody.repository !== repository) return { state: 'unproven', reason: `custody marker names ${custody.repository}` };
    return settle({ owner: custody, proof: 'custody marker', pullRequest, repository, issue, api });
  }
  const match = pullRequest && String(pullRequest.base?.ref || '').match(FIXTURE_BASE);
  if (match && (!pullRequest.head?.repo || pullRequest.head.repo.full_name === repository)) {
    return settle({ owner: legacyOwner(repository, pullRequest.base.ref), proof: `pull request #${pullRequest.number} from owned fixture ${pullRequest.base.ref}`, pullRequest, repository, issue, api });
  }
  if (readJobLog) {
    const created = Date.parse(issue.created_at);
    const candidates = fixtures.filter(fixture => FIXTURE_BASE.test(fixture.name) && Date.parse(fixture.date) <= created + 60_000 && Date.parse(fixture.date) >= created - 3_600_000);
    const url = new RegExp(`/${escapeRegExp(repository)}/issues/${issue.number}(?!\\d)`);
    let active = null;
    for (const runId of [...new Set(candidates.map(fixture => fixtureBranchRunId(fixture.name)))]) {
      const run = await api(`repos/${repository}/actions/runs/${runId}`).catch(() => null);
      if (isRunActive(run)) active = run;
      if (run?.status !== 'completed') continue;
      for (const job of await runJobs({ repository, runId, attempt: run.run_attempt, api })) {
        const text = await readJobLog(repository, job.id).catch(() => '');
        if (!url.test(text)) continue;
        const fixture = candidates.find(candidate => fixtureBranchRunId(candidate.name) === runId && jobMatchesTask(job, fixtureTask(candidate.name)));
        if (!fixture) return { state: 'unproven', reason: `job ${job.name} of run ${runId} names the issue but no fixture branch of that run matches it` };
        const jobs = (await runJobs({ repository, runId, attempt: run.run_attempt, api })).filter(candidate => jobMatchesTask(candidate, fixtureTask(fixture.name)));
        return finalizeState({ owner: legacyOwner(repository, fixture.name), proof: `log of job "${job.name}" in run ${runId} names this issue`, run, jobs, repository, issue, pullRequest: null });
      }
    }
    if (active) return { state: 'active', reason: `run ${active.id} that created a fixture just before the issue is ${active.status}` };
  }
  return { state: 'unproven', reason: 'no custody marker, no pull request from an owned fixture branch and no owning job log' };
}

const newest = items => items.reduce((best, item) => (!best || item.number > best.number ? item : best), null);
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fixtureTask = branch => String(branch).match(FIXTURE_BASE)?.[4] ?? null;

function legacyOwner(repository, baseBranch) {
  const [, kind, runId, attempt, task] = baseBranch.match(FIXTURE_BASE);
  return { v: 1, kind, repository, task, baseBranch, sourceRepository: repository, serverUrl: 'https://github.com', runId, runAttempt: attempt || '1', sourceSha: null, workflow: null, legacy: true };
}

async function settle({ owner, proof, pullRequest, repository, issue, api }) {
  let run;
  try {
    run = await api(`repos/${owner.sourceRepository || repository}/actions/runs/${owner.runId}`);
  } catch (error) {
    return { state: 'unproven', reason: `owning run ${owner.runId} is unreadable: ${error.message}` };
  }
  // A newer attempt of the same run means the owning attempt is over.
  const sameAttempt = String(run?.run_attempt ?? owner.runAttempt) === String(owner.runAttempt);
  if (sameAttempt && isRunActive(run)) return { state: 'active', reason: `owning run ${owner.runId} attempt ${owner.runAttempt} is ${run.status}`, custody: owner };
  if (sameAttempt && run?.status !== 'completed') return { state: 'unproven', reason: `owning run ${owner.runId} reports status ${run?.status ?? 'unknown'}`, custody: owner };
  const jobs = await runJobs({ repository: owner.sourceRepository || repository, runId: owner.runId, attempt: owner.runAttempt, api });
  return finalizeState({ owner, proof, run, jobs: jobs.filter(job => jobMatchesTask(job, owner.task)), repository, issue, pullRequest });
}

function finalizeState({ owner, proof, run, jobs, repository, issue, pullRequest }) {
  const resource = { repository, issueNumber: issue.number, baseBranch: owner.baseBranch, branches: [], pullRequestNumber: pullRequest?.state === 'open' ? pullRequest.number : null };
  return { state: 'finalize', reason: proof, custody: owner, run, jobs, resource, outcome: outcomeFromJobs(jobs, run) };
}

async function runJobs({ repository, runId, attempt, api }) {
  const endpoint = attempt ? `repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100` : `repos/${repository}/actions/runs/${runId}/jobs?per_page=100`;
  const answer = await api(endpoint).catch(() => null);
  return Array.isArray(answer?.jobs) ? answer.jobs : [];
}

/** A row job names its tool, and its model when two rows share a tool. */
export function jobMatchesTask(job, task) {
  const [tool, ...rest] = String(task || '').split('-');
  const name = String(job?.name || '');
  if (!tool || !new RegExp(`\\b${escapeRegExp(tool)}\\b`).test(name)) return false;
  const model = rest.join('-');
  return !/[,(]/.test(name) || !model || name.includes(model);
}

/**
 * The outcome a sweep records: the conclusions of the owning row's jobs (the
 * delivery job and any independent verification job of the same row). Any
 * failure fails it, any cancellation cancels it, and it passes only when every
 * matching job succeeded. Without a matching completed job the task is
 * `interrupted`: it ended unfinalized and nothing proves how it went.
 */
export function outcomeFromJobs(jobs, run) {
  const conclusions = jobs.map(job => (job?.status === 'completed' ? job.conclusion : null));
  if (!jobs.length) return run?.conclusion === 'cancelled' ? 'cancelled' : 'interrupted';
  if (conclusions.includes('failure') || conclusions.includes('timed_out')) return 'failed';
  if (conclusions.includes('cancelled')) return 'cancelled';
  if (conclusions.every(conclusion => conclusion === 'success')) return 'passed';
  return 'interrupted';
}

/** The run is still running, so its branches and tasks are not stale yet. */
export const isRunActive = run => ACTIVE_RUN_STATUSES.has(run?.status);
export const fixtureBranchRunId = branch => String(branch).match(FIXTURE_BASE)?.[2] ?? null;
