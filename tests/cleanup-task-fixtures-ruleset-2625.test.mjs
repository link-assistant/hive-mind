/**
 * Regression coverage for issue #2625 (Cleanup Test Repositories, runs
 * 37113071084 … 37608433608).
 *
 * Ruleset 21204104 ("no-destruction-possible") adds a `deletion` rule to every
 * branch and nobody can bypass it. Every DELETE of a stale fixture branch
 * answered HTTP 422 "Repository rule violations found / Cannot delete this
 * branch", the script threw with 180 such lines, and the daily job failed
 * while doing everything the policy allows.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2625
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cleanupStaleFixtures, describeRetainedBranches, isBranchDeletionForbidden, isBranchDeletionRuleViolation } from '../scripts/cleanup-task-fixtures.lib.mjs';

const repository = 'o/r';
const ruleError = 'gh: Repository rule violations found\n\nCannot delete this branch\n\n (HTTP 422)';
const deletionRule = { type: 'deletion', ruleset_source_type: 'Repository', ruleset_source: repository, ruleset_id: 21204104 };

const scenario = ({ rules, bypass = 'never', deleteError = null, rulesError = null }) => {
  const calls = [];
  const warnings = [];
  const summary = [];
  const run = cleanupStaleFixtures({
    repository,
    log() {},
    warn: message => warnings.push(message),
    appendSummary: text => summary.push(text),
    list: async endpoint => {
      if (endpoint.includes('/branches?')) return ['e2e/hello-world/1/agent-formal-ai', 'e2e/integration/2/claude-sonnet', 'main'].map(name => ({ name, commit: { sha: name } }));
      if (endpoint.includes('/pulls?')) return [{ number: 7, state: 'open', base: { ref: 'e2e/hello-world/1/agent-formal-ai' }, head: { ref: 'issue-1-solver', repo: { full_name: repository } } }];
      return [{ number: 1, created_at: '2000-01-01T00:00:00Z' }];
    },
    api: async (endpoint, options = {}) => {
      calls.push({ endpoint, method: options.method || 'GET' });
      if (endpoint.includes('/commits/')) return { commit: { committer: { date: '2000-01-01T00:00:00Z' } } };
      if (endpoint.includes('/rules/branches/')) {
        if (rulesError) throw new Error(rulesError);
        return rules;
      }
      if (endpoint.endsWith('/rulesets/21204104')) return { current_user_can_bypass: bypass };
      if (options.method === 'DELETE' && deleteError) throw new Error(deleteError);
      return {};
    },
  });
  return run.then(result => ({ result, calls, warnings, summary }));
};

test('the GitHub answer for a deletion rule is recognised, nothing else is', () => {
  assert.equal(isBranchDeletionRuleViolation(ruleError), true);
  for (const message of ['HTTP 422: Reference does not exist', 'HTTP 403: Resource not accessible by integration', 'HTTP 500: Repository rule violations found: Cannot delete this branch']) {
    assert.equal(isBranchDeletionRuleViolation(message), false, message);
  }
});

test('branches protected by a deletion rule are retained without a doomed DELETE and the run succeeds', async () => {
  const { result, calls, warnings, summary } = await scenario({ rules: [deletionRule, { ...deletionRule, type: 'non_fast_forward' }] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.retainedBranches.sort(), ['e2e/hello-world/1/agent-formal-ai', 'e2e/integration/2/claude-sonnet', 'issue-1-solver']);
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 0);
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 2, 'the PR and the issue are still closed');
  assert.equal(warnings.length, 1, 'one warning per run, not one per branch');
  assert.match(warnings[0], /^::warning title=Fixture branches retained::3 fixture branch\(es\) retained/);
  assert.match(summary.join(''), /ruleset exclusion, or a bypass for the cleanup token/);
});

test('a rule that cannot be detected beforehand is still classified from the DELETE answer', async () => {
  const { result, calls } = await scenario({ rules: [], deleteError: ruleError });
  assert.deepEqual(result.errors, []);
  assert.equal(result.retainedBranches.length, 3);
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 3);
});

test('an unreadable rules API falls back to attempting the DELETE', async () => {
  const { result, calls } = await scenario({ rules: null, rulesError: 'HTTP 403: Resource not accessible by integration' });
  assert.deepEqual(result, { owned: result.owned, errors: [], retainedBranches: [] });
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 3);
});

test('a token that may always bypass the rule deletes the branches', async () => {
  const { result, calls } = await scenario({ rules: [deletionRule], bypass: 'always' });
  assert.deepEqual(result.retainedBranches, []);
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 3);
});

test('other DELETE failures remain fatal', async () => {
  const { result } = await scenario({ rules: [], deleteError: 'HTTP 503: unavailable' });
  assert.equal(result.errors.length, 3);
  assert.deepEqual(result.retainedBranches, []);
});

test('organization rules count as binding without a readable bypass', async () => {
  assert.equal(await isBranchDeletionForbidden(repository, 'b', { api: async () => [{ type: 'deletion', ruleset_source_type: 'Organization', ruleset_id: 1 }] }), true);
  assert.equal(await isBranchDeletionForbidden(repository, 'b', { api: async () => [{ type: 'pull_request' }] }), false);
});

test('the warning stays short when hundreds of branches are retained', () => {
  const message = describeRetainedBranches(Array.from({ length: 180 }, (_, index) => `e2e/hello-world/${index}/agent`));
  assert.match(message, /^180 fixture branch\(es\)/);
  assert.match(message, /and 175 more/);
  assert.ok(message.length < 400);
});
