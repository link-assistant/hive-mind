/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { $ } from 'command-stream';
import { classifyUntrackedFiles, commitUncommittedChangesOnCriticalError, describePreservedWork } from '../src/critical-error-commit.lib.mjs';

test('recovery pushes screenshots and binary fixtures byte for byte without changing the PR branch', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'hive-2631-'));
  const work = join(root, 'work');
  const remote = join(root, 'remote.git');
  const git = (...args) => execFileSync('git', args, { cwd: work });
  try {
    await mkdir(work);
    execFileSync('git', ['init', '--bare', '-q', remote]);
    git('init', '-q', '-b', 'issue-2631');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    git('commit', '--allow-empty', '-qm', 'initial');
    git('remote', 'add', 'origin', remote);
    git('push', '-q', 'origin', 'issue-2631');
    const head = git('rev-parse', 'HEAD').toString();
    const files = ['docs/case-studies/screenshot.png', 'tests/data/sample.pdf', 'fixtures/input.bin', 'experiments/evidence.dat', 'assets/icon.png'];
    const binary = Buffer.from([0x89, 0x50, 0, 0x4e, 0x47]);
    for (const file of files) {
      await mkdir(join(work, file, '..'), { recursive: true });
      await writeFile(join(work, file), binary);
    }
    const result = await commitUncommittedChangesOnCriticalError({ tempDir: work, branchName: 'issue-2631', $: options => $({ ...options, mirror: false }), log: async () => {} });
    assert.equal(result.pushed, true);
    assert.deepEqual(result.preserved.sort(), files.sort());
    for (const file of files) assert.deepEqual(execFileSync('git', ['--git-dir', remote, 'show', `${result.recoveryBranch}:${file}`]), binary);
    assert.equal(git('rev-parse', 'HEAD').toString(), head);
    assert.equal(git('diff', '--cached', '--name-only').toString(), '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('large binaries have an accurate skip reason; build output stays excluded', { timeout: 10000 }, async () => {
  const work = await mkdtemp(join(tmpdir(), 'hive-2631-files-'));
  try {
    await mkdir(join(work, 'target'));
    await writeFile(join(work, 'target', 'generated.txt'), 'build output');
    await writeFile(join(work, 'large.png'), Buffer.alloc(5 * 1024 * 1024 + 1));
    const result = await classifyUntrackedFiles(work, ['large.png', 'target/generated.txt']);
    assert.deepEqual(result.keep, []);
    assert.equal(result.skippedDetails.find(file => file.path === 'large.png').reason, 'binary exceeds 5 MiB');
    const description = describePreservedWork({ committed: false, pushed: false, ...result });
    assert.match(description, /binary exceeds 5 MiB/);
    assert.doesNotMatch(description, /files were build output/);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
