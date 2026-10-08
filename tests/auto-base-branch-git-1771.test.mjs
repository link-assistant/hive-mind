/**
 * @hive-mind-test-suite default
 * Issue #1771: a reused checkout predates automatic creation of its PR base.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrCheckoutBranch } from '../src/solve.branch.lib.mjs';

const execute = promisify(execFile);

test('a reused checkout fetches an automatically created base before creating the issue branch', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'hive-auto-base-1771-'));
  const remote = join(root, 'remote.git');
  const source = join(root, 'source');
  const checkout = join(root, 'checkout');
  const logs = [];
  const git = async (cwd, ...args) => (await execute('git', args, { cwd })).stdout.trim();
  try {
    await mkdir(source);
    await git(source, 'init', '-b', 'trunk');
    await git(source, 'config', 'user.name', 'Test User');
    await git(source, 'config', 'user.email', 'test@example.com');
    await writeFile(join(source, 'README.md'), '# Fixture\n');
    await git(source, 'add', 'README.md');
    await git(source, 'commit', '-m', 'Initial commit');
    const sha = await git(source, 'rev-parse', 'HEAD');
    await git(root, 'clone', '--bare', source, remote);
    await git(root, 'clone', remote, checkout);
    // Equivalent to the GitHub POST: the new ref appears after this clone.
    await git(root, '--git-dir', remote, 'update-ref', 'refs/heads/release/next', sha);
    assert.equal(await git(checkout, 'for-each-ref', '--format=%(refname)', 'refs/remotes/origin/release/next'), '');

    const $ =
      options =>
      async (strings, ...values) => {
        // Preserve interpolated values as single argv entries (including paths).
        const template = strings.reduce((text, part, index) => text + part + (index < values.length ? `__value_${index}__` : ''), '');
        const args = template
          .trim()
          .split(/\s+/)
          .filter(arg => !/^\d*>/.test(arg))
          .map(arg => arg.replace(/__value_(\d+)__/g, (_, index) => String(values[index])));
        const [command, ...commandArgs] = args;
        assert.equal(command, 'git');
        try {
          const result = await execute(command, commandArgs, { cwd: options.cwd });
          return { code: 0, ...result };
        } catch (error) {
          return { code: error.code, stdout: error.stdout, stderr: error.stderr };
        }
      };
    const branch = await createOrCheckoutBranch({
      isContinueMode: false,
      issueNumber: 1,
      tempDir: checkout,
      defaultBranch: 'trunk',
      argv: { baseBranch: 'release/next', autoBaseBranchCreation: true },
      log: async message => logs.push(message),
      formatAligned: (icon, label, value) => `${icon} ${label} ${value}`,
      $,
      crypto: { randomBytes: () => Buffer.from('123456789abc', 'hex') },
      owner: 'o',
      repo: 'r',
    });
    assert.equal(branch, 'issue-1-123456789abc');
    assert.equal(await git(checkout, 'rev-parse', 'HEAD'), sha);
    assert.equal(await git(checkout, 'rev-parse', 'origin/release/next'), sha);
    assert.equal(await git(root, '--git-dir', remote, 'rev-parse', 'refs/heads/release/next'), sha);
    assert.ok(logs.some(message => message.includes('Fetching base branch:')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
