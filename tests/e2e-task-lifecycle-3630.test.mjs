/**
 * Issue #3630: the emulated lifecycle matrix of a real E2E task.
 *
 * The production row runner (`runE2eRow`), the finalize step
 * (`finalizeAndRecord`), the ledger and the fixture sweep run unchanged
 * against tests/github-emulator.mjs: success, failure, cancellation, an
 * interrupted runner, an interrupted cleanup, repeated and concurrent events,
 * and the no-op rerun of a pull request. A tripwire on PATH and on `fetch`
 * proves none of it reaches real GitHub.
 */
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createGitHubEmulator, installRealGitHubTripwire } from './github-emulator.mjs';
import { finalizeAndRecord, finalizeRow, rowExitCode, runE2eRow } from '../scripts/e2e-row.lib.mjs';
import { createBranchFixture } from '../scripts/task-fixture.lib.mjs';
import { buildCustody, custodyKey, FINALIZED_MARKER, parseMarker } from '../scripts/e2e-task-lifecycle.lib.mjs';
import { cleanupStaleFixtures } from '../scripts/cleanup-task-fixtures.lib.mjs';
import { collectLedger, ledgerArtifactName, planMatrixRows, PR_GATE_ROWS } from '../scripts/e2e-plan.lib.mjs';
import { ghApi } from '../scripts/github-actions.lib.mjs';

const REPOSITORY = 'link-assistant/hive-mind';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const TAG = 'v0.360.0';

let tripwire;
before(() => {
  tripwire = installRealGitHubTripwire();
});
after(() => tripwire.restore());
afterEach(() => assert.deepEqual(tripwire.invocations(), [], 'an emulated test reached a real gh, git, docker, act, curl, wget or fetch'));

/** The environment the row and finalize steps of the matrix workflow get. */
const rowEnv = ({ runId = '5001', runAttempt = '1', tool = 'codex', model = 'formal-ai', scope = 'pull-request', sourceSha = SHA_A, ...extra } = {}) => ({
  GITHUB_REPOSITORY: REPOSITORY,
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/e2e-hello-world-matrix.yml@refs/pull/3631/merge`,
  GITHUB_RUN_ID: runId,
  GITHUB_RUN_ATTEMPT: runAttempt,
  GITHUB_JOB: 'hello-world',
  E2E_TOOL: tool,
  E2E_MODEL: model,
  E2E_SCOPE: scope,
  E2E_SCOPE_KEY: scope === 'pull-request' ? 'pr3631' : `main-${sourceSha.slice(0, 12)}`,
  E2E_PULL_REQUEST: scope === 'pull-request' ? '3631' : '',
  E2E_SOURCE_SHA: sourceSha,
  E2E_FORMAL_AI_TAG: TAG,
  E2E_DEFER_FINALIZE: 'true',
  E2E_EVIDENCE_ARTIFACT: `e2e-hello-world-${tool}-${model}-a${runAttempt}`,
  ...extra,
});

/** One row job: the run step, then the always() finalize step. */
async function rowJob(github, { env = rowEnv(), jobStatus = null, deps = {}, finalize = true } = {}) {
  const hostLogDir = mkdtempSync(join(tmpdir(), 'e2e-row-'));
  const ledgerDir = join(hostLogDir, 'ledger');
  const evidence = await runE2eRow({ tool: env.E2E_TOOL, model: env.E2E_MODEL, hostLogDir, env, deps: github.deps(deps) });
  const finalized = finalize ? await finalizeAndRecord({ hostLogDir, ledgerDir, env: { ...env, E2E_JOB_STATUS: jobStatus || (rowExitCode(evidence, { scope: env.E2E_SCOPE }) ? 'failure' : 'success') }, deps: github.deps() }) : null;
  return { evidence, finalized, hostLogDir, ledgerDir };
}

const finalizationComments = (github, number) => github.commentsOf(number).filter(body => parseMarker(body, FINALIZED_MARKER));

test('the tripwire catches a real GitHub call (positive control)', async () => {
  await assert.rejects(ghApi('repos/o/r'));
  await assert.rejects(fetch('https://api.github.com/repos/o/r'), /tripwire/);
  const caught = tripwire.invocations();
  assert.ok(
    caught.some(line => line.startsWith('gh api repos/o/r')),
    caught.join('\n')
  );
  assert.ok(caught.includes('fetch https://api.github.com/repos/o/r'));
  assert.equal(process.env.GH_TOKEN, undefined);
  tripwire.reset();
});

test('success: the task issue and pull request are closed as completed with the run reference', async () => {
  const github = createGitHubEmulator();
  const { evidence, finalized } = await rowJob(github);
  assert.equal(evidence.passed, true, JSON.stringify(evidence.evaluation?.results ?? evidence.error));
  assert.equal(finalized.outcome, 'passed');
  assert.equal(finalized.finalization.failed, false, finalized.finalization.errors.join('\n'));
  const [issue] = github.issues();
  assert.equal(github.issues().length, 1);
  assert.deepEqual([issue.state, issue.state_reason], ['closed', 'completed']);
  assert.ok(issue.labels.includes('e2e-task'));
  const [pull] = github.pulls();
  assert.equal(pull.state, 'closed');
  const [comment] = finalizationComments(github, issue.number);
  assert.equal(parseMarker(comment, FINALIZED_MARKER).key, `${REPOSITORY}/5001/1/codex-formal-ai`);
  assert.match(comment, /\| Outcome \| `passed` \|/);
  assert.match(comment, /\[5001 attempt 1\]\(https:\/\/github\.com\/link-assistant\/hive-mind\/actions\/runs\/5001\)/);
  assert.match(comment, new RegExp(`link-assistant/hive-mind@${SHA_A}`));
  assert.match(comment, /artifact `e2e-hello-world-codex-formal-ai-a1`/);
  assert.deepEqual([...github.state.refs.keys()], [], 'the base and head branches are removed');
  assert.equal(github.state.sessions, 1);
  assert.equal(finalized.record.outcome, 'passed');
  assert.equal(finalized.record.executed, true);
});

test('failure: a wrong delivery is closed as not planned, and is advisory on a pull request only', async () => {
  for (const scope of ['pull-request', 'main']) {
    const github = createGitHubEmulator({ agent: 'wrongOutput' });
    const { evidence, finalized } = await rowJob(github, { env: rowEnv({ scope }) });
    assert.equal(evidence.passed, false);
    assert.equal(evidence.verdict.harness, true);
    assert.ok(evidence.evaluation.results.some(result => result.name === 'program prints exactly "Hello, World!"' && !result.ok));
    assert.equal(rowExitCode(evidence, { scope }), scope === 'pull-request' ? 0 : 1);
    // The finalize step sees the job status; a failed model verdict is `failed` either way.
    assert.equal(finalized.outcome, 'failed');
    const [issue] = github.issues();
    assert.deepEqual([issue.state, issue.state_reason], ['closed', 'not_planned']);
    assert.match(finalizationComments(github, issue.number)[0], /program prints exactly/);
  }
});

test('failure: a session that opens no pull request still closes its task', async () => {
  const github = createGitHubEmulator({ agent: 'noPullRequest' });
  const { evidence, finalized } = await rowJob(github);
  assert.equal(evidence.solveExitCode, 1);
  assert.equal(finalized.outcome, 'failed');
  const [issue] = github.issues();
  assert.deepEqual([issue.state, issue.state_reason], ['closed', 'not_planned']);
  assert.match(finalizationComments(github, issue.number)[0], /solve opened no pull request/);
  assert.deepEqual([...github.state.refs.keys()], []);
});

test('cancel: an aborted session is finalized as cancelled by the always() step', async () => {
  const github = createGitHubEmulator({ agent: 'hang' });
  const controller = new AbortController();
  const exec = (command, argv, options) => {
    const running = github.exec(command, argv, options);
    if (command === 'docker' && argv[0] === 'run' && !argv.includes('--version')) setImmediate(() => controller.abort());
    return running;
  };
  const { evidence, finalized } = await rowJob(github, { deps: { exec, signal: controller.signal }, jobStatus: 'cancelled' });
  assert.equal(evidence.cancelled, true);
  assert.equal(evidence.finishedAt, undefined);
  assert.equal(finalized.outcome, 'cancelled');
  const [issue] = github.issues();
  assert.deepEqual([issue.state, issue.state_reason], ['closed', 'not_planned']);
  assert.match(finalizationComments(github, issue.number)[0], /\| Outcome \| `cancelled` \|/);
  assert.equal(finalized.record.outcome, 'cancelled');
});

test('interrupted: a runner that died mid-session leaves evidence the finalize step closes as interrupted', async () => {
  const github = createGitHubEmulator({ agent: 'hang' });
  const controller = new AbortController();
  const hostLogDir = mkdtempSync(join(tmpdir(), 'e2e-row-'));
  const env = rowEnv();
  const running = runE2eRow({ tool: 'codex', model: 'formal-ai', hostLogDir, env, deps: github.deps({ signal: controller.signal }) });
  while (github.state.sessions === 0) await new Promise(resolve => setImmediate(resolve));
  const finalized = await finalizeAndRecord({ hostLogDir, ledgerDir: join(hostLogDir, 'ledger'), env: { ...env, E2E_JOB_STATUS: 'failure' }, deps: github.deps() });
  assert.equal(finalized.outcome, 'interrupted');
  const evidence = JSON.parse(readFileSync(join(hostLogDir, 'result.json'), 'utf8'));
  assert.ok(
    evidence.commands.some(command => command.logName === 'solve.log' && command.interrupted),
    'the session is recorded as interrupted'
  );
  const manifest = JSON.parse(readFileSync(join(hostLogDir, 'manifest.json'), 'utf8'));
  assert.ok(manifest.missing.includes('delivery.json'), 'missing evidence is marked, not dropped');
  const [issue] = github.issues();
  assert.deepEqual([issue.state, issue.state_reason], ['closed', 'not_planned']);
  assert.match(finalizationComments(github, issue.number)[0], /stopped before it recorded a verdict/);
  controller.abort();
  await running;
});

test('interrupted cleanup: a failed close is reported, and running the finalize step again completes it without a second comment', async () => {
  const github = createGitHubEmulator();
  github.fail({ method: 'PATCH', match: /\/issues\/\d+$/, message: 'gh: Server Error (HTTP 502)' });
  const { hostLogDir, ledgerDir, finalized: first } = await rowJob(github);
  assert.equal(first.finalization.failed, true);
  assert.match(first.finalization.errors.join('\n'), /close issues #\d+: .*HTTP 502/);
  const [issue] = github.issues();
  assert.equal(issue.state, 'open', 'the issue stays open for the retry');
  const again = await finalizeAndRecord({ hostLogDir, ledgerDir, env: { ...rowEnv(), E2E_JOB_STATUS: 'success' }, deps: github.deps() });
  assert.equal(again.finalization.failed, false, again.finalization.errors.join('\n'));
  assert.ok(again.finalization.actions.includes('outcome comment reused'));
  assert.deepEqual([issue.state, issue.state_reason], ['closed', 'completed']);
  assert.equal(finalizationComments(github, issue.number).length, 1);
  // A third run changes nothing: the only requests left are deletes of branches that are already gone.
  const before = github.mutations().length;
  const third = await finalizeAndRecord({ hostLogDir, ledgerDir, env: { ...rowEnv(), E2E_JOB_STATUS: 'success' }, deps: github.deps() });
  assert.equal(third.finalization.failed, false);
  assert.ok(
    github
      .mutations()
      .slice(before)
      .every(call => call.method === 'DELETE'),
    'nothing but idempotent deletes'
  );
  assert.equal(finalizationComments(github, issue.number).length, 1);
  assert.deepEqual([...github.state.refs.keys()], []);
});

test('sweep: a task whose finalize step never ran is recovered from its completed run; active and unowned issues are preserved', async () => {
  const github = createGitHubEmulator();
  await rowJob(github, { env: rowEnv({ runId: '6001' }), finalize: false });
  await rowJob(github, { env: rowEnv({ runId: '6002', tool: 'agent' }), finalize: false });
  const ordinary = await github.api(`repos/${REPOSITORY}/issues`, { method: 'POST', body: { title: 'Implement Hello World in Rust', body: 'A feature request that happens to carry the label.', labels: ['e2e-task'] } });
  github.setRun(6001, {
    jobs: [
      { name: 'hello-world (codex, formal-ai)', conclusion: 'success' },
      { name: 'hello-world (agent, formal-ai)', conclusion: 'success' },
    ],
  });
  github.setRun(6002, { status: 'in_progress', conclusion: null });
  const [recovered, active] = github.issues();
  const result = await cleanupStaleFixtures({ repository: REPOSITORY, api: github.api, list: github.list, now: Date.parse('2026-10-23T12:00:00Z'), log: () => {}, warn: () => {} });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.finalized.map(entry => [entry.number, entry.outcome, entry.runId]),
    [[recovered.number, 'passed', '6001']]
  );
  assert.deepEqual([recovered.state, recovered.state_reason], ['closed', 'completed']);
  assert.match(finalizationComments(github, recovered.number)[0], /Finalized by \| scheduled fixture sweep/);
  assert.deepEqual(
    result.preserved.map(entry => [entry.number, entry.state]),
    [
      [ordinary.number, 'unproven'],
      [active.number, 'active'],
    ].sort((a, b) => b[0] - a[0])
  );
  assert.equal(active.state, 'open');
  assert.equal(github.state.issues.get(ordinary.number).state, 'open', 'a label, title and age prove nothing');
  assert.ok(
    [...github.state.refs.keys()].every(branch => !branch.includes('6001')),
    'the recovered task branches are removed'
  );
  assert.ok(github.state.refs.has('e2e/hello-world/6002/agent-formal-ai'), 'a running row keeps its branches');
});

test('retention: a ruleset that forbids deleting branches warns on a pull request and fails after a merge', async () => {
  for (const scope of ['pull-request', 'main']) {
    const github = createGitHubEmulator();
    github.forbidDeletion(/^e2e\//);
    const { finalized } = await rowJob(github, { env: rowEnv({ scope }) });
    assert.deepEqual(finalized.finalization.retainedBranches, ['e2e/hello-world/5001/codex-formal-ai']);
    assert.equal(finalized.finalization.failed, scope === 'main');
    assert.equal(github.issues()[0].state, 'closed', 'retention never keeps the task open');
  }
});

test('repeated invocation of one attempt adopts its task: no duplicate issue and no second session', async () => {
  const github = createGitHubEmulator();
  github.fail({ method: 'EXEC', match: /^act /, message: 'runner lost communication with the server' });
  const first = await rowJob(github, { finalize: false });
  assert.equal(first.evidence.verdict.harness, false);
  const second = await rowJob(github);
  assert.equal(second.evidence.reusedTask, true);
  assert.equal(second.evidence.passed, true, JSON.stringify(second.evidence.evaluation?.results ?? second.evidence.error));
  assert.equal(github.state.sessions, 1);
  assert.equal(github.issues().length, 1);
  assert.equal(github.issues()[0].state, 'closed');
  // After finalization removed the base branch, the same attempt still does not start again.
  const third = await rowJob(github);
  assert.match(third.evidence.error, /already finalized/);
  assert.equal(github.issues().length, 1);
  assert.equal(github.state.sessions, 1);
});

test('concurrent fixture creation for one custody opens exactly one issue', async () => {
  const github = createGitHubEmulator();
  const custody = buildCustody({ repository: REPOSITORY, task: 'codex-formal-ai', baseBranch: 'e2e/hello-world/7001/codex-formal-ai', env: rowEnv({ runId: '7001' }) });
  const create = () => createBranchFixture({ repository: REPOSITORY, baseBranch: custody.baseBranch, readme: 'task', title: 'Hello', body: 'body', custody, api: github.api, runGh: github.gh, list: github.list, lockWaitMs: 5_000, pollMs: 0, wait: () => new Promise(resolve => setImmediate(resolve)) });
  const results = await Promise.all([create(), create(), create()]);
  assert.equal(github.issues().length, 1);
  assert.equal(new Set(results.map(result => result.issueNumber)).size, 1);
  assert.deepEqual(results.map(result => Boolean(result.reused)).sort(), [false, true, true]);
  assert.ok(results.every(result => result.custodyKey === custodyKey(custody)));
  // A branch of the same name that is not this custody's is never adopted.
  const other = buildCustody({ repository: REPOSITORY, task: 'codex-formal-ai', baseBranch: custody.baseBranch, env: rowEnv({ runId: '7001', runAttempt: '2' }) });
  await assert.rejects(createBranchFixture({ repository: REPOSITORY, baseBranch: custody.baseBranch, readme: 'task', title: 'Hello', body: 'body', custody: other, api: github.api, runGh: github.gh, list: github.list }), /not owned by/);
});

test('repeated pull request events: a recorded pass is reused through the ledger and creates no task', async () => {
  const github = createGitHubEmulator();
  // The first run of the pull request executes all three rows and uploads their ledgers.
  for (const { tool, model } of PR_GATE_ROWS) {
    const { finalized } = await rowJob(github, { env: rowEnv({ tool, model }) });
    assert.equal(finalized.outcome, 'passed');
    github.uploadArtifact({ runId: 5001, name: ledgerArtifactName({ scopeKey: 'pr3631', tool, model, runAttempt: 1 }), files: { 'ledger.json': JSON.stringify(finalized.record) } });
  }
  const issuesBefore = github.state.issues.size;
  const mutationsBefore = github.mutations().length;
  // A later push (or a re-delivered event) of the same pull request plans from the ledger.
  const history = await collectLedger({
    repository: REPOSITORY,
    scopeKey: 'pr3631',
    rows: PR_GATE_ROWS,
    api: github.api,
    download: async ({ runId, name }) => {
      const directory = await mkdtemp(join(tmpdir(), 'e2e-ledger-'));
      try {
        await github.gh(['run', 'download', String(runId), '--repo', REPOSITORY, '--name', name, '--dir', directory]);
        return readdirSync(directory).map(file => JSON.parse(readFileSync(join(directory, file), 'utf8')));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  });
  assert.equal(history.length, 3);
  const plan = planMatrixRows({ scope: 'pull-request', history, formalAiTag: TAG, sourceSha: SHA_B });
  for (const { tool, model } of PR_GATE_ROWS) {
    assert.equal(plan[`${tool}/${model}`].action, 'reuse');
    assert.deepEqual(plan[`${tool}/${model}`].reusedFrom, { runId: '5001', runAttempt: '1', sourceRepository: REPOSITORY, sourceSha: SHA_A, outcome: 'passed' });
  }
  assert.equal(github.state.issues.size, issuesBefore, 'the no-op rerun creates no task');
  assert.equal(github.mutations().length, mutationsBefore, 'planning only reads');
  // A merge of that source still executes once for its own source.
  const mainPlan = planMatrixRows({ scope: 'main', history: history.map(record => ({ ...record, scope: 'main' })), formalAiTag: TAG, sourceSha: SHA_B });
  assert.ok(PR_GATE_ROWS.every(({ tool, model }) => mainPlan[`${tool}/${model}`].action === 'run'));
});

test('finalizeRow without custody is a no-op, and a kept task is not finalized', async () => {
  const hostLogDir = mkdtempSync(join(tmpdir(), 'e2e-row-'));
  const github = createGitHubEmulator();
  assert.deepEqual((await finalizeRow({ hostLogDir, env: {}, deps: github.deps() })).actions, ['no owned task to finalize']);
  const kept = await finalizeAndRecord({ hostLogDir, ledgerDir: join(hostLogDir, 'ledger'), env: { E2E_KEEP: 'true' }, deps: github.deps() });
  assert.deepEqual(kept.finalization.actions, ['kept for inspection (E2E_KEEP)']);
  assert.equal(kept.record, null, 'no ledger scope, no record');
  assert.deepEqual(github.calls, []);
});
