/** @hive-mind-test-suite default,pr-essential */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { draftRunLinks, stageDraftEvidence } from '../scripts/formal-ai-draft-evidence.lib.mjs';
import { findRepeatedFailure, formatRepeatedFailureReport, runOutcomeFromAnnotations } from '../scripts/formal-ai-draft-health.lib.mjs';
import { draftChangeEvidence, FINAL_OUTCOME_ANNOTATION, makeDraftOutcome, OUTCOME_ANNOTATION, OUTCOME_FILE, parseDraftOutcome, withActionsEvidence } from '../scripts/formal-ai-draft-outcome.lib.mjs';
import { DRAFT_FAILURE_ANNOTATION_TITLE } from '../scripts/formal-ai-draft.lib.mjs';

const run = 'https://github.com/link-assistant/hive-mind/actions/runs/41081977243';
const job = `${run}/job/124153176671`;
const artifact = `${run}/artifacts/12990367865`;
const target = 'https://github.com/link-assistant/hive-mind/issues/3863';
const replay = await readFile(new URL('./fixtures/formal-ai-draft-3910/oct30.log.txt', import.meta.url), 'utf8');
const processResult = exitCode => ({ started: true, exitCode });

const october = makeDraftOutcome({ target, links: { run, job }, log: replay, process: processResult(5), runtime: { image: 'konard/hive-mind:2.39.9' } });

test('October 30 replay keeps the missing effect, exit 5, external 403 and Actions evidence', () => {
  const outcome = withActionsEvidence(october, { status: 'success', url: artifact, sessionLogs: 1 });
  assert.deepEqual(parseDraftOutcome(JSON.stringify(outcome)), outcome);
  assert.equal(outcome.primary.code, 'no_requested_implementation');
  assert.equal(outcome.task.acceptance, 'rejected');
  assert.equal(outcome.solver.terminalState, 'planned_not_executed');
  assert.equal(outcome.solver.source, 'legacy-log');
  assert.equal(outcome.process.exitCode, 5);
  assert.equal(outcome.runtime.solveVersion, '2.39.9');
  assert.equal(outcome.runtime.backendVersion, '0.355.15');
  assert.equal(outcome.evidence.optional.status, 'recovered');
  assert.equal(outcome.evidence.optional.httpStatus, 403);
  assert.deepEqual(outcome.evidence.optional.failedDestinations, ['gist', 'repository']);
  assert.deepEqual(outcome.evidence.actions, { status: 'retained', url: artifact, sessionLogs: 1 });
  assert.deepEqual(outcome.links, { run, job });
});

test('health groups the capability gap even when optional upload results differ', () => {
  const runs = [403, 500, 0, 403, 0].map((status, index) => {
    const log = status
      ? replay.replaceAll('403', String(status))
      : replay
          .split('\n')
          .filter(line => !line.includes('403'))
          .join('\n');
    const preliminary = makeDraftOutcome({ target, log, process: processResult(5), links: { run, job } });
    const final = withActionsEvidence(preliminary, { status: 'success', url: artifact });
    const annotations = [
      { title: DRAFT_FAILURE_ANNOTATION_TITLE, message: `Upload failed with HTTP ${status}` },
      { title: OUTCOME_ANNOTATION, message: JSON.stringify(preliminary) },
      { title: FINAL_OUTCOME_ANNOTATION, message: JSON.stringify(final) },
    ];
    return runOutcomeFromAnnotations({ html_url: run, status: 'completed', conclusion: 'failure', created_at: new Date(index).toISOString() }, annotations, { html_url: job });
  });
  assert.ok(runs.every(entry => entry.outcome.evidence.actions.status === 'retained'));
  const streak = findRepeatedFailure(runs);
  assert.equal(streak.key, 'outcome no_requested_implementation (planned_not_executed)');
  assert.equal(streak.count, 5);
  assert.ok(formatRepeatedFailureReport(streak, null).includes(job));
});

test('task and verification outcomes stay distinct from process and publication', () => {
  const failed = processResult(1);
  const cases = [
    ['missing_evidence', { process: processResult(5), log: '⚠️  Finished without changes: Formal AI produced no change (terminal state: blocked_missing_evidence)' }],
    ['unsupported_task', { process: processResult(5), log: '⚠️  Finished without changes: Formal AI produced no change (terminal state: unsupported_task)' }],
    ['compiler_failure', { process: failed, log: 'error[E0308]: mismatched types\nX Failed to create gist: HTTP 403' }],
    ['incorrect_implementation', { process: failed, change: 'implementation_diff', verification: { failed: true } }],
    ['tool_runtime_failure', { process: failed, log: '❌ Agent reported error: server disconnected' }],
    ['implementation_present', { process: processResult(0), change: 'implementation_diff', log: 'X Failed to create gist: HTTP 403' }],
  ];
  for (const [code, input] of cases) {
    const outcome = makeDraftOutcome(input);
    assert.equal(outcome.primary.code, code);
    assert.equal(outcome.task.usefulChange, code === 'implementation_present');
  }
  const implementation = makeDraftOutcome(cases.at(-1)[1]);
  assert.equal(implementation.task.acceptance, 'unverified');
  assert.equal(implementation.evidence.optional.status, 'failed');
  assert.equal(withActionsEvidence(implementation, { status: 'failure' }).primary.code, 'implementation_present');
});

test('Formal AI #1485 deferral stays before effects and does not count as execution', () => {
  const process = { started: false, exitCode: null };
  const deferral = {
    schema: 'formal-ai-hive-client-outcome/v1',
    state: 'deferred-before-effects',
    effects: { claimed: false },
    executionCredit: 0,
    authorshipCredit: 0,
    prerequisites: [{ run: 40675356715, attempt: 2, path: '.github/workflows/task-ladder.yml', event: 'push', status: 'in_progress', conclusion: null }],
  };
  const outcome = makeDraftOutcome({ deferral, process });
  assert.equal(outcome.primary.code, 'deferred_before_effects');
  assert.equal(outcome.primary.stage, 'admission');
  assert.equal(outcome.task.acceptance, 'deferred');
  assert.equal(outcome.task.usefulChange, false);
  assert.equal(outcome.process.exitCode, null);
  assert.equal(outcome.infrastructure.prerequisites[0].run, 40675356715);
  assert.equal(outcome.infrastructure.prerequisites[0].attempt, 2);
  assert.equal(findRepeatedFailure([{ outcome, status: 'completed', conclusion: 'failure' }], { threshold: 1 }), null);
  const claimed = { ...deferral, effects: { claimed: true } };
  assert.notEqual(makeDraftOutcome({ deferral: claimed, process }).primary.code, 'deferred_before_effects');
  assert.notEqual(makeDraftOutcome({ deferral, process: processResult(1) }).primary.code, 'deferred_before_effects');
  assert.notEqual(makeDraftOutcome({ deferral, process, log: replay }).primary.code, 'deferred_before_effects');
});

test('only a same-source continuation with passing independent checks gets no-op acceptance', () => {
  const source = 'a'.repeat(40);
  const verification = { source, testedSource: source, checks: [{ id: 'contract-test', conclusion: 'success' }] };
  const diagnostics = ['.gitkeep', '.formal-ai/general-change-plan.lino', 'dev/log/solve.log', 'report.log.gz', 'metadata.json'];
  const change = draftChangeEvidence(diagnostics);
  assert.equal(change, 'diagnostics_only');
  assert.equal(draftChangeEvidence([...diagnostics, 'src/fix.mjs']), 'implementation_diff');

  const input = { process: processResult(5), change, verification };
  assert.equal(makeDraftOutcome(input).primary.code, 'no_requested_implementation');
  assert.equal(makeDraftOutcome({ ...input, process: processResult(0) }).task.usefulChange, false);
  const repeat = { ...input, attemptKind: 'continuation' };
  const noop = makeDraftOutcome(repeat);
  assert.equal(noop.primary.code, 'verified_noop');
  assert.equal(noop.task.acceptance, 'accepted');
  assert.equal(noop.task.usefulChange, false);
  assert.equal(makeDraftOutcome({ ...repeat, verification: { ...verification, testedSource: 'b'.repeat(40) } }).primary.code, 'no_requested_implementation');
  assert.equal(makeDraftOutcome({ ...repeat, verification: { ...verification, checks: [{ id: 'ci', conclusion: 'cancelled' }] } }).primary.code, 'no_requested_implementation');
});

test('job lookup binds the numeric job to the current runner and run attempt', async () => {
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'link-assistant/hive-mind', GITHUB_RUN_ID: '41081977243', GITHUB_RUN_ATTEMPT: '2', RUNNER_NAME: 'my runner' };
  const links = await draftRunLinks(env, async endpoint => {
    assert.match(endpoint, /41081977243\/attempts\/2\/jobs/);
    return [
      {
        jobs: [
          { id: 42, runner_name: 'my runner', status: 'completed' },
          { id: 124153176671, runner_name: 'my runner', status: 'in_progress' },
        ],
      },
    ];
  });
  assert.deepEqual(links, { run, job });
});

test('the direct Formal AI workflow entry point publishes a consumable draft record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draft-contract-3910-'));
  try {
    const bin = join(root, 'bin');
    const logs = join(root, 'logs');
    const event = join(root, 'event.json');
    const fixture = new URL('./fixtures/formal-ai-draft-3910/oct30.log.txt', import.meta.url);
    const draft = new URL('../scripts/formal-ai-draft.mjs', import.meta.url);
    const finalize = new URL('../scripts/formal-ai-draft-evidence.mjs', import.meta.url);
    await mkdir(bin);
    await writeFile(event, JSON.stringify({ action: 'opened', issue: { number: 3863, html_url: target, labels: [], user: { login: 'someone', type: 'User' } } }));
    await writeFile(join(bin, 'gh'), '#!/bin/sh\necho "[]"\n', { mode: 0o755 });
    await writeFile(join(bin, 'docker'), '#!/bin/sh\nif [ "$1" = run ]; then cp "$DRAFT_REPLAY_FIXTURE" "$FORMAL_AI_DRAFT_LOG_DIR/solve-fixture.log"; exit 5; fi\n', { mode: 0o755 });
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: root,
      GITHUB_OUTPUT: join(root, 'output'),
      GITHUB_EVENT_NAME: 'issues',
      GITHUB_EVENT_PATH: event,
      GITHUB_REPOSITORY: 'link-assistant/hive-mind',
      FORMAL_AI_DRAFT_LOG_DIR: logs,
      FORMAL_AI_DRAFT_IMAGE: 'konard/hive-mind:test',
      DRAFT_REPLAY_FIXTURE: fixture.pathname,
    };
    const result = spawnSync(process.execPath, [draft.pathname], { env, encoding: 'utf8' });
    assert.equal(result.status, 5, result.stdout + result.stderr);
    assert.match(result.stdout, /Formal AI draft failed::No requested implementation was produced \(planned_not_executed\)/u);
    const outcome = parseDraftOutcome(await readFile(join(logs, OUTCOME_FILE), 'utf8'));
    assert.equal(outcome.primary.code, 'no_requested_implementation');
    assert.equal(outcome.evidence.actions.status, 'unconfirmed');

    const published = spawnSync(process.execPath, [finalize.pathname, '--finalize'], {
      encoding: 'utf8',
      env: { ...env, FORMAL_AI_DRAFT_ARTIFACT_STATUS: 'success', FORMAL_AI_DRAFT_ARTIFACT_URL: artifact, FORMAL_AI_DRAFT_SESSION_LOGS: '1' },
    });
    assert.equal(published.status, 0, published.stderr);
    const jsonLine = (await readFile(env.GITHUB_OUTPUT, 'utf8')).trim().split('\n').at(-1);
    const final = parseDraftOutcome(jsonLine.slice('draft_outcome='.length));
    assert.equal(final.evidence.actions.url, artifact);
    assert.equal(final.process.exitCode, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('artifact staging only sends recognized logs through the sanitizer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draft-artifact-3910-'));
  try {
    await writeFile(join(root, 'solve-a.log'), 'secret');
    await writeFile(join(root, 'attempt.stdout.log'), 'raw caller capture');
    await symlink(join(root, 'solve-a.log'), join(root, 'solve-b.log'));
    const destination = join(root, 'sanitized');
    const count = await stageDraftEvidence({
      logDir: root,
      destination,
      outcome: october,
      sanitize: async ({ sourcePath, destPath }) => {
        assert.equal(await readFile(sourcePath, 'utf8'), 'secret');
        await writeFile(destPath, '[REDACTED]');
      },
    });
    assert.equal(count, 1);
    assert.equal(await readFile(join(destination, 'solve-a.log'), 'utf8'), '[REDACTED]');
    await assert.rejects(readFile(join(destination, 'solve-b.log')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(destination, 'attempt.stdout.log')), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
