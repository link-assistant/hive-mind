/**
 * Issue #3630: which real E2E rows run. A pull request reuses a recorded pass
 * of any of its commits, a failed row is retried at most three times per
 * commit, a merge executes once for its own source, and reused evidence keeps
 * the identity of the run that produced it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { E2E_MAX_ATTEMPTS, PR_GATE_ROWS, collectLedger, formatPlanSummary, ledgerArtifactName, ledgerRecord, ledgerScopeKey, planMatrixRows, resolveScope } from '../scripts/e2e-plan.lib.mjs';

const TAG = 'v0.360.0';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const record = (tool, outcome, { sourceSha = SHA_A, runId = '100', runAttempt = '1', reusedFrom = null, formalAiTag = TAG, at = '2026-10-21T00:00:00Z' } = {}) => ledgerRecord({ tool, model: 'formal-ai', scope: 'pull-request', scopeKey: 'pr7', outcome, formalAiTag, pullRequest: 7, custody: { runId, runAttempt, sourceRepository: 'link-assistant/hive-mind', sourceSha }, reusedFrom, now: new Date(at) });

test('the pull request gate runs the three Formal AI clients only', () => {
  assert.deepEqual(
    PR_GATE_ROWS.map(row => row.tool),
    ['claude', 'agent', 'codex']
  );
  const plan = planMatrixRows({ scope: 'pull-request', formalAiTag: TAG, sourceSha: SHA_A });
  assert.equal(plan['agent/nemotron-3-super-free'].action, 'skip');
  for (const tool of ['claude', 'agent', 'codex']) assert.deepEqual(plan[`${tool}/formal-ai`], { action: 'run', reason: 'no recorded pass', attempt: 1 });
});

test('a pass of an earlier commit of the pull request is reused with its origin', () => {
  const history = [record('codex', 'passed', { sourceSha: SHA_A, runId: '100' })];
  const plan = planMatrixRows({ scope: 'pull-request', history, formalAiTag: TAG, sourceSha: SHA_B });
  assert.equal(plan['codex/formal-ai'].action, 'reuse');
  assert.deepEqual(plan['codex/formal-ai'].reusedFrom, { runId: '100', runAttempt: '1', sourceRepository: 'link-assistant/hive-mind', sourceSha: SHA_A, outcome: 'passed' });
  assert.equal(plan['claude/formal-ai'].action, 'run');
});

test('reusing a reused record keeps the original source identity', () => {
  const origin = { runId: '100', runAttempt: '2', sourceRepository: 'link-assistant/hive-mind', sourceSha: SHA_A, outcome: 'passed' };
  const reused = record('codex', 'passed', { sourceSha: SHA_B, runId: '200', reusedFrom: origin });
  assert.equal(reused.executed, false);
  assert.equal(reused.sourceSha, SHA_B, 'the reusing run records its own source');
  const plan = planMatrixRows({ scope: 'pull-request', history: [reused], formalAiTag: TAG, sourceSha: 'c'.repeat(40) });
  assert.deepEqual(plan['codex/formal-ai'].reusedFrom, origin);
});

test('a pass of another Formal AI version is not reused', () => {
  const plan = planMatrixRows({ scope: 'pull-request', history: [record('codex', 'passed', { formalAiTag: 'v0.359.0' })], formalAiTag: TAG, sourceSha: SHA_A });
  assert.equal(plan['codex/formal-ai'].action, 'run');
});

test('failed rows retry with a finite bound per source', () => {
  const failures = n => Array.from({ length: n }, (_, index) => record('agent', index % 2 ? 'harness-failed' : 'failed', { runAttempt: String(index + 1) }));
  assert.deepEqual(planMatrixRows({ scope: 'pull-request', history: failures(1), formalAiTag: TAG, sourceSha: SHA_A })['agent/formal-ai'], { action: 'run', reason: `retry 2 of ${E2E_MAX_ATTEMPTS}: earlier attempts did not pass`, attempt: 2 });
  const exhausted = planMatrixRows({ scope: 'pull-request', history: failures(E2E_MAX_ATTEMPTS), formalAiTag: TAG, sourceSha: SHA_A })['agent/formal-ai'];
  assert.equal(exhausted.action, 'exhausted');
  assert.match(exhausted.reason, /3 unsuccessful attempts/);
  // A new commit of the pull request gets fresh attempts.
  assert.equal(planMatrixRows({ scope: 'pull-request', history: failures(E2E_MAX_ATTEMPTS), formalAiTag: TAG, sourceSha: SHA_B })['agent/formal-ai'].action, 'run');
  // A dispatch with force runs anyway.
  assert.equal(planMatrixRows({ scope: 'pull-request', history: failures(E2E_MAX_ATTEMPTS), formalAiTag: TAG, sourceSha: SHA_A, force: true })['agent/formal-ai'].action, 'run');
});

test('main executes once per merged source and a repeated event is a no-op', () => {
  // A pull request pass is never the merge execution.
  const prPass = record('codex', 'passed', { sourceSha: SHA_A });
  assert.equal(planMatrixRows({ scope: 'main', history: [{ ...prPass, scope: 'main' }], formalAiTag: TAG, sourceSha: SHA_B })['codex/formal-ai'].action, 'run');
  // The second completion event for the same merged source reuses the first.
  const mainPass = ledgerRecord({ tool: 'codex', model: 'formal-ai', scope: 'main', scopeKey: ledgerScopeKey({ scope: 'main', sourceSha: SHA_B }), outcome: 'passed', formalAiTag: TAG, custody: { runId: '300', runAttempt: '1', sourceRepository: 'link-assistant/hive-mind', sourceSha: SHA_B } });
  const repeated = planMatrixRows({ scope: 'main', history: [mainPass], formalAiTag: TAG, sourceSha: SHA_B });
  assert.equal(repeated['codex/formal-ai'].action, 'reuse');
  assert.equal(repeated['agent/nemotron-3-super-free'].action, 'run', 'main runs every row');
});

test('schedules and dispatches always run every row', () => {
  for (const scope of ['schedule', 'dispatch']) {
    const plan = planMatrixRows({ scope, history: [record('codex', 'passed')], formalAiTag: TAG, sourceSha: SHA_A });
    assert.ok(Object.values(plan).every(entry => entry.action === 'run'));
  }
  assert.throws(() => planMatrixRows({ scope: 'push', formalAiTag: TAG }), /Unknown E2E scope/);
});

test('scope keys and ledger names are stable and validated', () => {
  assert.equal(ledgerScopeKey({ scope: 'pull-request', pullRequest: 3631 }), 'pr3631');
  assert.equal(ledgerScopeKey({ scope: 'main', sourceSha: SHA_A }), `main-${'a'.repeat(12)}`);
  assert.equal(ledgerScopeKey({ scope: 'schedule', runId: 5 }), 'run-5');
  assert.throws(() => ledgerScopeKey({ scope: 'pull-request' }), /pull request number/);
  assert.throws(() => ledgerScopeKey({ scope: 'main', sourceSha: 'main' }), /source sha/);
  assert.equal(ledgerArtifactName({ scopeKey: 'pr7', tool: 'codex', model: 'formal-ai', runAttempt: 2 }), 'e2e-ledger-pr7-codex-formal-ai-a2');
});

test('the scope follows the explicit call, then the event', () => {
  assert.deepEqual(resolveScope({ env: { E2E_SCOPE: 'pull-request', E2E_PULL_REQUEST: '7', E2E_SOURCE_SHA: SHA_A, GITHUB_EVENT_NAME: 'pull_request' }, event: {} }), { scope: 'pull-request', pullRequest: 7, sourceSha: SHA_A });
  assert.deepEqual(resolveScope({ env: { GITHUB_EVENT_NAME: 'workflow_run', GITHUB_SHA: SHA_B }, event: { workflow_run: { head_sha: SHA_A } } }), { scope: 'main', pullRequest: null, sourceSha: SHA_A });
  assert.equal(resolveScope({ env: { GITHUB_EVENT_NAME: 'schedule' }, event: {} }).scope, 'schedule');
  assert.equal(resolveScope({ env: { GITHUB_EVENT_NAME: 'workflow_dispatch' }, event: {} }).scope, 'dispatch');
});

test('the ledger is read by exact artifact name; expired and unreadable records are skipped', async () => {
  const queried = [];
  const logs = [];
  const history = await collectLedger({
    repository: 'o/r',
    scopeKey: 'pr7',
    rows: [{ tool: 'codex', model: 'formal-ai' }],
    log: message => logs.push(message),
    api: async endpoint => {
      queried.push(decodeURIComponent(endpoint.match(/name=([^&]+)/)[1]));
      if (endpoint.includes('-a1&')) return { artifacts: [{ workflow_run: { id: 1 } }, { expired: true, workflow_run: { id: 2 } }] };
      if (endpoint.includes('-a2&')) return { artifacts: [{ workflow_run: { id: 3 } }] };
      return { artifacts: [] };
    },
    download: async ({ runId }) => {
      if (runId === 3) throw new Error('gone');
      return { v: 1, runId };
    },
  });
  assert.deepEqual(
    queried,
    [1, 2, 3, 4, 5, 6].map(attempt => `e2e-ledger-pr7-codex-formal-ai-a${attempt}`)
  );
  assert.deepEqual(history, [{ v: 1, runId: 1 }]);
  assert.match(logs[0], /run 3 is unreadable: gone/);
});

test('the plan summary escapes table cells', () => {
  assert.match(formatPlanSummary({ scope: 'pull-request', scopeKey: 'pr7', plan: { 'codex/formal-ai': { action: 'run', reason: 'a | b' } } }), /\| `codex\/formal-ai` \| run \| a \\\| b \|/);
});
