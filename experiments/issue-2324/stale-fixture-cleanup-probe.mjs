// Exercise the real cleanup script with GitHub API responses and no network.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const repository = 'fixture/task';
const base = 'e2e/hello-world/1/agent-formal-ai';
const head = 'issue-1-fixture';
const mutations = [];
const context = vm.createContext({ console: { log() {} }, process: { env: { GITHUB_REPOSITORY: repository } } });
const api = new vm.SyntheticModule(
  ['ghList', 'ghApi'],
  function () {
    this.setExport('ghList', async endpoint => {
      if (endpoint.includes('/branches?')) return [{ name: base, commit: { sha: 'fixture' } }];
      if (endpoint.includes('/pulls?')) return endpoint.includes('state=all') ? [{ number: 1, state: 'closed', base: { ref: base }, head: { ref: head, repo: { full_name: repository } } }] : [];
      return [];
    });
    this.setExport('ghApi', async (endpoint, options) => {
      if (endpoint.includes('/commits/')) return { commit: { committer: { date: '2000-01-01T00:00:00Z' } } };
      mutations.push({ endpoint, ...options });
      return {};
    });
  },
  { context }
);
const script = new vm.SourceTextModule(readFileSync(new URL('../../scripts/cleanup-task-fixtures.mjs', import.meta.url), 'utf8'), { context });
await script.link(() => api);
await script.evaluate();
console.log(JSON.stringify(mutations));
