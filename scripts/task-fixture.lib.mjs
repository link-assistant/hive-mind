/** Token-free fixture isolation. Git trees are created without the host repo. */
import { appendFileSync } from 'node:fs';
import { ghApi, gh } from './github-actions.lib.mjs';
import { isBranchDeletionRuleViolation } from './cleanup-task-fixtures.lib.mjs';
import { custodyKey, formatCustodyMarker, parseCustody, parseMarker, FINALIZED_MARKER } from './e2e-task-lifecycle.lib.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const isRefConflict = error => /Reference already exists|\b422\b/.test(String(error?.message));

export function fixtureBranch({ kind = 'hello-world', runId, tool, model }) {
  const branch = `e2e/${kind}/${runId}/${tool}-${model}`;
  if (!/^e2e\/[a-z-]+\/[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/.test(branch) || branch.includes('..') || branch.endsWith('.')) throw new Error('Invalid fixture branch components');
  return branch;
}

/**
 * Create the orphan base branch and its task issue.
 *
 * With `custody` the issue body carries the custody marker and creating the
 * base ref is the lock (issue #3630): a repeated invocation for the same run
 * attempt and row loses the ref race and reuses the issue the first one
 * created instead of opening a duplicate. An already finalized task is never
 * reused, and a ref that does not name this custody is not ours.
 */
export async function createBranchFixture({ repository, baseBranch, readme, title, body, label = 'e2e-task', custody = null, api = ghApi, runGh = gh, list = null, onResource = () => {}, lockWaitMs = 30_000, pollMs = 3_000, wait = sleep }) {
  const resource = { repository, baseBranch, branches: [] };
  const root = `repos/${repository}`;
  const key = custody ? custodyKey(custody) : null;
  // Finalization removes the base ref, so the ref is no lock after it: the
  // closed task itself proves the attempt already ran.
  if (key && list) {
    const prior = await findOwnedTask({ root, key, list });
    if (prior?.finalized) throw new Error(`Task ${key} was already finalized in #${prior.issue.number}; a repeated event does not run it again.`);
  }
  const blob = await api(`${root}/git/blobs`, { method: 'POST', body: { content: readme, encoding: 'utf-8' } });
  const tree = await api(`${root}/git/trees`, { method: 'POST', body: { tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob.sha }] } });
  const message = key ? `Initialize isolated task\n\nE2E-Custody: ${key}` : 'Initialize isolated task';
  const commit = await api(`${root}/git/commits`, { method: 'POST', body: { message, tree: tree.sha, parents: [] } });
  try {
    await api(`${root}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${baseBranch}`, sha: commit.sha } });
  } catch (error) {
    if (!key || !isRefConflict(error)) throw error;
    return adoptBranchFixture({ repository, baseBranch, key, api, list, onResource, lockWaitMs, pollMs, wait, recreate: () => openTaskIssue() });
  }
  resource.branches.push(baseBranch);
  onResource(resource);
  return openTaskIssue();

  async function openTaskIssue() {
    if (!resource.branches.includes(baseBranch)) resource.branches.push(baseBranch);
    for (const name of [label, 'no-formal-ai-draft']) await runGh(['label', 'create', name, '--repo', repository, '--force', '--description', 'Isolated automation fixture']);
    const issueBody = custody ? `${body}\n\n${formatCustodyMarker(custody)}` : body;
    const issue = await api(`${root}/issues`, { method: 'POST', body: { title, body: issueBody, labels: [label, 'no-formal-ai-draft'] } });
    Object.assign(resource, { issueNumber: issue.number, issueUrl: issue.html_url, ...(key ? { custodyKey: key } : {}) });
    onResource(resource);
    return resource;
  }
}

/**
 * The base ref already exists. If it is this custody's (a repeated or
 * concurrent invocation), wait for the first invocation's issue and reuse it;
 * if that invocation was interrupted before opening the issue, open it now.
 */
async function adoptBranchFixture({ repository, baseBranch, key, api, list, onResource, lockWaitMs, pollMs, wait, recreate }) {
  const root = `repos/${repository}`;
  const ref = await api(`${root}/git/ref/heads/${baseBranch}`);
  const head = await api(`${root}/git/commits/${ref.object.sha}`);
  if (!String(head.message).includes(`E2E-Custody: ${key}`)) throw new Error(`Fixture branch ${baseBranch} exists and is not owned by ${key}; refusing to reuse it.`);
  if (!list) throw new Error(`Fixture branch ${baseBranch} already exists for ${key}, and no issue lister was given to find its task.`);
  const deadline = Date.now() + lockWaitMs;
  for (;;) {
    const owned = await findOwnedTask({ root, key, list });
    if (owned) {
      const { issue } = owned;
      if (owned.finalized) throw new Error(`Task ${key} was already finalized in #${issue.number}; a repeated event does not run it again.`);
      const resource = { repository, baseBranch, branches: [baseBranch], issueNumber: issue.number, issueUrl: issue.html_url, custodyKey: key, reused: true };
      onResource(resource);
      return resource;
    }
    if (Date.now() >= deadline) return recreate();
    await wait(pollMs);
  }
}

/** The oldest task issue of a custody, and whether it is already finalized. */
async function findOwnedTask({ root, key, list }) {
  const issues = await list(`${root}/issues?labels=e2e-task&state=all&sort=created&direction=desc&per_page=100`);
  const owned = issues.filter(issue => !issue.pull_request && parseCustody(issue.body) && custodyKey(parseCustody(issue.body)) === key);
  if (!owned.length) return null;
  const issue = owned.reduce((oldest, candidate) => (candidate.number < oldest.number ? candidate : oldest));
  if (issue.state === 'closed') return { issue, finalized: true };
  const comments = await list(`${root}/issues/${issue.number}/comments?per_page=100`);
  return { issue, finalized: comments.some(comment => parseMarker(comment?.body, FINALIZED_MARKER)?.key === key) };
}

/** Every operation is attempted; deletion-rule retention is reported separately. */
export async function cleanupBranchFixture(resource, { api = ghApi, log = console.warn, summaryFile = process.env.GITHUB_STEP_SUMMARY, stateReason = null, keepBranches = false } = {}) {
  const errors = [];
  const retainedBranches = [];
  const root = `repos/${resource.repository}`;
  const operations = [];
  if (resource.pullRequestNumber) operations.push([`${root}/pulls/${resource.pullRequestNumber}`, { method: 'PATCH', body: { state: 'closed' } }]);
  if (resource.issueNumber) operations.push([`${root}/issues/${resource.issueNumber}`, { method: 'PATCH', body: stateReason ? { state: 'closed', state_reason: stateReason } : { state: 'closed' } }]);
  if (!keepBranches) for (const branch of [...new Set(resource.branches || [])].reverse()) operations.push([`${root}/git/refs/heads/${branch}`, { method: 'DELETE' }]);
  for (const [endpoint, options] of operations) {
    try {
      await api(endpoint, options);
    } catch (error) {
      // A branch already removed by solve is successfully cleaned up.
      if (options.method === 'DELETE' && /404|Reference does not exist/.test(error.message)) continue;
      if (options.method === 'DELETE' && isBranchDeletionRuleViolation(error.message)) {
        const branch = endpoint.slice(`${root}/git/refs/heads/`.length);
        retainedBranches.push(branch);
        const message = `Fixture branch ${branch} retained by a repository rule that prohibits deletion. Removing it requires a ruleset exclusion, or a bypass for the cleanup token, that covers disposable branches; the scheduled cleanup deletes it once the rule allows it.`;
        log(`::warning::${message}`);
        if (summaryFile) appendFileSync(summaryFile, `${message}\n\n`);
        continue;
      }
      errors.push(`${endpoint}: ${error.message}`);
    }
  }
  return { errors, retainedBranches };
}
