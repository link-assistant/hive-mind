/** Token-free fixture isolation. Git trees are created without the host repo. */
import { ghApi, gh } from './github-actions.lib.mjs';

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

/** Every operation is attempted even if an earlier cleanup request fails. */
export async function cleanupBranchFixture(resource, { api = ghApi } = {}) {
  const errors = [];
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
      errors.push(`${endpoint}: ${error.message}`);
    }
  }
  return errors;
}
