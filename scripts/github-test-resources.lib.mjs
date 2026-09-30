/** Shared orphan-branch fixtures for the default GitHub token (issue #2323). */
import { randomUUID } from 'node:crypto';
import { githubApi, githubList } from './github-api.lib.mjs';

export const TEST_RESOURCE_MARKER = 'hive-mind-test:';
export const isTestBranch = name => /^(?:e2e|integration)\/.+/.test(name || '');

/** Create a repository when allowed, otherwise an orphan base here. */
export async function createGithubTestFixture({ api = githubApi, repository = process.env.GITHUB_REPOSITORY, canCreateRepositories = false, kind = 'integration', title = 'Test feedback lines feature', body = 'This issue tests comment detection in solve.mjs.', createPullRequest = true } = {}) {
  if (!['integration', 'e2e'].includes(kind)) throw new Error('unknown test fixture kind');
  const id = `${Date.now()}-${randomUUID()}`;
  const fixture = { repository, branches: [], prefix: `${kind}/${id}`, createdRepository: false, discoverPullRequests: !createPullRequest };
  try {
    if (canCreateRepositories) {
      const owner = repository?.split('/')[0] || (await api('user')).login;
      const account = await api(`users/${owner}`);
      const endpoint = account.type === 'Organization' ? `orgs/${owner}/repos` : 'user/repos';
      const repo = await api(endpoint, { method: 'POST', body: { name: `test-feedback-lines-${id}`, private: false, auto_init: true, description: 'Automated feedback integration fixture' } });
      fixture.repository = repo.full_name || `${owner}/test-feedback-lines-${id}`;
      fixture.createdRepository = true;
      fixture.defaultBranch = repo.default_branch || 'main';
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(fixture.repository || '')) throw new Error('a GitHub test fixture needs GITHUB_REPOSITORY');
    const root = `repos/${fixture.repository}`;
    fixture.baseBranch = fixture.createdRepository ? fixture.defaultBranch : `${fixture.prefix}/base`;
    fixture.headBranch = `${fixture.prefix}/head`;
    const tree = await api(`${root}/git/trees`, { method: 'POST', body: { tree: [{ path: 'README.md', mode: '100644', type: 'blob', content: '# Isolated test fixture\n' }] } });
    const commit = await api(`${root}/git/commits`, { method: 'POST', body: { message: `Test fixture ${fixture.prefix}`, tree: tree.sha, parents: [] } });
    fixture.baseSha = commit.sha;
    if (fixture.createdRepository) {
      await api(`${root}/git/refs/heads/${fixture.baseBranch}`, { method: 'PATCH', body: { sha: commit.sha, force: true } });
    } else {
      await api(`${root}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${fixture.baseBranch}`, sha: commit.sha } });
    }
    fixture.branches.push(fixture.baseBranch);

    // The opt-out label must exist before issues:opened is delivered for PATs.
    try {
      await api(`${root}/labels/no-formal-ai-draft`);
    } catch (error) {
      if (!/404|Not Found/i.test(error.message)) throw error;
      try {
        await api(`${root}/labels`, { method: 'POST', body: { name: 'no-formal-ai-draft', color: 'ededed' } });
      } catch (createError) {
        // Concurrent fixtures can create this shared label at the same time.
        if (!/already_exists|already exists/i.test(createError.message)) throw createError;
      }
    }
    const issue = await api(`${root}/issues`, { method: 'POST', body: { title, body: `${body}\n\n<!-- ${TEST_RESOURCE_MARKER} ${fixture.prefix} -->`, labels: ['no-formal-ai-draft'] } });
    fixture.issueNumber = issue.number;
    fixture.issueUrl = issue.html_url;
    if (createPullRequest) {
      const headTree = await api(`${root}/git/trees`, { method: 'POST', body: { base_tree: tree.sha, tree: [{ path: 'feedback.txt', mode: '100644', type: 'blob', content: 'Feedback integration test\n' }] } });
      const head = await api(`${root}/git/commits`, { method: 'POST', body: { message: 'Add feedback fixture', tree: headTree.sha, parents: [commit.sha] } });
      await api(`${root}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${fixture.headBranch}`, sha: head.sha } });
      fixture.branches.push(fixture.headBranch);
      const pr = await api(`${root}/pulls`, { method: 'POST', body: { title: 'Test PR for feedback lines', body: `Feedback integration fixture\n\nFixes #${issue.number}\n\n<!-- ${TEST_RESOURCE_MARKER} ${fixture.prefix} -->`, base: fixture.baseBranch, head: fixture.headBranch } });
      fixture.prNumber = pr.number;
      fixture.prUrl = pr.html_url;
    }
    return fixture;
  } catch (error) {
    try {
      await cleanupGithubTestFixture(fixture, { api });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `Fixture creation failed: ${error.message}; ${cleanupError.message}`, { cause: cleanupError });
    }
    throw error;
  }
}

/** Close the issue/PR and remove only refs owned by this fixture. */
export async function cleanupGithubTestFixture(fixture, { api = githubApi } = {}) {
  const root = `repos/${fixture.repository}`;
  const operations = [];
  const errors = [];
  const pullNumbers = new Set(fixture.prNumber ? [fixture.prNumber] : []);
  const branches = new Set(fixture.branches || []);
  // The model can open a PR before a session is interrupted or evidence
  // collection fails. Discover it by its unique base instead of leaking it.
  if (fixture.discoverPullRequests && fixture.issueNumber) {
    try {
      const pulls = await githubList(`${root}/pulls?state=all&base=${encodeURIComponent(fixture.baseBranch)}&per_page=100`, null, api);
      for (const pr of pulls) {
        pullNumbers.add(pr.number);
        if (pr.head?.repo?.full_name === fixture.repository) branches.add(pr.head.ref);
      }
    } catch (error) {
      errors.push(error);
    }
  }
  for (const number of pullNumbers) operations.push([`${root}/pulls/${number}`, { method: 'PATCH', body: { state: 'closed' } }]);
  if (fixture.issueNumber) operations.push([`${root}/issues/${fixture.issueNumber}`, { method: 'PATCH', body: { state: 'closed' } }]);
  for (const branch of [...branches].reverse()) {
    // GitHub refuses to delete a repository's default branch. Repository
    // deletion belongs to the capability-aware scheduled cleanup instead.
    if (fixture.createdRepository && branch === fixture.baseBranch) continue;
    operations.push([`${root}/git/refs/heads/${branch}`, { method: 'DELETE' }]);
  }
  for (const [endpoint, options] of operations) {
    try {
      await api(endpoint, options);
    } catch (error) {
      if (options.method === 'DELETE' && /Reference does not exist|404|Not Found/i.test(error.message)) continue;
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, `Test fixture cleanup failed for ${fixture.prefix || fixture.repository}: ${errors.map(error => error.message).join('; ')}`);
}
