/**
 * Issue #3630: recorded E2E attempts replay deterministically.
 *
 * Each fixture in tests/fixtures/e2e-replay was derived from a real run's
 * evidence by scripts/e2e-derive-replay.mjs. The production row runner runs it
 * against the GitHub emulator: the session delivers what the recorded session
 * delivered, act prints the recorded act log, and the same oracles judge it.
 * The verdicts must match the recorded ones, except where an oracle was fixed
 * after the recording; those changes are listed with the fix.
 */
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createGitHubEmulator, installRealGitHubTripwire } from './github-emulator.mjs';
import { finalizeAndRecord, rowExitCode, runE2eRow } from '../scripts/e2e-row.lib.mjs';
import { compareReplay, contentFromPatch, deriveReplay, replayName, sessionLogExcerpt } from '../scripts/e2e-replay.lib.mjs';
import { redactForFixture } from '../scripts/e2e-evidence.lib.mjs';

const FIXTURES = new URL('./fixtures/e2e-replay/', import.meta.url);
const fixtures = readdirSync(FIXTURES)
  .filter(name => name.endsWith('.json'))
  .sort()
  .map(name => JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')));

/**
 * Oracles fixed after a fixture was recorded: the result the fixed oracle
 * gives for that recording, and the change that fixed it.
 */
const ORACLE_CHANGES = {
  '39505806192-codex-formal-ai': {
    // 320e0a21e: solve's own dev/log session files are not part of the answer…
    'diff is the program, the workflow and a test script': true,
    // …and act's JSON logger keeps the program's newline in `msg`.
    'program prints exactly "Hello, World!"': true,
  },
};

let tripwire;
before(() => {
  tripwire = installRealGitHubTripwire();
});
after(() => tripwire.restore());
afterEach(() => assert.deepEqual(tripwire.invocations(), [], 'a replay reached a real gh, git, docker, act, curl, wget or fetch'));

const rowEnv = ({ tool, model, layer = 'default', formalAiTag }) => ({
  GITHUB_REPOSITORY: 'link-assistant/hive-mind',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_WORKFLOW_REF: 'link-assistant/hive-mind/.github/workflows/e2e-hello-world-matrix.yml@refs/pull/3631/merge',
  GITHUB_RUN_ID: '7001',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_JOB: 'hello-world',
  AUTOMATION_LAYER: layer,
  E2E_TOOL: tool,
  E2E_MODEL: model,
  E2E_SCOPE: 'pull-request',
  E2E_SCOPE_KEY: 'pr3631',
  E2E_PULL_REQUEST: '3631',
  E2E_SOURCE_SHA: 'c'.repeat(40),
  E2E_FORMAL_AI_TAG: formalAiTag || '',
  E2E_DEFER_FINALIZE: 'true',
  E2E_EVIDENCE_ARTIFACT: `e2e-hello-world-${tool}-${model}-a1`,
});

/** Replay one fixture through the production runner and finalizer. */
async function replay(fixture) {
  const github = createGitHubEmulator({ formalAiVersion: String(fixture.source.formalAiVersion || '').replace(/^formal-ai /, '') || '0.0.0' });
  github.useReplay(fixture);
  const env = rowEnv({ ...fixture.source });
  const hostLogDir = mkdtempSync(join(tmpdir(), 'e2e-replay-'));
  const evidence = await runE2eRow({ tool: fixture.source.tool, model: fixture.source.model, hostLogDir, env, deps: github.deps() });
  const { finalization } = await finalizeAndRecord({ hostLogDir, ledgerDir: join(hostLogDir, 'ledger'), env: { ...env, E2E_JOB_STATUS: rowExitCode(evidence, { scope: env.E2E_SCOPE }) ? 'failure' : 'success' }, deps: github.deps() });
  return { github, evidence, finalization, hostLogDir };
}

const verdicts = results => results.map(({ name, ok }) => ({ name, ok }));

test('the recorded fixtures exist and keep what is missing or truncated', () => {
  assert.ok(fixtures.length >= 4, 'run 39505806192 contributed four rows');
  for (const fixture of fixtures) {
    assert.ok(fixture.recorded.evaluation.length, `${fixture.name} keeps the recorded verdicts`);
    assert.ok(Array.isArray(fixture.evidence.missing), `${fixture.name} lists missing evidence`);
    // Run 39505806192 predates delivery.json and commands.json; that is stated, not hidden.
    if (fixture.source.runId === '39505806192') assert.deepEqual(fixture.evidence.missing, ['commands.json', 'delivery.json']);
    // Later runs record everything; only solve's own session files are placeholders.
    else {
      assert.deepEqual(fixture.evidence.missing, [], `${fixture.name} has complete evidence`);
      assert.ok(
        fixture.evidence.placeholders.every(path => path.startsWith('dev/log/')),
        `${fixture.name} rebuilds every answer file`
      );
    }
    if (fixture.session.log.truncated) assert.match(fixture.session.log.text, /\[replay: \d+ bytes of the session log omitted; \d+ oracle lines kept\]/);
  }
});

test('the fixtures carry no secret or personal data', () => {
  for (const fixture of fixtures) {
    const { redactions } = redactForFixture(JSON.stringify(fixture), { env: {} });
    assert.equal(redactions, 0, `${fixture.name} needs no further redaction`);
  }
});

for (const fixture of fixtures) {
  test(`replay ${fixture.name} reproduces the recorded verdicts`, async () => {
    const { github, evidence, finalization } = await replay(fixture);
    const changes = ORACLE_CHANGES[fixture.name] || {};
    const comparison = compareReplay(fixture.recorded.evaluation, evidence.evaluation.results, { changes });
    assert.deepEqual(comparison.differences, [], `${fixture.name}: replayed verdicts differ from the recorded ones`);
    assert.deepEqual(verdicts(evidence.harness), verdicts(fixture.recorded.harness), 'the harness verdicts are the recorded ones');
    assert.equal(evidence.solveExitCode, fixture.recorded.solveExitCode);
    assert.equal(github.state.sessions, 1, 'exactly one session ran');
    // Without a fixed oracle the replay passes exactly when the recording did.
    if (!Object.keys(changes).length) assert.equal(evidence.passed, fixture.recorded.passed);
    // The replayed task is finalized like a live one.
    assert.equal(finalization.outcome, evidence.passed ? 'passed' : 'failed');
    assert.ok(github.issues().every(issue => issue.state === 'closed'));
  });
}

test('a fixed oracle changes only the listed verdicts: codex row of run 39505806192 now passes', async () => {
  const fixture = fixtures.find(candidate => candidate.name === '39505806192-codex-formal-ai');
  const { evidence } = await replay(fixture);
  assert.equal(fixture.recorded.passed, false);
  assert.equal(evidence.passed, true, JSON.stringify(evidence.evaluation.results, null, 2));
});

test('a replay is deterministic', async () => {
  for (const fixture of fixtures) {
    const [first, second] = [await replay(fixture), await replay(fixture)];
    assert.deepEqual(second.evidence.evaluation, first.evidence.evaluation, fixture.name);
    assert.deepEqual(second.evidence.harness, first.evidence.harness, fixture.name);
  }
});

test('evidence of a current run derives a faithful replay (round trip)', async () => {
  const github = createGitHubEmulator({ formalAiVersion: '0.360.0' });
  const env = rowEnv({ tool: 'codex', model: 'formal-ai', formalAiTag: 'v0.360.0' });
  const hostLogDir = mkdtempSync(join(tmpdir(), 'e2e-live-'));
  const live = await runE2eRow({ tool: 'codex', model: 'formal-ai', hostLogDir, env, deps: github.deps() });
  assert.equal(live.passed, true);
  const read = name => readFileSync(join(hostLogDir, name), 'utf8');
  const present = readdirSync(hostLogDir);
  const result = JSON.parse(read('result.json'));
  const fixture = deriveReplay({ name: replayName(result), result, delivery: JSON.parse(read('delivery.json')), solveLog: read('solve.log'), actLog: read('act.log'), commands: JSON.parse(read('commands.json')), manifest: JSON.parse(read('manifest.json')), present }, { env: {} });
  assert.equal(fixture.name, '7001-codex-formal-ai');
  assert.deepEqual(fixture.evidence.missing, [], 'current evidence is complete');
  assert.deepEqual(fixture.evidence.placeholders, [], 'every delivered file is rebuilt from its patch');
  assert.equal(fixture.act.exitCodeSource, 'commands.json');
  const replayed = await replay(fixture);
  assert.deepEqual(replayed.evidence.evaluation, live.evaluation, 'the replay judges exactly what the live run judged');
  assert.deepEqual(replayed.evidence.files, live.files);
});

test('contentFromPatch rebuilds added files and refuses anything else', () => {
  assert.equal(contentFromPatch('@@ -0,0 +1,2 @@\n+fn main() {\n+}'), 'fn main() {\n}\n');
  assert.equal(contentFromPatch('@@ -0,0 +1 @@\n+echo hi\n\\ No newline at end of file'), 'echo hi');
  assert.equal(contentFromPatch('@@ -1,2 +1,2 @@\n-a\n+b'), null);
  assert.equal(contentFromPatch(null), null);
});

test('a long session log keeps its head, tail and every oracle line', () => {
  const rejection = 'remote: refusing to allow a GitHub App to create or update workflow `.github/workflows/ci.yml` without `workflows` permission';
  const log = `${'a'.repeat(10_000)}\n${rejection}\n${'b'.repeat(30_000)}\n`;
  const excerpt = sessionLogExcerpt(log);
  assert.equal(excerpt.truncated, true);
  assert.equal(excerpt.bytes, Buffer.byteLength(log));
  assert.ok(excerpt.text.includes(rejection));
  assert.ok(excerpt.text.length < log.length);
  assert.deepEqual(sessionLogExcerpt('short').truncated, false);
});
