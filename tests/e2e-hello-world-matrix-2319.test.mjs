/**
 * @hive-mind-test-suite default
 *
 * Issue #2319: the Hello World end-to-end matrix.
 *
 * The matrix itself runs only on `workflow_dispatch` — each row creates a
 * repository and spends a full session. What runs here is everything that
 * decides whether a row passes: each assertion is pinned against the pull
 * requests the 2026-09-27 runs actually produced (docs/case-studies/issue-2320),
 * so the matrix is known to fail on them, and against a clean answer, so it is
 * known to pass on one.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2319
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { buildE2eSolveArgv, checkBodyFinalized, checkDiffShape, E2E_MATRIX, escapeTableCell, evaluateE2eRun, formatE2eReport, logPrintsHelloWorld, parseIssue, parseIssueUrl, selectPullRequest, summariseChecks } from '../scripts/e2e-hello-world.lib.mjs';
import { AUTOMATION_STOPPED_MARKER } from '../src/tool-comments.lib.mjs';
import { createYargsConfig } from '../src/solve.config.lib.mjs';
import { resolveYargsFactory } from '../src/yargs-factory.lib.mjs';
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';

const ISSUE_URL = 'https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/issues/1';
const CLEAN_FILES = ['Main.kt', 'tests/verify-output.sh', '.github/workflows/run.yml'];
const RUN_LOG = ['build\tRun program\t2026-09-27T15:10:01.0000000Z Hello, World!', 'build\tVerify\t2026-09-27T15:10:02.0000000Z ✅ Output matches'].join('\n');
const GREEN = [{ __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }];

const cleanRun = (overrides = {}) => ({
  pullRequest: { number: 2, state: 'OPEN', isDraft: false, title: 'Implement Hello World in Kotlin', body: 'Implements Hello World in Kotlin with CI and an output check.\n\nFixes #1' },
  files: CLEAN_FILES,
  checks: GREEN,
  workflowLog: RUN_LOG,
  comments: ['## 🤖 Solution Draft Log'],
  ...overrides,
});

const failed = evaluation =>
  evaluation.results
    .filter(result => !result.ok)
    .map(result => result.name)
    .sort();

test('a clean Hello World answer passes every assertion', () => {
  const evaluation = evaluateE2eRun(cleanRun());
  assert.deepEqual(failed(evaluation), []);
  assert.equal(evaluation.passed, true);
});

test('the 2026-09-27 Kotlin run fails the matrix on the draft, the stray jar, the quoted title and the stop comment', () => {
  // kotlin-final.log: the critical-error auto-commit added Main.jar (5969-5977),
  // the body said "1 file(s) modified" (2089), the PR was left in draft and the
  // session ended in a stop comment.
  const evaluation = evaluateE2eRun(
    cleanRun({
      pullRequest: { number: 2, state: 'OPEN', isDraft: true, title: "'Implement Hello World in Kotlin'", body: '### Changes\n- 1 file(s) modified, 1 line(s) added' },
      files: [...CLEAN_FILES, 'Main.jar'],
      comments: [`## 🛑 ${AUTOMATION_STOPPED_MARKER}\n\nno_progress_between_sessions`],
    })
  );
  assert.equal(evaluation.passed, false);
  assert.deepEqual(failed(evaluation), ['diff is the program, the workflow and a test script', 'no "🛑 Automation stopped" comment', 'ready for review', 'title is final'].sort());
});

test('a run that opened no pull request fails', () => {
  const evaluation = evaluateE2eRun({ pullRequest: null });
  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.results[0].name, 'pull request opened');
});

test('diff shape: exactly one workflow, a program, at most one test script, no placeholders or artefacts', () => {
  assert.equal(checkDiffShape(CLEAN_FILES).ok, true);
  assert.equal(checkDiffShape(['main.py', '.github/workflows/test-hello-world.yml']).ok, true, 'the test script is optional');
  assert.equal(checkDiffShape([...CLEAN_FILES, 'README.md']).ok, true, 'the task recommends a CI badge in the README');
  assert.equal(checkDiffShape(['main.py']).ok, false, 'no workflow');
  assert.equal(checkDiffShape(['.github/workflows/run.yml']).ok, false, 'no program');
  assert.equal(checkDiffShape(['main.py', '.github/workflows/a.yml', '.github/workflows/b.yml']).ok, false, 'two workflows');
  assert.equal(checkDiffShape([...CLEAN_FILES, 'CLAUDE.md']).ok, false, "solve's task placeholder must not survive");
  assert.equal(checkDiffShape([...CLEAN_FILES, 'Main.class']).ok, false, 'compiled class');
  assert.equal(checkDiffShape(['src/main.rs', '.github/workflows/ci.yml', 'target/debug/hello']).ok, false, 'cargo output');
  assert.equal(checkDiffShape([...CLEAN_FILES, 'notes.txt']).ok, false, 'anything beyond the program and one test script');
});

test('the program output must be exactly the line, not a mention of it', () => {
  assert.equal(logPrintsHelloWorld(RUN_LOG), true);
  assert.equal(logPrintsHelloWorld('Hello, World!'), true, 'a log without the gh prefix');
  assert.equal(logPrintsHelloWorld('build\tVerify\t2026-09-27T15:10:02.0000000Z Expected: Hello, World!'), false);
  assert.equal(logPrintsHelloWorld('build\tRun\t2026-09-27T15:10:02.0000000Z Hello, World!!'), false);
  assert.equal(logPrintsHelloWorld('build\tRun\t2026-09-27T15:10:02.0000000Z Hello World'), false);
  assert.equal(logPrintsHelloWorld(''), false);
});

test('checks: green only when every check completed successfully', () => {
  assert.equal(summariseChecks(GREEN).green, true);
  assert.equal(summariseChecks([]).green, false, 'no checks is not green');
  assert.deepEqual(summariseChecks([{ name: 'build', status: 'COMPLETED', conclusion: 'FAILURE' }]).failed, ['build']);
  assert.equal(summariseChecks([{ name: 'build', status: 'IN_PROGRESS', conclusion: '' }]).pending, 1);
  assert.equal(summariseChecks([{ __typename: 'StatusContext', context: 'ci', state: 'SUCCESS' }]).green, true);
  assert.deepEqual(summariseChecks([{ __typename: 'StatusContext', context: 'ci', state: 'ERROR' }]).failed, ['ci']);
});

test('body: an agent-written description needs no generated file list', () => {
  assert.equal(checkBodyFinalized(cleanRun().pullRequest.body).ok, true);
  assert.equal(checkBodyFinalized('### Changes\n- Main.kt\n\nFixes #1').ok, true);
  assert.equal(checkBodyFinalized('').ok, false);
  assert.equal(checkBodyFinalized('_Details will be added as the solution draft is developed..._\n\nFixes #1').ok, false);
});

test('issue URL parsing and pull request selection', () => {
  const output = `✨ Test environment created successfully!\n\n🎯 Issue:\n   ${ISSUE_URL}\n\n🚀 Test with:\n   ./solve.mjs "${ISSUE_URL}"\n`;
  assert.equal(parseIssueUrl(output), ISSUE_URL);
  assert.equal(parseIssueUrl('❌ Failed!'), null);
  assert.deepEqual(parseIssue(ISSUE_URL), { owner: 'konard', repo: 'test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a', repository: 'konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a', number: 1 });
  assert.throws(() => parseIssue('https://github.com/konard/x/pull/2'));
  assert.equal(
    selectPullRequest(
      [
        { number: 2, headRefName: 'issue-1-abc' },
        { number: 3, headRefName: 'issue-10-abc' },
      ],
      1
    ).number,
    2
  );
});

test('every row runs the same solve command; only --tool and --model differ', async () => {
  const use = await ensureUseM();
  const yargs = resolveYargsFactory(await use('yargs@17.7.2'));
  const commands = [];
  for (const { tool, model } of E2E_MATRIX) {
    const argv = buildE2eSolveArgv({ issueUrl: ISSUE_URL, tool, model, logDir: '/home/box/logs' });
    const parsed = await createYargsConfig(yargs(argv)).parse();
    assert.equal(parsed.tool, tool);
    assert.equal(parsed.model, model);
    assert.equal(parsed.issueUrl, ISSUE_URL);
    assert.equal(parsed.attachLogs, true);
    assert.equal(parsed.autoRestartUntilMergeable, false, 'the runner performs approval and act verification after solve');
    assert.equal(parsed.detectRepeatedToolCalls, true, 'a looping model must end its row instead of running until compaction (#2395 made the breaker opt-in)');
    commands.push(argv.filter((arg, index) => !['--tool', '--model'].includes(argv[index - 1]) && !['--tool', '--model'].includes(arg)));
  }
  for (const command of commands) assert.deepEqual(command, commands[0]);
});

test('the matrix covers formal-ai on claude, agent and codex, plus one LLM model', () => {
  const formalAiTools = E2E_MATRIX.filter(row => row.model === 'formal-ai').map(row => row.tool);
  assert.deepEqual(formalAiTools.sort(), ['agent', 'claude', 'codex']);
  assert.equal(E2E_MATRIX.filter(row => row.model !== 'formal-ai').length, 1);
});

test('the workflow runs the tested script for exactly the E2E_MATRIX rows, manually, without leaking secrets', () => {
  const workflow = readFileSync('.github/workflows/e2e-hello-world-matrix.yml', 'utf8');
  assert.match(workflow, /^on:[^\n]*\n {2}workflow_dispatch:/m, 'manual only: every row creates a repository');
  assert.match(workflow, /^ {2}schedule:/m);
  assert.match(workflow, /^ {2}workflow_run:/m);
  assert.doesNotMatch(workflow, /^ {2}(push|pull_request):/m);
  assert.match(workflow, /node scripts\/e2e-hello-world\.mjs/);
  assert.match(workflow, /fail-fast: false/, 'one failing row must not hide the others');
  const rows = [...workflow.matchAll(/- tool: (\S+)\n\s+model: (\S+)/g)].map(match => ({ tool: match[1], model: match[2] }));
  assert.deepEqual(
    rows,
    E2E_MATRIX.map(row => ({ ...row }))
  );
  for (const line of workflow.split('\n').filter(line => /\$\{\{\s*(secrets|inputs)\./.test(line))) {
    assert.doesNotMatch(line, /^\s*(run:|node |if \[)/, `secrets and inputs reach run: only through env: ${line.trim()}`);
  }
});

test('the report is a table with one row per assertion', () => {
  const evaluation = evaluateE2eRun(cleanRun());
  const report = formatE2eReport({ tool: 'agent', model: 'formal-ai', issueUrl: ISSUE_URL, pullRequestUrl: 'https://github.com/o/r/pull/2', evaluation });
  assert.match(report, /^### ✅ `--tool agent --model formal-ai`/);
  assert.equal(report.match(/^\| .* \| ✅ \|/gm).length, evaluation.results.length);
});

test('report cells escape backslashes before pipes and stay on one line', () => {
  assert.equal(escapeTableCell('a|b'), 'a\\|b');
  assert.equal(escapeTableCell('a\\|b'), 'a\\\\\\|b', 'an existing backslash cannot un-escape the pipe');
  assert.equal(escapeTableCell('one\ntwo'), 'one two');
  const evaluation = { passed: false, results: [{ name: 'x', ok: false, reason: 'C:\\tmp | "a\nb"' }] };
  const row = formatE2eReport({ tool: 'claude', model: 'formal-ai', issueUrl: ISSUE_URL, evaluation })
    .split('\n')
    .find(line => line.startsWith('| x |'));
  assert.equal(row, '| x | ❌ | C:\\\\tmp \\| "a b" |');
});
