/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGithubTestFixture, cleanupGithubTestFixture } from '../scripts/github-test-resources.lib.mjs';

function fakeGithub(failAt = '') {
  const calls = [];
  const api = async (endpoint, options = {}) => {
    calls.push({ endpoint, ...options });
    if (endpoint.endsWith(failAt) && failAt) throw new Error('fixture API failure');
    if (endpoint === 'user') return { login: 'test-user' };
    if (endpoint === 'user/repos') return { full_name: `test-user/${options.body.name}` };
    if (endpoint.endsWith('/git/trees')) return { sha: `tree-${calls.length}` };
    if (endpoint.endsWith('/git/commits')) return { sha: `commit-${calls.length}` };
    if (endpoint.endsWith('/issues') && options.method === 'POST') return { number: 41, html_url: 'https://github.com/o/r/issues/41' };
    if (endpoint.endsWith('/pulls') && options.method === 'POST') return { number: 42, html_url: 'https://github.com/o/r/pull/42' };
    return {};
  };
  return { api, calls };
}

test('default layer creates an orphan base and a related head in the current repository', async () => {
  const { api, calls } = fakeGithub();
  const fixture = await createGithubTestFixture({ api, repository: 'o/r', canCreateRepositories: false });
  assert.equal(fixture.repository, 'o/r');
  assert.equal(calls.filter(call => call.endpoint === 'user/repos').length, 0);
  const commits = calls.filter(call => call.endpoint.endsWith('/git/commits'));
  assert.deepEqual(commits[0].body.parents, [], 'the fixture has no main-branch ancestor');
  assert.deepEqual(commits[1].body.parents, [fixture.baseSha]);
  assert.match(fixture.baseBranch, /^integration\//);
  const issue = calls.find(call => call.endpoint.endsWith('/issues'));
  assert.deepEqual(issue.body.labels, ['no-formal-ai-draft'], 'fixture issues cannot start another draft');
  assert.match(issue.body.body, /hive-mind-test: integration\//);
  const pr = calls.find(call => call.endpoint.endsWith('/pulls'));
  assert.equal(pr.body.base, fixture.baseBranch);
  assert.equal(pr.body.head, fixture.headBranch);
  await cleanupGithubTestFixture(fixture, { api });
  assert.equal(calls.filter(call => call.method === 'DELETE' && call.endpoint.includes('/git/refs/heads/')).length, 2);
  assert.ok(calls.some(call => call.endpoint.endsWith('/pulls/42') && call.body.state === 'closed'));
  assert.ok(calls.some(call => call.endpoint.endsWith('/issues/41') && call.body.state === 'closed'));
  assert.ok(!calls.some(call => call.endpoint === 'repos/o/r' && call.method === 'DELETE'));
});

test('capable layers keep using newly created repositories', async () => {
  const { api, calls } = fakeGithub();
  const fixture = await createGithubTestFixture({ api, repository: 'o/r', canCreateRepositories: true });
  assert.match(fixture.repository, /^test-user\/test-feedback-lines-/);
  assert.equal(fixture.baseBranch, 'main');
  assert.ok(calls.some(call => call.endpoint === 'user/repos'));
});

test('partial fixture creation cleans branches and issues before surfacing the error', async () => {
  const { api, calls } = fakeGithub('/pulls');
  await assert.rejects(createGithubTestFixture({ api, repository: 'o/r' }), /fixture API failure/);
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 2);
  assert.ok(calls.some(call => call.endpoint.endsWith('/issues/41') && call.body.state === 'closed'));
});

test('cleanup attempts every resource and reports failures', async () => {
  const calls = [];
  const api = async (endpoint, options) => {
    calls.push(endpoint);
    if (endpoint.endsWith('/pulls/42')) throw new Error('close failed');
    return options;
  };
  await assert.rejects(cleanupGithubTestFixture({ repository: 'o/r', prNumber: 42, issueNumber: 41, branches: ['integration/a/base', 'integration/a/head'] }, { api }), /cleanup/);
  assert.equal(calls.length, 4);
});

test('an interrupted e2e session discovers its solver PR before cleaning the fixture', async () => {
  const calls = [];
  const api = async (endpoint, options = {}) => {
    calls.push({ endpoint, ...options });
    if (endpoint.includes('/pulls?')) return [[{ number: 42, head: { ref: 'issue-41-solver', repo: { full_name: 'o/r' } } }]];
    return {};
  };
  await cleanupGithubTestFixture({ repository: 'o/r', issueNumber: 41, baseBranch: 'e2e/a/base', branches: ['e2e/a/base'], discoverPullRequests: true }, { api });
  assert.ok(calls.some(call => call.endpoint.endsWith('/pulls/42') && call.method === 'PATCH'));
  assert.ok(calls.some(call => call.endpoint.endsWith('/heads/issue-41-solver') && call.method === 'DELETE'));
});

test('repository deletion rules retain fixture refs visibly after issues and PRs close', async () => {
  const calls = [];
  const warnings = [];
  const fixture = { repository: 'o/r', prefix: 'integration/a', prNumber: 42, issueNumber: 41, branches: ['integration/a/base', 'integration/a/head'] };
  const api = async (endpoint, options) => {
    calls.push({ endpoint, ...options });
    if (options.method === 'DELETE') throw new Error('HTTP 422: Repository rule violations found: Cannot delete this branch');
  };
  const result = await cleanupGithubTestFixture(fixture, { api, log: message => warnings.push(message) });
  assert.deepEqual(result.retainedBranches, ['integration/a/head', 'integration/a/base']);
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 2);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /::warning::.*retained.*repository rule/i);
});

test('ordinary deletion permission and server failures still fail fixture cleanup', async () => {
  for (const message of ['HTTP 403: Resource not accessible', 'HTTP 503: unavailable', 'HTTP 422: validation failed']) {
    await assert.rejects(
      cleanupGithubTestFixture(
        { repository: 'o/r', branches: ['integration/a/head'] },
        {
          api: async () => {
            throw new Error(message);
          },
          log: () => {},
        }
      ),
      /Test fixture cleanup failed/
    );
  }
});
