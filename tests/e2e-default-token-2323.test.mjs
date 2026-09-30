/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildE2eSolveArgv, logPrintsHelloWorld } from '../scripts/e2e-hello-world.lib.mjs';
import { runGeneratedWorkflow } from '../scripts/e2e-default-token.lib.mjs';

test('default-token e2e uses its isolated base and finishes the session before validating locally', () => {
  const argv = buildE2eSolveArgv({ issueUrl: 'https://github.com/o/r/issues/1', tool: 'agent', model: 'formal-ai', baseBranch: 'e2e/run/base', defaultToken: true });
  assert.ok(argv.includes('--no-auto-restart-until-mergeable'));
  assert.equal(argv[argv.indexOf('--base-branch') + 1], 'e2e/run/base');
});

test('a refused run approval falls back to act and preserves its real exit status', async () => {
  const calls = [];
  const api = async (endpoint, options = {}) => {
    calls.push({ endpoint, ...options });
    if (endpoint.endsWith('/approve')) throw new Error('403 approval refused');
    if (endpoint.includes('/git/trees/')) return { tree: [{ path: '.github/workflows/test.yml', type: 'blob', sha: 'blob', mode: '100644' }] };
    if (endpoint.includes('/git/blobs/')) return { content: Buffer.from('name: test\n').toString('base64') };
    return {};
  };
  let command;
  const result = await runGeneratedWorkflow({
    api,
    repository: 'o/r',
    pullRequest: { number: 2, headRefOid: 'abc' },
    files: ['.github/workflows/test.yml'],
    runs: [{ id: 3, status: 'waiting' }],
    run: async (name, args) => {
      command = [name, ...args];
      return { code: 1, stdout: 'real workflow failed' };
    },
  });
  assert.equal(result.code, 1);
  assert.equal(result.method, 'act');
  assert.equal(result.stdout, 'real workflow failed');
  assert.ok(command.includes('pull_request'));
  assert.ok(command.includes('linux/amd64'));
  assert.ok(calls.some(call => call.endpoint.endsWith('/approve')));
});

test('an approved run continues through real Actions verification', async () => {
  const result = await runGeneratedWorkflow({ api: async () => ({}), repository: 'o/r', pullRequest: { number: 2 }, files: ['.github/workflows/test.yml'], runs: [{ id: 3, status: 'waiting' }] });
  assert.equal(result.method, 'approved');
});

test('act program output counts but an act shell command echoing it does not', () => {
  assert.equal(logPrintsHelloWorld('[Hello World/Test]   | Hello, World!\n'), true);
  assert.equal(logPrintsHelloWorld('[Hello World/Test]   | echo "Hello, World!"\n'), false);
});
