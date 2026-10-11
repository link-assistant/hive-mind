#!/usr/bin/env node
/**
 * Issue #2841: the dev-log sanitizer treated GitHub Actions YAML as credentials.
 *
 *   id-token: write                      -> id-token: [REDACTED]
 *   token: ${{ secrets.GITHUB_TOKEN }}   -> token: [REDACTED] secrets.GITHUB_TOKEN }}
 *
 * The `--development-log` rescan then saw the AI's own case-study files under
 * `dev/log/issues/<n>/pulls/<m>/` "change", discarded the whole session log, and
 * only said "residual credential material".
 *
 * Run with: node tests/test-issue-2841-actions-yaml-sanitizer.mjs
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findCredentialRuleIds, sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
import { describeResidualCredentialBlock, findResidualCredentialBlock } from '../src/log-sanitize-stream.lib.mjs';
import { sanitizeForPublication } from '../src/token-sanitization.lib.mjs';
import { collectAndCommitDevelopmentLogArtifacts } from '../src/development-log.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    failed++;
  }
}

// The workflow excerpt from the issue, as an AI quotes it in a case study.
const ACTIONS_WORKFLOW = ['permissions:', '  contents: write', '  id-token: write', '  packages: read', '  security-events: none', 'steps:', '  - uses: actions/checkout@v4', '    with:', '      token: ${{ secrets.GITHUB_TOKEN }}', '  - run: npm publish', '    env:', '      NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}', ''].join('\n');

const NOT_CREDENTIALS = [ACTIONS_WORKFLOW, 'Grant `id-token: write` to the release job.', 'Grant `id-token: write`.', 'and grant id-token: write.', '"id-token": "read"', 'Pass `token: ${{ secrets.NPM_TOKEN }}`.', 'gh auth login --token `${{ secrets.GH_PAT }}`', 'password: "${{ secrets.DB_PASSWORD }}"', "api_key: '${{ secrets.API_KEY }}'", 'gh auth login --token ${{ secrets.GH_PAT }}', 'gh auth login --token "${{ secrets.GH_PAT }}"', 'curl "https://example.test/hook?access_token=${{ secrets.HOOK_TOKEN }}"', 'token: ${{ github.token }}', 'echo "$ACTIONS_ID_TOKEN_REQUEST_URL" "$ACTIONS_ID_TOKEN_REQUEST_TOKEN"', 'Keys such as `password:`) used to lose their closing backtick.', '键名（例如 `password:`）不再被改写。'];

for (const input of NOT_CREDENTIALS) {
  await test(`not a credential: ${JSON.stringify(input.length > 60 ? `${input.slice(0, 57)}...` : input)}`, async () => {
    assert.equal(sanitizeCredentialText(input), input);
    assert.equal(await sanitizeForPublication(input), input);
    assert.deepEqual(findCredentialRuleIds(input), []);
  });
}

const literal = ['literal', 'secret', 'value', '123'].join('-');
const STILL_CREDENTIALS = [
  { input: `token: ${literal}`, rule: 'unquoted-assignment' },
  { input: `id-token: ${literal}`, rule: 'unquoted-assignment' },
  { input: 'password: `hunter2`', rule: 'unquoted-assignment' },
  // Only the `id-token` scope is exempt; any other key still masks `write`.
  { input: 'password: write', rule: 'unquoted-assignment' },
  { input: 'my-id-token: write', rule: 'unquoted-assignment' },
  { input: 'id_token: write', rule: 'unquoted-assignment' },
  { input: `token: \${{ '${literal}' }}`, rule: 'workflow-expression' },
  { input: `token: \`\${{ '${literal}' }}\``, rule: 'workflow-expression' },
  { input: `password: "\${{ '${literal}' }}"`, rule: 'workflow-expression' },
  { input: `gh auth login --token \${{ '${literal}' }}`, rule: 'workflow-expression' },
  { input: `curl 'https://example.test/?token=\${{ "${literal}" }}'`, rule: 'workflow-expression' },
  { input: `token: \${{ format('{0}', '${literal}') }}`, rule: 'workflow-expression' },
  { input: 'export DEPLOY_SYNTHETIC_TOKEN_ALPHA_123456', rule: 'vendor-token' },
];

for (const { input, rule } of STILL_CREDENTIALS) {
  await test(`still masked (${rule}): ${JSON.stringify(input)}`, async () => {
    const once = sanitizeCredentialText(input);
    assert.notEqual(once, input);
    assert.ok(!once.includes(literal), `the literal must not survive: ${once}`);
    assert.ok(!once.includes('hunter2'));
    assert.equal(sanitizeCredentialText(once), once, 'sanitizing twice equals sanitizing once');
    assert.equal(await sanitizeForPublication(input), once);
    assert.ok(findCredentialRuleIds(input).includes(rule), `expected ${rule} in ${findCredentialRuleIds(input)}`);
  });
}

await test('a workflow expression next to a real literal keeps the reference and masks the literal', () => {
  const output = sanitizeCredentialText(`token: \${{ secrets.A }} and password: \${{ '${literal}' }}`);
  assert.ok(output.startsWith('token: ${{ secrets.A }} and password: '));
  assert.ok(!output.includes(literal));
});

const tempRoot = await mkdtemp(join(tmpdir(), 'hive-mind-2841-'));
try {
  await test('the rescan accepts the workflow excerpt from the issue', async () => {
    const filePath = join(tempRoot, 'workflow.yml');
    await writeFile(filePath, ACTIONS_WORKFLOW);
    assert.equal(await findResidualCredentialBlock(filePath), null);
  });

  await test('the rescan reports the line and rule of a real residual, never its value', async () => {
    const filePath = join(tempRoot, 'case-study.md');
    await writeFile(filePath, `${ACTIONS_WORKFLOW}notes\nAPI_TOKEN=${literal}\n`);
    const residual = await findResidualCredentialBlock(filePath);
    assert.equal(residual.line, ACTIONS_WORKFLOW.split('\n').length + 1);
    assert.deepEqual(residual.ruleIds, ['unquoted-assignment']);
    const description = describeResidualCredentialBlock('dev/log/case-study.md', residual);
    assert.equal(description, `dev/log/case-study.md:${residual.line} (rule: unquoted-assignment)`);
    assert.ok(!JSON.stringify(residual).includes(literal));
  });

  await test('line numbers keep counting across streamed blocks', async () => {
    const filePath = join(tempRoot, 'long.log');
    await writeFile(filePath, `${'ordinary line\n'.repeat(500)}password=${literal}\n`);
    const residual = await findResidualCredentialBlock(filePath, { chunkBytes: 256 });
    assert.ok(residual.blockIndex > 1, 'the residual is not in the first block');
    assert.equal(residual.line, 501);
  });

  await test('a sanitizer refusal is reported with its stage instead of escaping the rescan', async () => {
    const filePath = join(tempRoot, 'refused.log');
    await writeFile(filePath, `ok\npassword=${literal}\n`);
    const error = Object.assign(new Error('Credential sanitization failed; publication was blocked.'), { name: 'CredentialSanitizationError', code: 'CREDENTIAL_SANITIZATION_FAILED', stage: 'residual', findings: [] });
    const residual = await findResidualCredentialBlock(filePath, {
      sanitize: async () => {
        throw error;
      },
    });
    assert.equal(residual.line, 2);
    assert.deepEqual(residual.ruleIds, ['unquoted-assignment']);
  });

  await test('an AI file with a residual next to the session no longer discards the session log', async () => {
    const repositoryPath = join(tempRoot, 'repo');
    const developmentLogDirectory = join(repositoryPath, 'dev/log/issues/2841/pulls/2850');
    await mkdir(developmentLogDirectory, { recursive: true });
    await writeFile(join(developmentLogDirectory, 'ai-notes.md'), `API_TOKEN=${literal}\n`);
    const sourceLog = join(tempRoot, 'solve.log');
    await writeFile(sourceLog, `Quoting the workflow:\n${ACTIONS_WORKFLOW}`);

    const commands = [];
    const messages = [];
    const result = await collectAndCommitDevelopmentLogArtifacts({
      enabled: true,
      repositoryPath,
      logFile: sourceLog,
      issueNumber: 2841,
      prNumber: 2850,
      tool: 'claude',
      sessionId: 'session-2841',
      branchName: null,
      rawCommand: 'solve --development-log',
      $:
        () =>
        async (strings, ...values) => {
          const command = strings.reduce((text, part, index) => `${text}${part}${values[index] ?? ''}`, '');
          commands.push(command);
          return { code: command.startsWith('git diff') ? 1 : 0, stdout: '', stderr: '' };
        },
      log: async message => messages.push(String(message)),
    });

    assert.equal(result.committed, true, messages.join('\n'));
    assert.ok(!result.discarded);
    const sessionDirectory = 'dev/log/issues/2841/pulls/2850/sessions/session-2841';
    assert.deepEqual(commands, [`git add -f -- ${sessionDirectory}`, `git diff --cached --quiet -- ${sessionDirectory}`, `git commit -m Add development log for issue #2841 PR #2850 -- ${sessionDirectory}`]);
    // The published copy keeps the workflow excerpt byte for byte.
    assert.ok((await readFile(join(repositoryPath, sessionDirectory, 'solve.log'), 'utf8')).includes(ACTIONS_WORKFLOW));
  });

  await test('a residual inside the session directory still blocks publication, with path, line and rule', async () => {
    const repositoryPath = join(tempRoot, 'repo-blocked');
    const sessionDirectory = join(repositoryPath, 'dev/log/issues/2841/pulls/2850/sessions/session-blocked');
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(join(sessionDirectory, 'extra.log'), `fine\nfine\npassword=${literal}\n`);
    let gitCalled = false;
    const messages = [];
    const result = await collectAndCommitDevelopmentLogArtifacts({
      enabled: true,
      repositoryPath,
      logFile: null,
      issueNumber: 2841,
      prNumber: 2850,
      tool: 'claude',
      sessionId: 'session-blocked',
      $: () => {
        gitCalled = true;
        return async () => ({ code: 0, stdout: '', stderr: '' });
      },
      log: async message => messages.push(String(message)),
    });
    assert.equal(result.skipped, 'error');
    assert.equal(gitCalled, false, 'no git command may run before the rescan (issue #2111)');
    assert.match(result.error.message, /dev\/log\/issues\/2841\/pulls\/2850\/sessions\/session-blocked\/extra\.log:3 \(rule: unquoted-assignment\)/);
    assert.ok(!messages.join('\n').includes(literal));
  });
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
