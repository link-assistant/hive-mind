/** Token-free fixture isolation. Git trees are created without the host repo. */
import { appendFileSync } from 'node:fs';
import { ghApi, gh } from './github-actions.lib.mjs';
import { isBranchDeletionRuleViolation } from './cleanup-task-fixtures.lib.mjs';

export function fixtureBranch({ kind = 'hello-world', runId, tool, model }) {
  const branch = `e2e/${kind}/${runId}/${tool}-${model}`;
  if (!/^e2e\/[a-z-]+\/[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/.test(branch) || branch.includes('..') || branch.endsWith('.')) throw new Error('Invalid fixture branch components');
  return branch;
}

export async function createBranchFixture({ repository, baseBranch, readme, title, body, label = 'e2e-task', api = ghApi, runGh = gh, onResource = () => {} }) {
  const resource = { repository, baseBranch, branches: [] };
  const root = `repos/${repository}`;
  const blob = await api(`${root}/git/blobs`, { method: 'POST', body: { content: readme, encoding: 'utf-8' } });
  const tree = await api(`${root}/git/trees`, { method: 'POST', body: { tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob.sha }] } });
  const commit = await api(`${root}/git/commits`, { method: 'POST', body: { message: 'Initialize isolated task', tree: tree.sha, parents: [] } });
  await api(`${root}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${baseBranch}`, sha: commit.sha } });
  resource.branches.push(baseBranch);
  onResource(resource);
  for (const name of [label, 'no-formal-ai-draft']) await runGh(['label', 'create', name, '--repo', repository, '--force', '--description', 'Isolated automation fixture']);
  const issue = await api(`${root}/issues`, { method: 'POST', body: { title, body, labels: [label, 'no-formal-ai-draft'] } });
  Object.assign(resource, { issueNumber: issue.number, issueUrl: issue.html_url });
  onResource(resource);
  return resource;
}

/** Every operation is attempted; deletion-rule retention is reported separately. */
export async function cleanupBranchFixture(resource, { api = ghApi, log = console.warn, summaryFile = process.env.GITHUB_STEP_SUMMARY } = {}) {
  const errors = [];
  const retainedBranches = [];
  const root = `repos/${resource.repository}`;
  const operations = [];
  if (resource.pullRequestNumber) operations.push([`${root}/pulls/${resource.pullRequestNumber}`, { method: 'PATCH', body: { state: 'closed' } }]);
  if (resource.issueNumber) operations.push([`${root}/issues/${resource.issueNumber}`, { method: 'PATCH', body: { state: 'closed' } }]);
  for (const branch of [...new Set(resource.branches || [])].reverse()) operations.push([`${root}/git/refs/heads/${branch}`, { method: 'DELETE' }]);
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
