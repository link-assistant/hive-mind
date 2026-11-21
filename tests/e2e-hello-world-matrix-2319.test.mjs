// @hive-mind-test-suite default,pr-essential
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

const { execFileSync } = await import('node:child_process');
// Ask Git for its protocol object ID. This is not a credential/security hash;
// --stdin without -w computes the ID without writing an object or invoking a shell.
const fixtureGitBlobId = data => {
  const id = execFileSync('git', ['hash-object', '--stdin'], {
    input: Buffer.from(data),
    encoding: 'utf8',
    timeout: 2000,
    maxBuffer: 128,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' },
  }).trim();
  assert.match(id, /^[a-f0-9]{40}$/);
  return id;
};

test('E2E actual act raw-output framing is decoded without accepting diagnostic messages', () => {
  const records = ['{"dryrun":false,"job":"Run Main.kt/run","jobID":"run","level":"info","matrix":{},"msg":"Hello, World!\\n","raw_output":true,"stage":"Main","step":"sh tests/verify-output.sh\\n","stepID":["3"],"time":"2026-11-04T05:20:22Z"}', '{"dryrun":false,"job":"Run Main.scala/run","jobID":"run","level":"info","matrix":{},"msg":"Hello, World!\\n","raw_output":true,"stage":"Main","step":"sh tests/verify-output.sh\\n","stepID":["2"],"time":"2026-11-04T05:20:35Z"}', '{"dryrun":false,"job":"Run main.rs/run","jobID":"run","level":"info","matrix":{},"msg":"Hello, World!\\n","raw_output":true,"stage":"Main","step":"sh tests/verify-output.sh\\n","stepID":["2"],"time":"2026-11-04T05:22:29Z"}'];
  for (const line of records) {
    assert.equal(logPrintsHelloWorld(line), true);
    assert.equal(logPrintsHelloWorld('build\tRun program\t2026-11-04T05:20:35Z ' + line), true);
    const record = JSON.parse(line);
    for (const delta of [{ raw_output: false }, { raw_output: undefined }, { stage: 'Pre' }, { dryrun: true }, { stepID: [] }, { msg: ' Hello, World!\n' }, { msg: 'Hello, World! \n' }, { msg: 'Hello, World!\n\n' }, { msg: 'Expected: Hello, World!\n' }, { msg: 'Hello, World!\nother\n' }]) assert.equal(logPrintsHelloWorld(JSON.stringify({ ...record, ...delta })), false, JSON.stringify(delta));
  }
});

test('E2E generated evidence exemption binds exact session blobs and rejects foreign or copied authority', async () => {
  const { collectGeneratedEvidence } = await import('../scripts/e2e-generated-evidence.lib.mjs');
  const issueNumber = 4010,
    pullRequest = { number: 4012, headRefName: 'issue-4010-test', headRefOid: 'a'.repeat(40) },
    tool = 'agent',
    model = 'formal-ai',
    version = '0.355.30',
    sessionId = 'ses_e2e_fixture';
  const sessionRoot = 'dev/log/issues/4010/pulls/4012/sessions/' + sessionId;
  const evidenceRoot = 'dev/log/self-authored/issue-4010/evidence';
  const metadata = { schemaVersion: 3, issueNumber, prNumber: pullRequest.number, branchName: pullRequest.headRefName, tool, sessionId, developmentLogDirectory: './dev/log/issues/4010/pulls/4012', artifacts: { solveLog: './' + sessionRoot + '/solve.log', sessionFiles: [] } };
  const blob = content => {
    const data = Buffer.from(content);
    return {
      sha: fixtureGitBlobId(data),
      size: data.length,
      encoding: 'base64',
      content: data.toString('base64'),
    };
  };
  const make = (data = metadata, session = 'formal-ai session ' + sessionId + '\nformal-ai model formal-ai/' + version + '\n') => {
    const blobs = [blob(JSON.stringify(data)), blob('session log'), blob('stream'), blob(session)];
    const paths = [sessionRoot + '/metadata.json', sessionRoot + '/solve.log', evidenceRoot + '/agent-stream.jsonl', evidenceRoot + '/session-id.txt'];
    const changes = paths.map((filename, i) => ({ filename, sha: blobs[i].sha, status: 'added' })).concat(CLEAN_FILES.map(filename => ({ filename, sha: blobs[1].sha, status: 'added' })));
    return { changes, issueNumber, pullRequest, tool, model, version, readBlob: async sha => blobs.find(b => b.sha === sha), readTree: async () => ({ truncated: false, tree: changes.map(row => ({ path: row.filename, mode: '100644', type: 'blob', sha: row.sha })) }) };
  };
  const fixture = make();
  const witness = await collectGeneratedEvidence(fixture);
  const files = fixture.changes.map(row => row.filename);
  assert.ok(witness);
  assert.equal(checkDiffShape(files, { generatedEvidence: witness }).ok, true);
  assert.equal(checkDiffShape(files).ok, false);
  assert.equal(checkDiffShape(files, { generatedEvidence: JSON.parse(JSON.stringify(witness)) }).ok, false);
  assert.equal(checkDiffShape([...files, evidenceRoot + '/hidden.mjs'], { generatedEvidence: witness }).ok, false);
  assert.equal(checkDiffShape([...files, sessionRoot + '/foreign.txt'], { generatedEvidence: witness }).ok, false);
  for (const delta of [{ issueNumber: 9 }, { prNumber: 9 }, { branchName: 'foreign' }, { tool: 'claude' }, { sessionId: 'foreign' }, { schemaVersion: 2 }, { artifacts: { ...metadata.artifacts, sessionFiles: ['extra'] } }]) assert.equal(await collectGeneratedEvidence(make({ ...metadata, ...delta })), null);
  assert.equal(await collectGeneratedEvidence(make(metadata, 'formal-ai session foreign\nformal-ai model formal-ai/' + version + '\n')), null);
  assert.equal(await collectGeneratedEvidence({ ...fixture, changes: fixture.changes.slice(0, 3) }), null);
  assert.equal(await collectGeneratedEvidence({ ...fixture, changes: [...fixture.changes, fixture.changes[0]] }), null);
  assert.equal(await collectGeneratedEvidence({ ...fixture, readBlob: async () => ({ sha: fixture.changes[0].sha, size: 65537, encoding: 'base64', content: '' }) }), null);
  assert.equal(await collectGeneratedEvidence({ ...fixture, readBlob: async () => ({ sha: fixture.changes[0].sha, size: 2, encoding: 'base64', content: 'e30=' }) }), null);
  assert.equal(await collectGeneratedEvidence({ ...fixture, tool: 'claude' }), null);
  assert.equal(await collectGeneratedEvidence({ ...fixture, model: 'other' }), null);
  assert.equal(await collectGeneratedEvidence({ ...fixture, readTree: async () => ({ truncated: true, tree: [] }) }), null);
  assert.equal(await collectGeneratedEvidence({ ...fixture, readTree: async () => ({ truncated: false, tree: fixture.changes.map(row => ({ path: row.filename, mode: '120000', type: 'blob', sha: row.sha })) }) }), null);
});

test('E2E actual PR4012 metadata uses a canonical string issue id and explicit null tool', async () => {
  const { collectGeneratedEvidence } = await import('../scripts/e2e-generated-evidence.lib.mjs');
  // Captured from source333/run41776642750, immutable PR4012 head0a20517c.
  // Original snapshot SHA2569ece98d5; metadata592B/session84B. Data provenance
  // admits a four-file diff exemption only, never model or source authority.
  const actual = {
    repository: 'link-assistant/hive-mind',
    run: 41776642750,
    job: 126398640901,
    source: '333875cba9e6651c4cfa89a2b2957c944222b356',
    issueNumber: 4010,
    pullRequest: { number: 4012, headRefName: 'issue-4010-1bec79370989', headRefOid: '0a20517c0690986cc8d59264c1905137ae8654e4' },
    tool: 'agent',
    model: 'formal-ai',
    version: '0.355.30',
    changes: [
      { filename: 'Main.scala', sha: '173a27b554fcd4e867908e67a46a52c110a82045', status: 'added' },
      { filename: 'ci/test-hello-world.yml', sha: '3ed3e4d5cc4380190838d3cb5323eefe66e2cbcb', status: 'added' },
      { filename: 'dev/log/issues/4010/pulls/4012/sessions/ses_e5b02ae19ffegFGvt7zuoKcxSN/metadata.json', sha: '7b92d0baad9763d21a4e0a2cbbdc561a9db89b4f', status: 'added' },
      { filename: 'dev/log/issues/4010/pulls/4012/sessions/ses_e5b02ae19ffegFGvt7zuoKcxSN/solve.log', sha: 'bcb6390a0368b8b6fd0b4f2ca105b0da128a8bb6', status: 'added' },
      { filename: 'dev/log/self-authored/issue-4010/evidence/agent-stream.jsonl', sha: '50ae9b1fb6e5dcf63cc778d2b40f41c2fa50e2f2', status: 'added' },
      { filename: 'dev/log/self-authored/issue-4010/evidence/session-id.txt', sha: '95e82168c6d60ba8d083944990dc812f42af7cf8', status: 'added' },
      { filename: 'tests/verify-output.sh', sha: '96ca3febc59d104374b5e99b22dbd9c9da816702', status: 'added' },
    ],
    tree: {
      truncated: false,
      tree: [
        { path: 'Main.scala', mode: '100644', type: 'blob', sha: '173a27b554fcd4e867908e67a46a52c110a82045' },
        { path: 'ci/test-hello-world.yml', mode: '100644', type: 'blob', sha: '3ed3e4d5cc4380190838d3cb5323eefe66e2cbcb' },
        { path: 'dev/log/issues/4010/pulls/4012/sessions/ses_e5b02ae19ffegFGvt7zuoKcxSN/metadata.json', mode: '100644', type: 'blob', sha: '7b92d0baad9763d21a4e0a2cbbdc561a9db89b4f' },
        { path: 'dev/log/issues/4010/pulls/4012/sessions/ses_e5b02ae19ffegFGvt7zuoKcxSN/solve.log', mode: '100644', type: 'blob', sha: 'bcb6390a0368b8b6fd0b4f2ca105b0da128a8bb6' },
        { path: 'dev/log/self-authored/issue-4010/evidence/agent-stream.jsonl', mode: '100644', type: 'blob', sha: '50ae9b1fb6e5dcf63cc778d2b40f41c2fa50e2f2' },
        { path: 'dev/log/self-authored/issue-4010/evidence/session-id.txt', mode: '100644', type: 'blob', sha: '95e82168c6d60ba8d083944990dc812f42af7cf8' },
        { path: 'tests/verify-output.sh', mode: '100644', type: 'blob', sha: '96ca3febc59d104374b5e99b22dbd9c9da816702' },
      ],
    },
    blobs: {
      '7b92d0baad9763d21a4e0a2cbbdc561a9db89b4f': {
        sha: '7b92d0baad9763d21a4e0a2cbbdc561a9db89b4f',
        node_id: 'B_kwDOPUU0qdoAKDdiOTJkMGJhYWQ5NzYzZDIxYTRlMGEyY2JiZGM1NjFhOWRiODliNGY',
        size: 592,
        url: 'https://api.github.com/repos/link-assistant/hive-mind/git/blobs/7b92d0baad9763d21a4e0a2cbbdc561a9db89b4f',
        content: 'ewogICJzY2hlbWFWZXJzaW9uIjogMywKICAiY29sbGVjdGVkQXQiOiAiMjAy\nNi0xMS0wNFQwNToxOToyNC40MzVaIiwKICAiaXNzdWVOdW1iZXIiOiAiNDAx\nMCIsCiAgInByTnVtYmVyIjogNDAxMiwKICAiYnJhbmNoTmFtZSI6ICJpc3N1\nZS00MDEwLTFiZWM3OTM3MDk4OSIsCiAgInRvb2wiOiBudWxsLAogICJzZXNz\naW9uSWQiOiAic2VzX2U1YjAyYWUxOWZmZWdGR3Z0N3p1b0tjeFNOIiwKICAi\ncmF3Q29tbWFuZCI6IG51bGwsCiAgImRldmVsb3BtZW50TG9nRGlyZWN0b3J5\nIjogIi4vZGV2L2xvZy9pc3N1ZXMvNDAxMC9wdWxscy80MDEyIiwKICAiY2Fz\nZVN0dWR5RGlyZWN0b3J5IjogIi4vZG9jcy9jYXNlLXN0dWRpZXMvaXNzdWUt\nNDAxMCIsCiAgImFydGlmYWN0cyI6IHsKICAgICJzb2x2ZUxvZyI6ICIuL2Rl\ndi9sb2cvaXNzdWVzLzQwMTAvcHVsbHMvNDAxMi9zZXNzaW9ucy9zZXNfZTVi\nMDJhZTE5ZmZlZ0ZHdnQ3enVvS2N4U04vc29sdmUubG9nIiwKICAgICJzb2x2\nZUxvZ1JhbmdlIjogewogICAgICAic3RhcnRCeXRlIjogMCwKICAgICAgImVu\nZEJ5dGUiOiAzNzAzNDIyCiAgICB9LAogICAgInNlc3Npb25GaWxlcyI6IFtd\nCiAgfQp9Cg==\n',
        encoding: 'base64',
      },
      '95e82168c6d60ba8d083944990dc812f42af7cf8': { sha: '95e82168c6d60ba8d083944990dc812f42af7cf8', node_id: 'B_kwDOPUU0qdoAKDk1ZTgyMTY4YzZkNjBiYThkMDgzOTQ0OTkwZGM4MTJmNDJhZjdjZjg', size: 84, url: 'https://api.github.com/repos/link-assistant/hive-mind/git/blobs/95e82168c6d60ba8d083944990dc812f42af7cf8', content: 'Zm9ybWFsLWFpIHNlc3Npb24gc2VzX2U1YjAyYWUxOWZmZWdGR3Z0N3p1b0tj\neFNOCmZvcm1hbC1haSBtb2RlbCBmb3JtYWwtYWkvMC4zNTUuMzAK\n', encoding: 'base64' },
    },
  };
  const make = (delta = {}) => ({
    ...actual,
    ...delta,
    readBlob: async sha => actual.blobs[sha],
    readTree: async sha => {
      assert.equal(sha, actual.pullRequest.headRefOid);
      return actual.tree;
    },
  });
  const files = actual.changes.map(row => row.filename);
  const witness = await collectGeneratedEvidence(make());
  assert.ok(witness);
  assert.equal(checkDiffShape(files, { workflowDir: 'ci/', generatedEvidence: witness }).ok, true);
  const metadataRow = actual.changes.find(row => row.filename.endsWith('/metadata.json'));
  const original = JSON.parse(Buffer.from(actual.blobs[metadataRow.sha].content, 'base64').toString());
  for (const delta of [{ issueNumber: '04010' }, { issueNumber: '4011' }, { tool: undefined }, { tool: 'claude' }]) {
    const data = Buffer.from(JSON.stringify({ ...original, ...delta }));
    const sha = fixtureGitBlobId(data);
    const changes = actual.changes.map(row => (row === metadataRow ? { ...row, sha } : row));
    const tree = { ...actual.tree, tree: actual.tree.tree.map(row => (row.path === metadataRow.filename ? { ...row, sha } : row)) };
    const blob = { sha, size: data.length, encoding: 'base64', content: data.toString('base64') };
    assert.equal(await collectGeneratedEvidence({ ...make(), changes, readTree: async () => tree, readBlob: async key => (key === sha ? blob : actual.blobs[key]) }), null);
  }
  assert.equal(await collectGeneratedEvidence(make({ changes: [...actual.changes, { filename: 'dev/log/self-authored/issue-4010/evidence/claude-stream.jsonl', sha: 'b'.repeat(40), status: 'added' }] })), null);
});

test('E2E real GitHub resources are opt-in while default captured regressions and strict cleanup remain', () => {
  const workflow = readFileSync('.github/workflows/e2e-hello-world-matrix.yml', 'utf8');
  assert.ok(workflow.includes('  prepare:\n    if: $' + "{{ github.event_name == 'workflow_dispatch' || vars.ENABLE_REAL_GITHUB_E2E == 'true' }}\n"));
  assert.match(workflow, /^ {2}workflow_dispatch:/m);
  assert.match(workflow, /^ {2}workflow_run:/m);
  assert.match(workflow, /^ {2}schedule:/m);
  assert.match(workflow, / {4}needs: prepare\n {4}if: needs\.prepare\.outputs\.should_run == 'true'/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  const runner = readFileSync('scripts/e2e-hello-world.mjs', 'utf8');
  assert.ok(runner.includes('if (cleanup.errors.length || cleanup.retainedBranches.length) evidence.passed = false;'));
});
