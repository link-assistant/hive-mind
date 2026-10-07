// Exercise the real cleanup logic with GitHub API responses and no network.
import { cleanupStaleFixtures } from '../../scripts/cleanup-task-fixtures.lib.mjs';
const repository = 'fixture/task';
const base = 'e2e/hello-world/1/agent-formal-ai';
const head = 'issue-1-fixture';
const mutations = [];
await cleanupStaleFixtures({
  repository,
  log() {},
  warn() {},
  list: async endpoint => {
    if (endpoint.includes('/branches?')) return [{ name: base, commit: { sha: 'fixture' } }];
    if (endpoint.includes('/pulls?')) return endpoint.includes('state=all') ? [{ number: 1, state: 'closed', base: { ref: base }, head: { ref: head, repo: { full_name: repository } } }] : [];
    return [];
  },
  api: async (endpoint, options) => {
    if (endpoint.includes('/commits/')) return { commit: { committer: { date: '2000-01-01T00:00:00Z' } } };
    if (endpoint.includes('/rules/branches/')) return [];
    mutations.push({ endpoint, ...options });
    return {};
  },
});
console.log(JSON.stringify(mutations));
