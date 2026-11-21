#!/usr/bin/env node
// @hive-mind-test-suite default,pr-essential

/**
 * Issue #4025: "Cleanup Test Repositories" was cancelled by its 15-minute
 * timeout every day from 2026-10-26 on (run 42472902848 and the runs listed in
 * dev/log/issues/4025/pulls/4026/ci-logs/cleanup-run-history.json).
 *
 * Ruleset 21204104 keeps every fixture branch, so the branch count only grows.
 * The last successful run took 14m15s for 1138 retained branches because the
 * script read one commit per fixture branch, then the branch rules and the
 * ruleset for every owned branch, one request at a time: about 3,400 calls.
 * Now commit dates come from GraphQL in pages of 100, a ruleset that forbids
 * deleting every branch is recognised once, rulesets are read once, and a time
 * budget ends the run cleanly. A dry run against the real repository went from
 * over 15 minutes to 35 seconds.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { cleanupStaleFixtures, findBlanketDeletionRuleset, isBranchDeletionForbidden, listFixtureBranchDates } from '../scripts/cleanup-task-fixtures.lib.mjs';

const repository = 'o/r';
const OLD = '2000-01-01T00:00:00Z';
const NEW = new Date().toISOString();
const blanketRuleset = { id: 21204104, name: 'no-destruction-possible', target: 'branch', enforcement: 'active', conditions: { ref_name: { include: ['~ALL'], exclude: [] } }, rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }], current_user_can_bypass: 'never' };
const deletionRule = { type: 'deletion', ruleset_source_type: 'Repository', ruleset_id: 21204104 };

/** `count` fixture branches, the first `fresh` of them too new to be stale. */
const branchNames = (count, fresh = 0) => Array.from({ length: count }, (_, index) => ({ name: `e2e/hello-world/${index}/agent`, date: index < fresh ? NEW : OLD }));

const scenario = ({ branches = branchNames(250), ruleset = blanketRuleset, graphqlFails = false, withGraphql = true, clockStep = 0, deadline = Infinity, verbose = false }) => {
  const calls = [];
  const logs = [];
  const warnings = [];
  let time = 0;
  const pages = [];
  for (let start = 0; start < branches.length; start += 100) pages.push(branches.slice(start, start + 100));
  const graphql = async (query, variables) => {
    calls.push({ kind: 'graphql', cursor: variables.cursor });
    if (graphqlFails) throw new Error('gh: Something went wrong (HTTP 502)');
    const index = variables.cursor ? Number(variables.cursor) : 0;
    const page = pages[index] ?? [];
    // GraphQL's ref query also matches names that merely contain "e2e/".
    const nodes = page.map(branch => ({ name: branch.name, target: { committedDate: branch.date } }));
    if (index === 0) nodes.push({ name: 'feature/e2e/notes', target: { committedDate: OLD } });
    return { data: { repository: { refs: { pageInfo: { hasNextPage: index + 1 < pages.length, endCursor: String(index + 1) }, nodes } } } };
  };
  const run = cleanupStaleFixtures({
    repository,
    graphql: withGraphql ? graphql : undefined,
    clock: () => (time += clockStep),
    deadline,
    verbose,
    log: message => logs.push(message),
    warn: message => warnings.push(message),
    list: async endpoint => {
      calls.push({ kind: 'list', endpoint });
      if (endpoint.includes('/branches?')) return [...branches.map(branch => ({ name: branch.name, commit: { sha: branch.name } })), { name: 'main', commit: { sha: 'main' } }];
      if (endpoint.includes('/pulls?')) return [{ number: 7, state: 'open', base: { ref: 'e2e/hello-world/249/agent' }, head: { ref: 'issue-1-solver', repo: { full_name: repository } } }];
      if (endpoint.includes('/rulesets?')) return ruleset ? [{ id: ruleset.id, name: ruleset.name, target: 'branch', enforcement: 'active', source_type: 'Repository' }] : [];
      return [];
    },
    api: async (endpoint, options = {}) => {
      calls.push({ kind: 'api', endpoint, method: options.method || 'GET' });
      if (endpoint.includes('/commits/')) return { commit: { committer: { date: branches.find(branch => endpoint.endsWith(branch.name))?.date ?? OLD } } };
      if (endpoint.includes('/rules/branches/')) return ruleset ? [deletionRule] : [];
      if (ruleset && endpoint.endsWith(`/rulesets/${ruleset.id}`)) return ruleset;
      return {};
    },
  });
  return run.then(result => ({ result, calls, logs, warnings }));
};

const count = (calls, predicate) => calls.filter(predicate).length;

test('a blanket deletion ruleset retains every owned branch with a constant number of API calls', async () => {
  const { result, calls, warnings } = await scenario({});
  assert.deepEqual(result.errors, []);
  assert.equal(result.incomplete, false);
  assert.equal(result.retainedBranches.length, 251, '250 stale fixtures plus the PR head branch');
  assert.equal(
    count(calls, call => call.kind === 'graphql'),
    3,
    '250 branches in three GraphQL pages'
  );
  assert.equal(
    count(calls, call => call.endpoint?.includes('/commits/')),
    0,
    'no per-branch commit lookup'
  );
  assert.equal(
    count(calls, call => call.endpoint?.includes('/rules/branches/')),
    0,
    'no per-branch rules lookup'
  );
  assert.equal(
    count(calls, call => call.endpoint?.includes('/rulesets/')),
    1,
    'the ruleset is read once'
  );
  assert.equal(
    count(calls, call => call.method === 'DELETE'),
    0
  );
  assert.equal(
    count(calls, call => call.method === 'PATCH'),
    1,
    'the open PR is still closed'
  );
  assert.equal(calls.length, 3 + 3 + 1 + 1, 'graphql pages + pulls/issues/rulesets lists + one ruleset read + one PATCH');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^::warning title=Fixture branches retained::251 fixture branch\(es\) retained/);
});

test('only stale fixture branches are owned, and GraphQL substring matches are ignored', async () => {
  const { result } = await scenario({ branches: branchNames(120, 20) });
  assert.equal(result.owned.length, 100, '100 stale fixtures; the PR head is not added because its base is fresh');
  assert.ok(result.owned.every(name => name.startsWith('e2e/hello-world/')));
  assert.ok(!result.owned.includes('feature/e2e/notes'));
});

test('a ruleset with exclusions is not blanket: branches are checked one by one, the ruleset is read once', async () => {
  const ruleset = { ...blanketRuleset, conditions: { ref_name: { include: ['~ALL'], exclude: ['refs/heads/e2e/**'] } } };
  const { result, calls } = await scenario({ ruleset });
  assert.equal(
    count(calls, call => call.endpoint?.includes('/rules/branches/')),
    251
  );
  assert.equal(
    count(calls, call => call.endpoint?.endsWith('/rulesets/21204104')),
    1,
    'memoized across 251 branches'
  );
  assert.equal(result.retainedBranches.length, 251);
});

test('a ruleset the token can always bypass is not blanket, and branches are deleted', async () => {
  const ruleset = { ...blanketRuleset, current_user_can_bypass: 'always' };
  const { result, calls } = await scenario({ ruleset, branches: branchNames(3) });
  assert.deepEqual(result.retainedBranches, []);
  assert.equal(
    count(calls, call => call.method === 'DELETE'),
    3
  );
});

test('without rulesets the stale branches are deleted', async () => {
  const { result, calls } = await scenario({ ruleset: null, branches: branchNames(3) });
  assert.deepEqual(result.retainedBranches, []);
  assert.equal(
    count(calls, call => call.method === 'DELETE'),
    3
  );
});

for (const [name, options] of [
  ['a failing GraphQL lookup', { graphqlFails: true }],
  ['no GraphQL client', { withGraphql: false }],
]) {
  test(`${name} falls back to one REST commit lookup per fixture branch`, async () => {
    const { result, calls, logs } = await scenario({ ...options, branches: branchNames(5, 1) });
    assert.equal(
      count(calls, call => call.endpoint?.includes('/commits/')),
      5
    );
    assert.equal(result.owned.length, 4);
    if (options.graphqlFails) assert.ok(logs.some(line => /GraphQL commit-date lookup failed.*HTTP 502/.test(line)));
  });
}

test('the time budget ends the run cleanly and says so', async () => {
  const ruleset = { ...blanketRuleset, conditions: { ref_name: { include: ['refs/heads/e2e/**'], exclude: [] } } };
  // Every clock read advances one second; the budget ends partway through the per-branch loop.
  const { result, calls, warnings } = await scenario({ ruleset, clockStep: 1000, deadline: 60_000 });
  assert.equal(result.incomplete, true);
  assert.deepEqual(result.errors, []);
  assert.ok(count(calls, call => call.endpoint?.includes('/rules/branches/')) < 251, 'stopped before every branch was checked');
  assert.ok(warnings.some(line => /^::warning title=Cleanup incomplete::Cleanup stopped at its time budget/.test(line)));
});

test('verbose mode logs every API call; it is off by default', async () => {
  const quiet = await scenario({ branches: branchNames(3) });
  assert.ok(!quiet.logs.some(line => line.startsWith('[verbose]')));
  const loud = await scenario({ branches: branchNames(3), verbose: true });
  assert.ok(loud.logs.some(line => /^\[verbose\] graphql .*ms$/.test(line)));
  assert.ok(loud.logs.some(line => /^\[verbose\] list GET repos\/o\/r\/pulls\?state=all/.test(line)));
  assert.ok(loud.logs.some(line => /^\[verbose\] api GET repos\/o\/r\/rulesets\/21204104 \d+ms$/.test(line)));
});

test('progress is logged so a slow run is never silent', async () => {
  const { logs } = await scenario({});
  assert.ok(logs.some(line => /^Fixture branches: 250, stale: 250 \(\d+s\)$/.test(line)));
  assert.ok(logs.some(line => /^Pull requests scanned: 1 /.test(line)));
  assert.ok(logs.some(line => /^Ruleset 21204104 \(no-destruction-possible\) forbids deleting every branch/.test(line)));
  // Issue #4029: the final count says where branches beyond the fixtures come from.
  assert.ok(
    logs.some(line => /^Stale fixture branches: 251 \(250 e2e\/ fixtures, 1 pull request heads based on them\) \(\d+s\)$/.test(line)),
    logs.join('\n')
  );
});

test('helpers fail safe', async () => {
  assert.equal(await findBlanketDeletionRuleset(repository, { list: async () => Promise.reject(new Error('HTTP 403')), api: async () => ({}) }), null, 'unreadable rulesets: check per branch');
  assert.equal(await findBlanketDeletionRuleset(repository, { list: async () => [{ id: 1, target: 'branch', enforcement: 'evaluate', source_type: 'Repository' }], api: async () => blanketRuleset }), null, 'evaluate mode does not block');
  const extraCondition = { ...blanketRuleset, conditions: { ...blanketRuleset.conditions, repository_name: { include: ['r'] } } };
  assert.equal(await findBlanketDeletionRuleset(repository, { list: async () => [{ id: 1, target: 'branch', enforcement: 'active', source_type: 'Repository' }], api: async () => extraCondition }), null, 'other conditions make it non-blanket');
  await assert.rejects(listFixtureBranchDates(repository, { graphql: async () => ({ errors: [{ message: 'bad' }] }) }), /unexpected GraphQL answer/);
  const rulesets = new Map();
  let reads = 0;
  const api = async endpoint => (endpoint.includes('/rules/branches/') ? [deletionRule] : (reads++, blanketRuleset));
  await Promise.all([isBranchDeletionForbidden(repository, 'a', { api, rulesets }), isBranchDeletionForbidden(repository, 'b', { api, rulesets })]);
  assert.equal(reads, 1, 'concurrent readers share one ruleset request');
});

test('the workflow serialises runs and passes the budget and verbose switches', () => {
  const workflow = readFileSync(new URL('../.github/workflows/cleanup-test-repos.yml', import.meta.url), 'utf8');
  assert.match(workflow, /\n {4}concurrency:\n {6}group: cleanup-\$\{\{ github\.repository \}\}\n {6}cancel-in-progress: false\n/);
  assert.match(workflow, /CLEANUP_TIME_BUDGET_MINUTES: '(\d+)'/);
  const budget = Number(workflow.match(/CLEANUP_TIME_BUDGET_MINUTES: '(\d+)'/)[1]);
  const timeout = Number(workflow.match(/\n {4}timeout-minutes: (\d+)/)[1]);
  assert.ok(budget <= timeout - 4, `budget ${budget}m leaves time for setup and the repository cleanup within ${timeout}m`);
  assert.match(workflow, /CLEANUP_VERBOSE: \$\{\{ vars\.CLEANUP_VERBOSE \|\| 'false' \}\}/);
  const script = readFileSync(new URL('../scripts/cleanup-task-fixtures.mjs', import.meta.url), 'utf8');
  assert.match(script, /graphql: \(query, variables\) => ghApi\('graphql', \{ method: 'POST', body: \{ query, variables \} \}\)/);
  assert.match(script, /verbose: process\.env\.CLEANUP_VERBOSE === 'true'/);
});
