/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupStaleTestResources, cleanupTestRepositories, mayDeleteTestRepository } from '../scripts/github-test-cleanup.lib.mjs';

test('repository deletion requires administration capability and a non-default layer', () => {
  const repo = { permissions: { admin: true } };
  assert.equal(mayDeleteTestRepository(repo, 'default'), false);
  assert.equal(mayDeleteTestRepository(repo, 'token'), true);
  assert.equal(mayDeleteTestRepository(repo, 'app'), true);
  assert.equal(mayDeleteTestRepository({ permissions: { admin: false } }, 'token'), false);
});

test('stale fixtures close associated issues and PRs and delete both base and solver refs', async () => {
  const calls = [];
  const branches = [
    { name: 'e2e/old/base', commit: { sha: 'old' } },
    { name: 'integration/new/base', commit: { sha: 'new' } },
    { name: 'main', commit: { sha: 'old' } },
  ];
  const api = async (endpoint, options = {}) => {
    calls.push({ endpoint, ...options });
    if (endpoint.includes('/branches?')) return [branches];
    if (endpoint.endsWith('/commits/old')) return { commit: { committer: { date: '2026-09-01T00:00:00Z' } } };
    if (endpoint.endsWith('/commits/new')) return { commit: { committer: { date: '2026-09-30T00:00:00Z' } } };
    if (endpoint.includes('/pulls?')) return [[{ number: 10, base: { ref: 'e2e/old/base' }, head: { ref: 'issue-5-abc', repo: { full_name: 'o/r' }, sha: 'old' } }]];
    if (endpoint.includes('/issues?'))
      return [
        [
          { number: 5, created_at: '2026-09-01T00:00:00Z', body: '<!-- hive-mind-test: e2e/old -->' },
          { number: 6, created_at: '2026-09-01T00:00:00Z', body: 'Real user issue' },
        ],
      ];
    return {};
  };
  await cleanupStaleTestResources({ api, repository: 'o/r', now: Date.parse('2026-09-30T01:00:00Z') });
  const writes = calls.filter(call => ['DELETE', 'PATCH'].includes(call.method));
  assert.ok(writes.some(call => call.endpoint.endsWith('/pulls/10')));
  assert.ok(writes.some(call => call.endpoint.endsWith('/issues/5')));
  assert.ok(writes.some(call => call.endpoint.endsWith('/heads/issue-5-abc')));
  assert.ok(writes.some(call => call.endpoint.endsWith('/heads/e2e/old/base')));
  assert.ok(!writes.some(call => call.endpoint.includes('integration/new') || call.endpoint.endsWith('/main') || call.endpoint.endsWith('/issues/6')));
});

test('dry run lists stale resources without writing', async () => {
  const api = async (endpoint, options = {}) => {
    assert.ok(!['DELETE', 'PATCH'].includes(options.method));
    if (endpoint.includes('/branches?')) return [[{ name: 'integration/a/base', commit: { sha: 'old' } }]];
    if (endpoint.includes('/commits/')) return { commit: { committer: { date: '2026-09-01T00:00:00Z' } } };
    return [[]];
  };
  const result = await cleanupStaleTestResources({ api, repository: 'o/r', dryRun: true });
  assert.equal(result.branches.length, 1);
});

test('one active PR protects a shared fixture even when an older PR is listed first', async () => {
  const writes = [];
  const api = async (endpoint, options = {}) => {
    if (options.method) writes.push({ endpoint, ...options });
    if (endpoint.includes('/branches?')) return [[{ name: 'e2e/shared/base', commit: { sha: 'old' } }]];
    if (endpoint.includes('/commits/')) return { commit: { committer: { date: endpoint.endsWith('/new') ? '2026-09-30T00:00:00Z' : '2026-09-01T00:00:00Z' } } };
    if (endpoint.includes('/pulls?'))
      return [
        [
          { number: 10, state: 'closed', base: { ref: 'e2e/shared/base' }, head: { ref: 'older-solver', sha: 'old', repo: { full_name: 'o/r' } } },
          { number: 11, state: 'open', base: { ref: 'e2e/shared/base' }, head: { ref: 'active-solver', sha: 'new', repo: { full_name: 'o/r' } } },
        ],
      ];
    if (endpoint.includes('/issues?')) return [[{ number: 5, state: 'open', created_at: '2026-09-01T00:00:00Z', body: '<!-- hive-mind-test: e2e/shared -->' }]];
    return {};
  };
  await cleanupStaleTestResources({ api, repository: 'o/r', now: Date.parse('2026-09-30T01:00:00Z') });
  assert.deepEqual(writes, []);
});

test('marked stale issues are closed even if a previous cleanup already removed their refs', async () => {
  const writes = [];
  const api = async (endpoint, options = {}) => {
    if (options.method) writes.push({ endpoint, ...options });
    if (endpoint.includes('/issues?')) return [[{ number: 5, state: 'open', created_at: '2026-09-01T00:00:00Z', body: '<!-- hive-mind-test: integration/old -->' }]];
    return [[]];
  };
  await cleanupStaleTestResources({ api, repository: 'o/r', now: Date.parse('2026-09-30T01:00:00Z') });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].endpoint, 'repos/o/r/issues/5');
});

test('default cleanup never calls repository deletion and reports the unavailable capability', async () => {
  const logs = [];
  await cleanupTestRepositories({
    layer: 'default',
    repository: 'o/r',
    api: async () => {
      throw new Error('default repository cleanup must not call the API');
    },
    log: line => logs.push(line),
  });
  assert.match(logs.join('\n'), /Repository deletion unavailable/);
});

test('app cleanup preserves archived and non-admin repositories and deletes capable test repositories', async () => {
  const deleted = [];
  const api = async (endpoint, options = {}) => {
    if (endpoint === 'users/o') return { type: 'Organization' };
    if (endpoint.includes('/repos?'))
      return [
        [
          { name: 'test-feedback-lines-abc', full_name: 'o/archived', archived: true },
          { name: 'test-feedback-lines-def', full_name: 'o/no-admin' },
          { name: 'test-feedback-lines-fed', full_name: 'o/capable' },
          { name: 'ordinary-repository', full_name: 'o/ordinary' },
        ],
      ];
    if (options.method === 'DELETE') deleted.push(endpoint);
    return { permissions: { admin: endpoint !== 'repos/o/no-admin' } };
  };
  await cleanupTestRepositories({ api, repository: 'o/r', layer: 'app' });
  assert.deepEqual(deleted, ['repos/o/capable']);
});
