/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { cleanupBranchFixture } from '../scripts/task-fixture.lib.mjs';

const fixture = { repository: 'o/r', pullRequestNumber: 2, issueNumber: 1, branches: ['e2e/integration/run/base', 'issue-1-solver'] };
const ruleError = 'gh: Repository rule violations found\n\nCannot delete this branch\n\n (HTTP 422)';

test('cleanup reports policy-retained branches after closing the issue and PR', { timeout: 5000 }, async () => {
  const calls = [];
  const warnings = [];
  const directory = await mkdtemp(join(tmpdir(), 'fixture-cleanup-'));
  const summaryFile = join(directory, 'summary.md');
  try {
    const result = await cleanupBranchFixture(fixture, {
      api: async (endpoint, options) => {
        calls.push({ endpoint, ...options });
        if (options.method === 'DELETE') throw new Error(ruleError);
      },
      log: message => warnings.push(message),
      summaryFile,
    });
    assert.deepEqual(result, { errors: [], retainedBranches: ['issue-1-solver', 'e2e/integration/run/base'] });
    assert.deepEqual(
      calls.slice(0, 2).map(call => call.body),
      [{ state: 'closed' }, { state: 'closed' }]
    );
    assert.equal(calls.filter(call => call.method === 'DELETE').length, 2);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /::warning::.*issue-1-solver.*retained.*repository rule/i);
    const summary = await readFile(summaryFile, 'utf8');
    for (const branch of fixture.branches) assert.ok(summary.includes(branch));
    assert.match(summary, /scheduled cleanup.*retry/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('other API failures remain fatal cleanup errors and every resource is attempted', async () => {
  for (const message of ['HTTP 403: Resource not accessible', 'HTTP 503: unavailable', 'HTTP 422: validation failed', 'HTTP 500: Repository rule violations found: Cannot delete this branch']) {
    const calls = [];
    const result = await cleanupBranchFixture(fixture, {
      api: async (endpoint, options) => {
        calls.push(endpoint);
        if (options.method === 'DELETE') throw new Error(message);
      },
      log: () => assert.fail('Unexpected retention warning'),
      summaryFile: null,
    });
    assert.equal(result.errors.length, 2, message);
    assert.ok(result.errors.every(error => error.includes(message)));
    assert.deepEqual(result.retainedBranches, []);
    assert.equal(calls.length, 4);
  }
});

test('a rule-like error closing the PR cannot be classified as branch retention', async () => {
  const result = await cleanupBranchFixture(fixture, {
    api: async (endpoint, options) => {
      if (options.method === 'PATCH') throw new Error(ruleError);
    },
    log: () => assert.fail('Unexpected retention warning'),
    summaryFile: null,
  });
  assert.equal(result.errors.length, 2);
  assert.deepEqual(result.retainedBranches, []);
});

test('already absent and successfully deleted branches leave no cleanup errors', async () => {
  for (const message of [null, 'HTTP 404: Not Found', 'HTTP 422: Reference does not exist']) {
    const result = await cleanupBranchFixture(
      { ...fixture, branches: [...fixture.branches, fixture.branches[0]] },
      {
        api: async (endpoint, options) => {
          if (message && options.method === 'DELETE') throw new Error(message);
        },
        log: () => assert.fail('Unexpected retention warning'),
        summaryFile: null,
      }
    );
    assert.deepEqual(result, { errors: [], retainedBranches: [] });
  }
});

test('the production integration passes with policy retention and saves its cleanup evidence', { timeout: 5000 }, () => {
  const report = integrationProbe('policy');
  assert.equal(report.error, undefined);
  assert.deepEqual(report.cleanupReport.errors, []);
  assert.equal(report.cleanupReport.retainedBranches.length, 2);
  assert.equal(report.cleanupReport.resources.pullRequestNumber, 2);
  assert.equal(report.warnings.length, 2);
});

test('policy retention cannot hide a failed integration assertion', { timeout: 5000 }, () => {
  const report = integrationProbe('prompt-failure');
  assert.match(report.error, /Feedback integration failed/);
  assert.match(report.cause, /New comments/);
  assert.equal(report.cleanupReport.retainedBranches.length, 2);
  assert.ok(report.cleanupReport.testError);
});

test('the production integration fails on ordinary cleanup errors', { timeout: 5000 }, () => {
  const report = integrationProbe('cleanup-failure');
  assert.match(report.error, /Fixture cleanup must succeed/);
  assert.equal(report.cleanupReport.errors.length, 2);
  assert.deepEqual(report.cleanupReport.retainedBranches, []);
});

function integrationProbe(scenario) {
  return JSON.parse(execFileSync(process.execPath, ['--experimental-vm-modules', 'experiments/issue-2324/feedback-git-identity-probe.mjs', scenario], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}
