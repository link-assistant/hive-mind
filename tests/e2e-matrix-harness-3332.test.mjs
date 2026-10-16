/**
 * @hive-mind-test-suite default
 *
 * Issue #3332: the E2E Hello World matrix could never pass.
 *
 * 1. It tested the GitHub Releases `latest` Formal AI (v0.352.1) instead of the
 *    version Hive Mind's images install (the bootstrap pin, 0.353.x).
 * 2. The default token cannot push `.github/workflows/test-hello-world.yml`;
 *    GitHub rejected the whole push and nothing reported it (run 38616580354).
 * 3. Harness failures and model failures shared one verdict.
 * 4. The Formal AI rows fail for known Formal AI causes (formal-ai#1209,
 *    formal-ai#1154); they stay red, and the summary says why.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3332
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { checkDiffShape, evaluateE2eRun, formatE2eReport } from '../scripts/e2e-hello-world.lib.mjs';
import { compareFormalAiSources, detectWorkflowPushRejection, FORMAL_AI_KNOWN_ISSUES, FORMAL_AI_RELEASES_ISSUE, readShippedFormalAiVersion, resolveShippedFormalAiVersion, splitE2eVerdict, stagedWorkflowExecution, stagedWorkflowTarget, workflowDirectoryForLayer, workflowPushRejectionResult, WORKFLOW_PUSH_REJECTED } from '../scripts/e2e-matrix-harness.lib.mjs';
import { helloWorldIssue } from '../scripts/hello-world-task.lib.mjs';
import { FORMAL_AI_BOOTSTRAP_VERSION } from '../src/formal-ai-version.lib.mjs';

const ISSUE_URL = 'https://github.com/link-assistant/hive-mind/issues/3308';
// Run 38616580354, `agent / nemotron-3-super-free`, artifact solve.log.
const REJECTED_PUSH_LOG = ['To https://github.com/link-assistant/hive-mind.git', ' ! [remote rejected] issue-3308-6b0e2f1a9c3d -> issue-3308-6b0e2f1a9c3d (refusing to allow a GitHub App to create or update workflow .github/workflows/test-hello-world.yml without workflows permission)', "error: failed to push some refs to 'https://github.com/link-assistant/hive-mind.git'"].join('\n');
const CLEAN_RUN = {
  pullRequest: { number: 2, state: 'OPEN', isDraft: false, title: 'Implement Hello World in Scala', body: 'Implements Hello World in Scala with CI.\n\nFixes #1' },
  files: ['HelloWorld.scala', 'tests/verify-output.sh', '.github/workflows/test-hello-world.yml'],
  checks: [{ __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  workflowLog: 'build\tRun\t2026-10-15T10:00:00.0000000Z Hello, World!',
  comments: [],
};

const probe = (scenario, env = {}) => JSON.parse(execFileSync(process.execPath, ['--experimental-vm-modules', 'experiments/issue-2324/matrix-schedule-probe.mjs', scenario], { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }));

test('the matrix tests the Formal AI version the images ship, not the GitHub Releases latest', { timeout: 10_000 }, () => {
  const shipped = readShippedFormalAiVersion();
  assert.equal(shipped, FORMAL_AI_BOOTSTRAP_VERSION, 'the bootstrap pin is what the images install');
  for (const dockerfile of ['Dockerfile', 'Dockerfile.formal-ai']) assert.ok(readFileSync(dockerfile, 'utf8').split('\n').includes(`ARG FORMAL_AI_VERSION=${shipped}`), `${dockerfile} installs ${shipped}`);

  const result = probe('workflow_run-success', { PROBE_SHIPPED: '0.353.2', PROBE_RELEASE: 'v0.352.1', PROBE_CRATES: '0.353.2' });
  assert.match(result.output, /formal_ai_tag=0\.353\.2\n/, 'the build and the image check receive the shipped version');
  assert.doesNotMatch(result.output, /formal_ai_tag=v?0\.352\.1/);
  assert.equal(result.metadata.formalAiTag, '0.353.2');
  assert.deepEqual(result.metadata.formalAiSources, { shipped: '0.353.2', githubRelease: '0.352.1', crates: '0.353.2' });
  const warning = result.logs.find(line => line.startsWith('::warning'));
  assert.ok(warning, 'a Releases/crates disagreement is an annotation, not a silent pick');
  assert.match(warning, /0\.352\.1/);
  assert.match(warning, /0\.353\.2/);
  assert.ok(warning.includes(FORMAL_AI_RELEASES_ISSUE), 'it links formal-ai#1203');
  assert.match(result.output, /\| Shipped by Hive Mind \(tested\) \| 0\.353\.2 \|/, 'the run summary records the tested version');
  assert.match(result.logs.at(-1), /^Matrix runs: shipped Formal AI 0\.353\.2;/);
});

test('an agreeing release, and a lookup that fails, neither warn nor stop the matrix', { timeout: 10_000 }, () => {
  const agreeing = probe('workflow_run-success', { PROBE_SHIPPED: '0.353.2', PROBE_RELEASE: 'v0.353.2', PROBE_CRATES: '0.353.2' });
  assert.equal(agreeing.logs.filter(line => line.startsWith('::warning')).length, 0);
  const offline = probe('workflow_run-success', { PROBE_SHIPPED: '0.353.2', PROBE_RELEASE: 'error', PROBE_CRATES: 'error' });
  assert.match(offline.output, /should_run=true/);
  assert.deepEqual(offline.metadata.formalAiSources, { shipped: '0.353.2', githubRelease: null, crates: null });
});

test('a schedule run skips a shipped version an older artifact recorded with a v prefix', { timeout: 10_000 }, () => {
  const result = probe('complete', { PROBE_SHIPPED: '0.353.2', PROBE_TESTED: 'v0.353.2' });
  assert.match(result.output, /should_run=false/);
});

test('a Dockerfile that installs another version makes the shipped version ambiguous', () => {
  assert.equal(resolveShippedFormalAiVersion({ pin: '0.353.2', dockerfiles: { Dockerfile: 'ARG FORMAL_AI_VERSION=0.353.2\n' } }), '0.353.2');
  assert.throws(() => resolveShippedFormalAiVersion({ pin: '0.353.2', dockerfiles: { 'Dockerfile.formal-ai': 'ARG FORMAL_AI_VERSION=0.352.1\n' } }), /Dockerfile\.formal-ai ARG FORMAL_AI_VERSION=0\.352\.1/);
  assert.deepEqual(compareFormalAiSources({ shipped: '0.353.2', githubRelease: 'v0.353.2', crates: '0.353.2' }).warnings, []);
});

test('the rejected workflow push of run 38616580354 is a harness failure, not a model failure', () => {
  const rejection = detectWorkflowPushRejection(REJECTED_PUSH_LOG);
  assert.deepEqual(rejection, { workflow: '.github/workflows/test-hello-world.yml', credential: 'GitHub App' });
  assert.equal(detectWorkflowPushRejection('remote: refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope').workflow, '.github/workflows/ci.yml');
  assert.equal(detectWorkflowPushRejection('🎉 SUCCESS: A solution draft has been prepared'), null);

  const harness = [workflowPushRejectionResult(rejection, { layer: 'app' })];
  assert.equal(harness[0].ok, false);
  assert.ok(harness[0].reason.startsWith(WORKFLOW_PUSH_REJECTED));
  assert.equal(WORKFLOW_PUSH_REJECTED, 'harness: workflow push rejected (no workflows permission)');
  assert.match(harness[0].reason, /AUTOMATION_TOKEN/, 'it tells the maintainer what to configure');

  // Only .gitkeep reached the branch: every model assertion fails too.
  const evaluation = evaluateE2eRun({ ...CLEAN_RUN, pullRequest: { ...CLEAN_RUN.pullRequest, isDraft: true }, files: ['.gitkeep'] });
  const verdict = splitE2eVerdict({ harness, evaluation });
  assert.equal(verdict.harness.ok, false);
  assert.equal(verdict.model.judged, false, 'a model is not judged on a push the harness made impossible');
  assert.equal(verdict.passed, false);

  const report = formatE2eReport({ tool: 'agent', model: 'nemotron-3-super-free', issueUrl: ISSUE_URL, evaluation, harness });
  assert.match(report, /^### ❌/);
  assert.match(report, /\*\*Harness:\*\* ❌ harness: workflow push rejected \(no workflows permission\)/);
  assert.match(report, /\*\*Model:\*\* not judged: the harness failed/);
});

test('the summary keeps the harness verdict apart from the model verdict', () => {
  const evaluation = evaluateE2eRun({ ...CLEAN_RUN, files: ['HelloWorld.scala', '.gitkeep'] });
  const harness = [{ name: 'workflow push accepted', ok: true, reason: 'no rejection in solve.log' }];
  const verdict = splitE2eVerdict({ harness, evaluation });
  assert.equal(verdict.harness.ok, true);
  assert.equal(verdict.model.judged, true);
  assert.equal(verdict.model.ok, false);
  const report = formatE2eReport({ tool: 'agent', model: 'nemotron-3-super-free', issueUrl: ISSUE_URL, evaluation, harness });
  assert.match(report, /\*\*Harness:\*\* ✅ ok/);
  assert.match(report, /\*\*Model:\*\* ❌ failed: diff is the program, the workflow and a test script/);
  assert.match(report, /\| Harness check \| Result \| Detail \|\n\|---\|---\|---\|\n\| workflow push accepted \| ✅ \|/);
  assert.doesNotMatch(report, /formal-ai\/issues/, 'the control row does not blame Formal AI');

  const clean = formatE2eReport({ tool: 'agent', model: 'nemotron-3-super-free', issueUrl: ISSUE_URL, evaluation: evaluateE2eRun(CLEAN_RUN), harness });
  assert.match(clean, /^### ✅/);
  assert.match(clean, /\*\*Model:\*\* ✅ passed/);
});

test('a failing Formal AI row stays red and links the known Formal AI causes', () => {
  assert.deepEqual(
    FORMAL_AI_KNOWN_ISSUES.map(issue => issue.url),
    ['https://github.com/link-assistant/formal-ai/issues/1209', 'https://github.com/link-assistant/formal-ai/issues/1154']
  );
  const evaluation = evaluateE2eRun({ ...CLEAN_RUN, pullRequest: { ...CLEAN_RUN.pullRequest, isDraft: true, title: '[WIP] Implement Hello World' }, files: ['.gitkeep'] });
  const report = formatE2eReport({ tool: 'claude', model: 'formal-ai', issueUrl: ISSUE_URL, evaluation, harness: [] });
  assert.match(report, /^### ❌/, 'the row stays red');
  for (const { url } of FORMAL_AI_KNOWN_ISSUES) assert.ok(report.includes(url), `the summary links ${url}`);
  const passing = formatE2eReport({ tool: 'claude', model: 'formal-ai', issueUrl: ISSUE_URL, evaluation: evaluateE2eRun(CLEAN_RUN), harness: [] });
  assert.doesNotMatch(passing, /formal-ai\/issues/);
});

test('with the default token the task stages its workflow under ci/ and the harness runs it with act', () => {
  assert.equal(workflowDirectoryForLayer('default'), 'ci/');
  assert.equal(workflowDirectoryForLayer('app'), '.github/workflows/');
  assert.equal(workflowDirectoryForLayer('token'), '.github/workflows/');

  const staged = helloWorldIssue('Scala', { workflowDir: 'ci/' }).body;
  assert.match(staged, /`ci\/test-hello-world\.yml`/);
  assert.doesNotMatch(staged, /should be in `\.github\/workflows\/`/);
  assert.match(helloWorldIssue('Scala').body, /should be in `\.github\/workflows\/` directory/, 'a token with workflows permission keeps the original task');

  const files = ['HelloWorld.scala', 'tests/verify-output.sh', 'ci/test-hello-world.yml'];
  assert.equal(checkDiffShape(files, { workflowDir: 'ci/' }).ok, true);
  assert.equal(checkDiffShape(files).ok, false, 'outside the staged mode ci/ is not a workflow');
  assert.equal(evaluateE2eRun({ ...CLEAN_RUN, files, workflowDir: 'ci/' }).passed, true);

  assert.equal(stagedWorkflowTarget('ci/test-hello-world.yml'), '.github/workflows/test-hello-world.yml');
  const execution = stagedWorkflowExecution({ code: 0, stdout: 'Hello, World!' }, ['ci/test-hello-world.yml']);
  assert.equal(execution.mode, 'act');
  assert.match(execution.fallbackReason, /ci\/test-hello-world\.yml/);
  assert.deepEqual(execution.checks, [{ name: 'Generated workflow (act)', status: 'COMPLETED', conclusion: 'SUCCESS' }]);
  assert.equal(stagedWorkflowExecution({ code: 1, stdout: '' }, ['ci/a.yml']).checks[0].conclusion, 'FAILURE');
});

test('the matrix workflow builds and checks the shipped version from prepare', () => {
  const workflow = readFileSync('.github/workflows/e2e-hello-world-matrix.yml', 'utf8');
  assert.match(workflow, /FORMAL_AI_VERSION: \$\{\{ needs\.prepare\.outputs\.formal_ai_tag \}\}/);
  assert.match(workflow, /E2E_FORMAL_AI_TAG: \$\{\{ needs\.prepare\.outputs\.formal_ai_tag \}\}/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY|shipped Formal AI/i);
  const schedule = readFileSync('scripts/e2e-matrix-schedule.mjs', 'utf8');
  assert.match(schedule, /readShippedFormalAiVersion/);
});
