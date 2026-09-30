/** Finite smoke test of the real act fallback, with a local GitHub API fixture. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runGeneratedWorkflow } from '../../scripts/e2e-default-token.lib.mjs';

const workflow = `name: Generated Hello World
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: node hello.mjs
`;
const contents = { workflow, program: 'console.log("Hello, World!");\n' };
const repository = { full_name: 'fixture/hello-world', name: 'hello-world', owner: { login: 'fixture' }, default_branch: 'main' };
const api = async endpoint => {
  if (endpoint.includes('/git/trees/'))
    return {
      tree: [
        { path: '.github/workflows/test.yml', sha: 'workflow', mode: '100644', type: 'blob' },
        { path: 'hello.mjs', sha: 'program', mode: '100644', type: 'blob' },
      ],
    };
  if (endpoint.includes('/git/blobs/')) return { content: Buffer.from(contents[endpoint.split('/').pop()]).toString('base64') };
  if (endpoint.includes('/pulls/')) return { number: 1, head: { ref: 'e2e/probe/head', sha: 'a'.repeat(40), repo: repository }, base: { ref: 'e2e/probe/base', sha: 'b'.repeat(40), repo: repository } };
  throw new Error(`unexpected fixture API request: ${endpoint}`);
};
const result = await runGeneratedWorkflow({
  api,
  repository: repository.full_name,
  pullRequest: { number: 1, headRefOid: 'a'.repeat(40) },
  files: ['.github/workflows/test.yml', 'hello.mjs'],
  run: async (command, args, options) => {
    const executed = spawnSync(process.env.ACT_BINARY || command, args, { env: options.env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (executed.error) throw executed.error;
    const stdout = `${executed.stdout || ''}${executed.stderr || ''}`;
    process.stdout.write(stdout);
    return { code: executed.status ?? 1, stdout };
  },
});
assert.equal(result.method, 'act');
assert.equal(result.code, 0);
assert.match(result.stdout, /Hello, World!/);
console.log('Real act fallback passed.');
