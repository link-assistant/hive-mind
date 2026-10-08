/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatSessionCompletionMessage } from '../src/work-session-formatting.lib.mjs';
import { IssueQueue } from '../src/hive.issue-queue.lib.mjs';
import { HiveRunReport } from '../src/hive.run-outcome.lib.mjs';
import { createRepositoryIssueFetcher } from '../src/hive.repository-fallback.lib.mjs';
import { readFileSync } from 'node:fs';
import { pullRequestClosesIssue } from '../src/github-linking.lib.mjs';
import { initI18n } from '../src/i18n.lib.mjs';

const fixture = new URL('../experiments/issue-2685/', import.meta.url);
export function runHive(scenario, args = []) {
  return new Promise((resolve, reject) => {
    const checks = args.some(arg => ['--no-tool-check', '--skip-tool-check', '--skip-claude-check'].includes(arg)) ? [] : ['--skip-tool-connection-check'];
    const target = scenario === 'archived' ? 'https://github.com/link-assistant' : 'https://github.com/link-assistant/calculator';
    const child = spawn(process.execPath, ['--max-old-space-size=256', '--import', fileURLToPath(new URL('hive-fixture-preload.mjs', fixture)), fileURLToPath(new URL('../src/hive.mjs', import.meta.url)), target, '--tool', 'codex', '--model', 'gpt-6.1-sol', '--once', '--all-issues', '--skip-issues-with-prs', ...checks, '--no-sentry', ...args], {
      cwd: fileURLToPath(fixture),
      env: { ...process.env, HIVE_FIXTURE_SCENARIO: scenario },
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: AbortSignal.timeout(12000),
    });
    let output = '';
    child.stdout.on('data', data => {
      output += data;
    });
    child.stderr.on('data', data => {
      output += data;
    });
    child.on('error', reject);
    child.on('close', code => resolve({ code, output }));
  });
}

test('production replay: nineteen PR skips produce no-work exit and name PR #228', { timeout: 15000 }, async () => {
  const result = await runHive('all-prs');
  assert.equal(result.code, 3, result.output);
  assert.match(result.output, /No issues processed/);
  assert.match(result.output, /Skipped.*19/);
  assert.match(result.output, /https:\/\/github.com\/link-assistant\/calculator\/pull\/228/);
  assert.doesNotMatch(result.output, /All issues processed|FIXTURE_SOLVER_STARTED/);
  assert.doesNotMatch(result.output, /Discovery details:/);
  const verbose = await runHive('all-prs', ['--verbose']);
  assert.equal(verbose.code, 3, verbose.output);
  assert.match(verbose.output, /Discovery details:.*existing open pull requests/);
});

for (const scenario of ['empty', 'blocked', 'archived', 'recheck-skip']) {
  test(`${scenario} does not claim successful work`, { timeout: 15000 }, async () => {
    const result = await runHive(scenario);
    assert.equal(result.code, 3, result.output);
    assert.doesNotMatch(result.output, /All issues processed|FIXTURE_SOLVER_STARTED/);
    assert.match(result.output, /Completed: 0/);
    if (scenario === 'recheck-skip') assert.match(result.output, /Existing PR: https:\/\/github.com\/link-assistant\/calculator\/pull\/228/);
    if (scenario === 'archived') assert.match(result.output, /1 skipped: archived repository/);
  });
}

test('GitHub discovery failure is a failure, not an empty successful result', { timeout: 15000 }, async () => {
  const result = await runHive('discovery-error');
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /GitHub discovery unavailable/);
  assert.doesNotMatch(result.output, /All issues processed|No open issues found/);
});

for (const args of [['--no-all-issues'], ['--project-mode', '--project-number', '1', '--project-owner', 'link-assistant'], ['--youtrack-mode']]) {
  test(`discovery errors propagate in ${args[0]} mode`, { timeout: 15000 }, async () => {
    const result = await runHive('discovery-error', args);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /Discovery error: GitHub discovery unavailable/);
  });
}

test('disk deferral stops a nonempty queue and preserves exit 75', { timeout: 15000 }, async () => {
  const result = await runHive('disk-halt');
  assert.equal(result.code, 75, result.output);
  assert.doesNotMatch(result.output, /FIXTURE_SOLVER_STARTED|All issues processed/);
});

test('a genuinely completed solver succeeds', { timeout: 15000 }, async () => {
  const result = await runHive('success');
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /FIXTURE_SOLVER_STARTED/);
  assert.match(result.output, /Completed: 1/);
});

test('worker failure stays nonzero', { timeout: 15000 }, async () => {
  const result = await runHive('worker-error');
  assert.equal(result.code, 1, result.output);
  assert.doesNotMatch(result.output, /All issues processed/);
});

test('dry runs explicitly report simulation and retain exit zero', { timeout: 15000 }, async () => {
  const result = await runHive('empty', ['--dry-run']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Dry run finished/);
  assert.doesNotMatch(result.output, /All issues processed|FIXTURE_SOLVER_STARTED/);
});

test('rechecking a skipped issue never increments completed', () => {
  const queue = new IssueQueue();
  queue.enqueue('issue');
  queue.dequeue();
  queue.markSkipped('issue', 'closed');
  assert.equal(queue.getStats().completed, 0);
  assert.equal(queue.getStats().skipped, 1);
  assert.equal(queue.getStats().processing, 0);
  assert.equal(queue.enqueue('issue'), true, 'a later monitoring round can reconsider skipped issues');
  queue.dequeue();
  queue.markCompleted('issue');
  assert.equal(queue.getStats().skipped, 0);
});

test('captured PR body closes all nineteen issues under the shared parser', () => {
  const data = new URL('../docs/case-studies/issue-2685/data/', import.meta.url);
  const [pr] = JSON.parse(readFileSync(new URL('calculator-open-prs.json', data), 'utf8'));
  const issues = JSON.parse(readFileSync(new URL('calculator-open-issues.json', data), 'utf8')).filter(issue => !issue.pull_request);
  assert.equal(issues.length, 19);
  for (const issue of issues) assert.equal(pullRequestClosesIssue({ body: pr.body, url: pr.html_url }, issue.number, 'link-assistant', 'calculator'), true, `#${issue.number}`);
});

test('completed work with blocked issues reports a partial outcome', { timeout: 15000 }, async () => {
  const result = await runHive('partial');
  assert.equal(result.code, 4, result.output);
  assert.match(result.output, /Completed: 1/);
  assert.match(result.output, /Waiting: 18/);
  assert.match(formatSessionCompletionMessage({ exitCode: result.code, sessionInfo: { command: 'hive' } }), /^⚠️.*still waiting/);
});

for (const flag of ['--no-tool-check', '--skip-tool-check', '--skip-claude-check']) {
  test(`hive honors ${flag} without a tool greeting`, { timeout: 15000 }, async () => {
    const result = await runHive('all-prs', [flag]);
    assert.equal(result.code, 3, result.output);
    assert.doesNotMatch(result.output, /FIXTURE_TOOL_CHECK/);
  });
}

test('waiting issues are counted once across discovery and worker deferral', () => {
  const queue = new IssueQueue();
  queue.enqueue('blocked');
  queue.dequeue();
  queue.defer('blocked');
  const outcome = new HiveRunReport().getOutcome(queue, { waitingIssues: ['blocked', 'another'] });
  assert.equal(outcome.pending, 2);
  assert.equal(outcome.exitCode, 3);
});

test('repository fallback preserves useful issues and surfaces partial discovery errors', async () => {
  const report = new HiveRunReport();
  const fetch = createRepositoryIssueFetcher({
    log: async () => {},
    cleanErrorMessage: error => error.message,
    reportError: () => {},
    onFetchError: error => report.recordError(error),
    sleeper: async () => {},
    tryFetchIssuesWithGraphQL: async () => ({ success: false }),
    execGhWithRetry: async () => ({ stdout: ['broken', 'working'].map(name => JSON.stringify({ name, owner: 'owner' })).join('\n') }),
    fetchAllIssuesWithPagination: async command => {
      if (command.includes('/broken')) throw new Error('repository unavailable');
      return [{ url: 'working-issue' }];
    },
  });
  const issues = await fetch('owner', 'user', null, true);
  assert.equal(issues.length, 1);
  const queue = new IssueQueue();
  queue.markCompleted(issues[0].url);
  assert.equal(report.getOutcome(queue).exitCode, 1);
  assert.deepEqual(report.errors, ['repository unavailable']);
  report.beginDiscovery();
  assert.equal(report.getOutcome(queue).exitCode, 0, 'a successful later monitoring round clears a transient discovery error');
});

test('repository-list failure also reaches the report', async () => {
  const report = new HiveRunReport();
  const fetch = createRepositoryIssueFetcher({
    log: async () => {},
    cleanErrorMessage: error => error.message,
    reportError: () => {},
    onFetchError: error => report.recordError(error),
    sleeper: async () => {},
    tryFetchIssuesWithGraphQL: async () => ({ success: false }),
    execGhWithRetry: async () => {
      throw new Error('list unavailable');
    },
    fetchAllIssuesWithPagination: async () => assert.fail('cannot fetch without a repository list'),
  });
  assert.deepEqual(await fetch('owner', 'user', null, true), []);
  assert.equal(report.getOutcome(new IssueQueue()).exitCode, 1);
});

test('Telegram reports hive no-work as a warning and preserves unrelated failures', async () => {
  for (const locale of [null, 'en', 'ru', 'zh', 'hi']) {
    await initI18n({ language: locale || 'en' });
    const message = formatSessionCompletionMessage({ exitCode: 3, sessionInfo: { command: 'hive', locale } });
    assert.match(message, /^⚠️/);
    assert.doesNotMatch(message, /finished successfully/);
    assert.doesNotMatch(message, /telegram\.work_session/);
  }
  const message = formatSessionCompletionMessage({ exitCode: 3, sessionInfo: { command: 'solve' } });
  assert.match(message, /^❌.*failed/);
});
